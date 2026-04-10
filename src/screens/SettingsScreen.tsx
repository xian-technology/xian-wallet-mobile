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
  TextInput,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Card } from "../components/Card";
import { useWallet } from "../lib/wallet-context";
import { saveWalletState, loadWalletState } from "../lib/storage";
import { lightTap } from "../lib/haptics";

function formatJsonText(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

interface ShieldedHistoryViewState {
  loading?: boolean;
  error?: string;
  available?: boolean;
  hasNewerIndexedHistory?: boolean;
  items?: Array<{
    noteIndex: number | bigint | null;
    action: string | null;
    function: string | null;
    commitment: string | null;
    createdAt: string | null;
    hasPayload: boolean;
  }>;
}

export function SettingsScreen({ navigation }: { navigation: any }) {
  const { state, refresh, controller, rpc, showToast, setContacts, prefs, updatePrefs } = useWallet();
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
  const [editingNetwork, setEditingNetwork] = useState(false);
  const [netName, setNetName] = useState("");
  const [netRpcUrl, setNetRpcUrl] = useState("");
  const [netDashboardUrl, setNetDashboardUrl] = useState("");
  const [netChainId, setNetChainId] = useState("");
  const [shieldedHistory, setShieldedHistory] = useState<Record<string, ShieldedHistoryViewState>>({});

  const [accountLoading, setAccountLoading] = useState(false);
  const isMnemonic = state.seedSource === "mnemonic";
  const activeAccount = state.accounts.find((a) => a.index === state.activeAccountIndex);
  const activePreset = state.networkPresets.find((p) => p.id === state.activeNetworkId);

  const startEditNetwork = () => {
    if (!activePreset) return;
    setNetName(activePreset.name);
    setNetRpcUrl(activePreset.rpcUrl);
    setNetDashboardUrl(activePreset.dashboardUrl ?? "");
    setNetChainId(activePreset.chainId ?? "");
    setEditingNetwork(true);
  };

  const handleSaveNetwork = async () => {
    if (!netName.trim() || !netRpcUrl.trim()) {
      showToast("Name and RPC URL are required.", "warning");
      return;
    }
    const ws = await loadWalletState();
    if (!ws) return;
    const preset = ws.networkPresets.find((p) => p.id === state.activeNetworkId);
    if (!preset) return;
    preset.name = netName.trim();
    preset.rpcUrl = netRpcUrl.trim();
    preset.dashboardUrl = netDashboardUrl.trim() || undefined;
    preset.chainId = netChainId.trim() || undefined;
    ws.rpcUrl = preset.rpcUrl;
    ws.dashboardUrl = preset.dashboardUrl;
    await saveWalletState(ws);
    setEditingNetwork(false);
    showToast("Network updated.", "success");
    await refresh();
  };

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
            await controller.importWalletBackup(backup, backupPassword);
            showToast("Wallet imported.", "success");
            await refresh();
          } catch (e) { showToast(e instanceof Error ? e.message : "Import failed", "danger"); }
        })
      : showToast("Import: paste your backup JSON in the export field on the source device.", "info");
  };

  const handleImportShieldedSnapshot = async () => {
    if (!controller) return;
    Alert.prompt
      ? Alert.prompt(
          "Import Shielded Snapshot",
          "Paste ShieldedWallet.to_json() output:",
          async (json) => {
            if (!json) return;
            try {
              await controller.saveShieldedWalletSnapshot(json);
              showToast("Shielded snapshot stored.", "success");
              await refresh();
            } catch (e) {
              showToast(
                e instanceof Error ? e.message : "Shielded snapshot import failed",
                "danger"
              );
            }
          }
        )
      : showToast("Shielded snapshot import requires text input support on this device.", "info");
  };

  const handleExportShieldedSnapshot = async (snapshotId: string) => {
    if (!controller || !backupPassword) {
      showToast("Enter your backup password first.", "warning");
      return;
    }
    try {
      const payload = await controller.exportShieldedWalletSnapshot(
        snapshotId,
        backupPassword
      );
      await Share.share({
        message: formatJsonText(payload.stateSnapshot),
        title: `${payload.label} Shielded Snapshot`,
      });
      showToast("Shielded snapshot exported.", "success");
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Shielded snapshot export failed",
        "danger"
      );
    }
  };

  const handleRemoveShieldedSnapshot = (snapshotId: string) => {
    Alert.alert(
      "Remove Shielded Snapshot",
      "This removes the locally stored encrypted state_snapshot record from the wallet.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            if (!controller) return;
            try {
              await controller.removeShieldedWalletSnapshot(snapshotId);
              showToast("Shielded snapshot removed.", "info");
              await refresh();
            } catch (e) {
              showToast(
                e instanceof Error ? e.message : "Shielded snapshot removal failed",
                "danger"
              );
            }
          },
        },
      ]
    );
  };

  const handleCheckShieldedSnapshotHistory = async (
    snapshotId: string,
    syncHint: string,
    afterNoteIndex: number
  ) => {
    setShieldedHistory((prev) => ({
      ...prev,
      [snapshotId]: { loading: true }
    }));
    try {
      const history = await rpc.getShieldedWalletHistory(syncHint, {
        afterNoteIndex,
        limit: 5,
      });
      setShieldedHistory((prev) => ({
        ...prev,
        [snapshotId]: {
          loading: false,
          available: history.available,
          hasNewerIndexedHistory: history.items.length > 0,
          items: history.items.map((item) => ({
            noteIndex: item.noteIndex,
            action: item.action,
            function: item.function,
            commitment: item.commitment,
            createdAt: item.createdAt,
            hasPayload: item.outputPayload != null && item.outputPayload !== "",
          })),
        }
      }));
    } catch (error) {
      setShieldedHistory((prev) => ({
        ...prev,
        [snapshotId]: {
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to load indexed shielded history.",
        }
      }));
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
            {accountLoading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            )}
            {state.accounts.map((a) => (
              <View key={a.index} style={styles.accountRow}>
                {renamingIndex === a.index ? (
                  <View style={styles.renameRow}>
                    <TextInput
                      style={styles.renameInput}
                      value={renameValue}
                      onChangeText={setRenameValue}
                      placeholder="Account name"
                      placeholderTextColor={colors.muted}
                      onSubmitEditing={() => handleRename(a.index)}
                      autoFocus
                      selectTextOnFocus
                    />
                    <TouchableOpacity style={styles.renameIconBtn} onPress={() => handleRename(a.index)}>
                      <Feather name="check" size={18} color={colors.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.renameIconBtn} onPress={() => setRenamingIndex(null)}>
                      <Feather name="x" size={18} color={colors.muted} />
                    </TouchableOpacity>
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
          {editingNetwork ? (
            <>
              <Input label="Name" value={netName} onChangeText={setNetName} placeholder="e.g. Mainnet" />
              <Input label="RPC URL" value={netRpcUrl} onChangeText={setNetRpcUrl} placeholder="http://..." autoCapitalize="none" autoCorrect={false} />
              <Input label="Dashboard URL" value={netDashboardUrl} onChangeText={setNetDashboardUrl} placeholder="http://... (optional)" autoCapitalize="none" autoCorrect={false} />
              <Input label="Chain ID" value={netChainId} onChangeText={setNetChainId} placeholder="Optional, e.g. xian-1" autoCapitalize="none" />
              <View style={styles.btnRow}>
                <Button title="Save" variant="secondary" onPress={handleSaveNetwork} style={{ flex: 1 }} />
                <Button title="Cancel" variant="ghost" onPress={() => setEditingNetwork(false)} style={{ flex: 1 }} />
              </View>
            </>
          ) : (
            <>
              {activePreset && (
                <>
                  <DetailRow label="RPC URL" value={activePreset.rpcUrl} />
                  <DetailRow label="Dashboard" value={activePreset.dashboardUrl ?? "-"} />
                  <DetailRow label="Chain ID" value={activePreset.chainId ?? "-"} />
                </>
              )}
              <View style={styles.btnRow}>
                <Button title="Edit" variant="secondary" onPress={startEditNetwork} style={{ flex: 1 }} />
                <Button title="All Networks" variant="secondary" onPress={() => navigation.navigate("Networks")} style={{ flex: 1 }} />
              </View>
            </>
          )}
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
                  <TouchableOpacity style={styles.actionPill} onPress={() => handleDeleteContact(c.id)}>
                    <Feather name="trash-2" size={14} color={colors.danger} />
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
                onPress={async () => { lightTap(); await updatePrefs({ quickActionsPosition: "top" }); }}
              ><Text style={[styles.prefOptionText, prefs.quickActionsPosition === "top" && styles.prefOptionTextActive]}>Top</Text></TouchableOpacity>
              <TouchableOpacity
                style={[styles.prefOption, prefs.quickActionsPosition === "bottom" && styles.prefOptionActive]}
                onPress={async () => { lightTap(); await updatePrefs({ quickActionsPosition: "bottom" }); }}
              ><Text style={[styles.prefOptionText, prefs.quickActionsPosition === "bottom" && styles.prefOptionTextActive]}>Bottom</Text></TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity
            style={styles.prefRow}
            onPress={async () => { lightTap(); await updatePrefs({ hideQuickActionLabels: !prefs.hideQuickActionLabels }); }}
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
          <Text style={styles.backupHint}>
            Full wallet backups now include any stored shielded state_snapshot records.
          </Text>
        </Card>

        <Card
          title="Shielded Snapshots"
          subtitle="Encrypted xian-zk state_snapshot backups stored with this wallet."
        >
          {state.shieldedWalletSnapshots.length === 0 ? (
            <Text style={styles.emptyText}>No shielded snapshots stored yet.</Text>
          ) : (
            state.shieldedWalletSnapshots.map((snapshot) => (
              <View key={snapshot.id} style={styles.snapshotRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.accountName}>{snapshot.label}</Text>
                  <Text style={styles.accountAddr} numberOfLines={1}>
                    {snapshot.assetId}
                  </Text>
                  <Text style={styles.snapshotMeta}>
                    {snapshot.noteCount} notes · {snapshot.commitmentCount} commitments · scanned {snapshot.lastScannedIndex}
                  </Text>
                  <Text style={styles.snapshotHint}>
                    Seed-only recovery still depends on indexed shielded history being available somewhere.
                  </Text>
                  {shieldedHistory[snapshot.id]?.loading ? (
                    <Text style={styles.snapshotHistoryInfo}>
                      Checking indexed history after note {snapshot.lastScannedIndex}...
                    </Text>
                  ) : shieldedHistory[snapshot.id]?.error ? (
                    <Text style={styles.snapshotHistoryWarning}>
                      {shieldedHistory[snapshot.id]?.error}
                    </Text>
                  ) : shieldedHistory[snapshot.id] ? (
                    shieldedHistory[snapshot.id]?.available === false ? (
                      <Text style={styles.snapshotHistoryWarning}>
                        Indexed shielded history is not available from the current RPC/BDS path right now.
                      </Text>
                    ) : shieldedHistory[snapshot.id]?.hasNewerIndexedHistory ? (
                      <View style={{ marginTop: 8 }}>
                        <Text style={styles.snapshotHistoryWarning}>
                          Indexed history shows newer notes after this snapshot. Refresh your shielded wallet state before spending.
                        </Text>
                        {shieldedHistory[snapshot.id]?.items?.map((item, index) => (
                          <Text key={`${snapshot.id}-${index}`} style={styles.snapshotHistoryInfo}>
                            {(item.action ?? item.function ?? "shielded output")} · note {String(item.noteIndex ?? "?")} · {item.hasPayload ? "payload present" : "payload missing"}
                          </Text>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.snapshotHistoryInfo}>
                        Indexed history is available and no newer notes were found after this snapshot.
                      </Text>
                    )
                  ) : null}
                </View>
                <View style={styles.snapshotActions}>
                  <TouchableOpacity
                    style={styles.actionPill}
                    onPress={() =>
                      handleCheckShieldedSnapshotHistory(
                        snapshot.id,
                        snapshot.syncHint,
                        snapshot.lastScannedIndex
                      )
                    }
                  >
                    <Text style={styles.actionPillText}>Check</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionPill}
                    onPress={() => handleExportShieldedSnapshot(snapshot.id)}
                  >
                    <Text style={styles.actionPillText}>Share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionPill}
                    onPress={() => handleRemoveShieldedSnapshot(snapshot.id)}
                  >
                    <Feather name="trash-2" size={14} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
          <Button
            title="Import Shielded Snapshot"
            variant="secondary"
            onPress={handleImportShieldedSnapshot}
          />
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

        <Text style={styles.versionText}>v{Constants.expoConfig?.version ?? "?"}</Text>
      </ScrollView>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1} ellipsizeMode="middle">{value}</Text>
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
  renameRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  renameInput: {
    flex: 1,
    fontSize: 15,
    color: colors.fg,
    backgroundColor: colors.bg2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  renameIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.bg2,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  accountName: { fontSize: 14, fontWeight: "600", color: colors.fg },
  activePill: { fontSize: 11, fontWeight: "600", color: colors.accent },
  accountAddr: { fontFamily: "monospace", fontSize: 11, color: colors.muted, marginTop: 2 },
  accountActions: { flexDirection: "row", gap: 12 },
  snapshotActions: { flexDirection: "row", gap: 12 },
  snapshotRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  snapshotMeta: { fontSize: 11, color: colors.muted, marginTop: 4 },
  snapshotHint: { fontSize: 11, color: colors.muted, marginTop: 6 },
  snapshotHistoryInfo: { fontSize: 11, color: colors.muted, marginTop: 6 },
  snapshotHistoryWarning: { fontSize: 11, color: colors.warning, marginTop: 6 },
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
  backupHint: { fontSize: 12, color: colors.muted, marginTop: 8 },
  emptyText: { fontSize: 13, color: colors.muted },
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
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  detailLabel: { fontSize: 13, color: colors.muted },
  detailValue: { fontSize: 13, fontFamily: "monospace", color: colors.fg, maxWidth: "65%" },
  versionText: { fontSize: 11, color: colors.muted, textAlign: "center", opacity: 0.5, paddingBottom: 8 },
});
