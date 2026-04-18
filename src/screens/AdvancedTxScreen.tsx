import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
  TouchableOpacity,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Card } from "../components/Card";
import { useWallet } from "../lib/wallet-context";
import { loadUnlockedSession } from "../lib/storage";
import { lightTap, successTap, errorTap } from "../lib/haptics";
import { parsePositiveIntegerInput, parseTypedInput } from "../lib/runtime-input";

type Step = "draft" | "review" | "sending" | "result";

interface ContractMethod {
  name: string;
  arguments: Array<{ name: string; type: string }>;
}

interface Arg { id: string; name: string; value: string; type: string; fixed?: boolean; }

function parseKwargs(args: Arg[]): Record<string, unknown> {
  const kw: Record<string, unknown> = {};
  for (const a of args) {
    if (!a.name.trim()) continue;
    kw[a.name] = parseTypedInput(a.value, a.type);
  }
  return kw;
}

export function AdvancedTxScreen() {
  const { state, rpc, refreshBalances, showToast } = useWallet();
  const [step, setStep] = useState<Step>("draft");
  const [contract, setContract] = useState("");
  const [func, setFunc] = useState("");
  const [args, setArgs] = useState<Arg[]>([]);
  const [chi, setChi] = useState("");
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<{ estimated: number; suggested: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [methods, setMethods] = useState<ContractMethod[]>([]);
  const [methodsLoading, setMethodsLoading] = useState(false);
  const [methodsError, setMethodsError] = useState<string | null>(null);
  const methodsGen = useRef(0);
  const [result, setResult] = useState<{ submitted: boolean; accepted: boolean; finalized: boolean; txHash?: string; message?: string; } | null>(null);

  // Load methods when contract changes (debounced + generation-guarded so late
  // responses can't overwrite newer input).
  useEffect(() => {
    const c = contract.trim();
    if (!c) {
      methodsGen.current += 1;
      setMethods([]);
      setMethodsError(null);
      setMethodsLoading(false);
      return;
    }
    const gen = ++methodsGen.current;
    const timer = setTimeout(async () => {
      setMethodsLoading(true);
      setMethodsError(null);
      try {
        const result = await rpc.getContractMethods(c);
        if (gen !== methodsGen.current) return;
        setMethods(result);
      } catch (e) {
        if (gen !== methodsGen.current) return;
        setMethods([]);
        setMethodsError(e instanceof Error ? e.message : "Failed to load contract functions");
      } finally {
        if (gen === methodsGen.current) setMethodsLoading(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [contract, state.rpcUrl, rpc]);

  // Update args when function changes
  useEffect(() => {
    const m = methods.find((method) => method.name === func);
    if (m) {
      setArgs(m.arguments.map((a) => ({ id: a.name, name: a.name, value: "", type: a.type || "str", fixed: true })));
    }
  }, [func, methods]);

  const updateArg = (id: string, val: string) => setArgs(args.map((a) => a.id === id ? { ...a, value: val } : a));

  const handleReview = async () => {
    if (!contract.trim() || !func.trim()) { setError("Contract and function are required."); return; }
    setError(null); setEstimating(true);
    try {
      const kw = parseKwargs(args);
      const est = await rpc.estimateChi({ sender: state.publicKey!, contract: contract.trim(), function: func.trim(), kwargs: kw });
      setEstimate(est); lightTap(); setStep("review");
    } catch (e) { setError(e instanceof Error ? e.message : "Estimation failed"); }
    finally { setEstimating(false); }
  };

  const handleSend = async () => {
    setStep("sending");
    try {
      const session = await loadUnlockedSession();
      if (!session) throw new Error("Wallet is locked");
      const kw = parseKwargs(args);
      const s = chi ? parsePositiveIntegerInput(chi) : estimate?.suggested ?? 50000;
      if (s == null) throw new Error("Chi must be a positive integer");
      const r = await rpc.sendTransaction({ privateKey: session.privateKey, contract: contract.trim(), function: func.trim(), kwargs: kw, chi: s });
      setResult(r); setStep("result");
      const ok = r.finalized || r.accepted;
      if (ok) { successTap(); showToast("Transaction finalized.", "success"); void refreshBalances(); }
      else { errorTap(); showToast("Transaction failed.", "danger"); }
    } catch (e) { errorTap(); setResult({ submitted: false, accepted: false, finalized: false, message: e instanceof Error ? e.message : "Failed" }); setStep("result"); }
  };

  const truncHash = (h: string) => h.length > 20 ? `${h.slice(0, 10)}...${h.slice(-8)}` : h;

  if (step === "review") {
    const kw = parseKwargs(args);
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Card title="Transaction Summary">
            <Row label="Contract" value={contract} mono />
            <Row label="Function" value={func} />
            <Row label="Chi" value={estimate ? `${estimate.suggested.toLocaleString()}` : chi || "auto"} />
            {Object.entries(kw).map(([k, v]) => <Row key={k} label={k} value={String(v)} mono />)}
          </Card>
        </ScrollView>
        <View style={styles.stickyBottom}>
          <Button title="Send Transaction" onPress={handleSend} />
          <Button title="Edit" variant="ghost" onPress={() => setStep("draft")} />
        </View>
      </View>
    );
  }

  if (step === "sending") {
    return (<View style={[styles.container, styles.centered]}><ActivityIndicator size="large" color={colors.accent} /><Text style={styles.sendingText}>Sending...</Text></View>);
  }

  if (step === "result" && result) {
    const ok = result.finalized || result.accepted;
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {!ok && result.message && <View style={styles.errorBanner}><Text style={styles.errorText}>{result.message}</Text></View>}
          {result.txHash && (
            <Card><Row label="TX Hash" value={truncHash(result.txHash)} mono />
              {state.dashboardUrl && <TouchableOpacity onPress={() => Linking.openURL(`${state.dashboardUrl!.replace(/\/+$/, "")}/explorer/tx/${result.txHash}`)}><Text style={styles.linkText}>View in explorer</Text></TouchableOpacity>}
            </Card>
          )}
          <Button title="New Transaction" onPress={() => { setStep("draft"); setResult(null); setEstimate(null); setContract(""); setFunc(""); setArgs([]); }} />
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card title="Contract Call">
          <Input label="Contract" value={contract} onChangeText={setContract} placeholder="e.g. currency" autoCapitalize="none" />

          {/* Function selector */}
          <View>
            <Text style={styles.fieldLabel}>Function</Text>
            {methodsLoading ? (
              <View style={styles.methodsLoading}><ActivityIndicator size="small" color={colors.accent} /><Text style={styles.loadingText}>Loading functions...</Text></View>
            ) : methods.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.methodScroll}>
                {methods.map((m) => (
                  <TouchableOpacity key={m.name} style={[styles.methodChip, func === m.name && styles.methodChipActive]} onPress={() => { lightTap(); setFunc(m.name); }}>
                    <Text style={[styles.methodChipText, func === m.name && styles.methodChipTextActive]}>{m.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <>
                {methodsError && (
                  <View style={styles.inlineHint}>
                    <Feather name="alert-circle" size={12} color={colors.warning} />
                    <Text style={styles.inlineHintText}>{methodsError}. Enter the function name manually below.</Text>
                  </View>
                )}
                <Input value={func} onChangeText={setFunc} placeholder="e.g. transfer" autoCapitalize="none" />
              </>
            )}
          </View>
        </Card>

        {/* Arguments */}
        {args.length > 0 && (
          <Card title="Arguments">
            {args.map((arg) => (
              <Input key={arg.id} label={`${arg.name} (${arg.type})`} value={arg.value} onChangeText={(v) => updateArg(arg.id, v)} placeholder={`${arg.type} value`} autoCapitalize="none" />
            ))}
          </Card>
        )}

        <Card title="Chi" subtitle="Leave empty to estimate automatically.">
          <Input value={chi} onChangeText={setChi} placeholder="Auto-estimate" keyboardType="number-pad" />
        </Card>

        {error && <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View>}
      </ScrollView>

      <View style={styles.stickyBottom}>
        <Button title={estimating ? "Estimating..." : "Review Transaction"} onPress={handleReview} loading={estimating} />
      </View>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (<View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={[styles.detailValue, mono && styles.mono]} numberOfLines={1}>{value}</Text></View>);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg0 },
  centered: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: 16, gap: 16, paddingBottom: 120 },
  stickyBottom: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: 24, backgroundColor: colors.bg0, borderTopWidth: 1, borderTopColor: colors.line, gap: 8 },
  sendingText: { color: colors.muted, marginTop: 16, fontSize: 14 },
  fieldLabel: { fontSize: 13, fontWeight: "500", color: colors.muted, marginBottom: 6 },
  methodsLoading: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8 },
  loadingText: { fontSize: 13, color: colors.muted },
  methodScroll: { marginBottom: 4 },
  methodChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.bg2, marginRight: 6 },
  methodChipActive: { backgroundColor: colors.accentSoft },
  methodChipText: { fontSize: 13, color: colors.muted, fontWeight: "500" },
  methodChipTextActive: { color: colors.accent },
  inlineHint: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, paddingHorizontal: 4 },
  inlineHintText: { fontSize: 11, color: colors.warning, flex: 1 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  detailLabel: { fontSize: 13, color: colors.muted },
  detailValue: { fontSize: 13, color: colors.fg, fontWeight: "500", maxWidth: "60%" },
  mono: { fontFamily: "monospace" },
  errorBanner: { backgroundColor: colors.dangerSoft, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.danger },
  errorText: { fontSize: 13, color: colors.danger },
  linkText: { fontSize: 13, color: colors.accent, fontWeight: "600", textAlign: "center", paddingTop: 8 },
});
