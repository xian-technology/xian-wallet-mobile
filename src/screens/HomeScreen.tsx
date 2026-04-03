import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { colors } from "../theme/colors";
import { useWallet } from "../lib/wallet-context";
import { loadWalletState, saveWalletState } from "../lib/storage";
import { SwipeableRow } from "../components/SwipeableRow";
import { DraggableList } from "../components/DraggableList";
import { lightTap, mediumTap, selectionTap } from "../lib/haptics";

function truncAddr(addr: string): string {
  return addr.length <= 16 ? addr : `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

function assetHue(contract: string): string {
  let h = 0;
  for (let i = 0; i < contract.length; i++) h = contract.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${((h % 360) + 360) % 360}, 45%, 35%)`;
}

function fmtBal(raw: string | null): string {
  if (raw == null) return "-";
  const n = Number(raw);
  if (Number.isNaN(n)) return "0";
  return n === Math.floor(n) ? n.toLocaleString() : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

export function HomeScreen({ navigation }: { navigation: any }) {
  const { state, refreshBalances, showToast, refresh, prefs } = useWallet();
  const [refreshing, setRefreshing] = useState(false);
  const [managing, setManaging] = useState(false);

  const address = state.publicKey ?? "";
  const activeAcct = state.accounts.find((a) => a.index === state.activeAccountIndex);
  const sorted = [...state.watchedAssets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const visible = managing ? sorted : sorted.filter((a) => !a.hidden);
  const hiddenN = state.watchedAssets.filter((a) => a.hidden).length;

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    await refreshBalances();
    setRefreshing(false);
  }, [refresh, refreshBalances]);

  const reorderAsset = async (fromIndex: number, toIndex: number) => {
    const ws = await loadWalletState();
    if (!ws) return;
    const s = [...ws.watchedAssets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const [moved] = s.splice(fromIndex, 1);
    if (moved) s.splice(toIndex, 0, moved);
    s.forEach((a, i) => { a.order = i; });
    ws.watchedAssets = s;
    await saveWalletState(ws);
    await refresh();
  };

  const toggleHide = async (contract: string) => {
    lightTap();
    const ws = await loadWalletState();
    if (!ws) return;
    const a = ws.watchedAssets.find((x) => x.contract === contract);
    if (a) a.hidden = !a.hidden;
    await saveWalletState(ws);
    await refresh();
  };

  const quickActions = (
    <View style={styles.actions}>
      <TouchableOpacity style={styles.actionBtn} onPress={() => { lightTap(); navigation.navigate("Send"); }}>
        <View style={styles.actionCircle}><Feather name="arrow-up" size={22} color={colors.accent} /></View>
        {!prefs.hideQuickActionLabels && <Text style={styles.actionLabel}>Send</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionBtn} onPress={() => { lightTap(); navigation.navigate("Receive"); }}>
        <View style={styles.actionCircle}><Feather name="arrow-down" size={22} color={colors.accent} /></View>
        {!prefs.hideQuickActionLabels && <Text style={styles.actionLabel}>Receive</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={[styles.actionBtn, styles.disabled]} disabled>
        <View style={[styles.actionCircle, styles.circleDisabled]}><Feather name="trending-up" size={20} color={colors.muted} /></View>
        {!prefs.hideQuickActionLabels && <Text style={styles.labelDisabled}>Trade</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={[styles.actionBtn, styles.disabled]} disabled>
        <View style={[styles.actionCircle, styles.circleDisabled]}><Feather name="repeat" size={20} color={colors.muted} /></View>
        {!prefs.hideQuickActionLabels && <Text style={styles.labelDisabled}>Swap</Text>}
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scroll, prefs.quickActionsPosition === "bottom" && { paddingBottom: 80 }]}
        scrollEnabled={!managing}
        refreshControl={managing ? undefined : <RefreshControl refreshing={refreshing} onRefresh={doRefresh} tintColor={colors.accent} colors={[colors.accent]} progressBackgroundColor={colors.bg2} />}
      >
        {activeAcct && <Text style={styles.acctLabel}>{activeAcct.name}</Text>}
        <TouchableOpacity style={styles.addrPill} onPress={async () => { lightTap(); await Clipboard.setStringAsync(address); showToast("Address copied.", "success"); }}>
          <Text style={styles.addrText}>{truncAddr(address)}</Text>
        </TouchableOpacity>

        {prefs.quickActionsPosition === "top" && quickActions}

        <View style={styles.sectionHd}>
          <Text style={styles.sectionLabel}>Assets</Text>
          <Text style={styles.badge}>{managing ? state.watchedAssets.length : visible.length}{hiddenN > 0 && !managing ? ` · ${hiddenN} hidden` : ""}</Text>
        </View>

        {managing ? (
          <DraggableList
            items={sorted.map((asset) => ({
              key: asset.contract,
              label: asset.symbol ?? asset.contract.slice(0, 6),
              sublabel: asset.name ?? asset.contract,
              iconLetter: (asset.symbol ?? asset.contract.slice(0, 6)).charAt(0).toUpperCase(),
              iconColor: asset.contract === "currency" ? colors.accentDim : assetHue(asset.contract),
              hidden: asset.hidden,
            }))}
            onReorder={reorderAsset}
            onToggleHide={toggleHide}
          />
        ) : (
          visible.map((asset) => {
            const sym = asset.symbol ?? asset.contract.slice(0, 6);
            const letter = sym.charAt(0).toUpperCase();
            const bg = asset.contract === "currency" ? colors.accentDim : assetHue(asset.contract);

            return (
              <SwipeableRow
                key={asset.contract}
                onSwipeLeft={() => {
                  lightTap();
                  navigation.navigate("Send", { token: asset.contract });
                }}
                onSwipeRight={() => {
                  mediumTap();
                  toggleHide(asset.contract);
                }}
              >
                <TouchableOpacity
                  style={[styles.row, styles.rowBg]}
                  onPress={() => { lightTap(); navigation.navigate("TokenDetail", { contract: asset.contract }); }}
                  onLongPress={() => { mediumTap(); setManaging(true); }}
                  activeOpacity={0.6}
                >
                  <View style={[styles.icon, { backgroundColor: bg }]}><Text style={styles.iconLetter}>{letter}</Text></View>
                  <View style={styles.body}>
                    <Text style={styles.sym}>{sym}</Text>
                    <Text style={styles.name} numberOfLines={1}>{asset.name ?? asset.contract}</Text>
                  </View>
                  <Text style={styles.bal}>{state.balancesLoading ? "..." : fmtBal(state.assetBalances[asset.contract] ?? null)}</Text>
                </TouchableOpacity>
              </SwipeableRow>
            );
          })
        )}

        <View style={styles.footer}>
          <TouchableOpacity style={styles.fLink} onPress={() => { lightTap(); setManaging(!managing); }}>
            <Text style={styles.fText}>{managing ? "Done" : "Manage assets"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fLink} onPress={() => { if (state.dashboardUrl) Linking.openURL(state.dashboardUrl.replace(/\/+$/, "")); }}>
            <Text style={styles.fText}>Explorer</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      {prefs.quickActionsPosition === "bottom" && (
        <View style={styles.stickyActions}>{quickActions}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg0 },
  scroll: { padding: 16, paddingTop: 8, gap: 4, paddingBottom: 16 },
  acctLabel: { fontSize: 13, fontWeight: "600", color: colors.muted, textAlign: "center", marginBottom: 2 },
  addrPill: { alignSelf: "center", backgroundColor: colors.bg2, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, marginBottom: 16 },
  addrText: { fontFamily: "monospace", fontSize: 13, color: colors.muted },
  actions: { flexDirection: "row", justifyContent: "center", gap: 20, marginVertical: 16 },
  actionBtn: { alignItems: "center", gap: 6, width: 56 },
  disabled: { opacity: 0.4 },
  actionCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  circleDisabled: { backgroundColor: colors.bg2 },
  actionLabel: { fontSize: 11, fontWeight: "600", color: colors.fg },
  labelDisabled: { fontSize: 11, fontWeight: "600", color: colors.muted },
  sectionHd: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 12 },
  sectionLabel: { fontSize: 14, fontWeight: "700", color: colors.fg },
  badge: { fontSize: 12, color: colors.muted },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12 },
  rowBg: { backgroundColor: colors.bg0 },
  rowHidden: { opacity: 0.4 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconLetter: { fontSize: 16, fontWeight: "700", color: colors.fg },
  body: { flex: 1 },
  sym: { fontSize: 14, fontWeight: "600", color: colors.fg },
  name: { fontSize: 12, color: colors.muted },
  bal: { fontSize: 14, fontWeight: "600", color: colors.fg },
  stickyActions: { borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: 10, backgroundColor: colors.bg0 },
  footer: { flexDirection: "row", justifyContent: "center", gap: 16, paddingVertical: 12 },
  fLink: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  fText: { fontSize: 12, color: colors.muted },
});
