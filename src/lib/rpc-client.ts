/**
 * Mobile RPC wrapper built on top of the shared Xian JS client.
 * Custom methods remain only for endpoints that are not yet modeled there.
 */
import {
  Ed25519Signer,
  type TransactionReceipt,
  type XianShieldedWalletHistoryResult,
  XianClient
} from "@xian-tech/client";

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
  /** Legacy convenience: some backends flatten payload.kwargs into the row. */
  kwargs?: Record<string, unknown>;
}

export class XianRpcClient {
  private client: XianClient;

  constructor(private rpcUrl: string) {
    this.client = new XianClient({ rpcUrl });
  }

  setRpcUrl(url: string): void {
    this.rpcUrl = url;
    this.client = new XianClient({ rpcUrl: url });
  }

  private async abciQuery(path: string): Promise<unknown> {
    const url = new URL(`${this.rpcUrl.replace(/\/+$/, "")}/abci_query`);
    url.searchParams.set("path", `"${path}"`);
    const response = await fetch(url.toString(), { method: "POST" });
    if (!response.ok) {
      throw new Error(`RPC error: ${response.status}`);
    }
    const data: AbciResult = await response.json();
    const value = data?.result?.response?.value;
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(base64ToUtf8(value));
    } catch {
      return base64ToUtf8(value);
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
    return this.client.getChainId();
  }

  async getChiRate(): Promise<number | null> {
    try {
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
    return this.client.getTokenMetadata(contract);
  }

  async getShieldedWalletHistory(
    syncHint: string,
    options?: {
      limit?: number;
      afterNoteIndex?: number;
    }
  ): Promise<XianShieldedWalletHistoryResult> {
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
    try {
      const result = await this.client.getBalance(address, { contract });
      if (result == null) {
        return "0";
      }
      return String(result);
    } catch {
      return null;
    }
  }

  async getMultipleBalances(
    address: string,
    contracts: string[]
  ): Promise<Record<string, string | null>> {
    const results: Record<string, string | null> = {};
    await Promise.allSettled(
      contracts.map(async (contract) => {
        results[contract] = await this.getBalance(address, contract);
      })
    );
    return results;
  }

  async getContractMethods(
    contract: string
  ): Promise<{ name: string; arguments: { name: string; type: string }[] }[]> {
    return this.client.getContractMethods(contract);
  }

  async estimateChi(opts: {
    sender: string;
    contract: string;
    function: string;
    kwargs: Record<string, unknown>;
  }): Promise<{ estimated: number; suggested: number }> {
    const result = await this.client.estimateChi({
      sender: opts.sender,
      contract: opts.contract,
      function: opts.function,
      kwargs: opts.kwargs
    });
    return {
      estimated: result.estimated,
      suggested: result.suggested
    };
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
