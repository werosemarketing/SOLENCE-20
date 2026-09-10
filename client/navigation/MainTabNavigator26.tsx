import React from "react";
import { Platform } from "react-native";
import { createNativeBottomTabNavigator } from "@react-navigation/bottom-tabs/unstable";
import { useTranslation } from "react-i18next";

import HomeStackNavigator from "@/navigation/HomeStackNavigator";
import ProfileStackNavigator from "@/navigation/ProfileStackNavigator";

export type MainTabParamList = {
  HomeTab: undefined;
  ProfileTab: undefined;
};

const Tab = createNativeBottomTabNavigator<MainTabParamList>();

export default function MainTabNavigator26() {
  const { t } = useTranslation();
  return (
    <Tab.Navigator
      initialRouteName="HomeTab"
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeStackNavigator}
        options={{
          title: t("headerTitle.appName"),
          tabBarIcon: ({ focused }) =>
            Platform.OS === "ios"
              ? {
                  type: "sfSymbol",
                  name: focused ? "house.fill" : "house",
                }
              : {
                  type: "image",
                  source: require("../../assets/images/tab-home.png"),
                },
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStackNavigator}
        options={{
          title: t("profile.header"),
          tabBarIcon: ({ focused }) =>
            Platform.OS === "ios"
              ? {
                  type: "sfSymbol",
                  name: focused ? "person.fill" : "person",
                }
              : {
                  type: "image",
                  source: require("../../assets/images/tab-profile.png"),
                },
        }}
      />
    </Tab.Navigator>
  );
}
