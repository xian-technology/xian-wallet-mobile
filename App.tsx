// Crypto polyfill must be first import
import "./src/lib/crypto-polyfill";

import React from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { View, Image, ActivityIndicator, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";

import { WalletProvider, useWallet } from "./src/lib/wallet-context";
import { Toast } from "./src/components/Toast";
import { colors } from "./src/theme/colors";
import { SetupScreen } from "./src/screens/SetupScreen";
import { LockScreen } from "./src/screens/LockScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { SendScreen } from "./src/screens/SendScreen";
import { ReceiveScreen } from "./src/screens/ReceiveScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { TokenDetailScreen } from "./src/screens/TokenDetailScreen";
import { NetworksScreen } from "./src/screens/NetworksScreen";
import { AdvancedTxScreen } from "./src/screens/AdvancedTxScreen";
import { AppsScreen } from "./src/screens/AppsScreen";
import { ActivityScreen } from "./src/screens/ActivityScreen";
import { NetworkBadge } from "./src/components/NetworkBadge";
import { lightTap } from "./src/lib/haptics";
import type { HomeTabParamList, RootStackParamList } from "./src/navigation/types";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<HomeTabParamList>();

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
      screenListeners={{ tabPress: () => lightTap() }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: "Xian Wallet",
          tabBarLabel: "Home",
          tabBarIcon: ({ color }) => <Feather name="home" size={20} color={color} />,
          headerRight: () => <NetworkBadge />,
        }}
      />
      <Tab.Screen
        name="Activity"
        component={ActivityScreen}
        options={{
          title: "Activity",
          tabBarIcon: ({ color }) => <Feather name="clock" size={20} color={color} />,
        }}
      />
      <Tab.Screen
        name="Apps"
        component={AppsScreen}
        options={{
          title: "Apps",
          tabBarIcon: ({ color }) => <Feather name="grid" size={20} color={color} />,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <Feather name="settings" size={20} color={color} />,
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

function LoadingScreen() {
  return (
    <View style={loadStyles.container}>
      <Image source={require("./assets/xian-logo.png")} style={loadStyles.logo} />
      <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 16 }} />
    </View>
  );
}

const loadStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg0, alignItems: "center", justifyContent: "center" },
  logo: { width: 64, height: 64, resizeMode: "contain" as const },
});

function AppNavigator() {
  const { state } = useWallet();

  if (state.loading) {
    return <LoadingScreen />;
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
      <Stack.Screen name="TokenDetail" component={TokenDetailScreen} options={{ title: "Token" }} />
      <Stack.Screen name="Networks" component={NetworksScreen} />
      <Stack.Screen name="AdvancedTx" component={AdvancedTxScreen} options={{ title: "Advanced Transaction" }} />
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
