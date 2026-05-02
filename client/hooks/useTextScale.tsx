import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const TEXT_SCALE_OPTIONS = [
  { id: "default", label: "Default", scale: 1.0 },
  { id: "larger", label: "Larger", scale: 1.15 },
  { id: "largest", label: "Largest", scale: 1.3 },
] as const;

export type TextScaleId = (typeof TEXT_SCALE_OPTIONS)[number]["id"];

const STORAGE_KEY = "solence_text_scale";
const DEFAULT_ID: TextScaleId = "default";

function scaleForId(id: TextScaleId): number {
  return (
    TEXT_SCALE_OPTIONS.find((o) => o.id === id)?.scale ?? 1.0
  );
}

type TextScaleContextValue = {
  scaleId: TextScaleId;
  scale: number;
  setScaleId: (id: TextScaleId) => void;
  ready: boolean;
};

const TextScaleContext = createContext<TextScaleContextValue>({
  scaleId: DEFAULT_ID,
  scale: 1.0,
  setScaleId: () => {},
  ready: true,
});

export function TextScaleProvider({ children }: { children: React.ReactNode }) {
  const [scaleId, setScaleIdState] = useState<TextScaleId>(DEFAULT_ID);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) return;
        if (stored && TEXT_SCALE_OPTIONS.some((o) => o.id === stored)) {
          setScaleIdState(stored as TextScaleId);
        }
      } catch {
        // ignore — fall back to default
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setScaleId = useCallback((id: TextScaleId) => {
    setScaleIdState(id);
    AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {
      // best-effort persistence
    });
  }, []);

  const value = useMemo<TextScaleContextValue>(
    () => ({
      scaleId,
      scale: scaleForId(scaleId),
      setScaleId,
      ready,
    }),
    [scaleId, setScaleId, ready],
  );

  return (
    <TextScaleContext.Provider value={value}>
      {children}
    </TextScaleContext.Provider>
  );
}

export function useTextScale(): TextScaleContextValue {
  return useContext(TextScaleContext);
}
