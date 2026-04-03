import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
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
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 45%, 35%)`;
}

interface AssetRowProps {
  contract: string;
  symbol: string;
  name: string;
  balance: string | null;
  onPress: () => void;
}

function AssetRow({ contract, symbol, name, balance, onPress }: AssetRowProps) {
  const letter = symbol.charAt(0).toUpperCase();
  const bg = contract === "currency" ? colors.accentDim : assetColor(contract);

  return (
    <TouchableOpacity style={styles.assetRow} onPress={onPress} activeOpacity={0.6}>
      <View style={[styles.assetIcon, { backgroundColor: bg }]}>
        <Text style={styles.assetLetter}>{letter}</Text>
      </View>
      <View style={styles.assetBody}>
        <Text style={styles.assetSymbol}>{symbol}</Text>
        <Text style={styles.assetName} numberOfLines={1}>{name}</Text>
      </View>
      <View style={styles.assetEnd}>
        <Text style={styles.assetBalance}>{balance ?? "-"}</Text>
      </View>
    </TouchableOpacity>
  );
}

export function HomeScreen({ navigation }: { navigation: any }) {
  const { state } = useWallet();
  const [copied, setCopied] = React.useState(false);

  const address = state.publicKey ?? "";
  const activeAccount = state.accounts.find(
    (a) => a.index === state.activeAccountIndex
  );

  const visibleAssets = state.watchedAssets
    .filter((a) => !a.hidden)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const handleCopy = async () => {
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Address pill */}
        <TouchableOpacity style={styles.addressPill} onPress={handleCopy}>
          <Text style={styles.addressText}>
            {copied ? "Copied!" : truncateAddress(address)}
          </Text>
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
          <Text style={styles.sectionBadge}>{visibleAssets.length}</Text>
        </View>

        {visibleAssets.map((asset) => (
          <AssetRow
            key={asset.contract}
            contract={asset.contract}
            symbol={asset.symbol ?? asset.contract.slice(0, 6)}
            name={asset.name ?? asset.contract}
            balance={state.assetBalances[asset.contract] ?? null}
            onPress={() => {}}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg0,
  },
  scroll: {
    padding: 16,
    paddingTop: 8,
    gap: 4,
  },
  addressPill: {
    alignSelf: "center",
    backgroundColor: colors.bg2,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 16,
  },
  addressText: {
    fontFamily: "monospace",
    fontSize: 13,
    color: colors.muted,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 32,
    marginBottom: 20,
  },
  actionBtn: {
    alignItems: "center",
    gap: 6,
  },
  actionCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  actionIcon: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.accent,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.fg,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.fg,
  },
  sectionBadge: {
    fontSize: 12,
    color: colors.muted,
  },
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
  },
  assetIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  assetLetter: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.fg,
  },
  assetBody: {
    flex: 1,
  },
  assetSymbol: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.fg,
  },
  assetName: {
    fontSize: 12,
    color: colors.muted,
  },
  assetEnd: {
    alignItems: "flex-end",
  },
  assetBalance: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.fg,
  },
});
