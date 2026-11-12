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
  throw new Error("This live voice test is available in the rebuilt Solence development app.");
}
