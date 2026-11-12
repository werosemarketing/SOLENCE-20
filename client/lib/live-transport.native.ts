import { NativeModules } from "react-native";
import { AudioModule, setAudioModeAsync } from "expo-audio";
import type { LiveTransport, LiveTransportEvents } from "./live-transport";

export async function createLiveTransport(events: LiveTransportEvents): Promise<LiveTransport> {
  if (!NativeModules.WebRTCModule) {
    throw new Error("Install the new Solence development build to enable live voice.");
  }
  const permission = await AudioModule.requestRecordingPermissionsAsync();
  if (!permission.granted) throw new Error("Microphone permission is needed. Enable it in your phone settings.");
  await setAudioModeAsync({
    allowsRecording: true, playsInSilentMode: true,
    interruptionMode: "doNotMix", shouldRouteThroughEarpiece: false,
  });
  // Load only after checking the native module, so older dev clients can
  // display an upgrade message instead of crashing at module evaluation.
  const { RTCPeerConnection, RTCSessionDescription, mediaDevices } =
    require("react-native-webrtc") as typeof import("react-native-webrtc");
  const peer = new RTCPeerConnection({});
  let stream: Awaited<ReturnType<typeof mediaDevices.getUserMedia>> | undefined;
  const channel = peer.createDataChannel("oai-events");
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    stream?.getTracks().forEach((track) => track.stop());
    channel.close();
    peer.close();
    void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  };
  // The package's declarations import an unexported event-target-shim
  // subpath. Keep the verified native event API typed at this boundary.
  const listen = (target: unknown, type: string, callback: (event: { data?: unknown }) => void) => {
    (target as { addEventListener: (type: string, handler: typeof callback) => void }).addEventListener(type, callback);
  };
  listen(channel, "message", (message) => {
    if (closed) return;
    try { events.event(JSON.parse(String(message.data))); }
    catch { /* Ignore malformed provider events, not connection failures. */ }
  });
  listen(channel, "close", () => { if (!closed) events.disconnected(); });
  listen(peer, "connectionstatechange", () => {
    if (!closed && (peer.connectionState === "failed" || peer.connectionState === "disconnected")) {
      events.disconnected();
    }
  });
  return {
    offer: async () => {
      try {
        stream = await mediaDevices.getUserMedia({ audio: true, video: false });
        if (closed) { stream.getTracks().forEach((track) => track.stop()); throw new Error("Call cancelled."); }
        stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream!));
        const offer = await peer.createOffer({});
        await peer.setLocalDescription(offer);
        if (closed || !offer.sdp) throw new Error("Could not create an audio connection.");
        return offer.sdp;
      } catch (error) { close(); throw error; }
    },
    answer: async (sdp) => {
      if (closed) throw new Error("Call cancelled.");
      // React Native WebRTC plays incoming audio tracks natively. No file
      // download or separate text-to-speech playback is involved.
      await peer.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp }));
    },
    mute: (muted) => stream?.getAudioTracks().forEach((track) => { track.enabled = !muted; }),
    close,
  };
}
