import React, { useState } from "react";
import * as Clipboard from "expo-clipboard";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
} from "react-native";
import { colors } from "../theme/colors";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Card } from "../components/Card";
import { useWallet } from "../lib/wallet-context";
import { lightTap } from "../lib/haptics";

type Mode = "create" | "seed" | "key";

export function SetupScreen() {
  const { refresh, controller } = useWallet();
  const [mode, setMode] = useState<Mode>("create");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedMnemonic, setGeneratedMnemonic] = useState<string | null>(null);
  const [networkExpanded, setNetworkExpanded] = useState(false);
  const [networkName, setNetworkName] = useState("Local node");
  const [networkChainId, setNetworkChainId] = useState("");
  const [networkRpcUrl, setNetworkRpcUrl] = useState("http://127.0.0.1:26657");
  const [networkDashboardUrl, setNetworkDashboardUrl] = useState("http://127.0.0.1:8080");

  const handleCreate = async () => {
    if (!controller) return;
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (mode === "create" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const opts: Parameters<typeof controller.createWallet>[0] = {
        password,
        networkName: networkName.trim() || undefined,
        chainId: networkChainId.trim() || undefined,
        rpcUrl: networkRpcUrl.trim() || undefined,
        dashboardUrl: networkDashboardUrl.trim() || undefined,
      };
      if (mode === "seed") {
        opts.mnemonic = mnemonic.trim();
      } else if (mode === "key") {
        opts.privateKey = privateKey.trim();
      }

      const result = await controller.createWallet(opts);
      if (result.mnemonic) {
        setGeneratedMnemonic(result.mnemonic);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create wallet");
    } finally {
      setLoading(false);
    }
  };

  if (generatedMnemonic) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.hero}>
            <Text style={styles.heading}>Recovery Seed</Text>
            <Text style={styles.sub}>
              Write this down and store it safely. You will need it to recover
              your wallet.
            </Text>
          </View>
          <View style={styles.form} testID="setup-form">
            <Card>
              <TouchableOpacity
                onPress={async () => {
                  lightTap();
                  await Clipboard.setStringAsync(generatedMnemonic);
                }}
              >
                <Text style={styles.seedText}>{generatedMnemonic}</Text>
              </TouchableOpacity>
            </Card>
            <Button
              title="I've saved my seed"
              onPress={async () => {
                setGeneratedMnemonic(null);
                await refresh();
              }}
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Image source={require("../../assets/xian-logo.png")} style={styles.logo} />
          <Text style={styles.heading}>Xian Wallet</Text>
          <Text style={styles.sub}>Self-custody for Xian. Keys encrypted locally.</Text>
        </View>

        <View style={styles.form} testID="setup-form">
          <View style={styles.tabs}>
            {(["create", "seed", "key"] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.tab, mode === m && styles.tabActive]}
                onPress={() => { setMode(m); setError(null); }}
              >
                <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
                  {m === "create" ? "Create" : m === "seed" ? "Seed" : "Key"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Card>
            <Input
              label="Password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholder="Wallet password"
            />
            {mode === "create" && (
              <Input
                label="Confirm password"
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Confirm password"
              />
            )}
            {mode === "seed" && (
              <Input
                label="Recovery seed"
                value={mnemonic}
                onChangeText={setMnemonic}
                placeholder="Enter your 12 or 24 word seed phrase"
                multiline
                numberOfLines={3}
                style={{ minHeight: 80, textAlignVertical: "top" }}
              />
            )}
            {mode === "key" && (
              <Input
                label="Private key"
                value={privateKey}
                onChangeText={setPrivateKey}
                placeholder="64-character hex key"
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
          </Card>

          <TouchableOpacity
            style={styles.disclosure}
            onPress={() => setNetworkExpanded(!networkExpanded)}
          >
            <Text style={styles.disclosureText}>
              {networkExpanded ? "▼" : "▶"}  Network settings
            </Text>
          </TouchableOpacity>

          {networkExpanded && (
            <Card>
              <Input
                label="Network label"
                value={networkName}
                onChangeText={setNetworkName}
                placeholder="e.g. Mainnet"
              />
              <Input
                label="Expected chain ID"
                value={networkChainId}
                onChangeText={setNetworkChainId}
                placeholder="Optional, e.g. xian-1"
                autoCapitalize="none"
              />
              <Input
                label="RPC URL"
                value={networkRpcUrl}
                onChangeText={setNetworkRpcUrl}
                placeholder="http://..."
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Input
                label="Dashboard URL"
                value={networkDashboardUrl}
                onChangeText={setNetworkDashboardUrl}
                placeholder="http://... (optional)"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </Card>
          )}

          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Button
            title={
              mode === "create"
                ? "Create Wallet"
                : mode === "seed"
                  ? "Import from Seed"
                  : "Import from Key"
            }
            onPress={handleCreate}
            loading={loading}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg0,
  },
  scroll: {
    flexGrow: 1,
    padding: 24,
    paddingVertical: 32,
    gap: 20,
    justifyContent: "center" as const,
  },
  hero: {
    alignItems: "center" as const,
    gap: 12,
  },
  form: {
    width: "100%" as const,
    maxWidth: 520,
    alignSelf: "center" as const,
    gap: 16,
  },
  logo: {
    width: 64,
    height: 64,
    resizeMode: "contain" as const,
  },
  heading: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.fg,
    textAlign: "center",
  },
  sub: {
    fontSize: 14,
    color: colors.muted,
    textAlign: "center",
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.bg2,
    borderRadius: 12,
    padding: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: colors.bg1,
  },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
  },
  tabTextActive: {
    color: colors.fg,
  },
  seedText: {
    fontFamily: "monospace",
    fontSize: 14,
    lineHeight: 24,
    color: colors.warning,
  },
  disclosure: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  disclosureText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
  },
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
  },
});
