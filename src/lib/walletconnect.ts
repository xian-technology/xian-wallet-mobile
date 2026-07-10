import "@walletconnect/react-native-compat";
import "fast-text-encoding";

import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { Core } from "@walletconnect/core";
import {
  formatJsonRpcError,
  formatJsonRpcResult
} from "@walletconnect/jsonrpc-utils";
import { getSdkError } from "@walletconnect/utils";
import { WalletKit, type WalletKitTypes } from "@reown/walletkit";
import {
  createXianMessageSigningPayload,
  Ed25519Signer
} from "@xian-tech/client";
import {
  createXianDappPolicyForRequest,
  findMatchingXianDappPolicy,
  parseXianDappAction,
  xianChainIdFromCaip2,
  type BroadcastMode,
  type XianDappPolicy,
  type XianDappPolicyArgumentScope,
  type XianProviderRequest,
  type XianTransactionIntent,
  type XianUnsignedTransaction,
  type XianWatchAssetRequest,
} from "@xian-tech/provider";

import {
  loadWalletState,
  saveWalletState,
  touchTrustedDappPolicy,
  upsertTrustedDappPolicy,
  type StoredWalletState,
} from "./storage";
import { loadUnlockedWalletMaterial } from "./wallet-controller";
import { XianRpcClient } from "./rpc-client";
import { activeNetworkAllowsInsecureHttp } from "./network-security";
import {
  activityNetworkKey,
  makeLocalActivityTx,
  saveLocalActivityTx,
} from "./local-activity";
import { isUnsafeMessageToSign } from "./signing-policy";
import {
  authorizeXianWalletConnectRequest,
  buildRequiredXianApprovedNamespaces,
  WalletConnectScopeError,
  type WalletConnectApprovedNamespace,
  type WalletConnectSessionNamespace,
} from "./walletconnect-policy";

const WALLETCONNECT_NATIVE_REDIRECT = "xianwallet://";
const WALLETCONNECT_ORIGIN_PREFIX = "wc:";
const TRUSTED_DAPP_POLICY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type WalletKitClient = Awaited<ReturnType<typeof WalletKit.init>>;

function rpcClientForState(state: StoredWalletState): XianRpcClient {
  return new XianRpcClient(state.rpcUrl, {
    allowInsecureHttp: activeNetworkAllowsInsecureHttp(state),
  });
}

interface WalletConnectMetadata {
  name?: string;
  description?: string;
  url?: string;
  icons?: string[];
}

interface WalletConnectSession {
  topic: string;
  expiry?: number;
  namespaces?: Record<string, WalletConnectSessionNamespace>;
  peer?: {
    metadata?: WalletConnectMetadata;
  };
}

export interface WalletConnectSessionSummary {
  topic: string;
  name: string;
  url?: string;
  icon?: string;
  expiresAt?: number;
}

export interface DappSessionProposal {
  id: number;
  name: string;
  description?: string;
  url?: string;
  icon?: string;
  requiredChains: string[];
  requiredMethods: string[];
  raw: WalletKitTypes.SessionProposal;
}

export interface DappSessionRequest {
  id: number;
  topic: string;
  origin: string;
  sessionName: string;
  caipChainId?: string;
  chainId?: string;
  request: XianProviderRequest;
  trustSuggestion?: {
    label: string;
    description: string;
    broadLabel: string;
    broadDescription: string;
    broadWarning: string;
    exactScope: XianDappPolicyArgumentScope;
    broadScope: XianDappPolicyArgumentScope;
  };
}

export interface WalletConnectRuntimeState {
  configured: boolean;
  sessions: WalletConnectSessionSummary[];
  proposals: DappSessionProposal[];
  requests: DappSessionRequest[];
}

const subscribers = new Set<() => void>();
let walletKitPromise: Promise<WalletKitClient> | null = null;
let walletKit: WalletKitClient | null = null;
let listenersAttached = false;
let linkingAttached = false;
let linkingSubscription: { remove(): void } | null = null;
let proposals: DappSessionProposal[] = [];
let requests: DappSessionRequest[] = [];

function configuredProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as
    | { walletConnectProjectId?: unknown }
    | undefined;
  const fromExtra =
    typeof extra?.walletConnectProjectId === "string"
      ? extra.walletConnectProjectId
      : undefined;
  const processEnv = (globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  const fromEnv = processEnv?.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID;
  const projectId = (fromExtra ?? fromEnv ?? "").trim();
  return projectId.length > 0 ? projectId : null;
}

