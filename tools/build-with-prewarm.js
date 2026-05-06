const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

require("./patch-expo-debugger");

function stripProtocol(domain) {
  let u = domain.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return new URL(u).host;
}

function getDomain() {
  if (process.env.REPLIT_INTERNAL_APP_DOMAIN) return stripProtocol(process.env.REPLIT_INTERNAL_APP_DOMAIN);
  if (process.env.REPLIT_DEV_DOMAIN) return stripProtocol(process.env.REPLIT_DEV_DOMAIN);
  if (process.env.EXPO_PUBLIC_DOMAIN) return stripProtocol(process.env.EXPO_PUBLIC_DOMAIN);
  console.error("[prewarm] No deployment domain found");
  process.exit(1);
}

async function checkStatus() {
  try {
    const res = await fetch("http://localhost:8081/status", {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForReady(metroProc, timeoutMs) {
  const start = Date.now();
  let exited = false;
  metroProc.on("exit", () => {
    exited = true;
  });
  while (Date.now() - start < timeoutMs) {
    if (exited) {
      console.error("[prewarm] Metro process exited unexpectedly");
      return false;
    }
    if (await checkStatus()) {
      const secs = Math.round((Date.now() - start) / 1000);
      console.log(`[prewarm] Metro ready after ${secs}s`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function clearCaches() {
  for (const dir of [".metro-cache", "node_modules/.cache/metro"]) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`[prewarm] cleared ${dir}`);
    }
  }
}

async function main() {
  const domain = getDomain();
  console.log(`[prewarm] domain=${domain}`);

  if (await checkStatus()) {
    console.log("[prewarm] Metro already running, skipping pre-warm");
    runBuild(domain);
    return;
  }

  clearCaches();

  console.log("[prewarm] starting Metro in background...");
  const metro = spawn("npm", ["run", "expo:start:static:build"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, EXPO_PUBLIC_DOMAIN: domain },
    detached: false,
  });
  metro.stdout.on("data", (d) => process.stdout.write(`[Metro] ${d}`));
  metro.stderr.on("data", (d) => process.stderr.write(`[Metro Err] ${d}`));

  const ready = await waitForReady(metro, 5 * 60 * 1000);
  if (!ready) {
    console.error("[prewarm] Metro did not become ready within 5 minutes");
    metro.kill();
    process.exit(1);
  }

  runBuild(domain, metro);
}

function runBuild(domain, metroToCleanup) {
  console.log("[prewarm] running scripts/build.js (Metro will be reused)");
  const build = spawn("node", ["scripts/build.js"], {
    stdio: "inherit",
    env: { ...process.env, EXPO_PUBLIC_DOMAIN: domain },
  });
  build.on("exit", (code) => {
    if (metroToCleanup) {
      try {
        metroToCleanup.kill();
      } catch {}
    }
    process.exit(code ?? 1);
  });
}

main().catch((err) => {
  console.error("[prewarm] fatal:", err.message);
  process.exit(1);
});
