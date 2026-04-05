/**
 * Mobile storage adapter that implements the WalletControllerStore interface.
 * Uses expo-secure-store for sensitive data and AsyncStorage for general state.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const WALLET_STATE_KEY = "xian_wallet_state";
const SESSION_KEY = "xian_unlocked_session";
const CONTACTS_KEY = "xian_contacts";
const REQUEST_PREFIX = "xian_req_";
const APPROVAL_PREFIX = "xian_approval_";

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
  connectedOrigins: string[];
  createdAt: string;
}

export interface StoredUnlockedSession {
  privateKey: string;
  mnemonic?: string;
  sessionKey: string;
  expiresAt: number;
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
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    const session: StoredUnlockedSession = JSON.parse(raw);
    if (session.expiresAt <= Date.now()) {
      await SecureStore.deleteItemAsync(SESSION_KEY);
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
  await SecureStore.deleteItemAsync(SESSION_KEY);
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

// Build the store object matching WalletControllerStore interface
export function createMobileStore() {
  return {
    loadState: loadWalletState,
    saveState: saveWalletState,
    clearState: clearWalletState,
    loadUnlockedSession,
    saveUnlockedSession,
    clearUnlockedSession,
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
