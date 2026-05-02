import React, { useEffect, useState } from "react";
import { StyleSheet, Platform } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts, MPLUSRounded1c_300Light, MPLUSRounded1c_400Regular, MPLUSRounded1c_500Medium, MPLUSRounded1c_700Bold } from "@expo-google-fonts/m-plus-rounded-1c";
import * as SplashScreen from "expo-splash-screen";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { initI18n } from "@/lib/i18n";

import RootStackNavigator from "@/navigation/RootStackNavigator";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TextScaleProvider } from "@/hooks/useTextScale";
import { navigationRef } from "@/lib/navigation-ref";

SplashScreen.preventAutoHideAsync();

function applyWebFont() {
  if (Platform.OS !== "web") return;
  const style = document.createElement("style");
  style.textContent = `
    body, [data-testid], [role], div[dir], span[dir] {
      font-family: 'M PLUS Rounded 1c', system-ui, sans-serif;
    }
  `;
  document.head.appendChild(style);
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    MPLUSRounded1c_300Light,
    MPLUSRounded1c_400Regular,
    MPLUSRounded1c_500Medium,
    MPLUSRounded1c_700Bold,
  });

  // i18n bootstraps from AsyncStorage (solence_language) → device locale
  // → DEFAULT_LANGUAGE. We gate the splash on both fonts AND i18n so the
  // first frame the user sees is already in the correct language — no
  // English flash on Spanish devices.
  const [i18nReady, setI18nReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    initI18n()
      .catch((err) => {
        console.warn("i18n init failed:", err);
      })
      .finally(() => {
        if (!cancelled) setI18nReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && i18nReady) {
      SplashScreen.hideAsync();
      applyWebFont();
    }
  }, [fontsLoaded, fontError, i18nReady]);

  if ((!fontsLoaded && !fontError) || !i18nReady) return null;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TextScaleProvider>
          <SafeAreaProvider>
            <GestureHandlerRootView style={styles.root}>
              <KeyboardProvider>
                <NavigationContainer ref={navigationRef}>
                  <RootStackNavigator />
                </NavigationContainer>
                <StatusBar style="auto" />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </SafeAreaProvider>
        </TextScaleProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
