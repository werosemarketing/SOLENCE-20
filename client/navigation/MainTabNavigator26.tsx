import React from "react";
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
          icon: {
            sfSymbolName: "house",
          },
          selectedIcon: {
            sfSymbolName: "house.fill",
          },
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStackNavigator}
        options={{
          title: t("profile.header"),
          icon: {
            sfSymbolName: "person",
          },
          selectedIcon: {
            sfSymbolName: "person.fill",
          },
        }}
      />
    </Tab.Navigator>
  );
}
