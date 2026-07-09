import { ReplitConnectors } from "@replit/connectors-sdk";
import { createClient } from "@replit/revenuecat-sdk/client";

/**
 * Returns a fresh RevenueCat API client authenticated via the Replit
 * RevenueCat connector. Called "uncachable" because the connector token
 * can rotate — always call this at the top of each script run rather
 * than caching the client across invocations.
 */
export async function getUncachableRevenueCatClient() {
  const connectors = new ReplitConnectors();
  const proxyFetch = connectors.createProxyFetch("revenuecat");

  return createClient({
    baseUrl: "https://api.revenuecat.com/v2",
    fetch: proxyFetch as typeof fetch,
  });
}
