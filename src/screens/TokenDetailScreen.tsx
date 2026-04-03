import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from "react-native";
import * as Clipboard from "expo-clipboard";
import { colors } from "../theme/colors";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { useWallet } from "../lib/wallet-context";
import { loadWalletState, saveWalletState } from "../lib/storage";

function formatBalance(raw: string | null): string {
  if (raw == null) return "-";
  const n = Number(raw);
  if (Number.isNaN(n)) return "0";
  if (n === Math.floor(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

export function TokenDetailScreen({ route, navigation }: { route: any; navigation: any }) {
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
          <Text style={styles.heroBalance}>
            {formatBalance(balance)}
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
          {asset.decimals != null && <Row label="Decimals" value={String(asset.decimals)} />}
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
  hero: { alignItems: "center", paddingVertical: 24 },
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
});
