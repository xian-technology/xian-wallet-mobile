/**
 * Mobile storage adapter that implements the WalletControllerStore interface.
 * Uses expo-secure-store for sensitive data and AsyncStorage for general state.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { XianDappPolicy } from "@xian-tech/provider";

const WALLET_STATE_KEY = "xian_wallet_state";
const SESSION_KEY = "xian_unlocked_session";
const BIOMETRIC_SESSION_KEY = "xian_biometric_session_key";
const BIOMETRIC_ENABLED_KEY = "xian_biometric_enabled";
const CONTACTS_KEY = "xian_contacts";
const REQUEST_PREFIX = "xian_req_";
const APPROVAL_PREFIX = "xian_approval_";

async function getSecureStoreItem(
  key: string,
  options?: SecureStore.SecureStoreOptions
): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, options);
  } catch {
    return null;
  }
}

async function deleteSecureStoreItem(
  key: string,
  options?: SecureStore.SecureStoreOptions
): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key, options);
  } catch {
    // Missing or unavailable Keychain entries should not block logout/startup.
  }
}

export type AssetNetworkStatus = "available" | "not_found" | "unknown";

export interface AssetNetworkState {
  status?: AssetNetworkStatus;
  hidden?: boolean;
  lastCheckedAt?: string;
  error?: string;
}

export type AssetNetworkStates = Record<string, Record<string, AssetNetworkState>>;

export interface StoredShieldedWalletSnapshot {
  id: string;
  label: string;
  assetId: string;
  syncHint: string;
  encryptedStateSnapshot: string;
  noteCount: number;
  commitmentCount: number;
  lastScannedIndex: number;
  updatedAt: string;
}

export interface ShieldedWalletSnapshotSummary {
  id: string;
  label: string;
  assetId: string;
  syncHint: string;
  noteCount: number;
  commitmentCount: number;
  lastScannedIndex: number;
  updatedAt: string;
}

// Types matching wallet-core interfaces
export interface StoredWalletState {
  publicKey: string;
  encryptedPrivateKey: string;
  encryptedMnemonic?: string;
  walletEncryptionSalt: string;
  seedSource: "privateKey" | "mnemonic";
  mnemonicWordCount?: number;
  accounts?: Array<{
    index: number;
    publicKey: string;
    encryptedPrivateKey: string;
    name: string;
  }>;
  activeAccountIndex?: number;
  rpcUrl: string;
  dashboardUrl?: string;
  activeNetworkId: string;
  networkPresets: Array<{
    id: string;
    name: string;
    chainId?: string;
    rpcUrl: string;
    dashboardUrl?: string;
    allowInsecureHttp?: boolean;
    builtin?: boolean;
  }>;
  watchedAssets: Array<{
    contract: string;
    name?: string;
    symbol?: string;
    icon?: string;
    decimals?: number;
    hidden?: boolean;
    order?: number;
  }>;
  assetNetworkStates?: AssetNetworkStates;
  trustedDappPolicies?: XianDappPolicy[];
  shieldedWalletSnapshots?: StoredShieldedWalletSnapshot[];
  connectedOrigins: string[];
  createdAt: string;
}

export interface StoredUnlockedSession {
  privateKey: string;
  mnemonic?: string;
  sessionKey: string;
  expiresAt: number;
}

export interface StoredBiometricSessionKey {
  publicKey: string;
  sessionKey: string;
  enabledAt: number;
}

export interface StoredProviderRequest {
  requestId: string;
  origin: string;
  request: unknown;
  createdAt: number;
  updatedAt: number;
  status: string;
  approvalId?: string;
  result?: unknown;
  error?: unknown;
}

export interface PersistedApproval {
  id: string;
  requestId: string;
  record: unknown;
  view: unknown;
  windowId?: number;
}

export interface Contact {
  id: string;
  name: string;
  address: string;
}

// Wallet state
export async function loadWalletState(): Promise<StoredWalletState | null> {
  const raw = await AsyncStorage.getItem(WALLET_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveWalletState(state: StoredWalletState): Promise<void> {
  await AsyncStorage.setItem(WALLET_STATE_KEY, JSON.stringify(state));
}

export async function clearWalletState(): Promise<void> {
  await AsyncStorage.removeItem(WALLET_STATE_KEY);
}

// Unlocked session (stored in secure store)
export async function loadUnlockedSession(): Promise<StoredUnlockedSession | null> {
  const raw = await getSecureStoreItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session: StoredUnlockedSession = JSON.parse(raw);
    if (session.expiresAt <= Date.now()) {
      await deleteSecureStoreItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function saveUnlockedSession(
  session: StoredUnlockedSession
): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function clearUnlockedSession(): Promise<void> {
  await deleteSecureStoreItem(SESSION_KEY);
}

function biometricSecureStoreOptions(): SecureStore.SecureStoreOptions {
  return {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: true,
    authenticationPrompt: "Unlock Xian Wallet",
    keychainService: BIOMETRIC_SESSION_KEY,
  };
}

export async function isBiometricUnlockEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY)) === "true";
}

export async function loadBiometricSessionKey(): Promise<StoredBiometricSessionKey | null> {
  const raw = await getSecureStoreItem(
    BIOMETRIC_SESSION_KEY,
    biometricSecureStoreOptions()
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    await clearBiometricSessionKey();
    return null;
  }
}

export async function saveBiometricSessionKey(
  session: StoredBiometricSessionKey
): Promise<void> {
  await SecureStore.setItemAsync(
    BIOMETRIC_SESSION_KEY,
    JSON.stringify(session),
    biometricSecureStoreOptions()
  );
  await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, "true");
}

export async function clearBiometricSessionKey(): Promise<void> {
  await deleteSecureStoreItem(
    BIOMETRIC_SESSION_KEY,
    biometricSecureStoreOptions()
  );
  await AsyncStorage.removeItem(BIOMETRIC_ENABLED_KEY);
}

// Provider requests
export async function loadRequestState(
  requestId: string
): Promise<StoredProviderRequest | null> {
  const raw = await AsyncStorage.getItem(REQUEST_PREFIX + requestId);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveRequestState(
  state: StoredProviderRequest
): Promise<void> {
  await AsyncStorage.setItem(
    REQUEST_PREFIX + state.requestId,
    JSON.stringify(state)
  );
}

export async function deleteRequestState(requestId: string): Promise<void> {
  await AsyncStorage.removeItem(REQUEST_PREFIX + requestId);
}

export async function listRequestStates(): Promise<StoredProviderRequest[]> {
  const keys = await AsyncStorage.getAllKeys();
  const reqKeys = keys.filter((k) => k.startsWith(REQUEST_PREFIX));
  if (reqKeys.length === 0) return [];
  const results: StoredProviderRequest[] = [];
  for (const key of reqKeys) {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      try { results.push(JSON.parse(raw)); } catch { /* skip */ }
    }
  }
  return results;
}

