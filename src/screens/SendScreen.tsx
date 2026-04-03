import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { colors } from "../theme/colors";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Card } from "../components/Card";
import { useWallet } from "../lib/wallet-context";

export function SendScreen({ navigation }: { navigation: any }) {
  const { state } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const xianBalance = state.assetBalances["currency"] ?? "0";

  const handleMax = () => {
    const n = Number(xianBalance);
    setAmount(Number.isNaN(n) ? "0" : String(n));
  };

  const handleReview = () => {
    if (!to.trim()) {
      setError("Recipient address is required.");
      return;
    }
    const n = Number(amount);
    if (!amount || Number.isNaN(n) || n <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setError(null);
    // TODO: navigate to review/confirm screen
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card title="Send" subtitle="Transfer tokens to another address.">
          <Input
            label="Recipient"
            value={to}
            onChangeText={setTo}
            placeholder="Wallet address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View>
            <Input
              label="Amount"
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              keyboardType="decimal-pad"
            />
            <Text style={styles.maxLink} onPress={handleMax}>
              MAX
            </Text>
            <Text style={styles.available}>
              Available: {Number(xianBalance).toLocaleString()} XIAN
            </Text>
          </View>
        </Card>

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Button title="Review" onPress={handleReview} />
        <Button
          title="Advanced Transaction"
          variant="ghost"
          onPress={() => {/* TODO */}}
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
    padding: 16,
    gap: 16,
  },
  maxLink: {
    position: "absolute",
    right: 14,
    top: 34,
    fontSize: 10,
    fontWeight: "700",
    color: colors.accent,
    letterSpacing: 0.5,
  },
  available: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 4,
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
