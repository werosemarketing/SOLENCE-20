import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWebAppRouter } from "../web";

let server: Server;
let root: string;
let base: string;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "solence-web-"));
  await mkdir(path.join(root, "_expo", "static"), { recursive: true });
  await writeFile(path.join(root, "index.html"), "<!doctype html><title>Solence</title><div id=\"root\"></div>");
  await writeFile(path.join(root, "_expo", "static", "app.js"), "console.log('Solence');");
  const app = express();
  // This has the same precedence as native manifest handling in server/index.ts.
  app.get("/", (req, res, next) => {
    if (req.header("expo-platform")) return res.json({ nativeManifest: true });
    next();
  });
  app.use(createWebAppRouter(root));
  app.get("/api/probe", (_req, res) => res.json({ api: true }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  );
  if (root) await rm(root, { recursive: true, force: true });
});

describe("published Expo web routing", () => {
  test("browser root and deep links load the app, not the Expo landing page", async () => {
    for (const route of ["/", "/?ref=example", "/profile"]) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type")!, /text\/html/);
      assert.equal(response.headers.get("cache-control"), "no-cache");
      assert.match(await response.text(), /<title>Solence<\/title>/);
    }
  });

  test("exported JavaScript is served as JavaScript", async () => {
    const response = await fetch(`${base}/_expo/static/app.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /javascript/);
    assert.match(await response.text(), /console\.log/);
  });

  test("APIs stay JSON and missing API or asset paths never return the shell", async () => {
    const api = await fetch(`${base}/api/probe`, { headers: { Accept: "text/html" } });
    assert.deepEqual(await api.json(), { api: true });
    for (const route of ["/api/missing", "/manifest", "/assets/missing", "/_expo/missing.js", "/android/missing.json"]) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 404);
      assert.doesNotMatch(await response.text(), /<title>Solence<\/title>/);
    }
  });

  test("native manifest headers still bypass the browser app", async () => {
    const response = await fetch(base, { headers: { "expo-platform": "ios" } });
    assert.deepEqual(await response.json(), { nativeManifest: true });
  });

  test("non-HTML API-style requests and POSTs do not receive the SPA", async () => {
    const json = await fetch(`${base}/profile`, { headers: { Accept: "application/json" } });
    assert.equal(json.status, 404);
    const post = await fetch(base, { method: "POST" });
    assert.equal(post.status, 404);
  });
});
