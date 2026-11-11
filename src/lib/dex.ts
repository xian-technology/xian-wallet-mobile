import { fixed } from "@xian-tech/client";
import {
  minimumAmountOutV2,
  selectBestXianDexV2ExactInRoute,
} from "@xian-tech/dex";

import type { XianRpcClient } from "./rpc-client";
import type { StoredWalletState } from "./storage";

export const DEX_ROUTER = "con_dex";
export const DEX_PAIRS = "con_pairs";
export const DEFAULT_DEX_FEE_BPS = 30;
export const DEFAULT_SLIPPAGE_BPS = 100;
export const DEFAULT_DEADLINE_MINUTES = 20;
export const DEX_MAX_HOPS = 3;

const DEX_REQUIRED_SWAP_EXPORTS = new Set([
  "swapExactTokensForTokens",
  "swapExactTokensForTokensSupportingFeeOnTransferTokens",
]);

export interface WalletDexPairInfo {
  id: number;
  token0: string;
  token1: string;
  reserve0: string;
  reserve1: string;
  totalSupply: string;
  blockTimestampLast: string | null;
  creationTime: string | null;
}

export interface WalletDexTokenInfo {
  contract: string;
  name: string | null;
  symbol: string | null;
  logoUrl: string | null;
  logoSvg: string | null;
  precision: number | null;
  balance: string;
  allowance: string;
  feeOnTransfer: boolean;
}

export interface WalletDexSnapshot {
  available: boolean;
  contract: string;
  pairsContract: string;
  reason?: string;
  tradeFeeBps: number;
  maxHops: number;
  pairs: WalletDexPairInfo[];
  tokens: WalletDexTokenInfo[];
}

export interface XianDatetime {
  __time__: [number, number, number, number, number, number, number];
}

export type DexQuote = NonNullable<ReturnType<typeof selectBestXianDexV2ExactInRoute>>;

export function runtimeFixedFromString(value: string): ReturnType<typeof fixed> | null {
  try {
    const amount = fixed(value.trim().replace(",", "."));
    return amount.__fixed__.startsWith("-") ? null : amount;
  } catch {
    return null;
  }
}

interface DexState {
  publicKey?: string;
  activeNetworkId?: string;
  rpcUrl: string;
  watchedAssets: StoredWalletState["watchedAssets"];
}

function numberFromUnknown(value: unknown, fallback = 0): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

async function readDexPair(
  rpc: XianRpcClient,
  id: number
): Promise<WalletDexPairInfo | null> {
  const key = String(id);
  const [
    token0,
    token1,
    reserve0,
    reserve1,
    totalSupply,
    blockTimestampLast,
    creationTime,
  ] = await Promise.all([
    rpc.getState(DEX_PAIRS, "pairs", [key, "token0"]),
    rpc.getState(DEX_PAIRS, "pairs", [key, "token1"]),
    rpc.getState(DEX_PAIRS, "pairs", [key, "reserve0"]),
    rpc.getState(DEX_PAIRS, "pairs", [key, "reserve1"]),
    rpc.getState(DEX_PAIRS, "pairs", [key, "totalSupply"]),
    rpc.getState(DEX_PAIRS, "pairs", [key, "blockTimestampLast"]),
    rpc.getState(DEX_PAIRS, "pairs", [key, "creationTime"]),
  ]);

  if (typeof token0 !== "string" || typeof token1 !== "string") {
    return null;
  }

  return {
    id,
    token0,
    token1,
    reserve0: String(reserve0 ?? 0),
    reserve1: String(reserve1 ?? 0),
    totalSupply: String(totalSupply ?? 0),
    blockTimestampLast: blockTimestampLast == null ? null : String(blockTimestampLast),
    creationTime: creationTime == null ? null : String(creationTime),
  };
}

async function readDexPairs(rpc: XianRpcClient): Promise<WalletDexPairInfo[]> {
  const countRaw = await rpc.getState(DEX_PAIRS, "pairs_num").catch(() => 0);
  const count = Math.max(0, Math.floor(numberFromUnknown(countRaw)));
  if (count <= 0) {
    return [];
  }
  const pairs = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      readDexPair(rpc, index + 1).catch(() => null)
    )
  );
  return pairs.filter((pair): pair is WalletDexPairInfo => pair != null);
}

async function readDexTradeFeeBps(
  rpc: XianRpcClient,
  account: string
): Promise<number> {
  try {
    const result = await rpc.call({
      sender: account,
      contract: DEX_ROUTER,
      function: "getTradeFeeBps",
      kwargs: { account },
    });
    const bps = numberFromUnknown(result, DEFAULT_DEX_FEE_BPS);
    return bps === 0 ? 0 : DEFAULT_DEX_FEE_BPS;
  } catch {
    return DEFAULT_DEX_FEE_BPS;
  }
}

async function readDexTokenInfo(
  state: DexState,
  rpc: XianRpcClient,
  contract: string
): Promise<WalletDexTokenInfo> {
  const [metadata, precisionRaw, balanceResult, allowanceRaw, feeOnTransferRaw] =
    await Promise.all([
      rpc.getTokenMetadata(contract).catch(() => ({
        contract,
        name: null,
        symbol: null,
        logoUrl: null,
        logoSvg: null,
      })),
      rpc.getState(contract, "metadata", ["precision"]).catch(() => null),
      state.publicKey
        ? rpc.getBalanceResult(state.publicKey, contract).catch(() => ({
            contract,
            balance: "0",
            status: "unknown" as const,
          }))
        : Promise.resolve({ contract, balance: "0", status: "unknown" as const }),
      state.publicKey
        ? rpc.getState(contract, "approvals", [state.publicKey, DEX_ROUTER]).catch(() => 0)
        : Promise.resolve(0),
      rpc.getState(DEX_ROUTER, "fee_on_transfer_tokens", [contract]).catch(() => false),
    ]);

  const watched = state.watchedAssets.find((asset) => asset.contract === contract);
  const precisionCandidate = numberFromUnknown(precisionRaw, NaN);
  const precision = Number.isInteger(precisionCandidate)
    ? precisionCandidate
    : typeof watched?.decimals === "number"
      ? watched.decimals
      : null;

  return {
    contract,
    name: metadata.name,
    symbol: metadata.symbol,
    logoUrl: metadata.logoUrl,
    logoSvg: metadata.logoSvg,
    precision,
    balance: String(balanceResult.balance ?? 0),
    allowance: String(allowanceRaw ?? 0),
    feeOnTransfer: feeOnTransferRaw === true,
  };
}

