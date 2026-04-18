import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { colors } from "../theme/colors";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { TokenAvatar } from "../components/TokenAvatar";
import { useWallet } from "../lib/wallet-context";
import { loadWalletState, saveWalletState } from "../lib/storage";
import { lightTap } from "../lib/haptics";
import type { RootStackScreenProps } from "../navigation/types";

function assetHue(contract: string): string {
  let h = 0;
  for (let i = 0; i < contract.length; i++) h = contract.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${((h % 360) + 360) % 360}, 45%, 35%)`;
}

function truncateToDecimals(n: number, d: number): number {
  if (d === 0) return Math.floor(n);
  const factor = 10 ** d;
  return Math.floor(n * factor) / factor;
}

function formatBalance(raw: string | null, decimals?: number): string {
  if (raw == null) return "-";
  const n = Number(raw);
  if (Number.isNaN(n)) return "0";
  const d = decimals ?? 8;
  const truncated = truncateToDecimals(n, d);
  if (d === 0) return truncated.toLocaleString();
  return truncated.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: d });
}

export function TokenDetailScreen({ route, navigation }: RootStackScreenProps<"TokenDetail">) {
  const { state, refresh, showToast } = useWallet();
  const contract: string = route.params?.contract ?? "";

  const asset = state.watchedAssets.find((a) => a.contract === contract);
  if (!asset) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.muted}>Asset not found.</Text>
      </View>
    );
  }

  const symbol = asset.symbol ?? asset.contract.slice(0, 6);
  const balance = state.assetBalances[contract];
  const iconBg = contract === "currency" ? colors.accentDim : assetHue(contract);

  const handleCopyContract = async () => {
    await Clipboard.setStringAsync(contract);
    showToast("Contract address copied.", "success");
  };

  const handleRemoveAsset = () => {
    if (contract === "currency") {
      showToast("Cannot remove the native token.", "warning");
      return;
    }
    Alert.alert("Remove Asset", `Stop tracking ${symbol}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          const ws = await loadWalletState();
          if (!ws) return;
          ws.watchedAssets = ws.watchedAssets.filter((a) => a.contract !== contract);
          await saveWalletState(ws);
          showToast(`${symbol} removed.`, "info");
          await refresh();
          navigation.goBack();
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Balance hero */}
        <View style={styles.hero}>
          <TokenAvatar
            contract={contract}
            symbol={symbol}
            icon={asset.icon}
            size={56}
            textSize={20}
            backgroundColor={iconBg}
          />
          <Text style={styles.heroBalance}>
            {formatBalance(balance, asset.decimals)}
          </Text>
          <Text style={styles.heroSymbol}>{symbol}</Text>
        </View>

        {/* Quick actions */}
        <View style={styles.actions}>
          <Button
            title={`Send ${symbol}`}
            onPress={() => navigation.navigate("Send")}
            style={{ flex: 1 }}
          />
        </View>

        {/* Details */}
        <Card title="Details">
          <Row label="Contract" value={contract} mono onPress={handleCopyContract} />
          {asset.name && <Row label="Name" value={asset.name} />}
          {asset.symbol && <Row label="Symbol" value={asset.symbol} />}
          <View style={styles.decimalsRow}>
            <Text style={styles.rowLabel}>Decimals</Text>
            <View style={styles.decimalsControls}>
              <TouchableOpacity
                style={styles.decBtn}
                onPress={async () => {
                  lightTap();
                  const ws = await loadWalletState();
                  if (!ws) return;
                  const a = ws.watchedAssets.find((x) => x.contract === contract);
                  if (a) a.decimals = Math.max(0, (a.decimals ?? 0) - 1);
                  await saveWalletState(ws);
                  await refresh();
                }}
              >
                <Feather name="minus" size={14} color={colors.fg} />
              </TouchableOpacity>
              <Text style={styles.decimalsValue}>{asset.decimals ?? 0}</Text>
              <TouchableOpacity
                style={styles.decBtn}
                onPress={async () => {
                  lightTap();
                  const ws = await loadWalletState();
                  if (!ws) return;
                  const a = ws.watchedAssets.find((x) => x.contract === contract);
                  if (a) a.decimals = (a.decimals ?? 0) + 1;
                  await saveWalletState(ws);
                  await refresh();
                }}
              >
                <Feather name="plus" size={14} color={colors.fg} />
              </TouchableOpacity>
            </View>
          </View>
        </Card>

        {/* Actions */}
        {contract !== "currency" && (
          <Button title="Remove Asset" variant="danger" onPress={handleRemoveAsset} />
        )}
      </ScrollView>
    </View>
  );
}

function Row({
  label,
  value,
  mono,
  onPress,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onPress?: () => void;
}) {
  const content = (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[styles.rowValue, mono && styles.mono]}
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {value}
      </Text>
    </View>
  );
  return onPress ? (
    <TouchableOpacity onPress={onPress}>{content}</TouchableOpacity>
  ) : (
    content
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg0 },
  centered: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: 16, gap: 16 },
  muted: { color: colors.muted, fontSize: 14 },
  hero: { alignItems: "center", paddingVertical: 24, gap: 8 },
  heroBalance: { fontSize: 36, fontWeight: "700", color: colors.fg },
  heroSymbol: { fontSize: 16, color: colors.muted, marginTop: 4 },
  actions: { flexDirection: "row", gap: 12 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  rowLabel: { fontSize: 13, color: colors.muted },
  rowValue: { fontSize: 13, color: colors.fg, fontWeight: "500", maxWidth: "60%" },
  mono: { fontFamily: "monospace" },
  decimalsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  decimalsControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  decBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.bg2, alignItems: "center", justifyContent: "center" },
  decimalsValue: { fontSize: 15, fontWeight: "600", color: colors.fg, minWidth: 24, textAlign: "center" },
});
