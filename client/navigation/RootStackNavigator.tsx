import React, { useState, useEffect, useCallback, useRef } from "react";
import { AppState, AppStateStatus, BackHandler, Platform } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { NavigatorScreenParams } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { useTranslation } from "react-i18next";
import DisclaimerScreen from "@/screens/DisclaimerScreen";
import OnboardingScreen from "@/screens/OnboardingScreen";
import UserAgreementScreen from "@/screens/UserAgreementScreen";
import AuthScreen from "@/screens/AuthScreen";
import UpgradeScreen from "@/screens/UpgradeScreen";
import ConversationDetailScreen from "@/screens/ConversationDetailScreen";
import BreathingScreen from "@/screens/BreathingScreen";
import WeeklySummaryScreen from "@/screens/WeeklySummaryScreen";
import MainTabNavigator, { type MainTabParamList } from "@/navigation/MainTabNavigator";
import LockScreen from "@/components/LockScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { getApiUrl } from "@/lib/query-client";
import {
  loadAppLockPreferences,
  thresholdToMs,
  type AppLockPreferences,
} from "@/lib/app-lock";
import {
  NOTIFICATION_CATEGORIES,
  categoryFromResponse,
  configureNotificationsForApp,
  isNotificationsSupported,
} from "@/lib/notifications";
import { navigationRef } from "@/lib/navigation-ref";

const STORAGE_KEY_DISCLAIMER = "solence_disclaimer_accepted";
const STORAGE_KEY_ONBOARDING = "solence_onboarding_complete";
const STORAGE_KEY_AUTH_TOKEN = "solence_auth_token";

type AppStage = "loading" | "auth" | "disclaimer" | "agreement" | "onboarding" | "main";

export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  Upgrade: { tokenLimit?: number; resetLabel?: string } | undefined;
  ConversationDetail: {
    conversationId: number;
    title?: string;
    scrollToMessageId?: number;
  };
  Breathing: undefined;
  WeeklySummary: { weekOffset?: number } | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Pull a referral code out of any URL the app is opened with. Tolerant
