import { createNavigationContainerRef } from "@react-navigation/native";

import type { RootStackParamList } from "@/navigation/RootStackNavigator";

// Singleton navigation ref used by code that lives outside the React tree
// (notification response listeners, deep-link handlers) to navigate
// without prop-drilling. Attached to NavigationContainer in App.tsx.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
