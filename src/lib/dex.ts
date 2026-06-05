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
  reserve0: number;
  reserve1: number;
  totalSupply: number;
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
  balance: number;
  allowance: number;
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

export interface RuntimeFixed {
  __fixed__: string;
}

export interface DexQuoteHop {
  pairId: number;
  fromToken: string;
  toToken: string;
  reserveIn: number;
  reserveOut: number;
  amountIn: number;
  amountOut: number;
}

export interface DexQuote {
  amountIn: number;
  amountOut: number;
  hops: DexQuoteHop[];
  path: number[];
  feeBps: number;
  priceImpact: number;
  midPriceOut: number;
}

interface DexState {
  publicKey?: string;
  activeNetworkId?: string;
  rpcUrl: string;
  watchedAssets: StoredWalletState["watchedAssets"];
}

interface AdjEdge {
  pairId: number;
  other: string;
  reserveSelf: number;
  reserveOther: number;
}

interface CandidatePath {
  pairIds: number[];
  tokens: string[];
  edges: AdjEdge[];
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

function amountOut(
  amountIn: number,
  reserveIn: number,
  reserveOut: number,
  feeBps: number
): number {
  if (amountIn <= 0 || reserveIn <= 0 || reserveOut <= 0) {
    return 0;
  }
  const inWithFee = amountIn * ((10_000 - feeBps) / 10_000);
  return (inWithFee * reserveOut) / (reserveIn + inWithFee);
}

function normalizeDecimalText(value: string): string | null {
  const trimmed = value.trim().replace(",", ".");
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    return null;
  }
  const [integerPart = "0", fractionPart = ""] = trimmed.split(".");
  const integer = integerPart.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionPart.replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

function formatFixedNumber(value: number, options: { floor?: boolean } = {}): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("DEX amount must be a finite non-negative number");
  }
  const precision = 12;
  const factor = 10 ** precision;
  const normalized = options.floor
    ? Math.floor(value * factor) / factor
    : value;
  const text = normalized.toLocaleString("en-US", {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: precision,
  });
  return normalizeDecimalText(text) ?? "0";
}

export function runtimeFixedFromNumber(
  value: number,
  options: { floor?: boolean } = {}
): RuntimeFixed {
  return { __fixed__: formatFixedNumber(value, options) };
}

export function runtimeFixedFromString(value: string): RuntimeFixed | null {
  const normalized = normalizeDecimalText(value);
  if (!normalized || !Number.isFinite(Number(normalized))) {
    return null;
  }
  return { __fixed__: normalized };
}

function buildAdjacency(pairs: WalletDexPairInfo[]): Map<string, AdjEdge[]> {
  const adj = new Map<string, AdjEdge[]>();
  const push = (token: string, edge: AdjEdge) => {
    const list = adj.get(token);
    if (list) {
      list.push(edge);
    } else {
      adj.set(token, [edge]);
    }
  };

  for (const pair of pairs) {
    if (pair.reserve0 <= 0 || pair.reserve1 <= 0) {
      continue;
    }
    push(pair.token0, {
      pairId: pair.id,
      other: pair.token1,
      reserveSelf: pair.reserve0,
      reserveOther: pair.reserve1,
    });
    push(pair.token1, {
      pairId: pair.id,
      other: pair.token0,
      reserveSelf: pair.reserve1,
      reserveOther: pair.reserve0,
    });
  }
  return adj;
}

function enumeratePaths(
  adj: Map<string, AdjEdge[]>,
  from: string,
  to: string,
  maxHops: number
): CandidatePath[] {
  const out: CandidatePath[] = [];
  const visited = new Set<string>([from]);
  const usedPairs = new Set<number>();

  function dfs(current: string, path: CandidatePath) {
    if (path.pairIds.length > 0 && current === to) {
      out.push({
        pairIds: [...path.pairIds],
        tokens: [...path.tokens],
        edges: [...path.edges],
      });
      return;
    }
    if (path.pairIds.length >= maxHops) {
      return;
    }
    const edges = adj.get(current);
    if (!edges) {
      return;
    }
    for (const edge of edges) {
      if (usedPairs.has(edge.pairId)) {
        continue;
      }
      if (visited.has(edge.other) && edge.other !== to) {
        continue;
      }
      usedPairs.add(edge.pairId);
      visited.add(edge.other);
      path.pairIds.push(edge.pairId);
      path.tokens.push(edge.other);
      path.edges.push(edge);
      dfs(edge.other, path);
      path.pairIds.pop();
      path.tokens.pop();
      path.edges.pop();
      usedPairs.delete(edge.pairId);
      if (edge.other !== to) {
        visited.delete(edge.other);
      }
    }
  }

  dfs(from, { pairIds: [], tokens: [from], edges: [] });
  return out;
}

function quotePath(
  candidate: CandidatePath,
  amountInValue: number,
  feeBps: number
): { amountOut: number; hops: DexQuoteHop[]; midPrice: number } {
  let current = amountInValue;
  let mid = 1;
  const hops: DexQuoteHop[] = [];
  for (let i = 0; i < candidate.edges.length; i++) {
    const edge = candidate.edges[i]!;
    const fromToken = candidate.tokens[i]!;
    const toToken = candidate.tokens[i + 1]!;
    const out = amountOut(current, edge.reserveSelf, edge.reserveOther, feeBps);
    if (out <= 0) {
      return { amountOut: 0, hops: [], midPrice: 0 };
    }
    hops.push({
      pairId: edge.pairId,
      fromToken,
      toToken,
      reserveIn: edge.reserveSelf,
      reserveOut: edge.reserveOther,
      amountIn: current,
      amountOut: out,
    });
    mid *= edge.reserveOther / edge.reserveSelf;
    current = out;
  }
  return { amountOut: current, hops, midPrice: mid };
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
    reserve0: numberFromUnknown(reserve0),
    reserve1: numberFromUnknown(reserve1),
    totalSupply: numberFromUnknown(totalSupply),
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
    balance: numberFromUnknown(balanceResult.balance),
    allowance: numberFromUnknown(allowanceRaw),
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
  amountInValue: number
): DexQuote | null {
  if (!snapshot.available || amountInValue <= 0 || fromToken === toToken) {
    return null;
  }

  const adj = buildAdjacency(snapshot.pairs);
  const paths = enumeratePaths(
    adj,
    fromToken,
    toToken,
    Math.max(1, snapshot.maxHops)
  );
  let best: DexQuote | null = null;
  for (const candidate of paths) {
    const { amountOut: out, hops, midPrice } = quotePath(
      candidate,
      amountInValue,
      snapshot.tradeFeeBps
    );
    if (out <= 0) {
      continue;
    }
    const executionPrice = out / amountInValue;
    const priceImpact =
      midPrice > 0 ? Math.max(0, 1 - executionPrice / midPrice) : 0;
    const quote: DexQuote = {
      amountIn: amountInValue,
      amountOut: out,
      hops,
      path: candidate.pairIds,
      feeBps: snapshot.tradeFeeBps,
      priceImpact,
      midPriceOut: midPrice,
    };
    if (!best || quote.amountOut > best.amountOut) {
      best = quote;
    }
  }
  return best;
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

export function minReceived(quote: DexQuote, slippageBps: number): number {
  return quote.amountOut * (1 - slippageBps / 10_000);
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
