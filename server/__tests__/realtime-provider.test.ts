import { test } from "node:test";
import assert from "node:assert/strict";
import { negotiateLiveCall } from "../realtime-provider";

const offer = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const config = { type: "realtime", model: "gpt-realtime" };

test("realtime negotiation authorizes the session then exchanges plain SDP using the short-lived credential", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const request: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return requests.length === 1
      ? Response.json({ value: "test-short-lived-credential" })
      : new Response(offer, { status: 201, headers: {
        location: "https://api.openai.com/v1/realtime/calls/rtc_test",
      } });
  };
  const result = await negotiateLiveCall(offer, config, "test-user", "test-server-credential", request);
  assert.deepEqual(result, { answer: offer, callId: "rtc_test" });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://api.openai.com/v1/realtime/client_secrets");
  assert.deepEqual(JSON.parse(requests[0].init!.body as string), { session: config });
  assert.equal(new Headers(requests[0].init?.headers).get("Authorization"), "Bearer test-server-credential");
  assert.equal(new Headers(requests[1].init?.headers).get("Authorization"), "Bearer test-short-lived-credential");
  assert.equal(new Headers(requests[1].init?.headers).get("Content-Type"), "application/sdp");
  assert.equal(requests[1].init?.body, offer);
  assert.ok(!JSON.stringify(result).includes("credential"));
});

test("failed session authorization stops negotiation and does not expose provider error contents", async () => {
  let count = 0;
  const request: typeof fetch = async () => {
    count++;
    return Response.json({ error: {
      code: "invalid_api_key", message: "Sensitive upstream details must not reach the client",
    } }, { status: 401 });
  };
  await assert.rejects(
    negotiateLiveCall(offer, config, "test-user", "test-server-credential", request),
    { message: "OpenAI could not authorize live voice (401: invalid_api_key)." },
  );
  assert.equal(count, 1);
});

test("a successful token response without a credential cannot start a call", async () => {
  let count = 0;
  const request: typeof fetch = async () => { count++; return Response.json({}); };
  await assert.rejects(
    negotiateLiveCall(offer, config, "test-user", "test-server-credential", request),
    /invalid live voice authorization/,
  );
  assert.equal(count, 1);
});

test("a token alone is not sufficient; failed SDP exchanges preserve the actual failure stage", async () => {
  let count = 0;
  const request: typeof fetch = async () => ++count === 1
    ? Response.json({ value: "test-short-lived-credential" })
    : Response.json({ error: { code: "model_not_found" } }, { status: 403 });
  await assert.rejects(
    negotiateLiveCall(offer, config, "test-user", "test-server-credential", request),
    { message: "OpenAI could not connect live voice (403: model_not_found)." },
  );
});
