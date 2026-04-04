import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { useWallet } from "../lib/wallet-context";
import { lightTap } from "../lib/haptics";

interface TxRecord {
  hash: string;
  block_height: number;
  sender: string;
  nonce: number;
  contract: string;
  function: string;
  success: boolean;
  stamps_used: number;
  created_at: string;
  kwargs?: Record<string, unknown>;
}

function truncHash(h: string): string {
  return h.length > 18 ? `${h.slice(0, 8)}...${h.slice(-6)}` : h;
}

function timeAgo(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  } catch {
    return dateStr;
  }
}

export function ActivityScreen({ navigation }: { navigation: any }) {
  const { state, rpc } = useWallet();
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTx, setSelectedTx] = useState<TxRecord | null>(null);

  const address = state.publicKey ?? "";

  const fetchTxs = useCallback(async () => {
    if (!address) return;
    const results = await rpc.getTransactionHistory(address, 50, 0);
    setTxs(results);
  }, [address, rpc]);

  useEffect(() => {
    fetchTxs().finally(() => setLoading(false));
  }, [fetchTxs]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchTxs();
    setRefreshing(false);
  };

  // ── TX Detail ──────────────────────────────────────────────
  if (selectedTx) {
    const isOutgoing = selectedTx.sender === address;
    return (
      <View style={styles.container}>
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={() => { lightTap(); setSelectedTx(null); }}>
            <Feather name="arrow-left" size={22} color={colors.fg} />
          </TouchableOpacity>
          <Text style={styles.detailTitle}>Transaction</Text>
          <View style={{ width: 22 }} />
        </View>

        <View style={styles.detailContent}>
          <View style={styles.statusRow}>
            <View style={[styles.statusBadge, selectedTx.success ? styles.statusSuccess : styles.statusFail]}>
              <Feather name={selectedTx.success ? "check" : "x"} size={14} color={selectedTx.success ? colors.success : colors.danger} />
              <Text style={[styles.statusText, { color: selectedTx.success ? colors.success : colors.danger }]}>
                {selectedTx.success ? "Success" : "Failed"}
              </Text>
            </View>
            <Text style={styles.directionText}>{isOutgoing ? "Sent" : "Received"}</Text>
          </View>

          <Row label="Hash" value={truncHash(selectedTx.hash)} mono />
          <Row label="Block" value={String(selectedTx.block_height)} />
          <Row label="Contract" value={selectedTx.contract} mono />
          <Row label="Function" value={selectedTx.function} />
          <Row label="Stamps" value={selectedTx.stamps_used.toLocaleString()} />
          <Row label="Time" value={selectedTx.created_at} />
          {selectedTx.kwargs && Object.entries(selectedTx.kwargs).map(([k, v]) => (
            <Row key={k} label={k} value={String(v)} mono />
          ))}

          {state.dashboardUrl && (
            <TouchableOpacity
              style={styles.explorerBtn}
              onPress={() => {
                lightTap();
                Linking.openURL(`${state.dashboardUrl!.replace(/\/+$/, "")}/explorer/tx/${selectedTx.hash}`);
              }}
            >
              <Feather name="external-link" size={14} color={colors.accent} />
              <Text style={styles.explorerText}>View in Explorer</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  // ── TX List ────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={txs}
        keyExtractor={(item) => item.hash}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} colors={[colors.accent]} progressBackgroundColor={colors.bg2} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Feather name="clock" size={32} color={colors.muted} />
            <Text style={styles.emptyText}>No transactions yet.</Text>
            <Text style={styles.emptyHint}>Send or receive tokens to see activity here.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isOutgoing = item.sender === address;
          return (
            <TouchableOpacity
              style={styles.txRow}
              onPress={() => { lightTap(); setSelectedTx(item); }}
              activeOpacity={0.6}
            >
              <View style={[styles.txIcon, isOutgoing ? styles.txIconOut : styles.txIconIn]}>
                <Feather name={isOutgoing ? "arrow-up-right" : "arrow-down-left"} size={18} color={isOutgoing ? colors.danger : colors.success} />
              </View>
              <View style={styles.txBody}>
                <Text style={styles.txFunc}>{item.contract}.{item.function}</Text>
                <Text style={styles.txTime}>{timeAgo(item.created_at)}</Text>
              </View>
              <View style={styles.txEnd}>
                <Feather
                  name={item.success ? "check-circle" : "x-circle"}
                  size={14}
                  color={item.success ? colors.success : colors.danger}
                />
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]} numberOfLines={1} ellipsizeMode="middle">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg0 },
  centered: { alignItems: "center", justifyContent: "center" },
  // List
  txRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
  txIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  txIconOut: { backgroundColor: colors.dangerSoft },
  txIconIn: { backgroundColor: colors.successSoft },
  txBody: { flex: 1 },
  txFunc: { fontSize: 14, fontWeight: "500", color: colors.fg },
  txTime: { fontSize: 12, color: colors.muted, marginTop: 2 },
  txEnd: { alignItems: "flex-end" },
  // Empty
  emptyContainer: { alignItems: "center", justifyContent: "center", paddingVertical: 80, gap: 12 },
  emptyText: { fontSize: 16, fontWeight: "600", color: colors.fg },
  emptyHint: { fontSize: 13, color: colors.muted, textAlign: "center" },
  // Detail
  detailHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
  detailTitle: { fontSize: 16, fontWeight: "700", color: colors.fg },
  detailContent: { padding: 16, gap: 4 },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20 },
  statusSuccess: { backgroundColor: colors.successSoft },
  statusFail: { backgroundColor: colors.dangerSoft },
  statusText: { fontSize: 13, fontWeight: "600" },
  directionText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  rowLabel: { fontSize: 13, color: colors.muted },
  rowValue: { fontSize: 13, color: colors.fg, fontWeight: "500", maxWidth: "60%" },
  mono: { fontFamily: "monospace" },
  explorerBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 16, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.accentSoft },
  explorerText: { fontSize: 14, fontWeight: "600", color: colors.accent },
});
