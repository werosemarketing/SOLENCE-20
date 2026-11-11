import React, { createContext, useContext } from "react";
import { Platform } from "react-native";
import Purchases, { PurchasesPackage } from "react-native-purchases";
import { useMutation, useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl, queryClient } from "@/lib/query-client";

const isPublishedWeb = Platform.OS === "web" && !__DEV__;
const WEB_ENTITLEMENT_QUERY = ["revenuecat", "web-entitlement"] as const;

const REVENUECAT_TEST_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

export const REVENUECAT_ENTITLEMENT_IDENTIFIER = "premium";

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
  // The Test Store must never provide checkout on the public website.
  // Native store purchases remain unchanged.
  if (isPublishedWeb) return;
  const apiKey = getRevenueCatApiKey();
  Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
  Purchases.configure({ apiKey });
  markRevenueCatReady();
  console.log("[RevenueCat] Configured with key ending in …" + apiKey.slice(-6));
}

// Identify the RevenueCat customer with our internal user id so webhooks
// carry it as app_user_id — the backend uses it to flip users.isPremium.
// Best-effort: an RC hiccup must never block auth flows.
export async function logInRevenueCat(userId: string) {
  if (isPublishedWeb) {
    await queryClient.invalidateQueries({ queryKey: WEB_ENTITLEMENT_QUERY });
    return;
  }
  if (!_rcReady || !userId) return;
  try {
    await Purchases.logIn(userId);
    console.log("[RevenueCat] Logged in as user " + userId.slice(0, 8) + "…");
  } catch (error) {
    console.error("[RevenueCat] logIn failed:", error);
  }
}

export async function logOutRevenueCat() {
  if (isPublishedWeb) {
    await queryClient.cancelQueries({ queryKey: WEB_ENTITLEMENT_QUERY });
    queryClient.setQueryData(WEB_ENTITLEMENT_QUERY, false);
    return;
  }
  if (!_rcReady) return;
  try {
    await Purchases.logOut();
  } catch (error) {
    // logOut throws if the current user is already anonymous — harmless.
    console.log("[RevenueCat] logOut skipped:", error instanceof Error ? error.message : error);
  }
}

// ── Context ──────────────────────────────────────────────────────────────────

// Module-level flag set by initializeRevenueCat so queries don't fire
// if initialization failed (e.g. missing key in dev).
let _rcReady = false;
export function markRevenueCatReady() { _rcReady = true; }
export function isRevenueCatReady() { return _rcReady; }

function useSubscriptionContext() {
  const ready = _rcReady;
  const webEntitlementQuery = useQuery({
    queryKey: WEB_ENTITLEMENT_QUERY,
    enabled: isPublishedWeb,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: async () => {
      const token = await AsyncStorage.getItem("solence_auth_token");
      if (!token) return false;
      const response = await fetch(`${getApiUrl()}/api/tokens`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) return false;
      if (!response.ok) throw new Error("Could not verify your subscription.");
      const data = await response.json();
      return data.isPremium === true;
    },
  });

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
      if (isPublishedWeb) throw new Error("Manage purchases in the Solence mobile app.");
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      return customerInfo;
    },
    onSuccess: () => customerInfoQuery.refetch(),
  });

  const restoreMutation = useMutation({
    mutationFn: () => {
      if (isPublishedWeb) throw new Error("Restore purchases in the Solence mobile app.");
      return Purchases.restorePurchases();
    },
    onSuccess: () => customerInfoQuery.refetch(),
  });

  const isSubscribed = isPublishedWeb
    ? webEntitlementQuery.data === true
    : customerInfoQuery.data?.entitlements.active?.[REVENUECAT_ENTITLEMENT_IDENTIFIER] !== undefined;

  const offeringsError = offeringsQuery.error;
  const customerInfoError = customerInfoQuery.error;

  return {
    customerInfo: customerInfoQuery.data,
    offerings: offeringsQuery.data,
    isSubscribed,
    canPurchaseInApp: !isPublishedWeb,
    isReady: ready,
    isLoading: isPublishedWeb
      ? webEntitlementQuery.isLoading
      : ready && (customerInfoQuery.isLoading || offeringsQuery.isLoading),
    offeringsError,
    customerInfoError: isPublishedWeb ? webEntitlementQuery.error : customerInfoError,
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