function wcOrigin(topic: string): string {
  return `${WALLETCONNECT_ORIGIN_PREFIX}${topic}`;
}

function emitChange(): void {
  for (const subscriber of subscribers) {
    subscriber();
  }
}

function metadataName(metadata: WalletConnectMetadata | undefined): string {
  return metadata?.name?.trim() || metadata?.url?.trim() || "Connected dapp";
}

function summarizeSession(session: WalletConnectSession): WalletConnectSessionSummary {
  const metadata = session.peer?.metadata;
  return {
    topic: session.topic,
    name: metadataName(metadata),
    url: metadata?.url,
    icon: metadata?.icons?.[0],
    expiresAt: session.expiry ? session.expiry * 1000 : undefined
  };
}

function sessionName(topic: string): string {
  const session = walletKit?.getActiveSessions()[topic] as
    | WalletConnectSession
    | undefined;
  return metadataName(session?.peer?.metadata);
}

function firstParamObject(
  params: unknown[] | Record<string, unknown> | undefined
): Record<string, unknown> {
  if (Array.isArray(params)) {
    const [first] = params;
    return isRecord(first) ? first : {};
  }
  return isRecord(params) ? params : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function parseXianNumber(value: unknown): number | bigint | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = BigInt(value);
    return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : parsed;
  }
  throw new TypeError("Xian number fields must be non-negative integers");
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafe);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)])
    );
  }
  return value;
}

function normalizeWatchAsset(
  value: unknown
): XianWatchAssetRequest["options"] {
  const root = isRecord(value) ? value : {};
  const options = isRecord(root.options) ? root.options : root;
  const contract = options.contract;
  if (typeof contract !== "string" || !contract.trim()) {
    throw new TypeError("xian_watchAsset requires a token contract");
  }
  return {
    contract: contract.trim(),
    name: typeof options.name === "string" ? options.name.trim() || undefined : undefined,
    symbol:
      typeof options.symbol === "string" ? options.symbol.trim() || undefined : undefined,
    icon: typeof options.icon === "string" ? options.icon.trim() || undefined : undefined,
    decimals:
      typeof options.decimals === "number" &&
      Number.isInteger(options.decimals) &&
      options.decimals >= 0
        ? options.decimals
        : undefined,
  };
}

function txPayload(tx: XianUnsignedTransaction): XianUnsignedTransaction["payload"] {
  return tx.payload;
}

async function activeChainIdForState(
  state: StoredWalletState,
  rpc: XianRpcClient
): Promise<string> {
  try {
    return await rpc.getChainId();
  } catch {
    const activePreset =
      state.networkPresets.find((preset) => preset.id === state.activeNetworkId) ??
      state.networkPresets[0];
    if (activePreset?.chainId) {
      return activePreset.chainId;
    }
    throw new Error("wallet chain is unavailable");
  }
}

async function updateWalletConnectOrigin(
  topic: string,
  connected: boolean
): Promise<void> {
  const state = await loadWalletState();
  if (!state) {
    return;
  }
  const origin = wcOrigin(topic);
  const origins = new Set(state.connectedOrigins);
  if (connected) {
    origins.add(origin);
  } else {
    origins.delete(origin);
  }
  await saveWalletState({
    ...state,
    connectedOrigins: [...origins],
    trustedDappPolicies: connected
      ? state.trustedDappPolicies ?? []
      : (state.trustedDappPolicies ?? []).filter(
          (policy) => policy.origin !== origin
        )
  });
}

async function executionContext(expectedChainId?: string): Promise<{
  state: StoredWalletState;
  privateKey: string;
  rpc: XianRpcClient;
  chainId: string;
}> {
  const material = await loadUnlockedWalletMaterial();
  if (!material) {
    throw new Error("wallet is locked");
  }
  const { state, privateKey } = material;
  const rpc = rpcClientForState(state);
  const chainId = await activeChainIdForState(state, rpc);
  if (expectedChainId && expectedChainId !== chainId) {
    throw new Error("wallet is connected to a different chain");
  }
  return { state, privateKey, rpc, chainId };
}

async function recordSubmittedTransaction(
  state: StoredWalletState,
  tx: XianUnsignedTransaction,
  result: { txHash?: string; accepted: boolean | null; finalized: boolean; message?: unknown }
): Promise<void> {
  const localTx = makeLocalActivityTx({
    txHash: result.txHash,
    sender: tx.payload.sender,
    contract: tx.payload.contract,
    function: tx.payload.function,
    kwargs: tx.payload.kwargs,
    accepted: result.accepted === true,
    finalized: result.finalized,
    message: result.message
  });
  if (localTx) {
    await saveLocalActivityTx(activityNetworkKey(state), localTx);
  }
}

