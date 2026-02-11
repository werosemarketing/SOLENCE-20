import React, { useState, useEffect } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import SolenceScreen from "@/screens/SolenceScreen";
import DisclaimerScreen from "@/screens/DisclaimerScreen";
import OnboardingScreen from "@/screens/OnboardingScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

const STORAGE_KEY_DISCLAIMER = "solence_disclaimer_accepted";
const STORAGE_KEY_ONBOARDING = "solence_onboarding_complete";

type AppStage = "loading" | "disclaimer" | "onboarding" | "main";

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
    return <DisclaimerScreen onAccept={() => setStage("onboarding")} />;
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