// of both deep-link form (`solence://signup?ref=CODE`) and the web
// fallback URL we generate server-side (`https://host/?ref=CODE`).
// Returns null when nothing useful is present.
function extractReferralCode(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = Linking.parse(url);
    const ref = parsed.queryParams?.ref;
    if (typeof ref !== "string") return null;
    const trimmed = ref.trim().toLowerCase().slice(0, 32);
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions();
  const { t } = useTranslation();
  const [stage, setStage] = useState<AppStage>("loading");
  const [authToken, setAuthToken] = useState<string | null>(null);
  // Most recently observed referral code from a deep link. Passed into
  // AuthScreen as `initialReferralCode` so the sign-up form prefills.
  // Kept in state so a deep-link arriving after launch (app already open
  // on the auth screen) still updates the input.
  const [pendingReferralCode, setPendingReferralCode] = useState<string | null>(
    null,
  );

  // App-lock state. `lockPrefs === null` while we're still loading the
  // user's preference; once we know it, `locked` decides whether the
  // LockScreen overlay is rendered above the rest of the app.
  const [lockPrefs, setLockPrefs] = useState<AppLockPreferences | null>(null);
  const [locked, setLocked] = useState(false);
  const backgroundedAtRef = useRef<number | null>(null);

  useEffect(() => {
    checkProgress();
  }, []);

  // Listen for inbound deep links. Both the cold-start URL and live
  // events are handled so we capture `?ref=CODE` whether the app was
  // launched by the link or merely focused while running.
  useEffect(() => {
    let cancelled = false;
    Linking.getInitialURL()
      .then((initialUrl) => {
        if (cancelled) return;
        const code = extractReferralCode(initialUrl);
        if (code) setPendingReferralCode(code);
      })
      .catch(() => {
        // Non-fatal: a missing initial URL just means no deep-link launch.
      });
    const sub = Linking.addEventListener("url", (event) => {
      const code = extractReferralCode(event?.url);
      if (code) setPendingReferralCode(code);
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // Load the app-lock preference on mount so we can decide whether to
  // show the lock screen on cold launch. We default to "show locked"
  // when enabled is true so the protected content never flashes before
  // the gate paints.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const prefs = await loadAppLockPreferences();
      if (cancelled) return;
      setLockPrefs(prefs);
      if (prefs.enabled) setLocked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-load preferences whenever we return to foreground so a toggle
  // change made during the session takes effect on the next background
  // round-trip without an app restart.
  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }
    const subscription = AppState.addEventListener(
      "change",
      (next: AppStateStatus) => {
        if (next === "background" || next === "inactive") {
          backgroundedAtRef.current = Date.now();
        } else if (next === "active") {
          // Re-fetch latest prefs in case the user just toggled them.
          loadAppLockPreferences().then((prefs) => {
            setLockPrefs(prefs);
            if (!prefs.enabled) {
              backgroundedAtRef.current = null;
              return;
            }
            const since = backgroundedAtRef.current;
            backgroundedAtRef.current = null;
            if (since == null) return;
            const elapsed = Date.now() - since;
            if (elapsed >= thresholdToMs(prefs.threshold)) {
              setLocked(true);
            }
          });
        }
      },
    );
    return () => {
      subscription.remove();
    };
  }, []);

  // Configure local notifications + listen for taps. We install the
  // foreground handler at boot so a scheduled reminder still surfaces a
  // banner if the app happens to be open. The response listener routes
  // a tap on the weekly-summary notification straight to that screen,
  // which is the deep-link contract the Profile UI promises the user.
  // Cold-start taps are handled via getLastNotificationResponseAsync so
  // we don't lose the navigation when the app was launched by the tap.
  useEffect(() => {
    if (!isNotificationsSupported()) return;
    configureNotificationsForApp();

    const handleResponse = (
      response: Notifications.NotificationResponse | null,
    ) => {
      if (!response) return;
      // Wait until the app is in the "main" stage and a token is present
      // before navigating — otherwise we'd be pushing onto a navigator
      // that hasn't mounted yet (auth/onboarding screens).
      if (stage !== "main") return;
      const category = categoryFromResponse(response);
      if (
        category === NOTIFICATION_CATEGORIES.weeklySummary &&
        navigationRef.isReady()
      ) {
        navigationRef.navigate("WeeklySummary", { weekOffset: 0 });
      }
      // Daily reminder taps just open the app to wherever it last was —
      // no special routing intended, the nudge itself is the point.
    };

    Notifications.getLastNotificationResponseAsync()
      .then(handleResponse)
      .catch(() => {
        // Non-fatal — just means there was no pending response.
      });
    const sub = Notifications.addNotificationResponseReceivedListener(
      handleResponse,
    );
    return () => {
      sub.remove();
    };
  }, [stage]);

  useEffect(() => {
    if (stage === "agreement" && Platform.OS !== "web") {
      const handler = BackHandler.addEventListener("hardwareBackPress", () => {
        setStage("disclaimer");
        return true;
      });
      return () => handler.remove();
    }
  }, [stage]);

  // Treat the server's onboardingCompletedAt as the source of truth so users
  // who upgrade into a new app version (or sign in on a new device) get the
  // personalization flow once. The local AsyncStorage flag is kept as a
  // fast-path cache so brand-new users don't see a flash of the auth screen
  // while we round-trip to /api/auth/me.
  const resolveOnboardingFromServer = async (token: string): Promise<boolean> => {
    try {
      const apiUrl = getApiUrl();
      const prefsResponse = await fetch(`${apiUrl}/api/preferences`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (prefsResponse.ok) {
        const data = await prefsResponse.json();
        const serverComplete = Boolean(
          data?.preferences?.onboardingCompletedAt,
        );
        if (serverComplete) {
          await AsyncStorage.setItem(STORAGE_KEY_ONBOARDING, "true");
        } else {
          await AsyncStorage.removeItem(STORAGE_KEY_ONBOARDING);
        }
        return serverComplete;
      }
    } catch {
      // Network hiccup: fall back to the local cache so we don't strand
      // returning users on the onboarding screen offline.
    }
    const cached = await AsyncStorage.getItem(STORAGE_KEY_ONBOARDING);
    return cached === "true";
  };

  const checkProgress = async () => {
    try {
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      if (!token) {
        setStage("auth");
        return;
      }

      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        await AsyncStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
        setStage("auth");
        return;
      }

      setAuthToken(token);

      const disclaimerAccepted = await AsyncStorage.getItem(STORAGE_KEY_DISCLAIMER);
      if (disclaimerAccepted !== "true") {
        setStage("disclaimer");
        return;
      }

      // /api/auth/me already returned the preferences payload — reuse it
      // before issuing a second request.
      let onboardingComplete = false;
      try {
        const me = await response.json();
        if (me?.preferences?.onboardingCompletedAt) {
          onboardingComplete = true;
          await AsyncStorage.setItem(STORAGE_KEY_ONBOARDING, "true");
        } else {
          await AsyncStorage.removeItem(STORAGE_KEY_ONBOARDING);
        }
      } catch {
        onboardingComplete = await resolveOnboardingFromServer(token);
      }

      if (!onboardingComplete) {
        setStage("onboarding");
        return;
      }

      setStage("main");
    } catch {
      setStage("auth");
    }
  };

  const handleAuthenticated = useCallback(async (token: string) => {
    await AsyncStorage.setItem(STORAGE_KEY_AUTH_TOKEN, token);
    setAuthToken(token);

    const disclaimerAccepted = await AsyncStorage.getItem(STORAGE_KEY_DISCLAIMER);
    if (disclaimerAccepted !== "true") {
      setStage("disclaimer");
      return;
    }

    const onboardingComplete = await resolveOnboardingFromServer(token);
    if (!onboardingComplete) {
      setStage("onboarding");
      return;
    }

    setStage("main");
  }, []);

  const handleSignOut = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
    setAuthToken(null);
    // Clear the lock so the AuthScreen isn't hidden behind it. The
    // user's lock preference itself is preserved so it re-engages
    // after they sign in again.
    setLocked(false);
    backgroundedAtRef.current = null;
    setStage("auth");
  }, []);

  const handleUnlock = useCallback(() => {
    setLocked(false);
    backgroundedAtRef.current = null;
  }, []);

  // Render the lock overlay above whatever stage we're in, but only
  // once the user is authenticated — the AuthScreen itself shouldn't
  // be gated, otherwise a signed-out user is trapped.
  const showLock =
    locked && lockPrefs?.enabled === true && stage !== "auth" && stage !== "loading";

  if (stage === "loading") {
    return null;
  }

  if (stage === "auth") {
    return (
      <AuthScreen
        onAuthenticated={handleAuthenticated}
        initialReferralCode={pendingReferralCode}
      />
    );
  }

  if (showLock) {
    return <LockScreen onUnlock={handleUnlock} onSignOut={handleSignOut} />;
  }

  if (stage === "disclaimer") {
    return (
      <DisclaimerScreen
        onAccept={() => setStage("onboarding")}
        onViewAgreement={() => setStage("agreement")}
      />
    );
  }

  if (stage === "agreement") {
    return <UserAgreementScreen onBack={() => setStage("disclaimer")} />;
  }

  if (stage === "onboarding") {
    return (
      <OnboardingScreen
        authToken={authToken}
        onComplete={() => setStage("main")}
      />
    );
  }

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Main"
        options={{ headerShown: false }}
      >
        {() => (
          <MainTabNavigator authToken={authToken} onSignOut={handleSignOut} />
        )}
      </Stack.Screen>
      <Stack.Screen
        name="Upgrade"
        component={UpgradeScreen}
        options={{
          headerShown: false,
          presentation: "modal",
          animation: "slide_from_bottom",
          gestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="ConversationDetail"
        component={ConversationDetailScreen}
        options={{
          title: t("conversationDetail.header"),
        }}
      />
      <Stack.Screen
        name="Breathing"
        component={BreathingScreen}
        options={{
          headerShown: false,
          presentation: "modal",
          animation: "slide_from_bottom",
          gestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="WeeklySummary"
        component={WeeklySummaryScreen}
        options={{
          title: t("weeklySummary.header"),
        }}
      />
    </Stack.Navigator>
  );
}