async function executeXianRequest(
  request: XianProviderRequest,
  expectedChainId?: string,
  expectedAccount?: string
): Promise<unknown> {
  const { state, privateKey, rpc, chainId } = await executionContext(expectedChainId);
  if (expectedAccount && expectedAccount !== state.publicKey) {
    throw new Error("WalletConnect session is approved for a different account");
  }
  const signer = new Ed25519Signer(privateKey);

  switch (request.method) {
    case "xian_requestAccounts":
    case "xian_accounts":
      return [state.publicKey];

    case "xian_chainId":
      return chainId;

    case "xian_getWalletInfo":
      return {
        accounts: [state.publicKey],
        selectedAccount: state.publicKey,
        chainId,
        connected: true,
        locked: false,
        capabilities: {
          getWalletInfo: true,
          prepareTransaction: true,
          signMessage: true,
          signTransaction: true,
          sendTransaction: true,
          sendCall: true,
          switchChain: false,
          watchAsset: true
        }
      };

    case "xian_signMessage": {
      const { message } = firstParamObject(request.params);
      if (typeof message !== "string") {
        throw new TypeError("xian_signMessage requires a message string");
      }
      if (isUnsafeMessageToSign(message)) {
        throw new Error("refusing to sign a transaction-like payload as a plain message");
      }
      return signer.signMessage(
        createXianMessageSigningPayload({
          account: state.publicKey,
          chainId,
          message
        })
      );
    }

    case "xian_prepareTransaction": {
      const { intent } = firstParamObject(request.params);
      const txIntent = intent as XianTransactionIntent;
      return rpc.buildTransaction({
        sender: state.publicKey,
        contract: txIntent.contract,
        function: txIntent.function,
        kwargs: txIntent.kwargs,
        chainId,
        chi: parseXianNumber(txIntent.chi),
        chiSupplied: parseXianNumber(txIntent.chiSupplied)
      });
    }

    case "xian_signTransaction": {
      const { tx } = firstParamObject(request.params);
      const unsignedTx = tx as XianUnsignedTransaction;
      const payload = txPayload(unsignedTx);
      if (payload.sender !== state.publicKey) {
        throw new Error("transaction sender does not match the active wallet");
      }
      if (payload.chain_id !== chainId) {
        throw new Error("transaction chain does not match the active wallet chain");
      }
      return rpc.signTransaction(privateKey, unsignedTx);
    }

    case "xian_sendTransaction": {
      const { tx, mode, waitForTx, timeoutMs, pollIntervalMs } =
        firstParamObject(request.params);
      const unsignedTx = tx as XianUnsignedTransaction;
      const payload = txPayload(unsignedTx);
      if (payload.sender !== state.publicKey) {
        throw new Error("transaction sender does not match the active wallet");
      }
      if (payload.chain_id !== chainId) {
        throw new Error("transaction chain does not match the active wallet chain");
      }
      const signedTx = await rpc.signTransaction(privateKey, unsignedTx);
      const result = await rpc.broadcastSignedTransaction(signedTx, {
        mode: mode as BroadcastMode | undefined,
        waitForTx: waitForTx as boolean | undefined,
        timeoutMs: timeoutMs as number | undefined,
        pollIntervalMs: pollIntervalMs as number | undefined
      });
      await recordSubmittedTransaction(state, unsignedTx, result);
      return result;
    }

    case "xian_sendCall": {
      const { intent, mode, waitForTx, timeoutMs, pollIntervalMs } =
        firstParamObject(request.params);
      const txIntent = intent as XianTransactionIntent;
      const unsignedTx = await rpc.buildTransaction({
        sender: state.publicKey,
        contract: txIntent.contract,
        function: txIntent.function,
        kwargs: txIntent.kwargs,
        chainId,
        chi: parseXianNumber(txIntent.chi),
        chiSupplied: parseXianNumber(txIntent.chiSupplied)
      });
      const signedTx = await rpc.signTransaction(privateKey, unsignedTx);
      const result = await rpc.broadcastSignedTransaction(signedTx, {
        mode: mode as BroadcastMode | undefined,
        waitForTx: waitForTx as boolean | undefined,
        timeoutMs: timeoutMs as number | undefined,
        pollIntervalMs: pollIntervalMs as number | undefined
      });
      await recordSubmittedTransaction(state, unsignedTx, result);
      return result;
    }

    case "xian_watchAsset": {
      const asset = normalizeWatchAsset(firstParamObject(request.params));
      await saveWalletState({
        ...state,
        watchedAssets: [
          ...state.watchedAssets.filter((entry) => entry.contract !== asset.contract),
          asset
        ]
      });
      return true;
    }

    default:
      throw new Error(`unsupported WalletConnect request method: ${request.method}`);
  }
}

