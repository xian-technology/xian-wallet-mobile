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
  ): Promise<
    Array<{
      hash: string;
      block_height: number;
      sender: string;
      nonce: number;
      contract: string;
      function: string;
      success: boolean;
      stamps_used: number;
      created_at: string;
      kwargs?: Record<string, unknown>;
    }>
  > {
    try {
      const result = await this.abciQuery(
        `/txs_by_sender/${address}/limit=${limit}/offset=${offset}`
      );
      if (Array.isArray(result)) {
        return result;
      }
      if (
        result &&
        typeof result === "object" &&
        "items" in (result as Record<string, unknown>)
      ) {
        return (result as { items: unknown[] }).items as Array<{
          hash: string;
          block_height: number;
          sender: string;
          nonce: number;
          contract: string;
          function: string;
          success: boolean;
          stamps_used: number;
          created_at: string;
          kwargs?: Record<string, unknown>;
        }>;
      }
      return [];
    } catch {
      return [];
    }
  }

  async getChainId(): Promise<string> {
    return this.client.getChainId();
  }

  async getStampRate(): Promise<number | null> {
    try {
      const rate = await this.client.getStampRate();
      return rate != null ? Number(rate) : null;
    } catch {
      return null;
    }
  }

  async getTokenMetadata(contract: string): Promise<{
    name: string | null;
    symbol: string | null;
    logoUrl: string | null;
  }> {
    const metadata = await this.client.getTokenMetadata(contract);
    return {
      name: metadata.name,
      symbol: metadata.symbol,
      logoUrl: metadata.logoUrl
    };
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

  async estimateStamps(opts: {
    sender: string;
    contract: string;
    function: string;
    kwargs: Record<string, unknown>;
  }): Promise<{ estimated: number; suggested: number }> {
    const result = await this.client.estimateStamps({
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
    stamps: number | bigint;
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
      stamps: opts.stamps
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