export function dexNetworkKey(state: DexState): string {
  return [state.activeNetworkId ?? "network", state.rpcUrl].join("|");
}

export async function loadDexSnapshot(
  state: DexState,
  rpc: XianRpcClient
): Promise<WalletDexSnapshot> {
  if (!state.publicKey) {
    return {
      available: false,
      contract: DEX_ROUTER,
      pairsContract: DEX_PAIRS,
      reason: "Wallet is locked.",
      tradeFeeBps: DEFAULT_DEX_FEE_BPS,
      maxHops: DEX_MAX_HOPS,
      pairs: [],
      tokens: [],
    };
  }

  const methods = await rpc.getContractMethods(DEX_ROUTER).catch(() => []);
  const methodNames = new Set(methods.map((method) => method.name));
  const hasSwapExport = [...DEX_REQUIRED_SWAP_EXPORTS].some((name) =>
    methodNames.has(name)
  );
  if (!hasSwapExport) {
    return {
      available: false,
      contract: DEX_ROUTER,
      pairsContract: DEX_PAIRS,
      reason: `${DEX_ROUTER} is not deployed on this network.`,
      tradeFeeBps: DEFAULT_DEX_FEE_BPS,
      maxHops: DEX_MAX_HOPS,
      pairs: [],
      tokens: [],
    };
  }

  const pairs = await readDexPairs(rpc);
  const tokenContracts = new Set<string>();
  for (const asset of state.watchedAssets) {
    tokenContracts.add(asset.contract);
  }
  for (const pair of pairs) {
    tokenContracts.add(pair.token0);
    tokenContracts.add(pair.token1);
  }

  const [tradeFeeBps, tokens] = await Promise.all([
    readDexTradeFeeBps(rpc, state.publicKey),
    Promise.all(
      [...tokenContracts].map((contract) => readDexTokenInfo(state, rpc, contract))
    ),
  ]);

  return {
    available: true,
    contract: DEX_ROUTER,
    pairsContract: DEX_PAIRS,
    tradeFeeBps,
    maxHops: DEX_MAX_HOPS,
    pairs,
    tokens,
  };
}

export function buildDexQuote(
  snapshot: WalletDexSnapshot,
  fromToken: string,
  toToken: string,
  amountIn: string
): DexQuote | null {
  if (!snapshot.available || fromToken === toToken) return null;
  const precisions = new Map(snapshot.tokens.map(token => [token.contract, token.precision]));
  return selectBestXianDexV2ExactInRoute({
    pairs: snapshot.pairs.map(pair => ({
      ...pair,
      precision0: precisions.get(pair.token0),
      precision1: precisions.get(pair.token1),
    })),
    fromToken,
    toToken,
    amountIn,
    feeBps: snapshot.tradeFeeBps,
    maxHops: Math.max(1, snapshot.maxHops),
  });
}

export function tokenByContract(
  snapshot: WalletDexSnapshot | null,
  contract: string
): WalletDexTokenInfo | null {
  return snapshot?.tokens.find((token) => token.contract === contract) ?? null;
}

export function tokenSymbol(token: WalletDexTokenInfo | null | undefined): string {
  return token?.symbol?.trim() || token?.contract.slice(0, 8).toUpperCase() || "";
}

export function sortedDexTokens(
  snapshot: WalletDexSnapshot | null
): WalletDexTokenInfo[] {
  if (!snapshot) {
    return [];
  }
  return [...snapshot.tokens].sort((a, b) => {
    if (a.contract === "currency") return -1;
    if (b.contract === "currency") return 1;
    return tokenSymbol(a).localeCompare(tokenSymbol(b));
  });
}

export function minReceived(quote: DexQuote, slippageBps: number): string {
  return minimumAmountOutV2(quote.amountOut, slippageBps, quote.outputPrecision);
}

export function blockedIntermediateToken(
  snapshot: WalletDexSnapshot,
  quote: DexQuote
): string | null {
  const intermediateTokens = quote.hops.slice(0, -1).map((hop) => hop.toToken);
  return (
    intermediateTokens.find(
      (contract) => tokenByContract(snapshot, contract)?.feeOnTransfer === true
    ) ?? null
  );
}

export function useSupportingFeeRoute(
  snapshot: WalletDexSnapshot,
  quote: DexQuote
): boolean {
  const first = quote.hops[0];
  const last = quote.hops[quote.hops.length - 1];
  if (!first || !last) {
    return false;
  }
  return (
    tokenByContract(snapshot, first.fromToken)?.feeOnTransfer === true ||
    tokenByContract(snapshot, last.toToken)?.feeOnTransfer === true
  );
}

export function deadlineFromNow(minutesFromNow: number): XianDatetime {
  const d = new Date(Date.now() + minutesFromNow * 60_000);
  return {
    __time__: [
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds() * 1000,
    ],
  };
}
