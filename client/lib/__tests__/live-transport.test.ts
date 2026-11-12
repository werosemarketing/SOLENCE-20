import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

// Exercise native transport wiring without needing a device or microphone.
const compiled = transformSync(
  readFileSync(resolve("client/lib/live-transport.native.ts"), "utf8"),
  { loader: "ts", format: "cjs" },
).code;

async function setup() {
  const modes: Array<Record<string, unknown>> = [];
  const events: Array<{ type: string }> = [];
  const gains: number[] = [];
  let routeFails = false;
  let microphoneStopped = false;
  let microphoneGainChanges = 0;
  const microphone = {
    kind: "audio", enabled: true,
    stop: () => { microphoneStopped = true; },
    _setVolume: () => { microphoneGainChanges++; },
  };
  const stream = { getTracks: () => [microphone], getAudioTracks: () => [microphone] };
  class EventTarget {
    handlers = new Map<string, Array<(event: any) => void>>();
    addEventListener(type: string, handler: (event: any) => void) {
      this.handlers.set(type, [...this.handlers.get(type) ?? [], handler]);
    }
    emit(type: string, event = {}) { this.handlers.get(type)?.forEach(handler => handler(event)); }
  }
  class Channel extends EventTarget {
    closed = false;
    close() { this.closed = true; }
  }
  const channel = new Channel();
  const peers: Peer[] = [];
  class Peer extends EventTarget {
    connectionState = "new";
    closed = false;
    constructor() { super(); peers.push(this); }
    createDataChannel() { return channel; }
    addTrack() {}
    async createOffer() { return { sdp: "v=0\r\n" }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() { this.closed = true; }
  }
  const module = { exports: {} as any };
  runInNewContext(compiled, {
    module, exports: module.exports,
    require: (name: string) => {
      if (name === "react-native") return { NativeModules: { WebRTCModule: {} } };
      if (name === "expo-audio") return {
        AudioModule: { requestRecordingPermissionsAsync: async () => ({ granted: true }) },
        setAudioModeAsync: async (mode: Record<string, unknown>) => {
          modes.push({ ...mode });
          if (routeFails && mode.allowsRecording) throw new Error("Audio route failed");
        },
      };
      if (name === "react-native-webrtc") return {
        RTCPeerConnection: Peer, RTCSessionDescription: class {},
        mediaDevices: { getUserMedia: async () => stream },
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const transport = await module.exports.createLiveTransport({
    event: (event: { type: string }) => events.push(event),
    disconnected: () => events.push({ type: "disconnected" }),
  });
  return {
    transport, peer: peers[0], channel, modes, events, microphone,
    incomingAudio: { kind: "audio", _setVolume: (gain: number) => gains.push(gain) },
    gains,
    failRoute: () => { routeFails = true; },
    microphoneStopped: () => microphoneStopped,
    microphoneGainChanges: () => microphoneGainChanges,
  };
}

test("live voice reapplies speaker playback after remote setup and WebRTC audio activation", async () => {
  const app = await setup();
  await app.transport.offer();
  await app.transport.answer("v=0\r\n");
  app.peer.connectionState = "connected";
  app.peer.emit("connectionstatechange");
  assert.equal(app.modes.length, 3);
  for (const mode of app.modes) {
    assert.equal(mode.shouldRouteThroughEarpiece, false);
    assert.equal(mode.allowsRecording, true);
    assert.equal(mode.playsInSilentMode, true);
    assert.equal(mode.interruptionMode, "doNotMix");
  }
  app.transport.close();
});

test("only incoming speech gets a moderate gain; microphone volume and mute remain independent", async () => {
  const app = await setup();
  await app.transport.offer();
  app.peer.emit("track", { track: app.incomingAudio });
  app.peer.emit("track", { track: { kind: "video", _setVolume: () => assert.fail("Video gain changed") } });
  assert.deepEqual(app.gains, [2]);
  assert.equal(app.microphoneGainChanges(), 0);
  app.transport.mute(true);
  assert.equal(app.microphone.enabled, false);
  app.transport.mute(false);
  assert.equal(app.microphone.enabled, true);
  app.transport.close();
});

test("ending a call stops recording and ignores later speaker or track events", async () => {
  const app = await setup();
  await app.transport.offer();
  app.transport.close();
  const modeCount = app.modes.length;
  app.peer.connectionState = "connected";
  app.peer.emit("connectionstatechange");
  app.peer.emit("track", { track: app.incomingAudio });
  assert.equal(app.modes.length, modeCount);
  assert.equal(app.modes.at(-1)?.allowsRecording, false);
  assert.equal(app.microphoneStopped(), true);
  assert.equal(app.peer.closed, true);
  assert.equal(app.channel.closed, true);
  assert.deepEqual(app.gains, []);
  await assert.rejects(app.transport.answer("v=0\r\n"), /cancelled/);
});

test("speaker routing failures are reported instead of silently leaving quiet playback", async () => {
  const app = await setup();
  app.failRoute();
  app.peer.connectionState = "connected";
  app.peer.emit("connectionstatechange");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.events[0]?.type, "solence.audio_error");
  app.transport.close();
});

test("cancelling during remote setup does not reactivate recording afterward", async () => {
  const app = await setup();
  const answer = app.transport.answer("v=0\r\n");
  app.transport.close();
  await assert.rejects(answer, /cancelled/);
  assert.equal(app.modes.at(-1)?.allowsRecording, false);
  assert.equal(app.modes.length, 2);
});