function authorizePendingRequest(
  client: WalletKitClient,
  pending: DappSessionRequest
): { account: string; chainId: string } {
  const session = client.getActiveSessions()[pending.topic] as
    | WalletConnectSession
    | undefined;
  if (!session) {
    throw new Error("WalletConnect session is no longer active");
  }
  return authorizeXianWalletConnectRequest({
    namespaces: session.namespaces,
    caipChainId: pending.caipChainId ?? "",
    method: pending.request.method,
  });
}

async function requiredNamespacesForProposal(
  proposal: WalletKitTypes.SessionProposal
): Promise<Record<string, WalletConnectApprovedNamespace>> {
  const state = await loadWalletState();
  if (!state) {
    throw new Error("wallet is not configured");
  }
  const rpc = rpcClientForState(state);
  const chainId = await activeChainIdForState(state, rpc);
  return buildRequiredXianApprovedNamespaces({
    proposal: proposal.params,
    chainId,
    account: state.publicKey,
  });
}

function proposalSummary(
  proposal: WalletKitTypes.SessionProposal
): DappSessionProposal {
  const metadata = proposal.params.proposer.metadata as WalletConnectMetadata;
  const required = Object.entries(proposal.params.requiredNamespaces ?? {});
  const requiredChains = required.flatMap(([key, namespace]) =>
    key.includes(":") ? [key] : namespace.chains ?? []
  );
  const requiredMethods = required.flatMap(([, namespace]) => namespace.methods ?? []);
  return {
    id: proposal.id,
    name: metadataName(metadata),
    description: metadata.description,
    url: metadata.url,
    icon: metadata.icons?.[0],
    requiredChains,
    requiredMethods,
    raw: proposal
  };
}

function requestSummary(
  event: WalletKitTypes.SessionRequest
): DappSessionRequest {
  const chainId = xianChainIdFromCaip2(event.params.chainId);
  const request = event.params.request as XianProviderRequest;
  const action = parseXianDappAction(request);
  const target =
    action?.contract && action.function
      ? `${action.contract}.${action.function}`
      : undefined;
  return {
    id: event.id,
    topic: event.topic,
    origin: wcOrigin(event.topic),
    sessionName: sessionName(event.topic),
    caipChainId: event.params.chainId,
    chainId: chainId ?? undefined,
    request,
    trustSuggestion: target
      ? {
          label: `Auto-approve this exact ${target}`,
          description:
            "For the next 30 days, this dapp can repeat matching requests with the same arguments on this account and network.",
          broadLabel: `Auto-approve any ${target}`,
          broadDescription:
            "For the next 30 days, this dapp can send matching requests even if recipients, amounts, routes, or other arguments change.",
          broadWarning:
            "Broad auto-approval can move funds or execute contract logic without another prompt. Use it only for dapps you fully trust.",
          exactScope: "exact",
          broadScope: "any"
        }
      : undefined
  };
}

async function respondWithResult(
  client: WalletKitClient,
  pending: DappSessionRequest,
  result: unknown
): Promise<void> {
  await client.respondSessionRequest({
    topic: pending.topic,
    response: formatJsonRpcResult(pending.id, jsonSafe(result))
  });
}

async function respondWithError(
  client: WalletKitClient,
  pending: DappSessionRequest,
  error: unknown
): Promise<void> {
  await client.respondSessionRequest({
    topic: pending.topic,
    response: formatJsonRpcError(
      pending.id,
      error instanceof Error ? error.message : String(error)
    )
  });
}

async function createPolicyForRequest(
  pending: DappSessionRequest,
  argumentScope: XianDappPolicyArgumentScope
): Promise<XianDappPolicy | null> {
  const state = await loadWalletState();
  if (!state) {
    return null;
  }
  const rpc = rpcClientForState(state);
  const chainId = await activeChainIdForState(state, rpc);
  return createXianDappPolicyForRequest({
    id: globalThis.crypto.randomUUID(),
    origin: pending.origin,
    account: state.publicKey,
    chainId,
    request: pending.request,
    now: Date.now(),
    expiresAt: Date.now() + TRUSTED_DAPP_POLICY_TTL_MS,
    argumentScope
  });
}

