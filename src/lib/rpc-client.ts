/**
 * Lightweight Xian RPC client for React Native.
 * Handles balance queries, stamp estimation, and transaction submission.
 */
import nacl from "tweetnacl";

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getPublicKey(privateKeyHex: string): string {
  const seed = hexToBytes(privateKeyHex);
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  return bytesToHex(keyPair.publicKey);
}

function sign(message: Uint8Array, privateKeyHex: string): string {
  const seed = hexToBytes(privateKeyHex);
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const sig = nacl.sign.detached(message, keyPair.secretKey);
  return bytesToHex(sig);
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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
  constructor(private rpcUrl: string) {}

  setRpcUrl(url: string): void {
    this.rpcUrl = url;
  }

  private async abciQuery(path: string): Promise<unknown> {
    const url = `${this.rpcUrl}/abci_query?path=%22${encodeURIComponent(path)}%22`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`RPC error: ${resp.status}`);
    const data: AbciResult = await resp.json();
    const value = data?.result?.response?.value;
    if (!value) return null;
    try {
      return JSON.parse(base64ToUtf8(value));
    } catch {
      return base64ToUtf8(value);
    }
  }

  async getChainId(): Promise<string> {
    const resp = await fetch(`${this.rpcUrl}/status`);
    if (!resp.ok) throw new Error(`RPC error: ${resp.status}`);
    const data = await resp.json();
    return data?.result?.node_info?.network ?? "unknown";
  }

  async getBalance(
    address: string,
    contract: string = "currency"
  ): Promise<string | null> {
    try {
      const result = await this.abciQuery(
        `/get/${contract}.balances:${address}`
      );
      if (result == null) return "0";
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

  async estimateStamps(opts: {
    sender: string;
    contract: string;
    function: string;
    kwargs: Record<string, unknown>;
  }): Promise<{ estimated: number; suggested: number }> {
    const payload = {
      sender: opts.sender,
      contract: opts.contract,
      function: opts.function,
      kwargs: opts.kwargs,
    };
    const resp = await fetch(
      `${this.rpcUrl}/abci_query?path=%22/simulate%22`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "abci_query",
          params: { path: "/simulate", data: bytesToHex(new TextEncoder().encode(JSON.stringify(payload))) },
          id: 1,
        }),
      }
    );
    if (!resp.ok) throw new Error(`simulation failed: ${resp.status}`);
    const data = await resp.json();
    const value = data?.result?.response?.value;
    if (!value) throw new Error("simulation returned no result");
    const parsed = JSON.parse(base64ToUtf8(value));
    const estimated = Number(parsed?.stamps_used ?? 0);
    return {
      estimated,
      suggested: Math.ceil(estimated * 1.3),
    };
  }

  async sendTransaction(opts: {
    privateKey: string;
    contract: string;
    function: string;
    kwargs: Record<string, unknown>;
    stamps: number;
  }): Promise<{
    submitted: boolean;
    accepted: boolean;
    finalized: boolean;
    txHash?: string;
    message?: string;
  }> {
    const sender = getPublicKey(opts.privateKey);
    const chainId = await this.getChainId();

    // Get nonce
    const nonceResult = await this.abciQuery(`/get_next_nonce/${sender}`);
    const nonce = Number(nonceResult ?? 0);

    // Build transaction payload
    const payload = {
      chain_id: chainId,
      contract: opts.contract,
      function: opts.function,
      kwargs: opts.kwargs,
      nonce,
      sender,
      stamps_supplied: opts.stamps,
    };

    const payloadBytes = new TextEncoder().encode(
      JSON.stringify(payload, Object.keys(payload).sort())
    );
    const signature = sign(payloadBytes, opts.privateKey);

    const tx = {
      metadata: { signature },
      payload,
    };

    // Broadcast
    const txBytes = new TextEncoder().encode(JSON.stringify(tx));
    const txB64 = btoa(String.fromCharCode(...txBytes));

    const resp = await fetch(`${this.rpcUrl}/broadcast_tx_sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "broadcast_tx_sync",
        params: { tx: txB64 },
        id: 1,
      }),
    });

    if (!resp.ok) {
      return {
        submitted: false,
        accepted: false,
        finalized: false,
        message: `HTTP ${resp.status}`,
      };
    }

    const data = await resp.json();
    const result = data?.result;
    const code = result?.code ?? -1;
    const hash = result?.hash;

    if (code !== 0) {
      return {
        submitted: true,
        accepted: false,
        finalized: false,
        txHash: hash,
        message: result?.log ?? `code ${code}`,
      };
    }

    // Wait for finalization
    if (hash) {
      try {
        const finalized = await this.waitForTx(hash);
        return {
          submitted: true,
          accepted: true,
          finalized,
          txHash: hash,
        };
      } catch {
        return {
          submitted: true,
          accepted: true,
          finalized: false,
          txHash: hash,
        };
      }
    }

    return {
      submitted: true,
      accepted: true,
      finalized: false,
      txHash: hash,
    };
  }

  private async waitForTx(
    hash: string,
    timeoutMs: number = 10000
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`${this.rpcUrl}/tx?hash=0x${hash}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data?.result?.tx_result) return true;
        }
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }
}
