/**
 * Completes iOS production credential setup in EAS:
 * - Re-downloads the provisioning profile from Apple (already created)
 * - Uploads it to EAS
 * - Links cert + profile as APP_STORE build credentials
 */
import { SignJWT, importPKCS8 } from "jose";
import { readFileSync } from "fs";

const EXPO_TOKEN = process.env.EXPO_TOKEN;
const ASC_KEY_ID = process.env.EXPO_ASC_API_KEY_ID;
const ASC_ISSUER = "2bf237d0-c893-4b61-819c-888b306ccb31";
const P8_PATH = "/tmp/asc/key.p8";

// IDs from previous successful steps
const EAS_CERT_ID = "835b8a49-f983-4773-b699-f29af2121a3d";
const APPLE_PROFILE_PORTAL_ID = "8PXF47C5PP";
const IOS_CREDS_ID = "3205d775-2e65-478b-bf72-2821dc5fd071";
const ACCOUNT_ID = "1e016e2a-e539-4b11-aa11-7da6b2c972e2";
const APPLE_APP_IDENTIFIER_ID = "f30596e3-6a64-4ed1-bd9c-1d3e0de1e218";

async function ascJwt() {
  const keyP8 = readFileSync(P8_PATH, "utf8");
  const pk = await importPKCS8(keyP8, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" })
    .setIssuer(ASC_ISSUER).setIssuedAt().setExpirationTime("20m")
    .setAudience("appstoreconnect-v1").sign(pk);
}

async function easMutation(query, variables) {
  const r = await fetch("https://api.expo.dev/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${EXPO_TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(`EAS error: ${JSON.stringify(j.errors)}`);
  return j.data;
}

// Step 1: re-download provisioning profile content from Apple
console.log("[1/3] Fetching provisioning profile from Apple...");
const jwt = await ascJwt();
const profResp = await fetch(
  `https://api.appstoreconnect.apple.com/v1/profiles/${APPLE_PROFILE_PORTAL_ID}`,
  { headers: { Authorization: `Bearer ${jwt}` } }
);
const profJson = await profResp.json();
if (profJson.errors) throw new Error(`Apple API: ${JSON.stringify(profJson.errors)}`);
const provProfileB64 = profJson.data.attributes.profileContent;
console.log(`  Got profile: ${profJson.data.attributes.name} (${profJson.data.attributes.profileState})`);

// Step 2: upload provisioning profile to EAS
console.log("[2/3] Uploading provisioning profile to EAS...");
const profData = await easMutation(
  `mutation CreateProfile($accountId: ID!, $appIdentifierId: ID!, $input: AppleProvisioningProfileInput!) {
    appleProvisioningProfile {
      createAppleProvisioningProfile(
        accountId: $accountId,
        appleAppIdentifierId: $appIdentifierId,
        appleProvisioningProfileInput: $input
      ) { id developerPortalIdentifier }
    }
  }`,
  {
    accountId: ACCOUNT_ID,
    appIdentifierId: APPLE_APP_IDENTIFIER_ID,
    input: {
      appleProvisioningProfile: provProfileB64,
      developerPortalIdentifier: APPLE_PROFILE_PORTAL_ID,
    },
  }
);
const easProfileId = profData.appleProvisioningProfile.createAppleProvisioningProfile.id;
console.log(`  EAS profile ID: ${easProfileId}`);

// Step 3: create APP_STORE IosAppBuildCredentials linking cert + profile
console.log("[3/3] Creating APP_STORE build credentials in EAS...");
const buildCredData = await easMutation(
  `mutation CreateBuildCred($iosCredId: ID!, $input: IosAppBuildCredentialsInput!) {
    iosAppBuildCredentials {
      createIosAppBuildCredentials(
        iosAppCredentialsId: $iosCredId,
        iosAppBuildCredentialsInput: $input
      ) { id iosDistributionType }
    }
  }`,
  {
    iosCredId: IOS_CREDS_ID,
    input: {
      iosDistributionType: "APP_STORE",
      distributionCertificateId: EAS_CERT_ID,
      provisioningProfileId: easProfileId,
    },
  }
);
const easBuildCredId =
  buildCredData.iosAppBuildCredentials.createIosAppBuildCredentials.id;
console.log(`  EAS build credentials ID: ${easBuildCredId}`);
console.log("\n✅ Credentials fully set up in EAS — ready to build.");
