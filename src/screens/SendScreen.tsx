import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
} from "react-native";
import { colors } from "../theme/colors";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Card } from "../components/Card";
import { useWallet } from "../lib/wallet-context";
import { loadUnlockedSession } from "../lib/storage";

type Step = "draft" | "review" | "sending" | "result";

export function SendScreen({ navigation }: { navigation: any }) {
  const { state, rpc, refreshBalances, showToast } = useWallet();
  const [step, setStep] = useState<Step>("draft");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<{ estimated: number; suggested: number } | null>(null);
  const [result, setResult] = useState<{
    submitted: boolean;
    accepted: boolean;
    finalized: boolean;
    txHash?: string;
    message?: string;
  } | null>(null);

  const xianBalance = state.assetBalances["currency"] ?? "0";

  const handleMax = () => {
    const n = Number(xianBalance);
    setAmount(Number.isNaN(n) ? "0" : String(n));
  };

  const handleReview = async () => {
    if (!to.trim()) { setError("Recipient address is required."); return; }
    const n = Number(amount);
    if (!amount || Number.isNaN(n) || n <= 0) { setError("Enter a valid amount."); return; }
    setError(null);
    setEstimating(true);

    try {
      const est = await rpc.estimateStamps({
        sender: state.publicKey!,
        contract: "currency",
        function: "transfer",
        kwargs: { to: to.trim(), amount: n },
      });
      setEstimate(est);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Estimation failed");
    } finally {
      setEstimating(false);
    }
  };

  const handleSend = async () => {
    setStep("sending");
    try {
      const session = await loadUnlockedSession();
      if (!session) throw new Error("Wallet is locked");

      const txResult = await rpc.sendTransaction({
        privateKey: session.privateKey,
        contract: "currency",
        function: "transfer",
        kwargs: { to: to.trim(), amount: Number(amount) },
        stamps: estimate?.suggested ?? 50000,
      });

      setResult(txResult);
      setStep("result");

      const ok = txResult.finalized || txResult.accepted;
      showToast(
        ok
          ? txResult.finalized ? "Transaction finalized." : "Transaction accepted."
          : "Transaction failed.",
        ok ? "success" : "danger"
      );

      if (ok) void refreshBalances();
    } catch (e) {
      setResult({
        submitted: false,
        accepted: false,
        finalized: false,
        message: e instanceof Error ? e.message : "Failed",
      });
      setStep("result");
      showToast("Transaction failed.", "danger");
    }
  };

  const handleNewTx = () => {
    setStep("draft");
    setTo("");
    setAmount("");
    setEstimate(null);
    setResult(null);
    setError(null);
  };

  const truncateHash = (hash: string) =>
    hash.length > 20 ? `${hash.slice(0, 10)}...${hash.slice(-8)}` : hash;

  // ── Review ────────────────────────────────────────────────
  if (step === "review") {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Card title="Transaction Summary">
            <Row label="To" value={truncateHash(to.trim())} mono />
            <Row label="Amount" value={`${Number(amount).toLocaleString()} XIAN`} />
            <Row label="Stamps" value={estimate ? `${estimate.suggested.toLocaleString()} (est. ${estimate.estimated.toLocaleString()})` : "-"} />
            <Row label="Contract" value="currency" mono />
            <Row label="Function" value="transfer" />
          </Card>

          <Button title="Send Transaction" onPress={handleSend} />
          <Button title="Edit" variant="ghost" onPress={() => setStep("draft")} />
        </ScrollView>
      </View>
    );
  }

  // ── Sending ───────────────────────────────────────────────
  if (step === "sending") {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.sendingText}>Sending transaction...</Text>
      </View>
    );
  }

  // ── Result ────────────────────────────────────────────────
  if (step === "result" && result) {
    const ok = result.finalized || result.accepted;
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {!ok && result.message && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{result.message}</Text>
            </View>
          )}

          {result.txHash && (
            <Card>
              <Row label="TX Hash" value={truncateHash(result.txHash)} mono />
              {state.dashboardUrl && (
                <TouchableOpacity
                  onPress={() =>
                    Linking.openURL(
                      `${state.dashboardUrl!.replace(/\/+$/, "")}/explorer/tx/${result.txHash}`
                    )
                  }
                >
                  <Text style={styles.linkText}>View in explorer</Text>
                </TouchableOpacity>
              )}
            </Card>
          )}

          <Button title="New Transaction" onPress={handleNewTx} />
        </ScrollView>
      </View>
    );
  }

  // ── Draft ─────────────────────────────────────────────────
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

          {state.contacts.length > 0 && (
            <View style={styles.contactList}>
              {state.contacts.slice(0, 5).map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.contactItem}
                  onPress={() => setTo(c.address)}
                >
                  <Text style={styles.contactName}>{c.name}</Text>
                  <Text style={styles.contactAddr}>
                    {c.address.slice(0, 6)}...{c.address.slice(-4)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

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

        <Button
          title={estimating ? "Estimating..." : "Review"}
          onPress={handleReview}
          loading={estimating}
          disabled={estimating}
        />
        <Button
          title="Advanced Transaction"
          variant="ghost"
          onPress={() => navigation.navigate("AdvancedTx")}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.monoText]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg0 },
  scroll: { padding: 16, gap: 16 },
  centered: { alignItems: "center", justifyContent: "center" },
  sendingText: { color: colors.muted, marginTop: 16, fontSize: 14 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  rowLabel: { fontSize: 13, color: colors.muted },
  rowValue: { fontSize: 13, color: colors.fg, fontWeight: "500", maxWidth: "60%" },
  monoText: { fontFamily: "monospace" },
  maxLink: {
    position: "absolute",
    right: 14,
    top: 34,
    fontSize: 10,
    fontWeight: "700",
    color: colors.accent,
    letterSpacing: 0.5,
  },
  available: { fontSize: 12, color: colors.muted, marginTop: 4 },
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorText: { fontSize: 13, color: colors.danger },
  linkText: {
    fontSize: 13,
    color: colors.accent,
    fontWeight: "600",
    textAlign: "center",
    paddingTop: 8,
  },
  contactList: {
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.line,
  },
  contactItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
    backgroundColor: colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  contactName: { fontSize: 13, fontWeight: "500", color: colors.fg },
  contactAddr: { fontSize: 11, fontFamily: "monospace", color: colors.muted },
});
