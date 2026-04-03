import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors } from "../theme/colors";

export function AppsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Connected Apps</Text>
      <Text style={styles.sub}>
        Apps that connect to your wallet will appear here.
      </Text>
      <Text style={styles.hint}>
        Connect via WalletConnect or by visiting a dApp in your browser.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg0,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  heading: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.fg,
  },
  sub: {
    fontSize: 14,
    color: colors.muted,
    textAlign: "center",
  },
  hint: {
    fontSize: 12,
    color: colors.muted,
    textAlign: "center",
    opacity: 0.6,
  },
});
