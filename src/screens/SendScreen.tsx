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
  Modal,
  FlatList,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Card } from "../components/Card";
import { useWallet } from "../lib/wallet-context";
import { loadUnlockedSession } from "../lib/storage";
import { lightTap, successTap, errorTap } from "../lib/haptics";

type Step = "draft" | "review" | "sending" | "result";

export function SendScreen({ navigation, route }: { navigation: any; route: any }) {
  const { state, rpc, refreshBalances, showToast } = useWallet();
  const [step, setStep] = useState<Step>("draft");
  const [selectedToken, setSelectedToken] = useState(route.params?.token ?? "currency");
  const [showTokenPicker, setShowTokenPicker] = useState(false);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<{ estimated: number; suggested: number } | null>(null);
  const [showContacts, setShowContacts] = useState(false);
  const [result, setResult] = useState<{
    submitted: boolean; accepted: boolean; finalized: boolean; txHash?: string; message?: string;
  } | null>(null);

  const tokenAsset = state.watchedAssets.find((a) => a.contract === selectedToken);
  const tokenSymbol = tokenAsset?.symbol ?? selectedToken.slice(0, 6).toUpperCase();
  const tokenBal = state.assetBalances[selectedToken] ?? "0";

  const handleMax = () => { lightTap(); setAmount(String(Number(tokenBal) || 0)); };

  const handleReview = async () => {
    if (!to.trim()) { setError("Recipient address is required."); return; }
    const n = Number(amount);
    if (!amount || Number.isNaN(n) || n <= 0) { setError("Enter a valid amount."); return; }
    setError(null); setEstimating(true);
    try {
      const est = await rpc.estimateStamps({ sender: state.publicKey!, contract: selectedToken, function: "transfer", kwargs: { to: to.trim(), amount: n } });
      setEstimate(est); lightTap(); setStep("review");
    } catch (e) { setError(e instanceof Error ? e.message : "Estimation failed"); }
    finally { setEstimating(false); }
  };

  const handleSend = async () => {
    setStep("sending");
    try {
      const session = await loadUnlockedSession();
      if (!session) throw new Error("Wallet is locked");
      const r = await rpc.sendTransaction({ privateKey: session.privateKey, contract: selectedToken, function: "transfer", kwargs: { to: to.trim(), amount: Number(amount) }, stamps: estimate?.suggested ?? 50000 });
      setResult(r); setStep("result");
      const ok = r.finalized || r.accepted;
      if (ok) { successTap(); showToast(r.finalized ? "Transaction finalized." : "Transaction accepted.", "success"); void refreshBalances(); }
      else { errorTap(); showToast("Transaction failed.", "danger"); }
    } catch (e) { errorTap(); setResult({ submitted: false, accepted: false, finalized: false, message: e instanceof Error ? e.message : "Failed" }); setStep("result"); }
  };

  const truncHash = (h: string) => h.length > 20 ? `${h.slice(0, 10)}...${h.slice(-8)}` : h;

  // ── Contact picker modal ────────────────────────────────────
  const contactModal = (
    <Modal visible={showContacts} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Contacts</Text>
            <TouchableOpacity onPress={() => setShowContacts(false)}><Feather name="x" size={22} color={colors.fg} /></TouchableOpacity>
          </View>
          {state.contacts.length === 0 ? (
            <Text style={styles.emptyText}>No contacts saved yet.</Text>
          ) : (
            <FlatList
              data={state.contacts}
              keyExtractor={(c) => c.id}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.contactItem} onPress={() => { lightTap(); setTo(item.address); setShowContacts(false); }}>
                  <Text style={styles.contactName}>{item.name}</Text>
                  <Text style={styles.contactAddr}>{item.address.slice(0, 8)}...{item.address.slice(-6)}</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );

  const visibleTokens = state.watchedAssets.filter((a) => !a.hidden);

  const tokenPickerModal = (
    <Modal visible={showTokenPicker} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Token</Text>
            <TouchableOpacity onPress={() => setShowTokenPicker(false)}><Feather name="x" size={22} color={colors.fg} /></TouchableOpacity>
          </View>
          <FlatList
            data={visibleTokens}
            keyExtractor={(a) => a.contract}
            renderItem={({ item }) => {
              const sym = item.symbol ?? item.contract.slice(0, 6);
              const letter = sym.charAt(0).toUpperCase();
              const isActive = item.contract === selectedToken;
              return (
                <TouchableOpacity
                  style={[styles.tokenPickerItem, isActive && styles.tokenPickerActive]}
                  onPress={() => { lightTap(); setSelectedToken(item.contract); setShowTokenPicker(false); }}
                >
                  <View style={[styles.tokenPickerIcon, { backgroundColor: item.contract === "currency" ? colors.accentDim : colors.bg2 }]}>
                    <Text style={styles.tokenPickerLetter}>{letter}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tokenPickerSym}>{sym}</Text>
                    <Text style={styles.tokenPickerName}>{item.name ?? item.contract}</Text>
                  </View>
                  {isActive && <Feather name="check" size={18} color={colors.accent} />}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );

  // ── Review ──────────────────────────────────────────────────
  if (step === "review") {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Card title="Transaction Summary">
            <Row label="Token" value={tokenSymbol} />
            <Row label="To" value={truncHash(to.trim())} mono />
            <Row label="Amount" value={`${Number(amount).toLocaleString()} ${tokenSymbol}`} />
            <Row label="Stamps" value={estimate ? `${estimate.suggested.toLocaleString()} (est. ${estimate.estimated.toLocaleString()})` : "-"} />
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
            <Card>
              <Row label="TX Hash" value={truncHash(result.txHash)} mono />
              {state.dashboardUrl && (
                <TouchableOpacity onPress={() => Linking.openURL(`${state.dashboardUrl!.replace(/\/+$/, "")}/explorer/tx/${result.txHash}`)}>
                  <Text style={styles.linkText}>View in explorer</Text>
                </TouchableOpacity>
              )}
            </Card>
          )}
          <Button title="New Transaction" onPress={() => { setStep("draft"); setTo(""); setAmount(""); setResult(null); setEstimate(null); }} />
        </ScrollView>
      </View>
    );
  }

  // ── Draft ───────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {contactModal}
      {tokenPickerModal}
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card title="Send" subtitle="Transfer tokens to another address.">
          {/* Token selector */}
          <TouchableOpacity style={styles.tokenSelector} onPress={() => { lightTap(); setShowTokenPicker(true); }}>
            <View style={[styles.tokenSelIcon, { backgroundColor: selectedToken === "currency" ? colors.accentDim : colors.bg2 }]}>
              <Text style={styles.tokenSelLetter}>{tokenSymbol.charAt(0)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tokenSelSym}>{tokenSymbol}</Text>
              <Text style={styles.tokenSelName}>{tokenAsset?.name ?? selectedToken}</Text>
            </View>
            <Feather name="chevron-down" size={18} color={colors.muted} />
          </TouchableOpacity>

          <View>
            <Text style={styles.fieldLabel}>Recipient</Text>
            <View style={styles.inputWithIcon}>
              <Input value={to} onChangeText={setTo} placeholder="Wallet address" autoCapitalize="none" autoCorrect={false} style={{ paddingRight: 44 }} />
              <TouchableOpacity style={styles.inlineIconBtn} onPress={() => { lightTap(); setShowContacts(true); }}>
                <Feather name="users" size={16} color={colors.muted} />
              </TouchableOpacity>
            </View>
          </View>

          <View>
            <Text style={styles.fieldLabel}>Amount</Text>
            <View style={styles.inputWithIcon}>
              <Input value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" style={{ paddingRight: 50 }} />
              <TouchableOpacity style={styles.inlineIconBtn} onPress={handleMax}>
                <Text style={styles.maxText}>MAX</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.available}>Available: {Number(tokenBal).toLocaleString()} {tokenSymbol}</Text>
          </View>
        </Card>

        {error && <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View>}
      </ScrollView>

      <View style={styles.stickyBottom}>
        <Button title="Advanced Transaction" variant="ghost" onPress={() => { lightTap(); navigation.navigate("AdvancedTx"); }} />
        <Button title={estimating ? "Estimating..." : "Review"} onPress={handleReview} loading={estimating} disabled={estimating} />
      </View>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.mono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg0 },
  scroll: { padding: 16, gap: 16, paddingBottom: 120 },
  centered: { alignItems: "center", justifyContent: "center" },
  sendingText: { color: colors.muted, marginTop: 16, fontSize: 14 },
  stickyBottom: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: 24, backgroundColor: colors.bg0, borderTopWidth: 1, borderTopColor: colors.line, gap: 8 },
  fieldLabel: { fontSize: 13, fontWeight: "500", color: colors.muted, marginBottom: 6 },
  inputWithIcon: { position: "relative" },
  inlineIconBtn: { position: "absolute", right: 10, top: 0, bottom: 0, justifyContent: "center", alignItems: "center", paddingHorizontal: 4 },
  maxText: { fontSize: 10, fontWeight: "700", color: colors.accent, letterSpacing: 0.5 },
  available: { fontSize: 12, color: colors.muted, marginTop: 4 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  detailLabel: { fontSize: 13, color: colors.muted },
  detailValue: { fontSize: 13, color: colors.fg, fontWeight: "500", maxWidth: "60%" },
  mono: { fontFamily: "monospace" },
  errorBanner: { backgroundColor: colors.dangerSoft, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.danger },
  errorText: { fontSize: 13, color: colors.danger },
  linkText: { fontSize: 13, color: colors.accent, fontWeight: "600", textAlign: "center", paddingTop: 8 },
  // Contact modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: colors.bg1, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "50%", padding: 16 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.fg },
  emptyText: { color: colors.muted, textAlign: "center", paddingVertical: 24 },
  contactItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  contactName: { fontSize: 14, fontWeight: "500", color: colors.fg },
  contactAddr: { fontSize: 11, fontFamily: "monospace", color: colors.muted },
  // Token selector
  tokenSelector: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, backgroundColor: colors.bg2 },
  tokenSelIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  tokenSelLetter: { fontSize: 15, fontWeight: "700", color: colors.fg },
  tokenSelSym: { fontSize: 14, fontWeight: "600", color: colors.fg },
  tokenSelName: { fontSize: 11, color: colors.muted },
  // Token picker modal items
  tokenPickerItem: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  tokenPickerActive: { backgroundColor: colors.accentSoft },
  tokenPickerIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  tokenPickerLetter: { fontSize: 14, fontWeight: "700", color: colors.fg },
  tokenPickerSym: { fontSize: 14, fontWeight: "600", color: colors.fg },
  tokenPickerName: { fontSize: 11, color: colors.muted },
});
