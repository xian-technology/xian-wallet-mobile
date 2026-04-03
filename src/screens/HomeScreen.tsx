import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { colors } from "../theme/colors";
import { useWallet } from "../lib/wallet-context";

function truncateAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

function assetColor(contract: string): string {
  let hash = 0;
  for (let i = 0; i < contract.length; i++) {
    hash = contract.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${((hash % 360) + 360) % 360}, 45%, 35%)`;
}

function formatBalance(raw: string | null): string {
  if (raw == null) return "-";
  const n = Number(raw);
  if (Number.isNaN(n)) return "0";
  if (n === Math.floor(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

export function HomeScreen({ navigation }: { navigation: any }) {
  const { state, refreshBalances, showToast, refresh } = useWallet();
  const [refreshing, setRefreshing] = useState(false);
  const [managingAssets, setManagingAssets] = useState(false);

  const address = state.publicKey ?? "";
  const activeAccount = state.accounts.find(
    (a) => a.index === state.activeAccountIndex
  );

  const sortedAssets = [...state.watchedAssets].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );
  const visibleAssets = managingAssets
    ? sortedAssets
    : sortedAssets.filter((a) => !a.hidden);
  const hiddenCount = state.watchedAssets.filter((a) => a.hidden).length;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    await refreshBalances();
    setRefreshing(false);
  }, [refresh, refreshBalances]);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(address);
    showToast("Address copied.", "success");
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.bg2}
          />
        }
      >
        {/* Account name */}
        {activeAccount && (
          <Text style={styles.accountLabel}>{activeAccount.name}</Text>
        )}

        {/* Address pill */}
        <TouchableOpacity style={styles.addressPill} onPress={handleCopy}>
          <Text style={styles.addressText}>{truncateAddress(address)}</Text>
        </TouchableOpacity>

        {/* Quick actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => navigation.navigate("Send")}
          >
            <View style={styles.actionCircle}>
              <Text style={styles.actionIcon}>↑</Text>
            </View>
            <Text style={styles.actionLabel}>Send</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => navigation.navigate("Receive")}
          >
            <View style={styles.actionCircle}>
              <Text style={styles.actionIcon}>↓</Text>
            </View>
            <Text style={styles.actionLabel}>Receive</Text>
          </TouchableOpacity>
        </View>

        {/* Assets */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>Assets</Text>
          <Text style={styles.sectionBadge}>
            {managingAssets
              ? state.watchedAssets.length
              : visibleAssets.length}
            {hiddenCount > 0 && !managingAssets
              ? ` · ${hiddenCount} hidden`
              : ""}
          </Text>
        </View>

        {visibleAssets.map((asset) => {
          const symbol = asset.symbol ?? asset.contract.slice(0, 6);
          const letter = symbol.charAt(0).toUpperCase();
          const bg = asset.contract === "currency" ? colors.accentDim : assetColor(asset.contract);
          const isHidden = asset.hidden === true;

          return (
            <TouchableOpacity
              key={asset.contract}
              style={[styles.assetRow, isHidden && styles.assetHidden]}
              onPress={() => {
                if (!managingAssets) {
                  navigation.navigate("TokenDetail", { contract: asset.contract });
                }
              }}
              activeOpacity={managingAssets ? 1 : 0.6}
            >
              <View style={[styles.assetIcon, { backgroundColor: bg }]}>
                <Text style={styles.assetLetter}>{letter}</Text>
              </View>
              <View style={styles.assetBody}>
                <Text style={styles.assetSymbol}>{symbol}</Text>
                <Text style={styles.assetName} numberOfLines={1}>
                  {asset.name ?? asset.contract}
                </Text>
              </View>
              {managingAssets ? (
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={async () => {
                    // Toggle hidden
                    const { saveWalletState, loadWalletState } = await import("../lib/storage");
                    const ws = await loadWalletState();
                    if (!ws) return;
                    const a = ws.watchedAssets.find((x) => x.contract === asset.contract);
                    if (a) a.hidden = !a.hidden;
                    await saveWalletState(ws);
                    await refresh();
                  }}
                >
                  <Text style={styles.eyeText}>{isHidden ? "👁‍🗨" : "👁"}</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.assetEnd}>
                  <Text style={styles.assetBalance}>
                    {state.balancesLoading ? "..." : formatBalance(state.assetBalances[asset.contract] ?? null)}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        {/* Manage assets link */}
        <TouchableOpacity
          style={styles.manageLink}
          onPress={() => setManagingAssets(!managingAssets)}
        >
          <Text style={styles.manageLinkText}>
            {managingAssets ? "Done" : "Manage assets"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg0 },
  scroll: { padding: 16, paddingTop: 8, gap: 4 },
  accountLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
    textAlign: "center",
    marginBottom: 2,
  },
  addressPill: {
    alignSelf: "center",
    backgroundColor: colors.bg2,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 16,
  },
  addressText: { fontFamily: "monospace", fontSize: 13, color: colors.muted },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 32,
    marginBottom: 20,
  },
  actionBtn: { alignItems: "center", gap: 6 },
  actionCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  actionIcon: { fontSize: 20, fontWeight: "700", color: colors.accent },
  actionLabel: { fontSize: 12, fontWeight: "600", color: colors.fg },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  sectionLabel: { fontSize: 14, fontWeight: "700", color: colors.fg },
  sectionBadge: { fontSize: 12, color: colors.muted },
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
  },
  assetHidden: { opacity: 0.4 },
  assetIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  assetLetter: { fontSize: 16, fontWeight: "700", color: colors.fg },
  assetBody: { flex: 1 },
  assetSymbol: { fontSize: 14, fontWeight: "600", color: colors.fg },
  assetName: { fontSize: 12, color: colors.muted },
  assetEnd: { alignItems: "flex-end" },
  assetBalance: { fontSize: 14, fontWeight: "600", color: colors.fg },
  eyeBtn: { padding: 8 },
  eyeText: { fontSize: 18 },
  manageLink: { alignItems: "center", paddingVertical: 12 },
  manageLinkText: { fontSize: 12, color: colors.muted },
});
