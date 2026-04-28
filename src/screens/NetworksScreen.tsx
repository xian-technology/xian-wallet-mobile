import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { colors } from "../theme/colors";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/AppDialog";
import { useWallet } from "../lib/wallet-context";
import { loadWalletState, saveWalletState } from "../lib/storage";

export function NetworksScreen() {
  const { state, refresh, showToast } = useWallet();
  const [editing, setEditing] = useState<string | null>(null); // preset id or "new"
  const [name, setName] = useState("");
  const [rpcUrl, setRpcUrl] = useState("");
  const [dashboardUrl, setDashboardUrl] = useState("");
  const [chainId, setChainId] = useState("");
  const [deleteNetworkId, setDeleteNetworkId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const startEdit = (preset: typeof state.networkPresets[0]) => {
    setEditing(preset.id);
    setName(preset.name);
    setRpcUrl(preset.rpcUrl);
    setDashboardUrl(preset.dashboardUrl ?? "");
    setChainId(preset.chainId ?? "");
  };

  const startNew = () => {
    setEditing("new");
    setName("");
    setRpcUrl("");
    setDashboardUrl("");
    setChainId("");
  };

  const handleSave = async () => {
    if (!name.trim() || !rpcUrl.trim()) {
      showToast("Name and RPC URL are required.", "warning");
      return;
    }

    const ws = await loadWalletState();
    if (!ws) return;

    if (editing === "new") {
      const id = `custom-${Date.now()}`;
      ws.networkPresets.push({
        id,
        name: name.trim(),
        rpcUrl: rpcUrl.trim(),
        dashboardUrl: dashboardUrl.trim() || undefined,
        chainId: chainId.trim() || undefined,
      });
    } else {
      const preset = ws.networkPresets.find((p) => p.id === editing);
      if (preset) {
        preset.name = name.trim();
        preset.rpcUrl = rpcUrl.trim();
        preset.dashboardUrl = dashboardUrl.trim() || undefined;
        preset.chainId = chainId.trim() || undefined;
      }
    }

    await saveWalletState(ws);
    setEditing(null);
    showToast("Network saved.", "success");
    await refresh();
  };

  const handleDelete = (id: string) => {
    setDeleteNetworkId(id);
  };

  const confirmDeleteNetwork = async () => {
    if (!deleteNetworkId) return;
    setDeleting(true);
    try {
      const ws = await loadWalletState();
      if (!ws) return;
      ws.networkPresets = ws.networkPresets.filter((p) => p.id !== deleteNetworkId);
      if (ws.activeNetworkId === deleteNetworkId && ws.networkPresets.length > 0) {
        const fallback = ws.networkPresets[0]!;
        ws.activeNetworkId = fallback.id;
        ws.rpcUrl = fallback.rpcUrl;
        ws.dashboardUrl = fallback.dashboardUrl;
      }
      await saveWalletState(ws);
      setDeleteNetworkId(null);
      showToast("Network removed.", "info");
      await refresh();
    } finally {
      setDeleting(false);
    }
  };

  const handleSwitch = async (id: string) => {
    const ws = await loadWalletState();
    if (!ws) return;
    const preset = ws.networkPresets.find((p) => p.id === id);
    if (!preset) return;
    ws.activeNetworkId = id;
    ws.rpcUrl = preset.rpcUrl;
    ws.dashboardUrl = preset.dashboardUrl;
    await saveWalletState(ws);
    showToast(`Switched to ${preset.name}.`, "success");
    await refresh();
  };

  if (editing) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Card title={editing === "new" ? "Add Network" : "Edit Network"}>
            <Input label="Name" value={name} onChangeText={setName} placeholder="e.g. Mainnet" />
            <Input label="RPC URL" value={rpcUrl} onChangeText={setRpcUrl} placeholder="http://..." autoCapitalize="none" />
            <Input label="Dashboard URL" value={dashboardUrl} onChangeText={setDashboardUrl} placeholder="http://... (optional)" autoCapitalize="none" />
            <Input label="Chain ID" value={chainId} onChangeText={setChainId} placeholder="(optional)" autoCapitalize="none" />
          </Card>
          <Button title="Save" onPress={handleSave} />
          <Button title="Cancel" variant="ghost" onPress={() => setEditing(null)} />
        </ScrollView>
      </View>
    );
  }

  const deleteNetwork = state.networkPresets.find((p) => p.id === deleteNetworkId);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card title="Networks" subtitle="Tap to switch, long-press to edit.">
          {state.networkPresets.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.networkRow, p.id === state.activeNetworkId && styles.networkActive]}
              onPress={() => handleSwitch(p.id)}
              onLongPress={() => {
                if (!p.builtin) startEdit(p);
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.networkName}>{p.name}</Text>
                <Text style={styles.networkUrl} numberOfLines={1}>{p.rpcUrl}</Text>
              </View>
              {p.id === state.activeNetworkId && (
                <Text style={styles.activePill}>Active</Text>
              )}
              {!p.builtin && (
                <TouchableOpacity onPress={() => handleDelete(p.id)} style={styles.deleteBtn}>
                  <Text style={styles.deleteText}>×</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))}
        </Card>
        <Button title="Add Network" variant="secondary" onPress={startNew} />
      </ScrollView>
      <ConfirmDialog
        visible={deleteNetworkId != null}
        title="Delete Network"
        message={`Remove "${deleteNetwork?.name ?? "this network"}"?`}
        confirmTitle="Delete"
        loading={deleting}
        onCancel={() => setDeleteNetworkId(null)}
        onConfirm={confirmDeleteNetwork}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg0 },
  scroll: { padding: 16, gap: 16 },
  networkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
  },
  networkActive: { backgroundColor: colors.accentSoft },
  networkName: { fontSize: 14, fontWeight: "600", color: colors.fg },
  networkUrl: { fontSize: 11, fontFamily: "monospace", color: colors.muted, marginTop: 2 },
  activePill: { fontSize: 11, fontWeight: "600", color: colors.accent },
  deleteBtn: { padding: 8 },
  deleteText: { fontSize: 18, color: colors.danger, fontWeight: "700" },
});
