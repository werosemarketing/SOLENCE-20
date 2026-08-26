import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildReferralShareUrl,
  warnIfReferralDomainMissing,
} from "../referrals";

const EXPECTED_PRODUCTION_WARNING =
  "Referral links may be broken: EXPO_PUBLIC_DOMAIN is not set in production. " +
  "Set it to the public app host (for example, app.solence.ai) so shared " +
  "referral links open correctly.";

function withEnvironment(
  values: {
    NODE_ENV?: string;
    EXPO_PUBLIC_DOMAIN?: string;
    REPLIT_DEV_DOMAIN?: string;
  },
  callback: () => void,
): void {
  const keys = ["NODE_ENV", "EXPO_PUBLIC_DOMAIN", "REPLIT_DEV_DOMAIN"] as const;
  const original = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );

  try {
    for (const key of keys) {
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) process.env[key] = value;
    }
    callback();
  } finally {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function assertValidPublicReferralDomain(
  value: unknown,
  source: string,
): { domain: string; host: URL } {
  assert.equal(typeof value, "string", `${source} must set EXPO_PUBLIC_DOMAIN`);
  if (typeof value !== "string") {
    throw new Error(`${source} must set EXPO_PUBLIC_DOMAIN`);
  }

  const domain = value.trim();
  assert.ok(domain, `${source} EXPO_PUBLIC_DOMAIN must not be empty`);
  assert.doesNotMatch(
    domain,
    /^https?:\/\//i,
    `${source} EXPO_PUBLIC_DOMAIN must be a host without a protocol`,
  );

  assert.doesNotThrow(
    () => new URL(`https://${domain}`),
    `${source} EXPO_PUBLIC_DOMAIN must be a valid public host`,
  );
  const host = new URL(`https://${domain}`);
  assert.equal(
    host.pathname,
    "/",
    `${source} EXPO_PUBLIC_DOMAIN must not include a path`,
  );
  assert.equal(
    host.search,
    "",
    `${source} EXPO_PUBLIC_DOMAIN must not include a query string`,
  );
  assert.equal(
    host.hash,
    "",
    `${source} EXPO_PUBLIC_DOMAIN must not include a fragment`,
  );
  assert.equal(
    host.host,
    domain.toLowerCase(),
    `${source} EXPO_PUBLIC_DOMAIN must contain only the public host`,
  );

  return { domain, host };
}

function assertReferralUrlUsesConfiguredHost(
  domain: string,
  configuredHost: URL,
): void {
  withEnvironment(
    { NODE_ENV: "production", EXPO_PUBLIC_DOMAIN: domain },
    () => {
      const referralUrl = new URL(buildReferralShareUrl("config-check"));
      assert.equal(referralUrl.host, configuredHost.host);
      assert.equal(referralUrl.protocol, "https:");
      assert.equal(referralUrl.searchParams.get("ref"), "config-check");
    },
  );
}

describe("referral share URLs", () => {
  test("production EAS config has a valid public referral domain", () => {
    const easConfig = JSON.parse(
      readFileSync(resolve(process.cwd(), "eas.json"), "utf8"),
    ) as {
      build?: {
        production?: {
          env?: {
            EXPO_PUBLIC_DOMAIN?: unknown;
          };
        };
      };
    };
    const domain = easConfig.build?.production?.env?.EXPO_PUBLIC_DOMAIN;
    const configured = assertValidPublicReferralDomain(
      domain,
      "production EAS config",
    );

    assertReferralUrlUsesConfiguredHost(configured.domain, configured.host);
  });

  test("production backend runtime config has a valid public referral domain", () => {
    const configured = assertValidPublicReferralDomain(
      process.env.EXPO_PUBLIC_DOMAIN,
      "production backend runtime environment",
    );

    assertReferralUrlUsesConfiguredHost(configured.domain, configured.host);
  });

  test("uses the configured public domain", () => {
    withEnvironment(
      {
        NODE_ENV: "production",
        EXPO_PUBLIC_DOMAIN: "app.solence.ai",
        REPLIT_DEV_DOMAIN: "development.example.com",
      },
      () => {
        assert.equal(
          buildReferralShareUrl("ABC 123"),
          "https://app.solence.ai/?ref=ABC%20123",
        );
      },
    );
  });

  test("warns when the public domain is missing in production", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message: string) => warnings.push(message);

    try {
      withEnvironment(
        {
          NODE_ENV: "production",
          REPLIT_DEV_DOMAIN: "development.example.com",
        },
        () => warnIfReferralDomainMissing(),
      );
    } finally {
      console.warn = originalWarn;
    }

    assert.deepEqual(warnings, [EXPECTED_PRODUCTION_WARNING]);
  });

  test("keeps the development-domain fallback", () => {
    withEnvironment(
      {
        NODE_ENV: "development",
        REPLIT_DEV_DOMAIN: "development.example.com",
      },
      () => {
        assert.equal(
          buildReferralShareUrl("dev-code"),
          "https://development.example.com/?ref=dev-code",
        );
      },
    );
  });
});
