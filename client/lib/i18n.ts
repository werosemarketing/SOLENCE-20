import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";

import en from "@/locales/en.json";
import es from "@/locales/es.json";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_OPTIONS,
  type Language,
} from "@shared/schema";

export const LANGUAGE_STORAGE_KEY = "solence_language";

function isSupportedLanguage(value: unknown): value is Language {
  return (
    typeof value === "string" &&
    (LANGUAGE_OPTIONS as readonly string[]).includes(value)
  );
}

// Pick the device's preferred locale and reduce it to one of our supported
// languages, falling back to the default. Used when the user has never
// explicitly picked a language in-app.
function detectDeviceLanguage(): Language {
  try {
    const locales = Localization.getLocales();
    for (const loc of locales) {
      const code = (loc.languageCode ?? "").toLowerCase();
      if (isSupportedLanguage(code)) return code;
    }
  } catch {
    // expo-localization can throw on web in odd contexts — fall through.
  }
  return DEFAULT_LANGUAGE;
}

let initPromise: Promise<typeof i18n> | null = null;

// Initialize i18next exactly once. The bootstrap is async because we need
// to wait on AsyncStorage; subsequent callers receive the same promise.
export function initI18n(): Promise<typeof i18n> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    let stored: Language | null = null;
    try {
      const raw = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (isSupportedLanguage(raw)) stored = raw;
    } catch {
      // AsyncStorage failures are non-fatal — we'll use the device locale.
    }

    const initialLanguage = stored ?? detectDeviceLanguage();

    await i18n.use(initReactI18next).init({
      resources: {
        en: { translation: en },
        es: { translation: es },
      },
      lng: initialLanguage,
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: LANGUAGE_OPTIONS as readonly string[] as string[],
      interpolation: { escapeValue: false },
      compatibilityJSON: "v4",
      returnNull: false,
      saveMissing: __DEV__,
      missingKeyHandler: __DEV__
        ? (lngs, ns, key) => {
            console.warn(
              `[i18n] missing key "${key}" for languages [${lngs.join(", ")}]`,
            );
          }
        : undefined,
    });

    return i18n;
  })();
  return initPromise;
}

// Persist the active language and switch i18next + i18n's internal state.
// Safe to call before init resolves; the change is queued via initI18n.
export async function setAppLanguage(language: Language): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Non-fatal — the in-memory change still applies for this session.
  }
  await initI18n();
  if (i18n.language !== language) {
    await i18n.changeLanguage(language);
  }
}

export function getCurrentLanguage(): Language {
  const lng = i18n.language;
  return isSupportedLanguage(lng) ? lng : DEFAULT_LANGUAGE;
}

export default i18n;
