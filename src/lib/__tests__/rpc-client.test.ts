import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockGetChainId = jest.fn() as jest.Mock;
const mockGetTokenMetadata = jest.fn() as jest.Mock;
const mockGetBalance = jest.fn() as jest.Mock;
const mockGetContractMethods = jest.fn() as jest.Mock;
const mockEstimateStamps = jest.fn() as jest.Mock;
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
    estimateStamps = mockEstimateStamps;
    buildTx = mockBuildTx;
    signTx = mockSignTx;
    broadcastTx = mockBroadcastTx;
    waitForTx = mockWaitForTx;
  }
}));

import { XianRpcClient } from "../rpc-client";

describe("XianRpcClient", () => {
  beforeEach(() => {
    mockGetChainId.mockReset();
    mockGetTokenMetadata.mockReset();
    mockGetBalance.mockReset();
    mockGetContractMethods.mockReset();
    mockEstimateStamps.mockReset();
    mockBuildTx.mockReset();
    mockSignTx.mockReset();
    mockBroadcastTx.mockReset();
    mockWaitForTx.mockReset();
  });

  it("delegates canonical build/sign/broadcast flow to xian-js", async () => {
    mockBuildTx.mockImplementation(async () => ({
      payload: {
        sender: "addr-11111111",
        contract: "currency",
        function: "transfer",
        kwargs: { to: "alice", amount: 9007199254740993n },
        stamps_supplied: 75_000,
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
      stamps: 75_000
    });

    expect(mockBuildTx).toHaveBeenCalledWith({
      sender: "addr-11111111",
      contract: "currency",
      function: "transfer",
      kwargs: { to: "alice", amount: 9007199254740993n },
      stamps: 75_000
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
      stamps: 50_000
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
});
