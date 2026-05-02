import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { NavigatorScreenParams } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import SolenceScreen from "@/screens/SolenceScreen";
import ProfileStackNavigator, {
  type ProfileStackParamList,
} from "@/navigation/ProfileStackNavigator";
import { useTheme } from "@/hooks/useTheme";

export type MainTabParamList = {
  HomeTab:
    | {
        activeConversationId?: number;
        activeConversationTitle?: string;
        breathingStarter?: string;
      }
    | undefined;
  ProfileTab: NavigatorScreenParams<ProfileStackParamList> | undefined;
};

export type MainTabNavigatorProps = {
  authToken: string | null;
  onSignOut: () => void;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function MainTabNavigator({
  authToken,
  onSignOut,
}: MainTabNavigatorProps) {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation();

  return (
    <Tab.Navigator
      initialRouteName="HomeTab"
      screenOptions={{
        tabBarActiveTintColor: theme.tabIconSelected,
        tabBarInactiveTintColor: theme.tabIconDefault,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: Platform.select({
            ios: "transparent",
            android: theme.backgroundRoot,
          }),
          borderTopWidth: 0,
          elevation: 0,
        },
        tabBarBackground: () =>
          Platform.OS === "ios" ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : null,
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="HomeTab"
        options={{
          title: t("solence.header"),
          tabBarIcon: ({ color, size }) => (
            <Feather name="circle" size={size} color={color} />
          ),
        }}
      >
        {(props) => (
          <SolenceScreen
            authToken={authToken}
            onSignOut={onSignOut}
            route={props.route}
            navigation={props.navigation}
          />
        )}
      </Tab.Screen>
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStackNavigator}
        options={{
          title: t("profile.header"),
          tabBarIcon: ({ color, size }) => (
            <Feather name="user" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