// Approvals
export async function loadApprovalState(
  approvalId: string
): Promise<PersistedApproval | null> {
  const raw = await AsyncStorage.getItem(APPROVAL_PREFIX + approvalId);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveApprovalState(
  state: PersistedApproval
): Promise<void> {
  await AsyncStorage.setItem(
    APPROVAL_PREFIX + state.id,
    JSON.stringify(state)
  );
}

export async function deleteApprovalState(approvalId: string): Promise<void> {
  await AsyncStorage.removeItem(APPROVAL_PREFIX + approvalId);
}

export async function listApprovalStates(): Promise<PersistedApproval[]> {
  const keys = await AsyncStorage.getAllKeys();
  const appKeys = keys.filter((k) => k.startsWith(APPROVAL_PREFIX));
  if (appKeys.length === 0) return [];
  const results: PersistedApproval[] = [];
  for (const key of appKeys) {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      try { results.push(JSON.parse(raw)); } catch { /* skip */ }
    }
  }
  return results;
}

// Contacts
export async function loadContacts(): Promise<Contact[]> {
  const raw = await AsyncStorage.getItem(CONTACTS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveContacts(contacts: Contact[]): Promise<void> {
  await AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
}

// Trusted dapp policies
function currentTrustedPolicies(state: StoredWalletState): XianDappPolicy[] {
  return Array.isArray(state.trustedDappPolicies)
    ? state.trustedDappPolicies
    : [];
}

function sameTrustedPolicyScope(
  left: XianDappPolicy,
  right: XianDappPolicy
): boolean {
  return (
    left.origin === right.origin &&
    left.account === right.account &&
    left.chainId === right.chainId &&
    left.contract === right.contract &&
    left.function === right.function &&
    left.methods.length === right.methods.length &&
    left.methods.every((method) => right.methods.includes(method))
  );
}

export async function loadTrustedDappPolicies(): Promise<XianDappPolicy[]> {
  const state = await loadWalletState();
  return state ? currentTrustedPolicies(state) : [];
}

export async function upsertTrustedDappPolicy(
  policy: XianDappPolicy
): Promise<void> {
  const state = await loadWalletState();
  if (!state) {
    throw new Error("no wallet configured");
  }
  const policies = currentTrustedPolicies(state);
  await saveWalletState({
    ...state,
    trustedDappPolicies: [
      ...policies.filter((existing) => !sameTrustedPolicyScope(existing, policy)),
      policy
    ]
  });
}

export async function touchTrustedDappPolicy(policyId: string): Promise<void> {
  const state = await loadWalletState();
  if (!state) {
    return;
  }
  const policies = currentTrustedPolicies(state);
  if (!policies.some((policy) => policy.id === policyId)) {
    return;
  }
  const now = Date.now();
  await saveWalletState({
    ...state,
    trustedDappPolicies: policies.map((policy) =>
      policy.id === policyId
        ? {
            ...policy,
            lastUsedAt: now,
            useCount: (policy.useCount ?? 0) + 1
          }
        : policy
    )
  });
}

export async function removeTrustedDappPolicy(policyId: string): Promise<void> {
  const state = await loadWalletState();
  if (!state) {
    return;
  }
  await saveWalletState({
    ...state,
    trustedDappPolicies: currentTrustedPolicies(state).filter(
      (policy) => policy.id !== policyId
    )
  });
}

// Build the store object matching WalletControllerStore interface
export function createMobileStore() {
  return {
    loadState: loadWalletState,
    saveState: saveWalletState,
    clearState: clearWalletState,
    loadUnlockedSession,
    saveUnlockedSession,
    clearUnlockedSession,
    isBiometricUnlockEnabled,
    loadBiometricSessionKey,
    saveBiometricSessionKey,
    clearBiometricSessionKey,
    loadRequestState,
    saveRequestState,
    deleteRequestState,
    listRequestStates,
    loadApprovalState,
    saveApprovalState,
    deleteApprovalState,
    listApprovalStates,
  };
}
