import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Share,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { colors } from "../theme/colors";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Card } from "../components/Card";
import { useWallet } from "../lib/wallet-context";
import { saveWalletState, loadWalletState } from "../lib/storage";

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
    try {
      await controller.addAccount();
      showToast("Account added.", "success");
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "danger");
    }
  };

  const handleRename = async (index: number) => {
    if (!controller || !renameValue.trim()) return;
    try {
      await controller.renameAccount(index, renameValue.trim());
      setRenamingIndex(null);
      setRenameValue("");
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "danger");
    }
  };

  const handleSwitchAccount = async (index: number) => {
    if (!controller) return;
    try {
      await controller.switchAccount(index);
      showToast("Account switched.", "success");
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "danger");
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
                        <TouchableOpacity onPress={() => handleSwitchAccount(a.index)}>
                          <Text style={styles.linkText}>Use</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity onPress={() => { setRenamingIndex(a.index); setRenameValue(a.name); }}>
                        <Text style={styles.mutedLink}>Rename</Text>
                      </TouchableOpacity>
                      {a.index !== 0 && (
                        <TouchableOpacity onPress={() => handleRemoveAccount(a.index)}>
                          <Text style={[styles.mutedLink, { color: colors.danger }]}>×</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </>
                )}
              </View>
            ))}
            <Button title="Add Account" variant="secondary" onPress={handleAddAccount} />
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

        {/* Backup */}
        <Card title="Backup" subtitle="Export wallet data.">
          <Input label="Password" secureTextEntry value={backupPassword} onChangeText={setBackupPassword} placeholder="Wallet password" />
          <Button title="Export" variant="secondary" onPress={handleExport} />
        </Card>

        {/* Actions */}
        <Card>
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
});
