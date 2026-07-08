/**
 * Sets up iOS App Store production credentials in EAS non-interactively:
 * 1. Generates a new RSA private key + CSR via openssl
 * 2. Signs a JWT with the ASC API key and calls Apple's API to issue a Distribution cert
 * 3. Packages the key + cert into a .p12
 * 4. Calls Apple's API to create an App Store provisioning profile
 * 5. Uploads the .p12 and profile to EAS via GraphQL
 * 6. Creates IosAppBuildCredentials (APP_STORE type) linking them
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { SignJWT, importPKCS8 } from "jose";

const EXPO_TOKEN = process.env.EXPO_TOKEN;
const ASC_KEY_ID = process.env.EXPO_ASC_API_KEY_ID;
const ASC_ISSUER = "2bf237d0-c893-4b61-819c-888b306ccb31";
const P8_PATH = "/tmp/asc/key.p8";
const TMP = "/tmp/asc";

const APP_ID = "3e250854-b7e0-4842-8b0b-b25122a8a41c";        // EAS app ID
const ACCOUNT_ID = "1e016e2a-e539-4b11-aa11-7da6b2c972e2";    // EAS account ID
const IOS_CREDS_ID = "3205d775-2e65-478b-bf72-2821dc5fd071";  // existing iosAppCredentials
const BUNDLE_ID = "com.solence.app";
const APPLE_TEAM_ID = "QR8C7YR992";
const P12_PASSWORD = "solence_build_2026";

// ── helpers ──────────────────────────────────────────────────────────────────

async function ascJwt() {
  const keyP8 = readFileSync(P8_PATH, "utf8");
  const privateKey = await importPKCS8(keyP8, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" })
    .setIssuer(ASC_ISSUER)
    .setIssuedAt()
    .setExpirationTime("20m")
    .setAudience("appstoreconnect-v1")
    .sign(privateKey);
}

async function appleGet(path, jwt) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const j = await r.json();
  if (j.errors) throw new Error(`Apple API error: ${JSON.stringify(j.errors)}`);
  return j;
}

async function applePost(path, body, jwt) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (j.errors) throw new Error(`Apple API error ${r.status}: ${JSON.stringify(j.errors)}`);
  return j;
}

async function easMutation(query, variables) {
  const r = await fetch("https://api.expo.dev/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${EXPO_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(`EAS GraphQL error: ${JSON.stringify(j.errors)}`);
  return j.data;
}

// ── step 1: generate private key + CSR ───────────────────────────────────────

console.log("\n[1/6] Generating RSA private key + CSR...");
execSync(`openssl genrsa -out ${TMP}/dist_key.pem 2048 2>/dev/null`);
execSync(
  `openssl req -new -key ${TMP}/dist_key.pem -out ${TMP}/dist_csr.pem` +
    ` -subj "/C=US/O=Solence/CN=Apple Distribution"` +
    ` 2>/dev/null`
);
const csrPem = readFileSync(`${TMP}/dist_csr.pem`, "utf8");
// Apple wants base64 of the PEM (the raw content without headers is what it actually uses)
const csrContent = csrPem
  .replace(/-----BEGIN CERTIFICATE REQUEST-----\n?/, "")
  .replace(/-----END CERTIFICATE REQUEST-----\n?/, "")
  .replace(/\n/g, "");
console.log("  CSR generated.");

// ── step 2: create distribution certificate via Apple API ─────────────────────

console.log("\n[2/6] Creating distribution certificate via Apple API...");
let jwt = await ascJwt();

const certResp = await applePost(
  "/v1/certificates",
  {
    data: {
      type: "certificates",
      attributes: { csrContent, certificateType: "DISTRIBUTION" },
    },
  },
  jwt
);

const appleCertId = certResp.data.id;
const certDerB64 = certResp.data.attributes.certificateContent; // DER base64
const serialNumber = certResp.data.attributes.serialNumber;
console.log(`  Certificate created. Apple ID: ${appleCertId}, serial: ${serialNumber}`);

// Write the DER cert
const certDer = Buffer.from(certDerB64, "base64");
writeFileSync(`${TMP}/dist_cert.der`, certDer);

// Convert DER → PEM
execSync(`openssl x509 -inform DER -in ${TMP}/dist_cert.der -out ${TMP}/dist_cert.pem 2>/dev/null`);

// ── step 3: package as .p12 ───────────────────────────────────────────────────

console.log("\n[3/6] Packaging .p12...");
execSync(
  `openssl pkcs12 -export` +
    ` -inkey ${TMP}/dist_key.pem` +
    ` -in ${TMP}/dist_cert.pem` +
    ` -out ${TMP}/dist_cert.p12` +
    ` -passout pass:${P12_PASSWORD}` +
    ` -legacy 2>/dev/null`
);
const p12B64 = readFileSync(`${TMP}/dist_cert.p12`).toString("base64");
console.log("  .p12 created.");

// ── step 4: get the bundle ID record from Apple ───────────────────────────────

console.log("\n[4/6] Looking up bundle ID in App Store Connect...");
jwt = await ascJwt(); // refresh — might have been > 1 min
const bundleResp = await appleGet(
  `/v1/bundleIds?filter[identifier]=${BUNDLE_ID}&filter[platform]=IOS&limit=1`,
  jwt
);
if (!bundleResp.data?.length) throw new Error(`Bundle ID ${BUNDLE_ID} not found in ASC`);
const bundleIdAscId = bundleResp.data[0].id;
console.log(`  Bundle ID ASC ID: ${bundleIdAscId}`);

// ── step 5: create App Store provisioning profile ─────────────────────────────

console.log("\n[5/6] Creating App Store provisioning profile...");
const profResp = await applePost(
  "/v1/profiles",
  {
    data: {
      type: "profiles",
      attributes: {
        name: `Solence App Store ${Date.now()}`,
        profileType: "IOS_APP_STORE",
      },
      relationships: {
        bundleId: { data: { type: "bundleIds", id: bundleIdAscId } },
        certificates: { data: [{ type: "certificates", id: appleCertId }] },
        devices: { data: [] },
      },
    },
  },
  jwt
);

const provProfileB64 = profResp.data.attributes.profileContent;
const provProfilePortalId = profResp.data.id;
console.log(`  Profile created. Portal ID: ${provProfilePortalId}`);

// ── step 6: upload to EAS and link ────────────────────────────────────────────

console.log("\n[6/6] Uploading credentials to EAS...");

// 6a. Create distribution certificate in EAS
const certData = await easMutation(
  `mutation CreateCert($accountId: ID!, $input: AppleDistributionCertificateInput!) {
    appleDistributionCertificate {
      createAppleDistributionCertificate(accountId: $accountId, appleDistributionCertificateInput: $input) {
        id
        developerPortalIdentifier
      }
    }
  }`,
  {
    accountId: ACCOUNT_ID,
    input: {
      certP12: p12B64,
      certPassword: P12_PASSWORD,
      developerPortalIdentifier: appleCertId,
      appleTeamId: null,
    },
  }
);
const easCertId = certData.appleDistributionCertificate.createAppleDistributionCertificate.id;
console.log(`  EAS cert ID: ${easCertId}`);

// 6b. Create provisioning profile in EAS
const profData = await easMutation(
  `mutation CreateProfile($appId: ID!, $input: AppleProvisioningProfileInput!) {
    appleProvisioningProfile {
      createAppleProvisioningProfile(iosAppCredentialsId: $appId, appleProvisioningProfileInput: $input) {
        id
        developerPortalIdentifier
      }
    }
  }`,
  {
    appId: IOS_CREDS_ID,
    input: {
      appleProvisioningProfile: provProfileB64,
      developerPortalIdentifier: provProfilePortalId,
    },
  }
);
const easProfileId = profData.appleProvisioningProfile.createAppleProvisioningProfile.id;
console.log(`  EAS profile ID: ${easProfileId}`);

// 6c. Create IosAppBuildCredentials for APP_STORE
const buildCredData = await easMutation(
  `mutation CreateBuildCred($iosCredId: ID!, $input: IosAppBuildCredentialsInput!) {
    iosAppBuildCredentials {
      createIosAppBuildCredentials(iosAppCredentialsId: $iosCredId, iosAppBuildCredentialsInput: $input) {
        id
        iosDistributionType
      }
    }
  }`,
  {
    iosCredId: IOS_CREDS_ID,
    input: {
      iosDistributionType: "APP_STORE",
      distributionCertificateId: easCertId,
      provisioningProfileId: easProfileId,
    },
  }
);
const easBuildCredId = buildCredData.iosAppBuildCredentials.createIosAppBuildCredentials.id;
console.log(`  EAS build credentials ID: ${easBuildCredId}`);

console.log("\n✅ Production iOS credentials set up successfully in EAS!");
console.log(`   Cert: ${easCertId}`);
console.log(`   Profile: ${easProfileId}`);
console.log(`   Build creds: ${easBuildCredId}`);
