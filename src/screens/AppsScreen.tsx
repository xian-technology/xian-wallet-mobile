import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import { Feather } from "@expo/vector-icons";
import { parseXianDappAction } from "@xian-tech/provider";

import { AppDialog } from "../components/AppDialog";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { colors } from "../theme/colors";
import { useWallet } from "../lib/wallet-context";
import { removeTrustedDappPolicy } from "../lib/storage";
import {
  approveWalletConnectProposal,
  approveWalletConnectRequest,
  disconnectWalletConnectSession,
  extractWalletConnectUri,
  getWalletConnectState,
  initializeWalletConnect,
  pairWalletConnectUri,
  rejectWalletConnectProposal,
  rejectWalletConnectRequest,
  startWalletConnectLinking,
  subscribeWalletConnect,
  type DappSessionProposal,
  type DappSessionRequest,
  type WalletConnectRuntimeState,
  type WalletConnectSessionSummary,
} from "../lib/walletconnect";

function formatTimestamp(value?: number): string {
  return value ? new Date(value).toLocaleString() : "No expiry";
}

function shortTopic(topic: string): string {
  return topic.length > 14 ? `${topic.slice(0, 8)}...${topic.slice(-4)}` : topic;
}

function requestTitle(request: DappSessionRequest): string {
  const action = parseXianDappAction(request.request);
  if (action?.contract && action.function) {
    return `${action.contract}.${action.function}`;
  }
  return request.request.method;
}

function requestPayload(request: DappSessionRequest): string {
  try {
    return JSON.stringify(request.request.params ?? {}, null, 2);
  } catch {
    return String(request.request.params ?? "");
  }
}

function policySessionName(
  origin: string,
  sessions: WalletConnectSessionSummary[]
): string {
  if (!origin.startsWith("wc:")) {
    return origin;
  }
  const topic = origin.slice(3);
  return sessions.find((session) => session.topic === topic)?.name ?? shortTopic(topic);
}

function sessionInitial(session: WalletConnectSessionSummary): string {
  return (session.name.trim().charAt(0) || "?").toUpperCase();
}

function ConnectedAppIcon({ session }: { session: WalletConnectSessionSummary }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    setImageFailed(false);
    setImageLoaded(false);
  }, [session.icon]);

  return (
    <View style={styles.iconFallback}>
      {!imageLoaded || imageFailed ? (
        <Text style={styles.iconInitial}>{sessionInitial(session)}</Text>
      ) : null}
      {session.icon && !imageFailed ? (
        <Image
          source={{ uri: session.icon }}
          style={[styles.icon, imageLoaded ? null : styles.iconPending]}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageFailed(true)}
        />
      ) : null}
    </View>
  );
}

