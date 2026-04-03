import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
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

interface Arg {
  id: string;
  name: string;
  value: string;
  type: string;
}

function parseKwargs(args: Arg[]): Record<string, unknown> {
  const kwargs: Record<string, unknown> = {};
  for (const arg of args) {
    if (!arg.name.trim()) continue;
    const v = arg.value.trim();
    switch (arg.type) {
      case "int": kwargs[arg.name] = parseInt(v, 10); break;
      case "float": kwargs[arg.name] = parseFloat(v); break;
      case "bool": kwargs[arg.name] = v === "true"; break;
      case "dict":
      case "list":
        try { kwargs[arg.name] = JSON.parse(v); } catch { kwargs[arg.name] = v; }
        break;
      default: kwargs[arg.name] = v;
    }
  }
  return kwargs;
}

export function AdvancedTxScreen({ navigation }: { navigation: any }) {
  const { state, rpc, refreshBalances, showToast } = useWallet();
  const [step, setStep] = useState<Step>("draft");
  const [contract, setContract] = useState("");
  const [func, setFunc] = useState("");
  const [args, setArgs] = useState<Arg[]>([]);
  const [stamps, setStamps] = useState("");
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<{ estimated: number; suggested: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    submitted: boolean;
    accepted: boolean;
    finalized: boolean;
    txHash?: string;
    message?: string;
  } | null>(null);

  const addArg = () => {
    setArgs([...args, { id: String(Date.now()), name: "", value: "", type: "str" }]);
  };

  const updateArg = (id: string, field: keyof Arg, val: string) => {
    setArgs(args.map((a) => (a.id === id ? { ...a, [field]: val } : a)));
  };

  const removeArg = (id: string) => {
    setArgs(args.filter((a) => a.id !== id));
  };

  const handleReview = async () => {
    if (!contract.trim() || !func.trim()) {
      setError("Contract and function are required.");
      return;
    }
    setError(null);
    setEstimating(true);
    try {
      const kwargs = parseKwargs(args);
      const est = await rpc.estimateStamps({
        sender: state.publicKey!,
        contract: contract.trim(),
        function: func.trim(),
        kwargs,
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
      const kwargs = parseKwargs(args);
      const stampCount = stamps ? Number(stamps) : estimate?.suggested ?? 50000;

      const txResult = await rpc.sendTransaction({
        privateKey: session.privateKey,
        contract: contract.trim(),
        function: func.trim(),
        kwargs,
        stamps: stampCount,
      });

      setResult(txResult);
      setStep("result");
      const ok = txResult.finalized || txResult.accepted;
      showToast(ok ? "Transaction finalized." : "Transaction failed.", ok ? "success" : "danger");
      if (ok) void refreshBalances();
    } catch (e) {
      setResult({ submitted: false, accepted: false, finalized: false, message: e instanceof Error ? e.message : "Failed" });
      setStep("result");
    }
  };

  const truncHash = (h: string) => h.length > 20 ? `${h.slice(0, 10)}...${h.slice(-8)}` : h;

  if (step === "review") {
    const kwargs = parseKwargs(args);
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Card title="Transaction Summary">
            <Row label="Contract" value={contract} mono />
            <Row label="Function" value={func} />
            <Row label="Stamps" value={estimate ? `${estimate.suggested.toLocaleString()} (est. ${estimate.estimated.toLocaleString()})` : stamps || "auto"} />
            {Object.entries(kwargs).map(([k, v]) => (
              <Row key={k} label={k} value={String(v)} mono />
            ))}
          </Card>
          <Button title="Send Transaction" onPress={handleSend} />
          <Button title="Edit" variant="ghost" onPress={() => setStep("draft")} />
        </ScrollView>
      </View>
    );
  }

  if (step === "sending") {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.sendingText}>Sending transaction...</Text>
      </View>
    );
  }

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
              <Row label="TX Hash" value={truncHash(result.txHash)} mono />
              {state.dashboardUrl && (
                <Button
                  title="View in explorer"
                  variant="ghost"
                  onPress={() =>
                    Linking.openURL(`${state.dashboardUrl!.replace(/\/+$/, "")}/explorer/tx/${result.txHash}`)
                  }
                />
              )}
            </Card>
          )}
          <Button title="New Transaction" onPress={() => { setStep("draft"); setResult(null); setEstimate(null); }} />
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card title="Contract Call" subtitle="Specify contract, function, and arguments.">
          <Input label="Contract" value={contract} onChangeText={setContract} placeholder="e.g. currency" autoCapitalize="none" />
          <Input label="Function" value={func} onChangeText={setFunc} placeholder="e.g. transfer" autoCapitalize="none" />
        </Card>

        <Card title="Arguments">
          {args.map((arg) => (
            <View key={arg.id} style={styles.argRow}>
              <Input
                value={arg.name}
                onChangeText={(v) => updateArg(arg.id, "name", v)}
                placeholder="name"
                style={styles.argInput}
                autoCapitalize="none"
              />
              <Input
                value={arg.value}
                onChangeText={(v) => updateArg(arg.id, "value", v)}
                placeholder="value"
                style={styles.argInput}
                autoCapitalize="none"
              />
              <Button title="×" variant="ghost" onPress={() => removeArg(arg.id)} style={{ paddingHorizontal: 8, paddingVertical: 4, minHeight: 0 }} />
            </View>
          ))}
          <Button title="Add Argument" variant="secondary" onPress={addArg} />
        </Card>

        <Card title="Stamps" subtitle="Leave empty to estimate automatically.">
          <Input
            value={stamps}
            onChangeText={setStamps}
            placeholder="Auto-estimate"
            keyboardType="number-pad"
          />
        </Card>

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Button
          title={estimating ? "Estimating..." : "Review Transaction"}
          onPress={handleReview}
          loading={estimating}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg0 },
  centered: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: 16, gap: 16 },
  sendingText: { color: colors.muted, marginTop: 16, fontSize: 14 },
  argRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  argInput: { flex: 1 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  rowLabel: { fontSize: 13, color: colors.muted },
  rowValue: { fontSize: 13, color: colors.fg, fontWeight: "500", maxWidth: "60%" },
  mono: { fontFamily: "monospace" },
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorText: { fontSize: 13, color: colors.danger },
});
