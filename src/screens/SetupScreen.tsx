import React, { useState } from "react";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
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
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Card } from "../components/Card";
import { useWallet } from "../lib/wallet-context";
import { parseWalletBackupJson } from "../lib/wallet-backup";
import { lightTap } from "../lib/haptics";

type Mode = "create" | "seed" | "key" | "backup";

export function SetupScreen() {
  const { refresh, controller } = useWallet();
  const [mode, setMode] = useState<Mode>("create");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [backupJson, setBackupJson] = useState("");
  const [backupFileName, setBackupFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedMnemonic, setGeneratedMnemonic] = useState<string | null>(null);
  const [networkExpanded, setNetworkExpanded] = useState(false);
  const [networkName, setNetworkName] = useState("Local node");
  const [networkChainId, setNetworkChainId] = useState("");
  const [networkRpcUrl, setNetworkRpcUrl] = useState("http://127.0.0.1:26657");
  const [networkDashboardUrl, setNetworkDashboardUrl] = useState("http://127.0.0.1:8080");
  const [networkAllowInsecureHttp, setNetworkAllowInsecureHttp] = useState(false);

  const handleCreate = async () => {
    if (!controller) return;
    if (!password) {
      setError(mode === "backup" ? "Enter the backup password." : "Enter a wallet password.");
      return;
    }
    if (mode !== "backup" && password.length < 6) {
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
      if (mode === "backup") {
        const backup = parseWalletBackupJson(backupJson.trim());
        await controller.importWalletBackup(backup, password);
        await refresh();
        return;
      }

      const opts: Parameters<typeof controller.createWallet>[0] = {
        password,
        networkName: networkName.trim() || undefined,
        chainId: networkChainId.trim() || undefined,
        rpcUrl: networkRpcUrl.trim() || undefined,
        dashboardUrl: networkDashboardUrl.trim() || undefined,
        allowInsecureHttp: networkAllowInsecureHttp,
      };
      if (mode === "seed") {
        opts.mnemonic = mnemonic.trim();
      } else if (mode === "key") {
        opts.privateKey = privateKey.trim();
      }

      const result = await controller.createWallet(opts);
      if (result.mnemonic) {
        setGeneratedMnemonic(result.mnemonic);
      } else {
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create wallet");
    } finally {
      setLoading(false);
    }
  };

  const importBackupFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/json",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const file = new File(asset.uri);
      const json = (await file.text()).trim();
      if (!json) {
        setError("Selected file is empty.");
        return;
      }
      parseWalletBackupJson(json);
      setBackupJson(json);
      setBackupFileName(asset.name ?? "backup file");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      setBackupFileName(null);
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
            {(["create", "seed", "key", "backup"] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.tab, mode === m && styles.tabActive]}
                onPress={() => { setMode(m); setError(null); }}
              >
                <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
                  {m === "create" ? "Create" : m === "seed" ? "Seed" : m === "key" ? "Key" : "Backup"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Card>
            <Input
              label={mode === "backup" ? "Backup password" : "Password"}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholder={mode === "backup" ? "Backup password" : "Wallet password"}
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
            {mode === "backup" && (
              <>
                <View style={styles.btnRow}>
                  <Button
                    title="Import File"
                    variant="secondary"
                    onPress={importBackupFile}
                    style={{ flex: 1 }}
                  />
                  <Button
                    title="Clear"
                    variant="ghost"
                    onPress={() => {
                      setBackupJson("");
                      setBackupFileName(null);
                      setError(null);
                    }}
                    style={{ flex: 1 }}
                  />
                </View>
                {backupFileName && (
                  <Text style={styles.loadedFileText}>Loaded {backupFileName}.</Text>
                )}
                <Input
                  label="Backup JSON"
                  value={backupJson}
                  onChangeText={(value) => {
                    setBackupJson(value);
                    setBackupFileName(null);
                  }}
                  placeholder="Paste encrypted backup JSON"
                  multiline
                  numberOfLines={6}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.backupJsonInput}
                />
              </>
            )}
          </Card>

          {mode !== "backup" && (
            <TouchableOpacity
              style={styles.disclosure}
              onPress={() => setNetworkExpanded(!networkExpanded)}
            >
              <Text style={styles.disclosureText}>
                {networkExpanded ? "▼" : "▶"}  Network settings
              </Text>
            </TouchableOpacity>
          )}

          {mode !== "backup" && networkExpanded && (
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
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => {
                  lightTap();
                  setNetworkAllowInsecureHttp((value) => !value);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionLabel}>Allow HTTP data transfers</Text>
                  <Text style={styles.optionHint}>Use only for trusted local or private endpoints.</Text>
                </View>
                <Feather name={networkAllowInsecureHttp ? "check-square" : "square"} size={18} color={networkAllowInsecureHttp ? colors.warning : colors.muted} />
              </TouchableOpacity>
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
                  : mode === "key"
                    ? "Import from Key"
                    : "Import Backup"
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
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  optionLabel: {
    fontSize: 14,
    color: colors.fg,
  },
  optionHint: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 3,
  },
  btnRow: {
    flexDirection: "row",
    gap: 8,
  },
  loadedFileText: {
    fontSize: 12,
    color: colors.muted,
  },
  backupJsonInput: {
    minHeight: 120,
    textAlignVertical: "top",
    fontFamily: "monospace",
    fontSize: 12,
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
