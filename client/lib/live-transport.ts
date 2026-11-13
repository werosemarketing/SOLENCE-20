export type LiveTransport = {
  offer: () => Promise<string>;
  answer: (sdp: string) => Promise<void>;
  mute: (muted: boolean) => void;
  close: () => void;
};
export type LiveTransportEvents = {
  event: (event: Record<string, any>) => void;
  disconnected: () => void;
};

export async function createLiveTransport(_events: LiveTransportEvents): Promise<LiveTransport> {
  throw new Error("Live voice is available in the Solence iOS and Android apps. You can still use standard voice here.");
}
