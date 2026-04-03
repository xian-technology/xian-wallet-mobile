import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { colors } from "../theme/colors";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { useWallet } from "../lib/wallet-context";

export function LockScreen() {
  const { refresh, controller } = useWallet();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = async () => {
    if (!controller || !password) return;
    setLoading(true);
    setError(null);
    try {
      await controller.unlock(password);
      await refresh();
    } catch {
      setError("Invalid password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.heading}>Xian Wallet</Text>
        <Text style={styles.sub}>Enter your password to unlock.</Text>

        <Input
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          onSubmitEditing={handleUnlock}
          returnKeyType="go"
        />

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Button title="Unlock" onPress={handleUnlock} loading={loading} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg0,
    justifyContent: "center",
  },
  inner: {
    padding: 24,
    gap: 20,
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
