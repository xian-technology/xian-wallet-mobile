// Crypto polyfill must be first import
import "./src/lib/crypto-polyfill";

import React from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Text } from "react-native";

import { WalletProvider, useWallet } from "./src/lib/wallet-context";
import { Toast } from "./src/components/Toast";
import { colors } from "./src/theme/colors";
import { SetupScreen } from "./src/screens/SetupScreen";
import { LockScreen } from "./src/screens/LockScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { SendScreen } from "./src/screens/SendScreen";
import { ReceiveScreen } from "./src/screens/ReceiveScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function HomeTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg0 },
        headerTintColor: colors.fg,
        tabBarStyle: {
          backgroundColor: colors.bg1,
          borderTopColor: colors.line,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>⌂</Text>,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>⚙</Text>,
        }}
      />
    </Tab.Navigator>
  );
}

function ToastOverlay() {
  const { toast, clearToast } = useWallet();
  if (!toast) return null;
  return <Toast message={toast.message} tone={toast.tone} onDismiss={clearToast} />;
}

function AppNavigator() {
  const { state } = useWallet();

  if (state.loading) {
    return null;
  }

  if (!state.hasWallet) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Setup" component={SetupScreen} />
      </Stack.Navigator>
    );
  }

  if (!state.unlocked) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Lock" component={LockScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg0 },
        headerTintColor: colors.fg,
      }}
    >
      <Stack.Screen
        name="Main"
        component={HomeTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="Send" component={SendScreen} />
      <Stack.Screen name="Receive" component={ReceiveScreen} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <NavigationContainer
        theme={{
          dark: true,
          colors: {
            primary: colors.accent,
            background: colors.bg0,
            card: colors.bg1,
            text: colors.fg,
            border: colors.line,
            notification: colors.accent,
          },
          fonts: {
            regular: { fontFamily: "System", fontWeight: "400" },
            medium: { fontFamily: "System", fontWeight: "500" },
            bold: { fontFamily: "System", fontWeight: "700" },
            heavy: { fontFamily: "System", fontWeight: "800" },
          },
        }}
      >
        <StatusBar style="light" />
        <AppNavigator />
        <ToastOverlay />
      </NavigationContainer>
    </WalletProvider>
  );
}
