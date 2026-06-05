import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Linking,
  TextInput,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { colors } from "../theme/colors";
import { useWallet } from "../lib/wallet-context";
import {
  loadDexAvailability,
  loadWalletState,
  saveDexAvailability,
  saveWalletState,
} from "../lib/storage";
import { SwipeableRow } from "../components/SwipeableRow";
import { DraggableList } from "../components/DraggableList";
import { TokenAvatar } from "../components/TokenAvatar";
import { AppDialog } from "../components/AppDialog";
import { lightTap, mediumTap } from "../lib/haptics";
import {
  hiddenAssetCount,
  isAssetHiddenOnActiveNetwork,
  isAssetUnavailableOnActiveNetwork,
  isMissingContractError,
  sortAssets,
  unavailableAssetCount,
  unavailableAssetLabel,
  updateAssetNetworkState,
  visibleAssetsForActiveNetwork,
} from "../lib/assets";
import { DEX_ROUTER, dexNetworkKey, loadDexSnapshot } from "../lib/dex";
import type { HomeTabScreenProps } from "../navigation/types";

function truncAddr(addr: string): string {
  return addr.length <= 16 ? addr : `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

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

function fmtBal(raw: string | null, decimals?: number): string {
  if (raw == null) return "-";
  const n = Number(raw);
  if (Number.isNaN(n)) return "0";
  const d = decimals ?? 8;
  const truncated = truncateToDecimals(n, d);
  if (d === 0) return truncated.toLocaleString();
  return truncated.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: d });
}

export function HomeScreen({ navigation }: HomeTabScreenProps<"Home">) {
  const { state, refreshBalances, showToast, refresh, prefs, rpc } = useWallet();
  const [refreshing, setRefreshing] = useState(false);
  const [managing, setManaging] = useState(false);
  const [addTokenValue, setAddTokenValue] = useState("");
  const [pendingUnavailableTokenContract, setPendingUnavailableTokenContract] = useState<string | null>(null);
  const [dexStatus, setDexStatus] = useState<"unknown" | "checking" | "available" | "unavailable">("unknown");
  const [dexStatusKey, setDexStatusKey] = useState("");
  const [dexError, setDexError] = useState<string | null>(null);

  const address = state.publicKey ?? "";
  const activeAcct = state.accounts.find((a) => a.index === state.activeAccountIndex);
  const sorted = sortAssets(state.watchedAssets);
  const visible = visibleAssetsForActiveNetwork(state);
  const hiddenN = hiddenAssetCount(state);
  const unavailableN = unavailableAssetCount(state);
  const secondaryCount = [
    hiddenN > 0 ? `${hiddenN} hidden` : "",
    unavailableN > 0 ? `${unavailableN} unavailable` : "",
  ].filter(Boolean).join(" · ");

  const checkDexAvailability = useCallback(async (force = false) => {
    if (!state.publicKey) return;
    const networkKey = dexNetworkKey(state);
    setDexStatusKey(networkKey);
    setDexError(null);

    if (!force) {
      const cached = await loadDexAvailability(networkKey).catch(() => null);
      if (cached?.contract === DEX_ROUTER) {
        setDexStatus("available");
        return;
      }
    }

    setDexStatus("checking");
    const snapshot = await loadDexSnapshot(state, rpc).catch((error) => ({
      available: false,
      reason: error instanceof Error ? error.message : "Couldn't check DEX availability.",
    }));
    if (dexNetworkKey(state) !== networkKey) {
      return;
    }
    if (snapshot.available) {
      await saveDexAvailability({
        networkKey,
        contract: DEX_ROUTER,
        checkedAt: new Date().toISOString(),
      });
      setDexStatus("available");
      setDexError(null);
    } else {
      setDexStatus("unavailable");
      setDexError(snapshot.reason ?? "DEX is not deployed on this network.");
    }
  }, [rpc, state.activeNetworkId, state.publicKey, state.rpcUrl, state.watchedAssets]);

  useEffect(() => {
    const networkKey = dexNetworkKey(state);
    if (dexStatusKey !== networkKey) {
      setDexStatus("unknown");
      setDexStatusKey(networkKey);
      setDexError(null);
    }
    void checkDexAvailability(false);
  }, [checkDexAvailability, dexStatusKey, state]);

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    await refreshBalances();
    await checkDexAvailability(true);
    setRefreshing(false);
  }, [checkDexAvailability, refresh, refreshBalances]);

  const reorderAsset = async (fromIndex: number, toIndex: number) => {
    const ws = await loadWalletState();
    if (!ws) return;
    const s = sortAssets(ws.watchedAssets);
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
    if (!a || isAssetUnavailableOnActiveNetwork(state, a)) return;
    const nextState = updateAssetNetworkState(ws, contract, {
      hidden: !isAssetHiddenOnActiveNetwork(state, a),
    });
    await saveWalletState(nextState);
    await refresh();
  };

  const addToken = async (
    rawContract: string,
    options: { confirmedInactive?: boolean } = {}
  ) => {
    const contractName = rawContract.trim();
    if (!contractName) return;
    const ws = await loadWalletState();
    if (!ws) return;
    if (ws.watchedAssets.some((a) => a.contract === contractName)) {
      showToast("Already tracked.", "warning");
      return;
    }
    let meta: Awaited<ReturnType<typeof rpc.getTokenMetadata>> | null = null;
    try {
      meta = await rpc.getTokenMetadata(contractName);
    } catch (e) {
      if (isMissingContractError(e) && !options.confirmedInactive) {
        setPendingUnavailableTokenContract(contractName);
        return;
      }
      if (!isMissingContractError(e)) {
        showToast(
          e instanceof Error
            ? `Couldn't load ${contractName}: ${e.message}`
            : `Couldn't load token metadata for ${contractName}.`,
          "danger"
        );
        return;
      }
    }
    if (!meta?.name && !meta?.symbol && !options.confirmedInactive) {
      showToast(`No token found at ${contractName}.`, "danger");
      return;
    }
    const nextState = updateAssetNetworkState(
      {
        ...ws,
        watchedAssets: [
          ...ws.watchedAssets,
          {
            contract: contractName,
            name: meta?.name ?? undefined,
            symbol: meta?.symbol ?? undefined,
            icon: meta?.logoUrl ?? meta?.logoSvg ?? undefined,
          },
        ],
      },
      contractName,
      {
        status: meta ? "available" : "not_found",
        lastCheckedAt: new Date().toISOString(),
        error: meta ? undefined : "Token contract not found on this network",
      }
    );
    await saveWalletState(nextState);
    setPendingUnavailableTokenContract(null);
    setAddTokenValue("");
    showToast(
      meta?.symbol
        ? `Added ${meta.symbol}.`
        : options.confirmedInactive
          ? `Added ${contractName} as inactive.`
          : `Added ${contractName}.`,
      "success"
    );
    await refresh();
    await refreshBalances();
  };

  const tradeEnabled = dexStatus === "available";
  const tradeChecking = dexStatus === "checking" || dexStatus === "unknown";
  const tradeDisabledTitle = tradeChecking
    ? "Checking DEX availability"
    : dexError ?? "DEX is not deployed on this network.";

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
      <TouchableOpacity
        style={[styles.actionBtn, !tradeEnabled && styles.disabled]}
        disabled={!tradeEnabled}
        onPress={() => { lightTap(); navigation.navigate("Trade"); }}
        accessibilityHint={tradeEnabled ? "Open token swap" : tradeDisabledTitle}
      >
        <View style={[styles.actionCircle, !tradeEnabled && styles.circleDisabled]}><Feather name="repeat" size={20} color={tradeEnabled ? colors.accent : colors.muted} /></View>
        {!prefs.hideQuickActionLabels && <Text style={tradeEnabled ? styles.actionLabel : styles.labelDisabled}>{tradeChecking ? "Checking" : "Swap"}</Text>}
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <AppDialog
        visible={pendingUnavailableTokenContract != null}
        title="Token unavailable"
        message={`This token contract was not found on ${state.activeNetworkName ?? "the current network"}. Add it as an inactive token anyway?`}
        onRequestClose={() => setPendingUnavailableTokenContract(null)}
        actions={[
          {
            title: "Cancel",
            variant: "secondary",
            onPress: () => setPendingUnavailableTokenContract(null),
          },
          {
            title: "Add Inactive",
            onPress: () => {
              const contract = pendingUnavailableTokenContract;
              if (contract) void addToken(contract, { confirmedInactive: true });
            },
          },
        ]}
      >
        <Text style={styles.unavailableTokenContract} numberOfLines={3}>
          {pendingUnavailableTokenContract}
        </Text>
      </AppDialog>
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
          <Text style={styles.badge}>
            {managing ? state.watchedAssets.length : visible.length}
            {!managing && secondaryCount ? ` · ${secondaryCount}` : ""}
          </Text>
        </View>

        {managing ? (
          <View>
          <DraggableList
            items={sorted.map((asset) => ({
              key: asset.contract,
              label: asset.symbol ?? asset.contract.slice(0, 6),
              sublabel: asset.name ?? asset.contract,
              icon: asset.icon,
              iconLetter: (asset.symbol ?? asset.contract.slice(0, 6)).charAt(0).toUpperCase(),
              iconColor: asset.contract === "currency" ? colors.accentDim : assetHue(asset.contract),
              hidden: isAssetHiddenOnActiveNetwork(state, asset),
              unavailable: isAssetUnavailableOnActiveNetwork(state, asset),
              statusLabel: isAssetUnavailableOnActiveNetwork(state, asset)
                ? unavailableAssetLabel(state)
                : undefined,
            }))}
            onReorder={reorderAsset}
            onToggleHide={toggleHide}
          />
          <View style={styles.addTokenRow}>
            <TextInput
              style={styles.addTokenInput}
              value={addTokenValue}
              onChangeText={setAddTokenValue}
              placeholder="Contract name"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              onSubmitEditing={() => addToken(addTokenValue)}
            />
            <TouchableOpacity
              style={styles.addTokenBtn}
              onPress={() => { lightTap(); void addToken(addTokenValue); }}
            >
              <Feather name="plus" size={16} color={colors.accent} />
            </TouchableOpacity>
          </View>
          </View>
        ) : visible.length === 0 ? (
          <Text style={styles.emptyAssets}>
            {state.watchedAssets.length > 0 ? "No assets available on this network." : "No assets tracked yet."}
          </Text>
        ) : (
          visible.map((asset) => {
            const sym = asset.symbol ?? asset.contract.slice(0, 6);
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
                  <TokenAvatar
                    contract={asset.contract}
                    symbol={sym}
                    icon={asset.icon}
                    size={40}
                    textSize={16}
                    backgroundColor={bg}
                  />
                  <View style={styles.body}>
                    <Text style={styles.sym}>{sym}</Text>
                    <Text style={styles.name} numberOfLines={1}>{asset.name ?? asset.contract}</Text>
                  </View>
                  <Text style={styles.bal}>{state.balancesLoading ? "..." : fmtBal(state.assetBalances[asset.contract] ?? null, asset.decimals)}</Text>
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
  body: { flex: 1 },
  sym: { fontSize: 14, fontWeight: "600", color: colors.fg },
  name: { fontSize: 12, color: colors.muted },
  bal: { fontSize: 14, fontWeight: "600", color: colors.fg },
  emptyAssets: { color: colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 24 },
  stickyActions: { borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: 10, backgroundColor: colors.bg0 },
  addTokenRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingTop: 8 },
  addTokenInput: { flex: 1, fontSize: 13, fontFamily: "monospace", color: colors.fg, backgroundColor: colors.bg2, borderRadius: 8, borderWidth: 1, borderColor: colors.line, paddingVertical: 8, paddingHorizontal: 12 },
  addTokenBtn: { width: 36, height: 36, borderRadius: 8, backgroundColor: colors.bg2, alignItems: "center", justifyContent: "center" },
  unavailableTokenContract: { fontSize: 12, fontFamily: "monospace", color: colors.fg, backgroundColor: colors.bg2, borderRadius: 10, padding: 10 },
  footer: { flexDirection: "row", justifyContent: "center", gap: 16, paddingVertical: 12 },
  fLink: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  fText: { fontSize: 12, color: colors.muted },
});
