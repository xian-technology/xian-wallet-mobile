import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Share,
  ActivityIndicator,
  Linking,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Card } from "../components/Card";
import { useWallet } from "../lib/wallet-context";
import { saveWalletState, loadWalletState } from "../lib/storage";
import { loadPreferences, savePreferences, type Preferences } from "../lib/preferences";
import { lightTap } from "../lib/haptics";

export function SettingsScreen({ navigation }: { navigation: any }) {
  const { state, refresh, controller, showToast, setContacts } = useWallet();
  const [secretPassword, setSecretPassword] = useState("");
  const [revealedSeed, setRevealedSeed] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [newContactAddr, setNewContactAddr] = useState("");
  const [showContacts, setShowContacts] = useState(false);
  const [backupPassword, setBackupPassword] = useState("");
  const [prefs, setPrefsState] = useState<Preferences>({ quickActionsPosition: "top", hideQuickActionLabels: false });

  React.useEffect(() => { loadPreferences().then(setPrefsState); }, []);

  const [accountLoading, setAccountLoading] = useState(false);
  const isMnemonic = state.seedSource === "mnemonic";
  const activeAccount = state.accounts.find((a) => a.index === state.activeAccountIndex);

  const handleRevealSeed = async () => {
    if (!controller) return;
    try {
      setError(null);
      setRevealedSeed(await controller.revealMnemonic(secretPassword));
    } catch { setError("Invalid password."); }
  };

  const handleRevealKey = async () => {
    if (!controller) return;
    try {
      setError(null);
      setRevealedKey(await controller.revealPrivateKey(secretPassword));
    } catch { setError("Invalid password."); }
  };

  const handleHideSecrets = () => {
    setRevealedSeed(null);
    setRevealedKey(null);
    setSecretPassword("");
    setError(null);
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
    setAccountLoading(true);
    try {
      await controller.addAccount();
      showToast("Account added.", "success");
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "danger");
    } finally {
      setAccountLoading(false);
    }
  };

  const handleRename = async (index: number) => {
    if (!controller || !renameValue.trim()) return;
    setAccountLoading(true);
    try {
      await controller.renameAccount(index, renameValue.trim());
      setRenamingIndex(null);
      setRenameValue("");
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "danger");
    } finally {
      setAccountLoading(false);
    }
  };

  const handleSwitchAccount = async (index: number) => {
    if (!controller) return;
    setAccountLoading(true);
    try {
      await controller.switchAccount(index);
      showToast("Account switched.", "success");
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "danger");
    } finally {
      setAccountLoading(false);
    }
  };

  const handleRemoveAccount = (index: number) => {
    Alert.alert("Remove Account", "You can re-derive it later from the seed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          if (!controller) return;
          await controller.removeAccount(index);
          showToast("Account removed.", "info");
          await refresh();
        },
      },
    ]);
  };

  const handleExport = async () => {
    if (!controller || !backupPassword) return;
    try {
      const backup = await controller.exportWallet(backupPassword);
      const json = JSON.stringify(backup, null, 2);
      await Share.share({ message: json, title: "Xian Wallet Backup" });
      showToast("Wallet exported.", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Export failed", "danger");
    }
  };

  const handleImport = async () => {
    if (!backupPassword) {
      showToast("Enter a password first.", "warning");
      return;
    }
    Alert.prompt
      ? Alert.prompt("Import Backup", "Paste the exported JSON:", async (json) => {
          if (!json || !controller) return;
          try {
            const backup = JSON.parse(json);
            if (!backup?.version || !backup?.type) { showToast("Invalid backup.", "danger"); return; }
            await controller.removeWallet();
            // Re-create from backup
            const opts: Parameters<typeof controller.createWallet>[0] = { password: backupPassword };
            if (backup.type === "mnemonic" && backup.mnemonic) opts.mnemonic = backup.mnemonic;
            else if (backup.privateKey) opts.privateKey = backup.privateKey;
            await controller.createWallet(opts);
            showToast("Wallet imported.", "success");
            await refresh();
          } catch (e) { showToast(e instanceof Error ? e.message : "Import failed", "danger"); }
        })
      : showToast("Import: paste your backup JSON in the export field on the source device.", "info");
  };

  const handleAddContact = async () => {
    if (!newContactName.trim() || !newContactAddr.trim()) return;
    const contact = {
      id: globalThis.crypto.randomUUID(),
      name: newContactName.trim(),
      address: newContactAddr.trim(),
    };
    await setContacts([...state.contacts, contact]);
    setNewContactName("");
    setNewContactAddr("");
    showToast("Contact saved.", "success");
  };

  const handleDeleteContact = async (id: string) => {
    await setContacts(state.contacts.filter((c) => c.id !== id));
    showToast("Contact removed.", "info");
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Accounts */}
        {isMnemonic && (
          <Card title="Accounts" subtitle={`${state.accounts.length} derived from recovery seed.`}>
            {accountLoading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            )}
            {state.accounts.map((a) => (
              <View key={a.index} style={styles.accountRow}>
                {renamingIndex === a.index ? (
                  <View style={styles.renameRow}>
                    <Input
                      value={renameValue}
                      onChangeText={setRenameValue}
                      placeholder="Account name"
                      style={{ flex: 1 }}
                      onSubmitEditing={() => handleRename(a.index)}
                      autoFocus
                    />
                    <Button title="Save" variant="secondary" onPress={() => handleRename(a.index)} style={{ paddingVertical: 10 }} />
                    <Button title="Cancel" variant="ghost" onPress={() => setRenamingIndex(null)} style={{ paddingVertical: 10 }} />
                  </View>
                ) : (
                  <>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.accountName}>
                        {a.name}
                        {a.index === state.activeAccountIndex && <Text style={styles.activePill}> Active</Text>}
                      </Text>
                      <Text style={styles.accountAddr} numberOfLines={1}>{a.publicKey}</Text>
                    </View>
                    <View style={styles.accountActions}>
                      {a.index !== state.activeAccountIndex && (
                        <TouchableOpacity style={styles.actionPill} onPress={() => handleSwitchAccount(a.index)}>
                          <Text style={styles.actionPillText}>Use</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity style={styles.actionPill} onPress={() => { setRenamingIndex(a.index); setRenameValue(a.name); }}>
                        <Feather name="edit-2" size={14} color={colors.muted} />
                      </TouchableOpacity>
                      {a.index !== 0 && (
                        <TouchableOpacity style={styles.actionPill} onPress={() => handleRemoveAccount(a.index)}>
                          <Feather name="trash-2" size={14} color={colors.danger} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </>
                )}
              </View>
            ))}
            <Button
              title="Add Account"
              variant="secondary"
              onPress={handleAddAccount}
              loading={accountLoading}
              disabled={accountLoading}
            />
          </Card>
        )}

        {/* Networks */}
        <Card title="Networks" subtitle={state.activeNetworkName ?? "Local node"}>
          <Button
            title="Manage Networks"
            variant="secondary"
            onPress={() => navigation.navigate("Networks")}
          />
        </Card>

        {/* Security */}
        <Card title="Security" subtitle={isMnemonic ? "Seed-backed wallet." : "Private key wallet."}>
          {revealedSeed || revealedKey ? (
            <>
              {revealedSeed && (
                <TouchableOpacity
                  style={styles.secretBox}
                  onPress={async () => {
                    await Clipboard.setStringAsync(revealedSeed);
                    showToast("Copied to clipboard.", "success");
                  }}
                >
                  <Text style={styles.secretLabel}>Recovery Seed</Text>
                  <Text style={styles.secretText}>{revealedSeed}</Text>
                </TouchableOpacity>
              )}
              {revealedKey && (
                <TouchableOpacity
                  style={styles.secretBox}
                  onPress={async () => {
                    await Clipboard.setStringAsync(revealedKey);
                    showToast("Copied to clipboard.", "success");
                  }}
                >
                  <Text style={styles.secretLabel}>Private Key</Text>
                  <Text style={styles.secretText}>{revealedKey}</Text>
                </TouchableOpacity>
              )}
              <Button title="Hide" variant="secondary" onPress={handleHideSecrets} />
            </>
          ) : (
            <>
              <Input label="Password" secureTextEntry value={secretPassword} onChangeText={setSecretPassword} placeholder="Wallet password" />
              <View style={styles.btnRow}>
                {isMnemonic && <Button title="Show Seed" variant="secondary" onPress={handleRevealSeed} style={{ flex: 1 }} />}
                <Button title="Show Key" variant="secondary" onPress={handleRevealKey} style={{ flex: 1 }} />
              </View>
              {error && <Text style={styles.errorText}>{error}</Text>}
            </>
          )}
        </Card>

        {/* Contacts */}
        <Card title="Contacts">
          {showContacts ? (
            <>
              {state.contacts.map((c) => (
                <View key={c.id} style={styles.contactRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.contactName}>{c.name}</Text>
                    <Text style={styles.contactAddr} numberOfLines={1}>{c.address}</Text>
                  </View>
                  <TouchableOpacity onPress={() => handleDeleteContact(c.id)}>
                    <Text style={[styles.mutedLink, { color: colors.danger }]}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <Input label="Name" value={newContactName} onChangeText={setNewContactName} placeholder="e.g. Alice" />
              <Input label="Address" value={newContactAddr} onChangeText={setNewContactAddr} placeholder="Wallet address" autoCapitalize="none" />
              <Button title="Save Contact" variant="secondary" onPress={handleAddContact} />
              <Button title="Done" variant="ghost" onPress={() => setShowContacts(false)} />
            </>
          ) : (
            <Button
              title={state.contacts.length > 0 ? `Manage contacts (${state.contacts.length})` : "Add contacts"}
              variant="secondary"
              onPress={() => setShowContacts(true)}
            />
          )}
        </Card>

        {/* Appearance */}
        <Card title="Appearance" subtitle="Customize the home screen.">
          <View style={styles.prefRow}>
            <Text style={styles.prefLabel}>Quick actions position</Text>
            <View style={styles.prefToggle}>
              <TouchableOpacity
                style={[styles.prefOption, prefs.quickActionsPosition === "top" && styles.prefOptionActive]}
                onPress={async () => { lightTap(); const p = { ...prefs, quickActionsPosition: "top" as const }; setPrefsState(p); await savePreferences(p); }}
              ><Text style={[styles.prefOptionText, prefs.quickActionsPosition === "top" && styles.prefOptionTextActive]}>Top</Text></TouchableOpacity>
              <TouchableOpacity
                style={[styles.prefOption, prefs.quickActionsPosition === "bottom" && styles.prefOptionActive]}
                onPress={async () => { lightTap(); const p = { ...prefs, quickActionsPosition: "bottom" as const }; setPrefsState(p); await savePreferences(p); }}
              ><Text style={[styles.prefOptionText, prefs.quickActionsPosition === "bottom" && styles.prefOptionTextActive]}>Bottom</Text></TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity
            style={styles.prefRow}
            onPress={async () => { lightTap(); const p = { ...prefs, hideQuickActionLabels: !prefs.hideQuickActionLabels }; setPrefsState(p); await savePreferences(p); }}
          >
            <Text style={styles.prefLabel}>Hide action labels</Text>
            <Feather name={prefs.hideQuickActionLabels ? "check-square" : "square"} size={18} color={prefs.hideQuickActionLabels ? colors.accent : colors.muted} />
          </TouchableOpacity>
        </Card>

        {/* Backup */}
        <Card title="Backup" subtitle="Export or import wallet data.">
          <Input label="Password" secureTextEntry value={backupPassword} onChangeText={setBackupPassword} placeholder="Wallet password" />
          <View style={styles.btnRow}>
            <Button title="Export" variant="secondary" onPress={handleExport} style={{ flex: 1 }} />
            <Button title="Import" variant="secondary" onPress={handleImport} style={{ flex: 1 }} />
          </View>
        </Card>

        {/* Actions */}
        <Card>
          {state.dashboardUrl && (
            <Button
              title="Open Explorer"
              variant="secondary"
              onPress={() => Linking.openURL(state.dashboardUrl!.replace(/\/+$/, ""))}
            />
          )}
          <Button title="Lock Wallet" variant="secondary" onPress={handleLock} />
          <Button title="Remove Wallet" variant="danger" onPress={handleRemoveWallet} />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg0 },
  scroll: { padding: 16, gap: 16, paddingBottom: 40 },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  renameRow: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  accountName: { fontSize: 14, fontWeight: "600", color: colors.fg },
  activePill: { fontSize: 11, fontWeight: "600", color: colors.accent },
  accountAddr: { fontFamily: "monospace", fontSize: 11, color: colors.muted, marginTop: 2 },
  accountActions: { flexDirection: "row", gap: 12 },
  loadingOverlay: { alignItems: "center" as const, paddingVertical: 8 },
  actionPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.bg2,
  },
  actionPillText: { fontSize: 12, fontWeight: "600" as const, color: colors.accent },
  actionPillTextMuted: { fontSize: 14 },
  linkText: { fontSize: 12, color: colors.accent, fontWeight: "600" },
  mutedLink: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  secretBox: {
    backgroundColor: colors.bg0,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  secretLabel: { fontSize: 12, fontWeight: "600", color: colors.warning, marginBottom: 6 },
  secretText: { fontFamily: "monospace", fontSize: 12, lineHeight: 20, color: colors.fg },
  btnRow: { flexDirection: "row", gap: 8 },
  errorText: { fontSize: 13, color: colors.danger },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  contactName: { fontSize: 14, fontWeight: "500", color: colors.fg },
  contactAddr: { fontFamily: "monospace", fontSize: 11, color: colors.muted },
  prefRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  prefLabel: { fontSize: 14, color: colors.fg },
  prefToggle: { flexDirection: "row", backgroundColor: colors.bg2, borderRadius: 10, padding: 2 },
  prefOption: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8 },
  prefOptionActive: { backgroundColor: colors.bg1 },
  prefOptionText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  prefOptionTextActive: { color: colors.fg },
});
