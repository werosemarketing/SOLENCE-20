import React, { useState, useEffect, useCallback } from "react";
import { BackHandler, Platform } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { NavigatorScreenParams } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DisclaimerScreen from "@/screens/DisclaimerScreen";
import OnboardingScreen from "@/screens/OnboardingScreen";
import UserAgreementScreen from "@/screens/UserAgreementScreen";
import AuthScreen from "@/screens/AuthScreen";
import UpgradeScreen from "@/screens/UpgradeScreen";
import ConversationDetailScreen from "@/screens/ConversationDetailScreen";
import MainTabNavigator, { type MainTabParamList } from "@/navigation/MainTabNavigator";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { getApiUrl } from "@/lib/query-client";

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
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions();
  const [stage, setStage] = useState<AppStage>("loading");
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    checkProgress();
  }, []);

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
    setStage("auth");
  }, []);

  if (stage === "loading") {
    return null;
  }

  if (stage === "auth") {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
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
          title: "Conversation",
        }}
      />
    </Stack.Navigator>
  );
}
