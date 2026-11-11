import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("publishing keeps the server, web export, and native manifests in the image", () => {
  const rules = readFileSync(".replitignore", "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"));
  for (const directory of ["server_dist", "web-build", "static-build"]) {
    assert.ok(
      !rules.some((rule) => rule.includes(directory)),
      `${directory} is required at runtime and must not be excluded from publishing`,
    );
  }
});

test("the production server listens on the port mapped to public HTTP", () => {
  const config = readFileSync(".replit", "utf8");
  const deployment = config.split("[deployment]")[1].split("\n[")[0];
  const run = JSON.parse(deployment.match(/^run\s*=\s*(\[.*\])$/m)![1]) as string[];
  const publicMapping = config.split("[[ports]]").slice(1).find(
    (section) => /^externalPort\s*=\s*80\s*$/m.test(section.split("\n[")[0]),
  );
  assert.ok(publicMapping, "a public HTTP port must be configured");
  const localPort = publicMapping.match(/^localPort\s*=\s*(\d+)/m)![1];
  assert.match(run.join(" "), new RegExp(`\\bPORT=${localPort}\\b`));
  assert.match(deployment, /npm run web:build/);
  assert.match(deployment, /npm run server:build/);
});
