import React, { useState, useEffect } from "react";
import { BackHandler, Platform } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import SolenceScreen from "@/screens/SolenceScreen";
import DisclaimerScreen from "@/screens/DisclaimerScreen";
import OnboardingScreen from "@/screens/OnboardingScreen";
import UserAgreementScreen from "@/screens/UserAgreementScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

const STORAGE_KEY_DISCLAIMER = "solence_disclaimer_accepted";
const STORAGE_KEY_ONBOARDING = "solence_onboarding_complete";

type AppStage = "loading" | "disclaimer" | "agreement" | "onboarding" | "main";

export type RootStackParamList = {
  Solence: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions();
  const [stage, setStage] = useState<AppStage>("loading");

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

  const checkProgress = async () => {
    try {
      const disclaimerAccepted = await AsyncStorage.getItem(STORAGE_KEY_DISCLAIMER);
      if (disclaimerAccepted !== "true") {
        setStage("disclaimer");
        return;
      }

      const onboardingComplete = await AsyncStorage.getItem(STORAGE_KEY_ONBOARDING);
      if (onboardingComplete !== "true") {
        setStage("onboarding");
        return;
      }

      setStage("main");
    } catch {
      setStage("disclaimer");
    }
  };

  if (stage === "loading") {
    return null;
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
    return <OnboardingScreen onComplete={() => setStage("main")} />;
  }

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Solence"
        component={SolenceScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
