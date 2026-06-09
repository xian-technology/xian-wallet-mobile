/**
 * Mobile RPC wrapper built on top of the shared Xian JS client.
 * Custom methods remain only for endpoints that are not yet modeled there.
 */
import {
  Ed25519Signer,
  type SimulateRequest,
  type TransactionReceipt,
  type XianShieldedWalletHistoryResult,
  XianClient
} from "@xian-tech/client";
import type {
  BroadcastMode,
  TransactionSubmission,
  XianSignedTransaction,
  XianUnsignedTransaction
} from "@xian-tech/provider";
import {
  isMissingContractError,
  messageFromUnknown,
  type WalletAsset,
} from "./assets";
import { assertRpcTransportAllowed } from "./network-security";

export interface BalanceResult {
  contract: string;
  balance: string | null;
  status: "available" | "not_found" | "unknown";
  error?: string;
}

function base64ToUtf8(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalizeMessage(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  return typeof value === "string" ? value : String(value);
}

interface AbciResult {
  result?: {
    response?: {
      value?: string;
      code?: number;
    };
  };
}

export interface TxHistoryRecord {
  hash: string;
  block_height?: number | null;
  block_hash?: string | null;
  block_time?: string | number | null;
  tx_index?: number | null;
  sender: string;
  nonce?: number | null;
  contract: string;
  function: string;
  success: boolean;
  status_code?: number | null;
  chi_used?: number | null;
  created_at?: string | null;
  result?: unknown;
  payload?: {
    sender?: string;
    nonce?: number;
    contract?: string;
    function?: string;
    kwargs?: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
  envelope?: unknown;
  /** Wallet-local fallback row for nodes without indexed transaction history. */
  local?: boolean;
  local_status?: "accepted" | "finalized";
}

export class XianRpcClient {
  private client: XianClient;
  private allowInsecureHttp: boolean;

  constructor(private rpcUrl: string, options: { allowInsecureHttp?: boolean } = {}) {
    this.allowInsecureHttp = options.allowInsecureHttp === true;
    this.client = new XianClient({ rpcUrl });
  }

  setRpcUrl(url: string, options: { allowInsecureHttp?: boolean } = {}): void {
    this.allowInsecureHttp = options.allowInsecureHttp === true;
    this.rpcUrl = url;
    this.client = new XianClient({ rpcUrl: url });
  }

  private assertTransportAllowed(): void {
    assertRpcTransportAllowed(this.rpcUrl, this.allowInsecureHttp);
  }

  private async abciQuery(path: string): Promise<unknown> {
    this.assertTransportAllowed();
    const url = new URL(`${this.rpcUrl.replace(/\/+$/, "")}/abci_query`);
    url.searchParams.set("path", `"${path}"`);
    const response = await fetch(url.toString(), { method: "POST" });
    if (!response.ok) {
      throw new Error(`RPC error: ${response.status}`);
    }
    const text = await response.text();
    if (!text.trim()) {
      return null;
    }
    let data: AbciResult;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    const value = data?.result?.response?.value;
    if (!value) {
      return null;
    }
    let decoded = "";
    try {
      decoded = base64ToUtf8(value);
    } catch {
      return null;
    }
    if (!decoded.trim()) {
      return null;
    }
    try {
      return JSON.parse(decoded);
    } catch {
      return decoded;
    }
  }

  async getTransactionHistory(
    address: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<TxHistoryRecord[]> {
    const result = await this.abciQuery(
      `/txs_by_sender/${address}/limit=${limit}/offset=${offset}`
    );
    if (Array.isArray(result)) {
      return result as TxHistoryRecord[];
    }
    if (
      result &&
      typeof result === "object" &&
      "items" in (result as Record<string, unknown>)
    ) {
      const items = (result as { items: unknown }).items;
      return Array.isArray(items) ? (items as TxHistoryRecord[]) : [];
    }
    return [];
  }

  async getChainId(): Promise<string> {
    this.assertTransportAllowed();
    return this.client.getChainId();
  }

  async getChiRate(): Promise<number | null> {
    try {
      this.assertTransportAllowed();
      const rate = await this.client.getChiRate();
      return rate != null ? Number(rate) : null;
    } catch {
      return null;
    }
  }

  async getTokenMetadata(contract: string): Promise<{
    name: string | null;
    symbol: string | null;
    logoUrl: string | null;
    logoSvg: string | null;
  }> {
    this.assertTransportAllowed();
    return this.client.getTokenMetadata(contract);
  }

  async getShieldedWalletHistory(
    syncHint: string,
    options?: {
      limit?: number;
      afterNoteIndex?: number;
    }
  ): Promise<XianShieldedWalletHistoryResult> {
    this.assertTransportAllowed();
    return this.client.getShieldedWalletHistory(syncHint, {
      kind: "sync_hint",
      limit: options?.limit,
      afterNoteIndex: options?.afterNoteIndex,
    });
  }

  async getBalance(
    address: string,
    contract: string = "currency"
  ): Promise<string | null> {
    return (await this.getBalanceResult(address, contract)).balance;
  }

  async getBalanceResult(
    address: string,
    contract: string = "currency"
  ): Promise<BalanceResult> {
    try {
      this.assertTransportAllowed();
      const result = await this.client.getBalance(address, { contract });
      if (isMissingContractError(result)) {
        return {
          contract,
          balance: null,
          status: "not_found",
          error: messageFromUnknown(result),
        };
      }
      if (result == null) {
        return {
          contract,
          balance: "0",
          status: "available",
        };
      }
      return {
        contract,
        balance: String(result),
        status: "available",
      };
    } catch (error) {
      return {
        contract,
        balance: null,
        status: isMissingContractError(error) ? "not_found" : "unknown",
        error: messageFromUnknown(error),
      };
    }
  }

  async getMultipleBalances(
    address: string,
    contracts: string[]
  ): Promise<Record<string, string | null>> {
    const results = await this.getMultipleBalanceResults(address, contracts);
    return Object.fromEntries(
      results.map((result) => [result.contract, result.balance])
    );
  }

  async getMultipleBalanceResults(
    address: string,
    contracts: Array<string | WalletAsset>
  ): Promise<BalanceResult[]> {
    const balanceResults = await Promise.all(
      contracts.map((entry) => {
        const contract = typeof entry === "string" ? entry : entry.contract;
        return this.getBalanceResult(address, contract);
      })
    );
    return balanceResults;
  }

  async getContractMethods(
    contract: string
  ): Promise<{ name: string; arguments: { name: string; type: string }[] }[]> {
    this.assertTransportAllowed();
    return this.client.getContractMethods(contract);
  }

  async getState(
    contract: string,
    variable: string,
    keys: string[] = []
  ): Promise<unknown> {
    this.assertTransportAllowed();
    return this.client.getState(contract, variable, keys);
  }

  async call(request: SimulateRequest): Promise<unknown> {
    this.assertTransportAllowed();
    return this.client.call(request);
  }

  async estimateChi(opts: {
    sender: string;
    contract: string;
    function: string;
    kwargs: Record<string, unknown>;
  }): Promise<{ estimated: number }> {
    this.assertTransportAllowed();
    const result = await this.client.estimateChi({
      sender: opts.sender,
      contract: opts.contract,
      function: opts.function,
      kwargs: opts.kwargs
    });
    return {
      estimated: result.estimated
    };
  }

  async buildTransaction(opts: {
    sender: string;
    contract: string;
    function: string;
    kwargs: Record<string, unknown>;
    chainId?: string;
    chi?: number | bigint;
    chiSupplied?: number | bigint;
  }): Promise<XianUnsignedTransaction> {
    this.assertTransportAllowed();
    return this.client.buildTx({
      sender: opts.sender,
      contract: opts.contract,
      function: opts.function,
      kwargs: opts.kwargs,
      chainId: opts.chainId,
      chi: opts.chi,
      chiSupplied: opts.chiSupplied
    });
  }

  async signTransaction(
    privateKey: string,
    tx: XianUnsignedTransaction
  ): Promise<XianSignedTransaction> {
    return this.client.signTx(tx, new Ed25519Signer(privateKey));
  }

  async broadcastSignedTransaction(
    tx: XianSignedTransaction,
    options?: {
      mode?: BroadcastMode;
      waitForTx?: boolean;
      timeoutMs?: number;
      pollIntervalMs?: number;
    }
  ): Promise<TransactionSubmission> {
    this.assertTransportAllowed();
    return this.client.broadcastTx(tx, options);
  }

  async sendTransaction(opts: {
    privateKey: string;
    contract: string;
    function: string;
    kwargs: Record<string, unknown>;
    chi: number | bigint;
  }): Promise<{
    submitted: boolean;
    accepted: boolean;
    finalized: boolean;
    txHash?: string;
    message?: string;
  }> {
    this.assertTransportAllowed();
    const signer = new Ed25519Signer(opts.privateKey);
    const tx = await this.client.buildTx({
      sender: signer.address,
      contract: opts.contract,
      function: opts.function,
      kwargs: opts.kwargs,
      chi: opts.chi
    });
    const signedTx = await this.client.signTx(tx, signer);
    const submission = await this.client.broadcastTx(signedTx, {
      mode: "checktx"
    });

    if (!submission.submitted) {
      return {
        submitted: false,
        accepted: false,
        finalized: false,
        txHash: submission.txHash,
        message: normalizeMessage(submission.message)
      };
    }

    if (!submission.accepted) {
      return {
        submitted: true,
        accepted: false,
        finalized: false,
        txHash: submission.txHash,
        message: normalizeMessage(submission.message)
      };
    }

    let receipt: TransactionReceipt | null = null;
    if (submission.txHash) {
      try {
        receipt = await this.client.waitForTx(submission.txHash, {
          timeoutMs: 10_000,
          pollIntervalMs: 1_000
        });
      } catch {
        receipt = null;
      }
    }

    return {
      submitted: true,
      accepted: true,
      finalized: receipt?.success ?? false,
      txHash: submission.txHash,
      message: receipt && !receipt.success ? String(receipt.message ?? "Transaction failed") : undefined
    };
  }
}
