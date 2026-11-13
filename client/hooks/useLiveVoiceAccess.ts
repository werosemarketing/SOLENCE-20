import { useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/query-client";

export function useLiveVoiceAccess() {
  const query = useQuery<{ allowed: boolean; maxSeconds: number }>({
    queryKey: ["/api/chat/realtime/access"],
    queryFn: async () => {
      const token = await AsyncStorage.getItem("solence_auth_token");
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch(`${getApiUrl()}/api/chat/realtime/access`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Could not verify your Unlimited subscription. Please retry.");
      return response.json();
    },
    staleTime: 0,
    retry: 1,
    // RevenueCat's authenticated webhook can arrive shortly after a purchase.
    refetchInterval: (query) => query.state.data?.allowed === false ? 5000 : false,
  });
  const { refetch } = query;
  // A purchase or restore can change access while this screen is unfocused.
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  return query;
}
