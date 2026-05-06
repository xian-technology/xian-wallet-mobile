import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TxHistoryRecord } from "./rpc-client";

const LOCAL_ACTIVITY_KEY = "xian_local_activity";
const MAX_LOCAL_ACTIVITY_PER_NETWORK = 50;

type LocalActivityStore = Record<string, TxHistoryRecord[]>;

export interface SubmittedActivityTx {
  txHash?: string;
  sender: string;
  contract: string;
  function: string;
  kwargs: Record<string, unknown>;
  accepted: boolean;
  finalized: boolean;
  message?: unknown;
}

export function activityNetworkKey(state: {
  activeNetworkId?: string;
  rpcUrl: string;
  publicKey?: string;
}): string {
  return `${state.activeNetworkId ?? state.rpcUrl}|${state.rpcUrl}|${state.publicKey ?? ""}`;
}

function sanitizeActivityValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeActivityValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeActivityValue(entry)])
    );
  }
  return value;
}

function normalizeTx(value: unknown): TxHistoryRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const tx = value as Partial<TxHistoryRecord>;
  if (
    typeof tx.hash !== "string" ||
    typeof tx.sender !== "string" ||
    typeof tx.contract !== "string" ||
    typeof tx.function !== "string"
  ) {
    return null;
  }
  return tx as TxHistoryRecord;
}

async function loadStore(): Promise<LocalActivityStore> {
  const raw = await AsyncStorage.getItem(LOCAL_ACTIVITY_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.flatMap((entry) => normalizeTx(entry) ?? []) : []
      ])
    );
  } catch {
    return {};
  }
}

async function saveStore(store: LocalActivityStore): Promise<void> {
  await AsyncStorage.setItem(LOCAL_ACTIVITY_KEY, JSON.stringify(store));
}

export function makeLocalActivityTx(input: SubmittedActivityTx): TxHistoryRecord | null {
  const hash = input.txHash?.trim();
  if (!hash) {
    return null;
  }
  const kwargs = sanitizeActivityValue(input.kwargs) as Record<string, unknown>;
  return {
    hash,
    sender: input.sender,
    contract: input.contract,
    function: input.function,
    success: input.finalized || input.accepted,
    created_at: new Date().toISOString(),
    payload: {
      sender: input.sender,
      contract: input.contract,
      function: input.function,
      kwargs
    },
    kwargs,
    result: input.message ? { message: sanitizeActivityValue(input.message) } : undefined,
    local: true,
    local_status: input.finalized ? "finalized" : "accepted"
  };
}

export async function loadLocalActivityTxs(networkKey: string): Promise<TxHistoryRecord[]> {
  const store = await loadStore();
  return store[networkKey] ?? [];
}

export async function saveLocalActivityTx(
  networkKey: string,
  tx: TxHistoryRecord
): Promise<void> {
  const store = await loadStore();
  const current = store[networkKey] ?? [];
  store[networkKey] = [tx, ...current.filter((item) => item.hash !== tx.hash)]
    .slice(0, MAX_LOCAL_ACTIVITY_PER_NETWORK);
  await saveStore(store);
}

function txTime(tx: TxHistoryRecord): number {
  const raw = tx.created_at ?? tx.block_time;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function mergeActivityTxs(
  indexedTxs: TxHistoryRecord[],
  localTxs: TxHistoryRecord[]
): TxHistoryRecord[] {
  const indexedHashes = new Set(indexedTxs.map((tx) => tx.hash));
  const seenLocalHashes = new Set<string>();
  const dedupedLocalTxs = localTxs.filter((tx) => {
    if (indexedHashes.has(tx.hash) || seenLocalHashes.has(tx.hash)) {
      return false;
    }
    seenLocalHashes.add(tx.hash);
    return true;
  });
  return [
    ...dedupedLocalTxs,
    ...indexedTxs
  ].sort((left, right) => txTime(right) - txTime(left));
}
