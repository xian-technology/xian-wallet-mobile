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
  BackHandler,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { useWallet } from "../lib/wallet-context";
import { lightTap } from "../lib/haptics";
import type { TxHistoryRecord } from "../lib/rpc-client";
import { classifyTx, type TxClassification } from "../lib/tx-classify";

function truncHash(h: string, head = 8, tail = 6): string {
  return h.length > head + tail + 3 ? `${h.slice(0, head)}...${h.slice(-tail)}` : h;
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();
    if (Number.isNaN(diff)) return dateStr;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  } catch {
    return dateStr;
  }
}

function formatAmount(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (Number.isFinite(num)) {
      return num.toLocaleString(undefined, { maximumFractionDigits: 8 });
    }
    return trimmed;
  }
  if (typeof value === "object" && value && "__fixed__" in (value as Record<string, unknown>)) {
    const fixed = (value as Record<string, unknown>).__fixed__;
    if (typeof fixed === "string" || typeof fixed === "number") return formatAmount(fixed);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function formatArgValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && "__fixed__" in (value as Record<string, unknown>)) {
    const fixed = (value as Record<string, unknown>).__fixed__;
    if (typeof fixed === "string" || typeof fixed === "number") return String(fixed);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function kwargsOf(tx: TxHistoryRecord): Record<string, unknown> {
  return (tx.payload?.kwargs ?? tx.kwargs ?? {}) as Record<string, unknown>;
}

function accentColors(accent: TxClassification["accent"]): { bg: string; fg: string } {
  switch (accent) {
    case "success": return { bg: colors.successSoft, fg: colors.success };
    case "danger": return { bg: colors.dangerSoft, fg: colors.danger };
    case "warning": return { bg: colors.warningSoft, fg: colors.warning };
    case "info":
    case "accent": return { bg: colors.accentSoft, fg: colors.accent };
    case "neutral":
    default: return { bg: colors.bg2, fg: colors.muted };
  }
}

function subtitleFor(cls: TxClassification, tx: TxHistoryRecord): string {
  const kw = kwargsOf(tx);
  switch (cls.category) {
    case "send":
    case "receive":
    case "approve": {
      const amount = formatAmount(kw.amount);
      if (amount) return `${amount} ${tx.contract}`;
      break;
    }
    case "buy":
    case "sell":
    case "swap": {
      const amountIn = formatAmount(kw.amountIn);
      const src = typeof kw.src === "string" ? kw.src : "";
      if (amountIn) return `${amountIn}${src ? ` ${src}` : ""}`;
      break;
    }
    case "add_liquidity":
    case "remove_liquidity": {
      const a = typeof kw.tokenA === "string" ? kw.tokenA : "";
      const b = typeof kw.tokenB === "string" ? kw.tokenB : "";
      if (a && b) return `${a} / ${b}`;
      break;
    }
    case "create_token": {
      const sym = typeof kw.token_symbol === "string" ? kw.token_symbol : "";
      const name = typeof kw.token_name === "string" ? kw.token_name : "";
      return sym || name || "";
    }
  }
  return `${tx.contract}.${tx.function}`;
}

export function ActivityScreen() {
  const { state, rpc, showToast } = useWallet();
  const [txs, setTxs] = useState<TxHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<TxHistoryRecord | null>(null);

  const address = state.publicKey ?? "";

  const fetchTxs = useCallback(async () => {
    if (!address) return;
    try {
      const results = await rpc.getTransactionHistory(address, 50, 0);
      setTxs(results);
      setLoadError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load transactions";
      setLoadError(msg);
      showToast(msg, "danger");
    }
  }, [address, rpc, showToast]);

  useEffect(() => {
    fetchTxs().finally(() => setLoading(false));
  }, [fetchTxs]);

  useEffect(() => {
    if (!selectedTx) return;
    const handler = () => { setSelectedTx(null); return true; };
    const sub = BackHandler.addEventListener("hardwareBackPress", handler);
    return () => sub.remove();
  }, [selectedTx]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchTxs();
    setRefreshing(false);
  };

  const openExplorer = (hash: string) => {
    if (!state.dashboardUrl) return;
    lightTap();
    Linking.openURL(`${state.dashboardUrl.replace(/\/+$/, "")}/explorer/tx/${hash}`);
  };

  // ── TX Detail ──────────────────────────────────────────────
  if (selectedTx) {
    const cls = classifyTx(selectedTx);
    const kw = kwargsOf(selectedTx);
    const accent = accentColors(cls.accent);
    const rows: Array<{ label: string; value: string; mono?: boolean }> = [];

    const addressLink = (addr: string) => truncHash(addr, 8, 6);
    const tokenLabel = (c: string | null | undefined) => c ?? "—";

    switch (cls.category) {
      case "send":
      case "receive": {
        const amount = formatAmount(kw.amount);
        const to = typeof kw.to === "string" ? kw.to : null;
        const mainAccount = typeof kw.main_account === "string" ? kw.main_account : null;
        if (amount) rows.push({ label: "Amount", value: `${amount} ${tokenLabel(selectedTx.contract)}` });
        rows.push({ label: "From", value: addressLink(selectedTx.sender), mono: true });
        if (to) rows.push({ label: "To", value: addressLink(to), mono: true });
        if (mainAccount) rows.push({ label: "On behalf of", value: addressLink(mainAccount), mono: true });
        break;
      }
      case "approve": {
        const amount = formatAmount(kw.amount);
        const to = typeof kw.to === "string" ? kw.to : null;
        if (amount) rows.push({ label: "Amount", value: `${amount} ${tokenLabel(selectedTx.contract)}` });
        if (to) rows.push({ label: "Spender", value: addressLink(to), mono: true });
        rows.push({ label: "Owner", value: addressLink(selectedTx.sender), mono: true });
        break;
      }
      case "buy":
      case "sell":
      case "swap": {
        const amountIn = formatAmount(kw.amountIn);
        const amountOutMin = formatAmount(kw.amountOutMin);
        const src = typeof kw.src === "string" ? kw.src : null;
        const path = Array.isArray(kw.path)
          ? (kw.path as unknown[]).filter((p): p is string => typeof p === "string")
          : null;
        const to = typeof kw.to === "string" ? kw.to : null;
        if (amountIn) rows.push({ label: "Amount in", value: `${amountIn}${src ? ` ${src}` : ""}` });
        if (amountOutMin) rows.push({ label: "Min out", value: amountOutMin });
        if (path && path.length > 0) {
          const full = src ? [src, ...path] : path;
          rows.push({ label: "Route", value: full.join(" → ") });
        }
        if (to) rows.push({ label: "Recipient", value: addressLink(to), mono: true });
        break;
      }
      case "add_liquidity":
      case "remove_liquidity": {
        const tokenA = typeof kw.tokenA === "string" ? kw.tokenA : null;
        const tokenB = typeof kw.tokenB === "string" ? kw.tokenB : null;
        if (tokenA && tokenB) rows.push({ label: "Pair", value: `${tokenA} / ${tokenB}` });
        const amountA = formatAmount(kw.amountADesired ?? kw.amountA);
        const amountB = formatAmount(kw.amountBDesired ?? kw.amountB);
        const liquidity = formatAmount(kw.liquidity);
        if (amountA) rows.push({ label: "Amount A", value: amountA });
        if (amountB) rows.push({ label: "Amount B", value: amountB });
        if (liquidity) rows.push({ label: "Liquidity", value: liquidity });
        break;
      }
      case "create_token": {
        const tokenContract = typeof kw.token_contract === "string" ? kw.token_contract : null;
        const tokenName = typeof kw.token_name === "string" ? kw.token_name : null;
        const tokenSymbol = typeof kw.token_symbol === "string" ? kw.token_symbol : null;
        const supply = formatAmount(kw.initial_supply);
        if (tokenName) rows.push({ label: "Name", value: tokenName });
        if (tokenSymbol) rows.push({ label: "Symbol", value: tokenSymbol });
        if (tokenContract) rows.push({ label: "Contract", value: tokenContract, mono: true });
        if (supply) rows.push({ label: "Initial supply", value: supply });
        break;
      }
    }

    rows.push({ label: "Hash", value: truncHash(selectedTx.hash), mono: true });
    rows.push({ label: "Contract", value: `${selectedTx.contract}.${selectedTx.function}` });
    if (selectedTx.block_height != null) {
      rows.push({ label: "Block", value: String(selectedTx.block_height) });
    }
    if (selectedTx.chi_used != null) {
      const n = Number(selectedTx.chi_used);
      rows.push({ label: "Chi used", value: Number.isFinite(n) ? n.toLocaleString() : String(selectedTx.chi_used) });
    }
    if (selectedTx.created_at) {
      rows.push({ label: "Time", value: selectedTx.created_at });
    }

    const knownKeys: Record<TxClassification["category"], readonly string[]> = {
      send: ["amount", "to", "main_account"],
      receive: ["amount", "to", "main_account"],
      approve: ["amount", "to"],
      buy: ["amountIn", "amountOutMin", "src", "path", "to"],
      sell: ["amountIn", "amountOutMin", "src", "path", "to"],
      swap: ["amountIn", "amountOutMin", "src", "path", "to"],
      add_liquidity: ["tokenA", "tokenB", "amountADesired", "amountBDesired", "amountA", "amountB", "amountAMin", "amountBMin", "to", "deadline", "feeBps"],
      remove_liquidity: ["tokenA", "tokenB", "liquidity", "amountAMin", "amountBMin", "to", "deadline"],
      create_token: ["token_contract", "token_name", "token_symbol", "initial_supply", "token_logo_url", "token_logo_svg", "token_website", "initial_holder", "operator_address"],
      contract: [],
    };
    const known = new Set(knownKeys[cls.category]);
    const extraRows: Array<{ label: string; value: string }> = [];
    for (const [k, v] of Object.entries(kw)) {
      if (known.has(k)) continue;
      extraRows.push({ label: k, value: formatArgValue(v) });
    }

    const errorMsg = (() => {
      if (selectedTx.success) return null;
      const res = selectedTx.result as unknown;
      if (!res) return null;
      if (typeof res === "string") return res;
      if (typeof res === "object") {
        const obj = res as Record<string, unknown>;
        const msg = obj.error ?? obj.message ?? obj.result ?? null;
        if (typeof msg === "string") return msg;
        try { return JSON.stringify(res); } catch { return null; }
      }
      return null;
    })();

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
          <View style={styles.detailSummary}>
            <View style={[styles.detailIcon, { backgroundColor: accent.bg }]}>
              <Feather name={cls.icon} size={20} color={accent.fg} />
            </View>
            <View style={styles.detailSummaryText}>
              <Text style={styles.detailLabel}>{cls.label}</Text>
              <Text style={styles.detailSubtle}>{selectedTx.contract}.{selectedTx.function}</Text>
            </View>
            <View style={[styles.statusBadge, selectedTx.success ? styles.statusSuccess : styles.statusFail]}>
              <Feather name={selectedTx.success ? "check" : "x"} size={12} color={selectedTx.success ? colors.success : colors.danger} />
              <Text style={[styles.statusText, { color: selectedTx.success ? colors.success : colors.danger }]}>
                {selectedTx.success ? "Success" : "Failed"}
              </Text>
            </View>
          </View>

          {rows.map((r) => (
            <Row key={r.label} label={r.label} value={r.value} mono={r.mono} />
          ))}

          {errorMsg && (
            <View style={styles.errorCard}>
              <Text style={styles.errorHeader}>Error</Text>
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          )}

          {extraRows.length > 0 && (
            <View style={styles.extraCard}>
              <Text style={styles.extraHeader}>Arguments</Text>
              {extraRows.map((r) => (
                <Row key={r.label} label={r.label} value={r.value} mono />
              ))}
            </View>
          )}

          {state.dashboardUrl && (
            <TouchableOpacity style={styles.explorerBtn} onPress={() => openExplorer(selectedTx.hash)}>
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
      {loadError && txs.length === 0 && (
        <TouchableOpacity style={styles.errorBanner} onPress={handleRefresh}>
          <Feather name="alert-circle" size={14} color={colors.danger} />
          <Text style={styles.errorBannerText}>{loadError}. Tap to retry.</Text>
        </TouchableOpacity>
      )}
      <FlatList
        data={txs}
        keyExtractor={(item) => item.hash}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} colors={[colors.accent]} progressBackgroundColor={colors.bg2} />
        }
        ListEmptyComponent={
          !loadError ? (
            <View style={styles.emptyContainer}>
              <Feather name="clock" size={32} color={colors.muted} />
              <Text style={styles.emptyText}>No transactions yet.</Text>
              <Text style={styles.emptyHint}>Send or receive tokens to see activity here.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const cls = classifyTx(item);
          const accent = accentColors(cls.accent);
          const subtitle = subtitleFor(cls, item);
          return (
            <TouchableOpacity
              style={styles.txRow}
              onPress={() => { lightTap(); setSelectedTx(item); }}
              activeOpacity={0.6}
            >
              <View style={[styles.txIcon, { backgroundColor: accent.bg }]}>
                <Feather name={cls.icon} size={18} color={accent.fg} />
              </View>
              <View style={styles.txBody}>
                <Text style={styles.txFunc}>
                  {cls.label}
                  {!item.success && <Text style={styles.txFailedTag}> · Failed</Text>}
                </Text>
                <Text style={styles.txTime} numberOfLines={1} ellipsizeMode="tail">{subtitle}</Text>
              </View>
              <View style={styles.txEnd}>
                <Text style={styles.txTimeAgo}>{timeAgo(item.created_at)}</Text>
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
  txBody: { flex: 1 },
  txFunc: { fontSize: 14, fontWeight: "500", color: colors.fg },
  txFailedTag: { fontSize: 11, color: colors.danger, fontWeight: "500" },
  txTime: { fontSize: 12, color: colors.muted, marginTop: 2 },
  txEnd: { alignItems: "flex-end" },
  txTimeAgo: { fontSize: 11, color: colors.muted },
  // Empty / Error
  emptyContainer: { alignItems: "center", justifyContent: "center", paddingVertical: 80, gap: 12 },
  emptyText: { fontSize: 16, fontWeight: "600", color: colors.fg },
  emptyHint: { fontSize: 13, color: colors.muted, textAlign: "center" },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: colors.dangerSoft, borderBottomWidth: 1, borderBottomColor: colors.line },
  errorBannerText: { fontSize: 12, color: colors.danger, flex: 1 },
  // Detail
  detailHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
  detailTitle: { fontSize: 16, fontWeight: "700", color: colors.fg },
  detailContent: { padding: 16, gap: 4 },
  detailSummary: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  detailIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  detailSummaryText: { flex: 1, minWidth: 0 },
  detailLabel: { fontSize: 15, fontWeight: "700", color: colors.fg },
  detailSubtle: { fontSize: 12, color: colors.muted, marginTop: 2 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12 },
  statusSuccess: { backgroundColor: colors.successSoft },
  statusFail: { backgroundColor: colors.dangerSoft },
  statusText: { fontSize: 11, fontWeight: "600" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  rowLabel: { fontSize: 13, color: colors.muted },
  rowValue: { fontSize: 13, color: colors.fg, fontWeight: "500", maxWidth: "60%" },
  mono: { fontFamily: "monospace" },
  errorCard: { marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: colors.dangerSoft },
  errorHeader: { fontSize: 12, fontWeight: "700", color: colors.danger, marginBottom: 4 },
  errorText: { fontSize: 13, color: colors.danger, fontFamily: "monospace" },
  extraCard: { marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: colors.bg1 },
  extraHeader: { fontSize: 12, fontWeight: "700", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  explorerBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 16, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.accentSoft },
  explorerText: { fontSize: 14, fontWeight: "600", color: colors.accent },
});
