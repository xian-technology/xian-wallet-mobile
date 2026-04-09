import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { colors } from "../theme/colors";
import { useWallet } from "../lib/wallet-context";
import { lightTap } from "../lib/haptics";

export function NetworkBadge() {
  const { state, rpc, refresh, refreshBalances, showToast } = useWallet();
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");

  const checkStatus = useCallback(async () => {
    setStatus("checking");
    try {
      const chainId = await Promise.race([
        rpc.getChainId(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 3000)
        ),
      ]);
      setStatus(chainId ? "online" : "offline");
    } catch {
      setStatus("offline");
    }
  }, [rpc]);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  const dotColor =
    status === "online" ? colors.success :
    status === "offline" ? colors.danger :
    colors.warning;

  const handlePress = async () => {
    lightTap();
    showToast("Refreshing...", "info");
    await checkStatus();
    await refresh();
    await refreshBalances();
    showToast(status === "online" ? "Connected." : "Node unreachable.", status === "online" ? "success" : "warning");
  };

  return (
    <TouchableOpacity style={styles.badge} onPress={handlePress}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={styles.label}>{state.activeNetworkName ?? "Network"}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: colors.bg2,
    marginRight: 8,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.muted,
  },
});
