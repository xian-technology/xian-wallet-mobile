import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Keyboard,
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
import { TokenAvatar } from "../components/TokenAvatar";
import { useWallet } from "../lib/wallet-context";
import { loadUnlockedSession } from "../lib/storage";
import { lightTap, successTap, errorTap } from "../lib/haptics";
import {
  formatRuntimeInput,
  isRecognizedXianRecipient,
  parseAmountInput
} from "../lib/runtime-input";
import type { RootStackScreenProps } from "../navigation/types";

type Step = "draft" | "review" | "sending" | "result";

export function SendScreen({ navigation, route }: RootStackScreenProps<"Send">) {
  const { state, rpc, refreshBalances, showToast } = useWallet();
  const [step, setStep] = useState<Step>("draft");
  const [selectedToken, setSelectedToken] = useState(route.params?.token ?? "currency");
  const [showTokenPicker, setShowTokenPicker] = useState(false);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<{ estimated: number } | null>(null);
  const [chiRate, setChiRate] = useState<number | null>(null);
  const [showContacts, setShowContacts] = useState(false);
  const [unrecognizedRecipient, setUnrecognizedRecipient] = useState<string | null>(null);
  const [result, setResult] = useState<{
    submitted: boolean; accepted: boolean; finalized: boolean; txHash?: string; message?: string;
  } | null>(null);

  const tokenAsset = state.watchedAssets.find((a) => a.contract === selectedToken);
  const tokenSymbol = tokenAsset?.symbol ?? selectedToken.slice(0, 6).toUpperCase();
  const tokenBal = state.assetBalances[selectedToken] ?? "0";

  const handleMax = () => { lightTap(); setAmount(tokenBal && tokenBal !== "null" ? tokenBal : "0"); };

  const startReview = async (trimmedTo: string) => {
    const parsedAmount = parseAmountInput(amount);
    if (parsedAmount == null) { setError("Enter a valid amount."); return; }
    setError(null); setEstimating(true);
    try {
      const [est, rate] = await Promise.all([
        rpc.estimateChi({ sender: state.publicKey!, contract: selectedToken, function: "transfer", kwargs: { to: trimmedTo, amount: parsedAmount } }),
        rpc.getChiRate(),
      ]);
      setEstimate(est); setChiRate(rate); lightTap(); setStep("review");
    } catch (e) { setError(e instanceof Error ? e.message : "Estimation failed"); }
    finally { setEstimating(false); }
  };

  const handleReview = async () => {
    const trimmedTo = to.trim();
    if (!trimmedTo) { setError("Recipient address is required."); return; }
    if (trimmedTo === state.publicKey) {
      setError("You can't send tokens to your own address.");
      return;
    }
    if (!isRecognizedXianRecipient(trimmedTo)) {
      setUnrecognizedRecipient(trimmedTo);
      return;
    }
    await startReview(trimmedTo);
  };

  const handleConfirmUnrecognizedRecipient = () => {
    const recipient = unrecognizedRecipient;
    setUnrecognizedRecipient(null);
    if (recipient) {
      void startReview(recipient);
    }
  };

  const handleSend = async () => {
    setStep("sending");
    try {
      const session = await loadUnlockedSession();
      if (!session) throw new Error("Wallet is locked");
      const parsedAmount = parseAmountInput(amount);
      if (parsedAmount == null) throw new Error("Enter a valid amount");
      const r = await rpc.sendTransaction({ privateKey: session.privateKey, contract: selectedToken, function: "transfer", kwargs: { to: to.trim(), amount: parsedAmount }, chi: estimate?.estimated ?? 50000 });
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

  const unrecognizedRecipientModal = (
    <Modal
      visible={unrecognizedRecipient != null}
      transparent
      animationType="fade"
      onRequestClose={() => setUnrecognizedRecipient(null)}
    >
      <View style={styles.confirmOverlay}>
        <View style={styles.confirmDialog}>
          <View style={styles.confirmIcon}>
            <Feather name="alert-triangle" size={20} color={colors.warning} />
          </View>
          <Text style={styles.confirmTitle}>Confirm recipient</Text>
          <Text style={styles.confirmBody}>
            This recipient is not a standard Xian address or contract name. Send funds to it anyway?
          </Text>
          <Text style={styles.confirmAddress} numberOfLines={3}>
            {unrecognizedRecipient}
          </Text>
          <View style={styles.confirmActions}>
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => setUnrecognizedRecipient(null)}
              style={styles.confirmButton}
            />
            <Button
              title="Send Anyway"
              variant="danger"
              onPress={handleConfirmUnrecognizedRecipient}
              style={styles.confirmButton}
            />
          </View>
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
              const isActive = item.contract === selectedToken;
              return (
                <TouchableOpacity
                  style={[styles.tokenPickerItem, isActive && styles.tokenPickerActive]}
                  onPress={() => { lightTap(); setSelectedToken(item.contract); setShowTokenPicker(false); }}
                >
                  <TokenAvatar
                    contract={item.contract}
                    symbol={sym}
                    icon={item.icon}
                    size={32}
                    textSize={14}
                    backgroundColor={item.contract === "currency" ? colors.accentDim : colors.bg2}
                  />
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
            <Row label="Amount" value={`${formatRuntimeInput(parseAmountInput(amount)) || amount.trim()} ${tokenSymbol}`} />
            <Row label="Chi" value={estimate ? `${estimate.estimated.toLocaleString()}${chiRate ? ` (~${(estimate.estimated / chiRate).toLocaleString(undefined, { maximumFractionDigits: 8 })} XIAN)` : ""}` : "-"} />
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
      {unrecognizedRecipientModal}
      {tokenPickerModal}
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card title="Send" subtitle="Transfer tokens to another address.">
          {/* Token selector */}
          <TouchableOpacity style={styles.tokenSelector} onPress={() => { lightTap(); Keyboard.dismiss(); setShowTokenPicker(true); }}>
            <TokenAvatar
              contract={selectedToken}
              symbol={tokenSymbol}
              icon={tokenAsset?.icon}
              size={36}
              textSize={15}
              backgroundColor={selectedToken === "currency" ? colors.accentDim : colors.bg2}
            />
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
              <TouchableOpacity style={styles.inlineIconBtn} onPress={() => { lightTap(); Keyboard.dismiss(); setShowContacts(true); }}>
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
            <Text style={styles.available}>Available: {(() => { const n = Number(tokenBal); const f = 10 ** 8; return (Math.floor(n * f) / f).toLocaleString(undefined, { maximumFractionDigits: 8 }); })()} {tokenSymbol}</Text>
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
  confirmOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.68)", justifyContent: "center", padding: 20 },
  confirmDialog: { backgroundColor: colors.bg1, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 18, gap: 12 },
  confirmIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.warningSoft, alignItems: "center", justifyContent: "center" },
  confirmTitle: { fontSize: 18, fontWeight: "700", color: colors.fg },
  confirmBody: { fontSize: 13, lineHeight: 19, color: colors.muted },
  confirmAddress: { fontSize: 12, fontFamily: "monospace", color: colors.fg, backgroundColor: colors.bg2, borderRadius: 10, padding: 10 },
  confirmActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  confirmButton: { flex: 1, paddingHorizontal: 10 },
  emptyText: { color: colors.muted, textAlign: "center", paddingVertical: 24 },
  contactItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  contactName: { fontSize: 14, fontWeight: "500", color: colors.fg },
  contactAddr: { fontSize: 11, fontFamily: "monospace", color: colors.muted },
  // Token selector
  tokenSelector: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, backgroundColor: colors.bg2 },
  tokenSelSym: { fontSize: 14, fontWeight: "600", color: colors.fg },
  tokenSelName: { fontSize: 11, color: colors.muted },
  // Token picker modal items
  tokenPickerItem: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  tokenPickerActive: { backgroundColor: colors.accentSoft },
  tokenPickerSym: { fontSize: 14, fontWeight: "600", color: colors.fg },
  tokenPickerName: { fontSize: 11, color: colors.muted },
});
