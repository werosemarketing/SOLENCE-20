import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import SolenceScreen from "@/screens/SolenceScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type RootStackParamList = {
  Solence: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions();

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
