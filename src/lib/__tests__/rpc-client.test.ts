import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockGetChainId = jest.fn() as jest.Mock;
const mockGetTokenMetadata = jest.fn() as jest.Mock;
const mockGetBalance = jest.fn() as jest.Mock;
const mockGetContractMethods = jest.fn() as jest.Mock;
const mockGetState = jest.fn() as jest.Mock;
const mockCall = jest.fn() as jest.Mock;
const mockEstimateChi = jest.fn() as jest.Mock;
const mockBuildTx = jest.fn() as jest.Mock;
const mockSignTx = jest.fn() as jest.Mock;
const mockBroadcastTx = jest.fn() as jest.Mock;
const mockSendTx = jest.fn() as jest.Mock;
const mockWaitForTx = jest.fn() as jest.Mock;
jest.mock("@xian-tech/client", () => ({
  // The real chi rule, so these tests pin the margin and the cap.
  chiToSupply: jest.requireActual<typeof import("@xian-tech/client")>("@xian-tech/client").chiToSupply,
  Ed25519Signer: class {
    address: string;

    constructor(privateKey: string) {
      this.address = `addr-${privateKey.slice(0, 8)}`;
    }
  },
  XianClient: class {
    constructor(_opts: { rpcUrl: string }) {}

    getChainId = mockGetChainId;
    getTokenMetadata = mockGetTokenMetadata;
    getBalance = mockGetBalance;
    getContractMethods = mockGetContractMethods;
    getState = mockGetState;
    call = mockCall;
    estimateChi = mockEstimateChi;
    buildTx = mockBuildTx;
    signTx = mockSignTx;
    broadcastTx = mockBroadcastTx;
    sendTx = mockSendTx;
    waitForTx = mockWaitForTx;
  }
}));

import { XianRpcClient, chiToSupply } from "../rpc-client";
import { SimulationFailedError } from "../simulation";

describe("chiToSupply", () => {
  it("supplies the chi the estimate carries", () => {
    expect(chiToSupply({ estimated: 1000, supply: 1002 })).toBe(1002);
  });

  it("refuses to guess a budget without a simulation", () => {
    expect(() => chiToSupply(null)).toThrow("simulated");
    expect(() => chiToSupply(undefined)).toThrow("simulated");
  });
});

