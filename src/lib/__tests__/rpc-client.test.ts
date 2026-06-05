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
const mockWaitForTx = jest.fn() as jest.Mock;
jest.mock("@xian-tech/client", () => ({
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
    waitForTx = mockWaitForTx;
  }
}));

import { XianRpcClient } from "../rpc-client";

describe("XianRpcClient", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockGetChainId.mockReset();
    mockGetTokenMetadata.mockReset();
    mockGetBalance.mockReset();
    mockGetContractMethods.mockReset();
    mockGetState.mockReset();
    mockCall.mockReset();
    mockEstimateChi.mockReset();
    mockBuildTx.mockReset();
    mockSignTx.mockReset();
    mockBroadcastTx.mockReset();
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

    expect(mockBuildTx).toHaveBeenCalledWith({
      sender: "addr-11111111",
      contract: "currency",
      function: "transfer",
      kwargs: { to: "alice", amount: 9007199254740993n },
      chi: 75_000
    });
    expect(mockSignTx).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ nonce: 7 }) }),
      expect.objectContaining({ address: "addr-11111111" })
    );
    expect(mockBroadcastTx).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { signature: "sig" } }),
      { mode: "checktx" }
    );
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

  it("treats malformed transaction-history RPC responses as empty activity", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => "not json",
    })) as unknown as typeof fetch;

    const client = new XianRpcClient("http://127.0.0.1:26657");
    await expect(client.getTransactionHistory("addr")).resolves.toEqual([]);
  });
});