async function tryAutoApproveRequest(
  client: WalletKitClient,
  pending: DappSessionRequest
): Promise<boolean> {
  let authorization: { account: string; chainId: string };
  try {
    authorization = authorizePendingRequest(client, pending);
  } catch (error) {
    await respondWithError(client, pending, error);
    return true;
  }
  const material = await loadUnlockedWalletMaterial();
  if (!material) {
    return false;
  }
  const { state } = material;
  const rpc = rpcClientForState(state);
  const chainId = await activeChainIdForState(state, rpc);
  const match = findMatchingXianDappPolicy(
    state.trustedDappPolicies ?? [],
    {
      origin: pending.origin,
      account: state.publicKey,
      chainId,
      now: Date.now()
    },
    pending.request
  );
  if (!match.matched || !match.policy) {
    return false;
  }

  try {
    const result = await executeXianRequest(
      pending.request,
      authorization.chainId,
      authorization.account
    );
    await respondWithResult(client, pending, result);
    await touchTrustedDappPolicy(match.policy.id);
  } catch (error) {
    await respondWithError(client, pending, error);
  }
  return true;
}

function attachListeners(client: WalletKitClient): void {
  if (listenersAttached) {
    return;
  }
  listenersAttached = true;

  client.on("session_proposal", (proposal) => {
    void (async () => {
      try {
        await requiredNamespacesForProposal(proposal);
        proposals = [
          ...proposals.filter((entry) => entry.id !== proposal.id),
          proposalSummary(proposal)
        ];
      } catch (error) {
        const reason =
          error instanceof WalletConnectScopeError
            ? getSdkError(error.reason)
            : getSdkError("UNSUPPORTED_NAMESPACE_KEY");
        await client.rejectSession({ id: proposal.id, reason });
        proposals = proposals.filter((entry) => entry.id !== proposal.id);
      }
      emitChange();
    })();
  });

  client.on("session_request", (event) => {
    void (async () => {
      const pending = requestSummary(event);
      try {
        authorizePendingRequest(client, pending);
      } catch (error) {
        await respondWithError(client, pending, error);
        emitChange();
        return;
      }
      if (await tryAutoApproveRequest(client, pending)) {
        emitChange();
        return;
      }
      requests = [
        ...requests.filter((entry) => entry.id !== pending.id),
        pending
      ];
      emitChange();
    })();
  });

  client.on("proposal_expire", ({ id }) => {
    proposals = proposals.filter((entry) => entry.id !== id);
    emitChange();
  });

  client.on("session_request_expire", ({ id }) => {
    requests = requests.filter((entry) => entry.id !== id);
    emitChange();
  });

  client.on("session_delete", ({ topic }) => {
    requests = requests.filter((entry) => entry.topic !== topic);
    void updateWalletConnectOrigin(topic, false).then(emitChange);
  });
}