describe("XianRpcClient", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockGetChainId.mockReset();
    mockGetChainId.mockImplementation(async () => "xian-local");
    mockGetTokenMetadata.mockReset();
    mockGetBalance.mockReset();
    mockGetContractMethods.mockReset();
    mockGetState.mockReset();
    mockCall.mockReset();
    mockEstimateChi.mockReset();
    mockBuildTx.mockReset();
    mockSignTx.mockReset();
    mockBroadcastTx.mockReset();
    mockSendTx.mockReset();
    mockSendTx.mockImplementation(async () => mockBroadcastTx());
    mockWaitForTx.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("delegates canonical build/sign/broadcast flow to xian-js", async () => {
    mockBuildTx.mockImplementation(async () => ({
      payload: {
        sender: "addr-11111111",
        contract: "currency",
        function: "transfer",
        kwargs: { to: "alice", amount: 9007199254740993n },
        chi_supplied: 75_000,
        nonce: 7
      }
    }));
    mockSignTx.mockImplementation(async () => ({
      payload: { nonce: 7 },
      metadata: { signature: "sig" }
    }));
    mockBroadcastTx.mockImplementation(async () => ({
      submitted: true,
      accepted: true,
      txHash: "ABC123"
    }));
    mockWaitForTx.mockImplementation(async () => ({
      success: true,
      txHash: "ABC123"
    }));

    const client = new XianRpcClient("http://127.0.0.1:26657");
    const result = await client.sendTransaction({
      privateKey: "11".repeat(32),
      contract: "currency",
      function: "transfer",
      kwargs: { to: "alice", amount: 9007199254740993n },
      chi: 75_000
    });

    expect(mockSendTx).toHaveBeenCalledWith({
      sender: "addr-11111111",
      signer: expect.objectContaining({ address: "addr-11111111" }),
      chainId: "xian-local",
      contract: "currency",
      function: "transfer",
      kwargs: { to: "alice", amount: 9007199254740993n },
      chi: 75_000,
      mode: "checktx"
    });
    expect(mockWaitForTx).toHaveBeenCalledWith("ABC123", {
      timeoutMs: 10_000,
      pollIntervalMs: 1_000
    });
    expect(result).toEqual({
      submitted: true,
      accepted: true,
      finalized: true,
      txHash: "ABC123",
      message: undefined
    });
  });

  it("reports the simulated chi and the chi to supply: the estimate plus the margin", async () => {
    const client = new XianRpcClient("http://127.0.0.1:26657");
    const request = { sender: "a".repeat(64), contract: "currency", function: "transfer", kwargs: {} };

    mockEstimateChi.mockImplementationOnce(async () => ({ estimated: 1000, simulation: { chi_used: 1000 } }));
    await expect(client.estimateChi(request)).resolves.toEqual({ estimated: 1000, supply: 1002 });
  });

  it("caps the chi to supply at the transaction limit and refuses an estimate above it", async () => {
    const client = new XianRpcClient("http://127.0.0.1:26657");
    const request = { sender: "a".repeat(64), contract: "currency", function: "transfer", kwargs: {} };

    mockEstimateChi.mockImplementationOnce(async () => ({ estimated: 199_999, simulation: {} }));
    await expect(client.estimateChi(request)).resolves.toEqual({ estimated: 199_999, supply: 200_000 });
    mockEstimateChi.mockImplementationOnce(async () => ({ estimated: 200_001, simulation: {} }));
    await expect(client.estimateChi(request)).rejects.toThrow(/exceeds the per-transaction limit/);
  });

  // The simulator answers a failing call with status 1 and its chi; sending
  // it anyway executes, fails and pays that chi.
  it("refuses an estimate whose simulation fails, keeping its chi and reason", async () => {
    const client = new XianRpcClient("http://127.0.0.1:26657");
    const request = { sender: "a".repeat(64), contract: "currency", function: "transfer", kwargs: {} };
    mockEstimateChi.mockImplementationOnce(async () => ({
      estimated: 130,
      simulation: { status: 1, chi_used: 130, result: "AssertionError('Not enough coins to send.')" }
    }));

    const failure = await client.estimateChi(request).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SimulationFailedError);
    expect(failure).toMatchObject({
      message: "This transaction would fail: AssertionError('Not enough coins to send.')",
      estimated: 130,
      supply: 132,
      failure: "AssertionError('Not enough coins to send.')"
    });
  });

  // A network configured with a chain id is the user's statement of which
  // chain they sign for; an RPC serving another chain must not get signatures.
  it("refuses to build or send a transaction when the RPC serves another chain than configured", async () => {
    const client = new XianRpcClient("http://127.0.0.1:26657", { expectedChainId: "xian-expected" });
    mockGetChainId.mockImplementation(async () => "xian-local");
    const call = { sender: "a".repeat(64), contract: "currency", function: "transfer", kwargs: {} };
    const mismatch = "the network RPC serves chain xian-local, not the configured xian-expected; refusing to sign";

    await expect(client.signingChainId()).rejects.toThrow(mismatch);
    await expect(client.buildTransaction(call)).rejects.toThrow(mismatch);
    await expect(client.sendTransaction({ ...call, privateKey: "11".repeat(32), chi: 500 })).rejects.toThrow(mismatch);
    expect(mockBuildTx).not.toHaveBeenCalled();
  });

  it("builds for the configured chain when the RPC serves it", async () => {
    const client = new XianRpcClient("http://127.0.0.1:26657", { expectedChainId: "xian-expected" });
    mockGetChainId.mockImplementation(async () => "xian-expected");
    mockBuildTx.mockImplementation(async () => ({ payload: {} }));

    await client.buildTransaction({ sender: "a".repeat(64), contract: "currency", function: "transfer", kwargs: {} });

    expect(mockBuildTx).toHaveBeenCalledWith(expect.objectContaining({ chainId: "xian-expected" }));
  });

  it("rejects a conflicting explicit chain on an automatic call", async () => {
    const client = new XianRpcClient("http://127.0.0.1:26657");
    await expect(client.sendCall({
      privateKey: "11".repeat(32), chainId: "another-chain",
      contract: "currency", function: "transfer", kwargs: {}, chi: 500
    })).rejects.toThrow("not the configured another-chain");
    expect(mockSendTx).not.toHaveBeenCalled();
  });

  it("returns submission failures without fabricating a receipt", async () => {
    mockBuildTx.mockImplementation(async () => ({ payload: { nonce: 1 } }));
    mockSignTx.mockImplementation(async () => ({
      payload: { nonce: 1 },
      metadata: { signature: "sig" }
    }));
    mockBroadcastTx.mockImplementation(async () => ({
      submitted: false,
      accepted: false,
      txHash: "NOPE",
      message: "rejected"
    }));

    const client = new XianRpcClient("http://127.0.0.1:26657");
    const result = await client.sendTransaction({
      privateKey: "22".repeat(32),
      contract: "currency",
      function: "transfer",
      kwargs: { to: "alice", amount: 5 },
      chi: 50_000
    });

    expect(mockWaitForTx).not.toHaveBeenCalled();
    expect(result).toEqual({
      submitted: false,
      accepted: false,
      finalized: false,
      txHash: "NOPE",
      message: "rejected"
    });
  });

  async function sendWith(submission: Record<string, unknown>, receipt?: () => Promise<unknown>) {
    mockBuildTx.mockImplementation(async () => ({ payload: { nonce: 1 } }));
    mockSignTx.mockImplementation(async () => ({ payload: { nonce: 1 }, metadata: { signature: "sig" } }));
    mockBroadcastTx.mockImplementation(async () => submission);
    if (receipt) mockWaitForTx.mockImplementation(receipt);
    const client = new XianRpcClient("http://127.0.0.1:26657");
    return client.sendTransaction({
      privateKey: "22".repeat(32),
      contract: "currency",
      function: "transfer",
      kwargs: { to: "alice", amount: 5 },
      chi: 50_000
    });
  }

  it.each([
    [
      "a CheckTx rejection",
      { submitted: true, accepted: false, txHash: "REJ", message: "Transfer amount exceeds balance" },
      undefined,
      { submitted: true, accepted: false, finalized: false, txHash: "REJ", message: "Transfer amount exceeds balance" }
    ],
    [
      "an executed failure",
      { submitted: true, accepted: true, txHash: "FAIL" },
      async () => ({ success: false, message: "Out of chi." }),
      { submitted: true, accepted: true, finalized: false, txHash: "FAIL", message: "Out of chi." }
    ],
    [
      "an executed failure without a message",
      { submitted: true, accepted: true, txHash: "FAIL" },
      async () => ({ success: false }),
      { submitted: true, accepted: true, finalized: false, txHash: "FAIL", message: "Transaction failed" }
    ],
    [
      "an executed failure with an empty message",
      { submitted: true, accepted: true, txHash: "FAIL" },
      async () => ({ success: false, message: "" }),
      { submitted: true, accepted: true, finalized: false, txHash: "FAIL", message: "" }
    ],
    [
      "a finalized success",
      { submitted: true, accepted: true, txHash: "OK" },
      async () => ({ success: true }),
      { submitted: true, accepted: true, finalized: true, txHash: "OK", message: undefined }
    ],
    [
      "a receipt that does not arrive in time",
      { submitted: true, accepted: true, txHash: "SLOW" },
      async () => {
        throw new Error("timed out");
      },
      { submitted: true, accepted: true, finalized: false, txHash: "SLOW", message: undefined }
    ],
    [
      "an accepted submission without a hash",
      { submitted: true, accepted: true },
      undefined,
      { submitted: true, accepted: true, finalized: false, txHash: undefined, message: undefined }
    ]
  ])("reports %s", async (_case, submission, receipt, outcome) => {
    expect(await sendWith(submission, receipt)).toEqual(outcome);
  });

  it("falls back to on-chain SVG metadata when no logo URL is set", async () => {
    mockGetTokenMetadata.mockImplementation(async () => ({
      name: "Example",
      symbol: "EXP",
      logoUrl: null,
      logoSvg: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'></svg>"
    }));

    const client = new XianRpcClient("http://127.0.0.1:26657");
    await expect(client.getTokenMetadata("con_token")).resolves.toEqual({
      name: "Example",
      symbol: "EXP",
      logoUrl: null,
      logoSvg: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'></svg>"
    });
  });

  it("delegates state reads and read-only calls to xian-js", async () => {
    mockGetState.mockImplementation(async () => "123");
    mockCall.mockImplementation(async () => 30);

    const client = new XianRpcClient("http://127.0.0.1:26657");

    await expect(client.getState("con_pairs", "pairs", ["1", "token0"])).resolves.toBe("123");
    await expect(client.call({
      sender: "sender",
      contract: "con_dex",
      function: "getTradeFeeBps",
      kwargs: { account: "sender" }
    })).resolves.toBe(30);
    expect(mockGetState).toHaveBeenCalledWith("con_pairs", "pairs", ["1", "token0"]);
    expect(mockCall).toHaveBeenCalledWith({
      sender: "sender",
      contract: "con_dex",
      function: "getTradeFeeBps",
      kwargs: { account: "sender" }
    });
  });

  it("treats empty transaction-history RPC responses as empty activity", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => "",
    })) as unknown as typeof fetch;

    const client = new XianRpcClient("http://127.0.0.1:26657");
    await expect(client.getTransactionHistory("addr")).resolves.toEqual([]);
  });

  it("keeps the canonical tx_hash from indexed transaction history", async () => {
    const indexedTx = {
      tx_hash: "TX-1",
      block_height: 12,
      sender: "addr",
      contract: "currency",
      function: "transfer",
      success: true
    };
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          result: {
            response: {
              code: 0,
              value: btoa(JSON.stringify([indexedTx]))
            }
          }
        })
    })) as unknown as typeof fetch;

    const client = new XianRpcClient("http://127.0.0.1:26657");
    await expect(client.getTransactionHistory("addr")).resolves.toEqual([indexedTx]);
  });

  it("treats malformed transaction-history RPC responses as empty activity", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => "not json",
    })) as unknown as typeof fetch;

    const client = new XianRpcClient("http://127.0.0.1:26657");
    await expect(client.getTransactionHistory("addr")).resolves.toEqual([]);
  });

  it("builds transaction-history queries from bracketed IPv6 loopback RPC URLs", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => "",
    })) as unknown as typeof fetch;

    const client = new XianRpcClient("http://[::1]:26657");
    await expect(client.getTransactionHistory("addr")).resolves.toEqual([]);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/\[::1\]:26657\/abci_query\?path=/),
      { method: "POST" }
    );
  });
});
