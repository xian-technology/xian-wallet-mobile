import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from "react-native";
import { colors } from "../theme/colors";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Card } from "../components/Card";
import { useWallet } from "../lib/wallet-context";

export function SettingsScreen() {
  const { state, refresh, controller } = useWallet();
  const [showSecrets, setShowSecrets] = useState(false);
  const [secretPassword, setSecretPassword] = useState("");
  const [revealedSeed, setRevealedSeed] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeAccount = state.accounts.find(
    (a) => a.index === state.activeAccountIndex
  );
  const isMnemonic = state.seedSource === "mnemonic";

  const handleRevealSeed = async () => {
    if (!controller) return;
    try {
      setError(null);
      const seed = await controller.revealMnemonic(secretPassword);
      setRevealedSeed(seed);
    } catch {
      setError("Invalid password.");
    }
  };

  const handleRevealKey = async () => {
    if (!controller) return;
    try {
      setError(null);
      const key = await controller.revealPrivateKey(secretPassword);
      setRevealedKey(key);
    } catch {
      setError("Invalid password.");
    }
  };

  const handleLock = async () => {
    if (!controller) return;
    await controller.lock();
    await refresh();
  };

  const handleRemoveWallet = () => {
    Alert.alert(
      "Remove Wallet",
      "This permanently removes the wallet. Make sure you have your recovery seed backed up.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            if (!controller) return;
            await controller.removeWallet();
            await refresh();
          },
        },
      ]
    );
  };

  const handleAddAccount = async () => {
    if (!controller) return;
    try {
      await controller.addAccount();
      await refresh();
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Accounts (mnemonic only) */}
        {isMnemonic && (
          <Card title="Accounts" subtitle={`${state.accounts.length} derived from recovery seed.`}>
            {state.accounts.map((a) => (
              <View key={a.index} style={styles.accountRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.accountName}>
                    {a.name}
                    {a.index === state.activeAccountIndex ? (
                      <Text style={styles.activePill}> Active</Text>
                    ) : null}
                  </Text>
                  <Text style={styles.accountAddr} numberOfLines={1}>
                    {a.publicKey}
                  </Text>
                </View>
                {a.index !== state.activeAccountIndex && (
                  <TouchableOpacity
                    onPress={async () => {
                      await controller?.switchAccount(a.index);
                      await refresh();
                    }}
                  >
                    <Text style={styles.linkText}>Switch</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <Button
              title="Add Account"
              variant="secondary"
              onPress={handleAddAccount}
            />
          </Card>
        )}

        {/* Security */}
        <Card
          title="Security"
          subtitle={isMnemonic ? "Seed-backed wallet." : "Private key wallet."}
        >
          {revealedSeed || revealedKey ? (
            <>
              {revealedSeed && (
                <View style={styles.secretBox}>
                  <Text style={styles.secretLabel}>Recovery Seed</Text>
                  <Text style={styles.secretText} selectable>
                    {revealedSeed}
                  </Text>
                </View>
              )}
              {revealedKey && (
                <View style={styles.secretBox}>
                  <Text style={styles.secretLabel}>Private Key</Text>
                  <Text style={styles.secretText} selectable>
                    {revealedKey}
                  </Text>
                </View>
              )}
              <Button
                title="Hide"
                variant="secondary"
                onPress={() => {
                  setRevealedSeed(null);
                  setRevealedKey(null);
                  setSecretPassword("");
                }}
              />
            </>
          ) : (
            <>
              <Input
                label="Password"
                secureTextEntry
                value={secretPassword}
                onChangeText={setSecretPassword}
                placeholder="Wallet password"
              />
              <View style={styles.row}>
                {isMnemonic && (
                  <Button
                    title="Show Seed"
                    variant="secondary"
                    onPress={handleRevealSeed}
                    style={{ flex: 1 }}
                  />
                )}
                <Button
                  title="Show Key"
                  variant="secondary"
                  onPress={handleRevealKey}
                  style={{ flex: 1 }}
                />
              </View>
              {error && <Text style={styles.errorText}>{error}</Text>}
            </>
          )}
        </Card>

        {/* Actions */}
        <Card>
          <Button title="Lock Wallet" variant="secondary" onPress={handleLock} />
          <Button
            title="Remove Wallet"
            variant="danger"
            onPress={handleRemoveWallet}
          />
        </Card>
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
    gap: 16,
    paddingBottom: 40,
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  accountName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.fg,
  },
  activePill: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.accent,
  },
  accountAddr: {
    fontFamily: "monospace",
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  linkText: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  secretBox: {
    backgroundColor: colors.bg0,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  secretLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.warning,
    marginBottom: 6,
  },
  secretText: {
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 20,
    color: colors.fg,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
  },
});