export function AppsScreen() {
  const { state, refresh, showToast } = useWallet();
  const [wcState, setWcState] = useState<WalletConnectRuntimeState>(() =>
    getWalletConnectState()
  );
  const [uri, setUri] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [trustRequest, setTrustRequest] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [manualPairingVisible, setManualPairingVisible] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const syncWalletConnectState = useCallback(() => {
    setWcState(getWalletConnectState());
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeWalletConnect(syncWalletConnectState);
    void initializeWalletConnect().then(syncWalletConnectState);
    return unsubscribe;
  }, [syncWalletConnectState]);

  useEffect(() => startWalletConnectLinking(), []);

  const activeProposal = wcState.proposals[0];
  const activeRequest = wcState.requests[0];

  useEffect(() => {
    setTrustRequest(false);
  }, [activeRequest?.id]);

  const policies = useMemo(
    () =>
      [...state.trustedDappPolicies].sort((left, right) =>
        policySessionName(left.origin, wcState.sessions).localeCompare(
          policySessionName(right.origin, wcState.sessions)
        )
      ),
    [state.trustedDappPolicies, wcState.sessions]
  );

  async function pasteUri(): Promise<void> {
    setUri(await Clipboard.getStringAsync());
  }

  async function pairValue(value: string): Promise<boolean> {
    const pairingUri = extractWalletConnectUri(value);
    if (!pairingUri) {
      showToast("No WalletConnect URI found.", "warning");
      return false;
    }

    setBusy("pair");
    try {
      await pairWalletConnectUri(pairingUri);
      setUri("");
      syncWalletConnectState();
      showToast("Pairing started.", "success");
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "danger");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function pair(): Promise<void> {
    await pairValue(uri);
  }

  async function openScanner(): Promise<void> {
    const permission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission();
    if (!permission.granted) {
      showToast("Camera access is needed to scan WalletConnect QR codes.", "warning");
      return;
    }
    setScanned(false);
    setScannerVisible(true);
  }

  async function handleBarcodeScanned(result: BarcodeScanningResult): Promise<void> {
    if (scanned) {
      return;
    }
    setScanned(true);
    const paired = await pairValue(result.data);
    if (paired) {
      setScannerVisible(false);
    } else {
      setScanned(false);
    }
  }

  async function approveProposal(proposal: DappSessionProposal): Promise<void> {
    setBusy(`proposal-${proposal.id}`);
    try {
      await approveWalletConnectProposal(proposal.id);
      await refresh();
      syncWalletConnectState();
      showToast("App connected.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(null);
    }
  }

  async function rejectProposal(proposal: DappSessionProposal): Promise<void> {
    setBusy(`proposal-${proposal.id}`);
    try {
      await rejectWalletConnectProposal(proposal.id);
      syncWalletConnectState();
    } finally {
      setBusy(null);
    }
  }

  async function approveRequest(request: DappSessionRequest): Promise<void> {
    setBusy(`request-${request.id}`);
    try {
      await approveWalletConnectRequest(request.id, { trust: trustRequest });
      await refresh();
      syncWalletConnectState();
      showToast("Request approved.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(null);
    }
  }

  async function rejectRequest(request: DappSessionRequest): Promise<void> {
    setBusy(`request-${request.id}`);
    try {
      await rejectWalletConnectRequest(request.id);
      syncWalletConnectState();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(session: WalletConnectSessionSummary): Promise<void> {
    setBusy(`disconnect-${session.topic}`);
    try {
      await disconnectWalletConnectSession(session.topic);
      await refresh();
      syncWalletConnectState();
      showToast("App disconnected.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(null);
    }
  }

  async function revokePolicy(policyId: string): Promise<void> {
    setBusy(`policy-${policyId}`);
    try {
      await removeTrustedDappPolicy(policyId);
      await refresh();
      showToast("Auto-approval rule revoked.", "success");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>WalletConnect</Text>
          {!wcState.configured ? (
            <View style={styles.notice}>
              <Feather name="alert-circle" size={18} color={colors.warning} />
              <Text style={styles.noticeText}>
                Set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID to enable mobile dapp
                connections.
              </Text>
            </View>
          ) : (
            <>
              <Button title="Scan QR" onPress={openScanner} />
              {!manualPairingVisible ? (
                <Button
                  title="Paste WalletConnect URI"
                  variant="ghost"
                  onPress={() => setManualPairingVisible(true)}
                />
              ) : (
                <View style={styles.manualPairing}>
                  <Input
                    label="WalletConnect URI"
                    value={uri}
                    onChangeText={setUri}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="wc:..."
                  />
                  <View style={styles.row}>
                    <Button title="Paste" variant="secondary" onPress={pasteUri} style={styles.rowButton} />
                    <Button
                      title="Pair"
                      onPress={pair}
                      loading={busy === "pair"}
                      disabled={!uri.trim()}
                      style={styles.rowButton}
                    />
                  </View>
                </View>
              )}
            </>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Connected Apps</Text>
            <Text style={styles.count}>{wcState.sessions.length}</Text>
          </View>
          {wcState.sessions.length === 0 ? (
            <Text style={styles.empty}>No connected apps.</Text>
          ) : (
            wcState.sessions.map((session) => (
              <View key={session.topic} style={styles.sessionRow}>
                <ConnectedAppIcon session={session} />
                <View style={styles.sessionBody}>
                  <Text style={styles.sessionName}>{session.name}</Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {session.url ?? shortTopic(session.topic)}
                  </Text>
                </View>
                <Button
                  title="Disconnect"
                  variant="secondary"
                  onPress={() => void disconnect(session)}
                  loading={busy === `disconnect-${session.topic}`}
                  style={styles.smallButton}
                />
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Auto-Approval Rules</Text>
            <Text style={styles.count}>{policies.length}</Text>
          </View>
          {policies.length === 0 ? (
            <Text style={styles.empty}>No trusted transaction rules.</Text>
          ) : (
            policies.map((policy) => (
              <View key={policy.id} style={styles.policyRow}>
                <View style={styles.policyBody}>
                  <Text style={styles.policyTitle}>
                    {policy.contract && policy.function
                      ? `${policy.contract}.${policy.function}`
                      : policy.label ?? "Dapp rule"}
                  </Text>
                  <Text style={styles.meta}>
                    {policySessionName(policy.origin, wcState.sessions)} · {policy.chainId}
                  </Text>
                  <Text style={styles.meta}>
                    {formatTimestamp(policy.expiresAt)}
                    {policy.lastUsedAt ? ` · Used ${formatTimestamp(policy.lastUsedAt)}` : ""}
                  </Text>
                </View>
                <Button
                  title="Revoke"
                  variant="danger"
                  onPress={() => void revokePolicy(policy.id)}
                  loading={busy === `policy-${policy.id}`}
                  style={styles.smallButton}
                />
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <AppDialog
        visible={scannerVisible}
        title="Scan WalletConnect QR"
        message="Point the camera at a WalletConnect QR code."
        onRequestClose={() => setScannerVisible(false)}
        actions={[
          {
            title: "Close",
            variant: "secondary",
            onPress: () => setScannerVisible(false),
          },
        ]}
        contentStyle={styles.scannerContent}
      >
        {cameraPermission?.granted ? (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={scanned ? undefined : (result) => void handleBarcodeScanned(result)}
          />
        ) : (
          <Text style={styles.empty}>Camera permission is not available.</Text>
        )}
      </AppDialog>

      <AppDialog
        visible={Boolean(activeProposal)}
        title="Connect app"
        message={
          activeProposal
            ? `${activeProposal.name} wants to connect to this wallet.`
            : undefined
        }
        onRequestClose={() => activeProposal && void rejectProposal(activeProposal)}
        actions={[
          {
            title: "Reject",
            variant: "secondary",
            onPress: () => activeProposal && void rejectProposal(activeProposal),
            disabled: busy != null,
          },
          {
            title: "Connect",
            onPress: () => activeProposal && void approveProposal(activeProposal),
            loading: activeProposal ? busy === `proposal-${activeProposal.id}` : false,
          },
        ]}
      >
        {activeProposal ? (
          <View style={styles.dialogStack}>
            <Text style={styles.meta}>{activeProposal.url}</Text>
            <Text style={styles.dialogLabel}>Chains</Text>
            <Text style={styles.dialogValue}>
              {activeProposal.requiredChains.join(", ") || "Optional"}
            </Text>
            <Text style={styles.dialogLabel}>Methods</Text>
            <Text style={styles.dialogValue}>
              {activeProposal.requiredMethods.join(", ") || "Optional"}
            </Text>
          </View>
        ) : null}
      </AppDialog>

      <AppDialog
        visible={Boolean(activeRequest)}
        title="Approve request"
        message={
          activeRequest
            ? `${activeRequest.sessionName} requests ${activeRequest.request.method}.`
            : undefined
        }
        onRequestClose={() => activeRequest && void rejectRequest(activeRequest)}
        actions={[
          {
            title: "Reject",
            variant: "secondary",
            onPress: () => activeRequest && void rejectRequest(activeRequest),
            disabled: busy != null,
          },
          {
            title: "Approve",
            onPress: () => activeRequest && void approveRequest(activeRequest),
            loading: activeRequest ? busy === `request-${activeRequest.id}` : false,
          },
        ]}
      >
        {activeRequest ? (
          <View style={styles.dialogStack}>
            <Text style={styles.dialogLabel}>Request</Text>
            <Text style={styles.dialogValue}>{requestTitle(activeRequest)}</Text>
            <Text style={styles.dialogLabel}>Network</Text>
            <Text style={styles.dialogValue}>
              {activeRequest.chainId ?? "Active wallet network"}
            </Text>
            {activeRequest.trustSuggestion ? (
              <View style={styles.trustRow}>
                <View style={styles.trustText}>
                  <Text style={styles.dialogValue}>
                    {activeRequest.trustSuggestion.label}
                  </Text>
                  <Text style={styles.meta}>
                    {activeRequest.trustSuggestion.description}
                  </Text>
                </View>
                <Switch
                  value={trustRequest}
                  onValueChange={setTrustRequest}
                  trackColor={{ false: colors.bg2, true: colors.accentDim }}
                  thumbColor={trustRequest ? colors.accent : colors.muted}
                />
              </View>
            ) : null}
            <Text style={styles.dialogLabel}>Payload</Text>
            <Text style={styles.payload}>{requestPayload(activeRequest)}</Text>
          </View>
        ) : null}
      </AppDialog>

      {busy && busy !== "pair" ? (
        <View pointerEvents="none" style={styles.busyOverlay}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg0,
  },
  content: {
    padding: 16,
    gap: 18,
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.fg,
  },
  count: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  rowButton: {
    flex: 1,
  },
  manualPairing: {
    gap: 10,
  },
  notice: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: "rgba(250, 173, 20, 0.18)",
  },
  noticeText: {
    flex: 1,
    color: colors.fg,
    fontSize: 13,
    lineHeight: 18,
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    paddingVertical: 6,
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.bg1,
    borderWidth: 1,
    borderColor: colors.line,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    position: "absolute",
  },
  iconPending: {
    opacity: 0,
  },
  iconFallback: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: colors.accentSoft,
  },
  iconInitial: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "700",
  },
  sessionBody: {
    flex: 1,
    minWidth: 0,
  },
  sessionName: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "700",
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  smallButton: {
    paddingHorizontal: 14,
    minHeight: 40,
  },
  policyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.bg1,
    borderWidth: 1,
    borderColor: colors.line,
  },
  policyBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  policyTitle: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "700",
  },
  dialogStack: {
    gap: 8,
  },
  scannerContent: {
    maxHeight: 420,
  },
  camera: {
    height: 340,
    borderRadius: 14,
    overflow: "hidden",
  },
  dialogLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    marginTop: 4,
  },
  dialogValue: {
    color: colors.fg,
    fontSize: 14,
    lineHeight: 20,
  },
  trustRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  trustText: {
    flex: 1,
    gap: 3,
  },
  payload: {
    color: colors.fg,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "Courier",
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});