export function subscribeWalletConnect(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export async function initializeWalletConnect(): Promise<void> {
  if (walletKitPromise) {
    await walletKitPromise;
    return;
  }

  const projectId = configuredProjectId();
  if (!projectId) {
    return;
  }

  walletKitPromise = (async () => {
    const core = new Core({ projectId });
    const client = await WalletKit.init({
      core,
      metadata: {
        name: "Xian Wallet",
        description: "Xian mobile wallet",
        url: "https://xian.org",
        icons: [],
        redirect: {
          native: WALLETCONNECT_NATIVE_REDIRECT
        }
      }
    });
    walletKit = client;
    attachListeners(client);
    emitChange();
    return client;
  })();

  await walletKitPromise;
}

export function getWalletConnectState(): WalletConnectRuntimeState {
  const sessions = walletKit
    ? Object.values(walletKit.getActiveSessions() as Record<string, WalletConnectSession>)
        .map(summarizeSession)
        .sort((left, right) => left.name.localeCompare(right.name))
    : [];

  return {
    configured: configuredProjectId() != null,
    sessions,
    proposals,
    requests
  };
}

export async function pairWalletConnectUri(uri: string): Promise<void> {
  const trimmed = uri.trim();
  if (!trimmed) {
    throw new Error("WalletConnect URI is required");
  }
  await initializeWalletConnect();
  if (!walletKit) {
    throw new Error("WalletConnect project id is not configured");
  }
  await walletKit.pair({ uri: trimmed });
}

function tryDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractWalletConnectUri(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const decoded = tryDecode(trimmed);
  if (decoded.startsWith("wc:")) {
    return decoded;
  }

  try {
    const url = new URL(trimmed);
    const candidates = [
      url.searchParams.get("uri"),
      url.searchParams.get("wc"),
      url.searchParams.get("walletconnect"),
      url.searchParams.get("walletConnectUri"),
      url.searchParams.get("wc_uri")
    ];
    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      const extracted = extractWalletConnectUri(candidate);
      if (extracted) {
        return extracted;
      }
    }
  } catch {
    // Continue with the raw-string fallback below.
  }

  const match = decoded.match(/wc:[^\s"'<>]+/);
  return match?.[0] ?? null;
}

export async function handleWalletConnectLink(url: string): Promise<boolean> {
  const uri = extractWalletConnectUri(url);
  if (!uri) {
    return false;
  }
  await pairWalletConnectUri(uri);
  return true;
}

export function startWalletConnectLinking(): () => void {
  if (linkingAttached) {
    return () => undefined;
  }

  linkingAttached = true;
  void Linking.getInitialURL().then(async (url) => {
    if (url) {
      try {
        await handleWalletConnectLink(url);
      } catch {
        // The Apps screen will surface pairing errors when the user retries.
      }
    }
  });

  linkingSubscription = Linking.addEventListener("url", ({ url }) => {
    void handleWalletConnectLink(url).catch(() => undefined);
  });

  return () => {
    linkingAttached = false;
    linkingSubscription?.remove();
    linkingSubscription = null;
  };
}

export async function approveWalletConnectProposal(id: number): Promise<void> {
  await initializeWalletConnect();
  if (!walletKit) {
    throw new Error("WalletConnect project id is not configured");
  }
  const pending = proposals.find((entry) => entry.id === id);
  if (!pending) {
    throw new Error("WalletConnect proposal not found");
  }
  const approvedNamespaces = await requiredNamespacesForProposal(pending.raw);
  const session = await walletKit.approveSession({
    id,
    namespaces: approvedNamespaces
  });
  await updateWalletConnectOrigin(session.topic, true);
  proposals = proposals.filter((entry) => entry.id !== id);
  emitChange();
}

export async function rejectWalletConnectProposal(id: number): Promise<void> {
  await initializeWalletConnect();
  if (!walletKit) {
    return;
  }
  await walletKit.rejectSession({
    id,
    reason: getSdkError("USER_REJECTED")
  });
  proposals = proposals.filter((entry) => entry.id !== id);
  emitChange();
}

export async function approveWalletConnectRequest(
  id: number,
  options?: { trust?: XianDappPolicyArgumentScope }
): Promise<void> {
  await initializeWalletConnect();
  if (!walletKit) {
    throw new Error("WalletConnect project id is not configured");
  }
  const pending = requests.find((entry) => entry.id === id);
  if (!pending) {
    throw new Error("WalletConnect request not found");
  }
  try {
    const authorization = authorizePendingRequest(walletKit, pending);
    const result = await executeXianRequest(
      pending.request,
      authorization.chainId,
      authorization.account
    );
    await respondWithResult(walletKit, pending, result);
    if (options?.trust) {
      const policy = await createPolicyForRequest(pending, options.trust);
      if (policy) {
        await upsertTrustedDappPolicy(policy);
      }
    }
  } catch (error) {
    await respondWithError(walletKit, pending, error);
    throw error;
  } finally {
    requests = requests.filter((entry) => entry.id !== id);
    emitChange();
  }
}

export async function rejectWalletConnectRequest(id: number): Promise<void> {
  await initializeWalletConnect();
  if (!walletKit) {
    return;
  }
  const pending = requests.find((entry) => entry.id === id);
  if (!pending) {
    return;
  }
  await respondWithError(walletKit, pending, "User rejected.");
  requests = requests.filter((entry) => entry.id !== id);
  emitChange();
}

export async function disconnectWalletConnectSession(topic: string): Promise<void> {
  await initializeWalletConnect();
  if (!walletKit) {
    return;
  }
  await walletKit.disconnectSession({
    topic,
    reason: getSdkError("USER_DISCONNECTED")
  });
  await updateWalletConnectOrigin(topic, false);
  emitChange();
}
