import React, { createContext, useContext } from "react";
import { Platform } from "react-native";
import Purchases, { PurchasesPackage } from "react-native-purchases";
import { useMutation, useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";

const REVENUECAT_TEST_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

export const REVENUECAT_ENTITLEMENT_IDENTIFIER = "unlimited";

function getRevenueCatApiKey(): string {
  // Dev builds, Expo Go, and web always use the test store key
  if (__DEV__ || Platform.OS === "web" || Constants.executionEnvironment === "storeClient") {
    if (!REVENUECAT_TEST_API_KEY) {
      throw new Error("EXPO_PUBLIC_REVENUECAT_TEST_API_KEY is not set");
    }
    return REVENUECAT_TEST_API_KEY;
  }

  if (Platform.OS === "ios") {
    if (!REVENUECAT_IOS_API_KEY) {
      throw new Error("EXPO_PUBLIC_REVENUECAT_IOS_API_KEY is not set");
    }
    return REVENUECAT_IOS_API_KEY;
  }

  if (Platform.OS === "android") {
    if (!REVENUECAT_ANDROID_API_KEY) {
      throw new Error("EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY is not set");
    }
    return REVENUECAT_ANDROID_API_KEY;
  }

  // Fallback for any other platform (test store)
  if (!REVENUECAT_TEST_API_KEY) {
    throw new Error("EXPO_PUBLIC_REVENUECAT_TEST_API_KEY is not set");
  }
  return REVENUECAT_TEST_API_KEY;
}

export function initializeRevenueCat() {
  const apiKey = getRevenueCatApiKey();
  Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
  Purchases.configure({ apiKey });
  markRevenueCatReady();
  console.log("[RevenueCat] Configured with key ending in …" + apiKey.slice(-6));
}

// ── Context ──────────────────────────────────────────────────────────────────

// Module-level flag set by initializeRevenueCat so queries don't fire
// if initialization failed (e.g. missing key in dev).
let _rcReady = false;
export function markRevenueCatReady() { _rcReady = true; }
export function isRevenueCatReady() { return _rcReady; }

function useSubscriptionContext() {
  const ready = _rcReady;

  const customerInfoQuery = useQuery({
    queryKey: ["revenuecat", "customer-info"],
    queryFn: () => Purchases.getCustomerInfo(),
    staleTime: 60 * 1000,
    enabled: ready,
    retry: 1,
  });

  const offeringsQuery = useQuery({
    queryKey: ["revenuecat", "offerings"],
    queryFn: () => Purchases.getOfferings(),
    staleTime: 300 * 1000,
    enabled: ready,
    retry: 1,
  });

  const purchaseMutation = useMutation({
    mutationFn: async (pkg: PurchasesPackage) => {
      // Race against a 30-second timeout so the spinner never hangs forever
      // if the StoreKit sheet is dismissed while the app is backgrounded.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error("Purchase timed out"), { timedOut: true })), 30000)
      );
      const { customerInfo } = await Promise.race([
        Purchases.purchasePackage(pkg),
        timeout,
      ]);
      return customerInfo;
    },
    onSuccess: () => customerInfoQuery.refetch(),
  });

  const restoreMutation = useMutation({
    mutationFn: () => Purchases.restorePurchases(),
    onSuccess: () => customerInfoQuery.refetch(),
  });

  const isSubscribed =
    customerInfoQuery.data?.entitlements.active?.[REVENUECAT_ENTITLEMENT_IDENTIFIER] !== undefined;

  const offeringsError = offeringsQuery.error;
  const customerInfoError = customerInfoQuery.error;

  return {
    customerInfo: customerInfoQuery.data,
    offerings: offeringsQuery.data,
    isSubscribed,
    isReady: ready,
    isLoading: ready && (customerInfoQuery.isLoading || offeringsQuery.isLoading),
    offeringsError,
    customerInfoError,
    purchase: purchaseMutation.mutateAsync,
    restore: restoreMutation.mutateAsync,
    isPurchasing: purchaseMutation.isPending,
    isRestoring: restoreMutation.isPending,
  };
}

type SubscriptionContextValue = ReturnType<typeof useSubscriptionContext>;
const Context = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const value = useSubscriptionContext();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSubscription() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useSubscription must be used within a SubscriptionProvider");
  return ctx;
}
