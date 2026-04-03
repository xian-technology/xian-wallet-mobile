import React, { useState } from "react";
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
      const opts: Parameters<typeof controller.createWallet>[0] = { password };
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
          <Text style={styles.heading}>Recovery Seed</Text>
          <Text style={styles.sub}>
            Write this down and store it safely. You will need it to recover
            your wallet.
          </Text>
          <Card>
            <TouchableOpacity onPress={() => {/* TODO: copy */}}>
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
        <Image source={require("../../assets/xian-logo.png")} style={styles.logo} />
        <Text style={styles.heading}>Xian Wallet</Text>
        <Text style={styles.sub}>Self-custody for Xian. Keys encrypted locally.</Text>

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
    padding: 24,
    paddingTop: 60,
    gap: 20,
    alignItems: "center" as const,
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
