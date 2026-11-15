import { describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  activityHasTx,
  loadLocalActivityTxs,
  makeLocalActivityTx,
  mergeActivityTxs,
  submissionExecutionFailed,
} from "../local-activity";
import type { TxHistoryRecord } from "../rpc-client";
import { classifyTx, txHistoryKwargs } from "../tx-classify";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe("local activity fallback", () => {
  it("builds a JSON-safe local transaction row", () => {
    const tx = makeLocalActivityTx({
      txHash: "TX-1",
      sender: "sender",
      contract: "currency",
      function: "transfer",
      kwargs: {
        to: "receiver",
        amount: 9007199254740993n,
      },
      accepted: true,
      finalized: false,
    });

    expect(tx).toEqual(
      expect.objectContaining({
        tx_hash: "TX-1",
        sender: "sender",
        contract: "currency",
        function: "transfer",
        success: true,
        local: true,
        local_status: "accepted",
      })
    );
    expect(tx ? txHistoryKwargs(tx).amount : null).toBe("9007199254740993");
  });

  it("records a transaction whose execution failed as failed, with its reason", () => {
    const tx = makeLocalActivityTx({
      txHash: "TX-F",
      sender: "sender",
      contract: "currency",
      function: "transfer",
      kwargs: {},
      accepted: true,
      finalized: true,
      executionFailed: true,
      message: "AssertionError('Not enough coins to send.')",
    });

    expect(tx).toEqual(
      expect.objectContaining({
        success: false,
        result: { message: "AssertionError('Not enough coins to send.')" },
      })
    );
  });

  it.each([
    ["a receipt that reports failure", { accepted: true, finalized: true, receipt: { success: false } }, true],
    ["a commit broadcast admitted but not finalized", { mode: "commit", accepted: true, finalized: false }, true],
    ["a successful receipt", { accepted: true, finalized: true, receipt: { success: true } }, false],
    ["a finalized commit broadcast", { mode: "commit", accepted: true, finalized: true }, false],
    ["a checktx broadcast still pending", { mode: "checktx", accepted: true, finalized: false }, false],
    ["a rejected commit broadcast", { mode: "commit", accepted: false, finalized: false }, false],
  ])("judges a submission with %s", (_case, submission, failed) => {
    expect(submissionExecutionFailed(submission)).toBe(failed);
  });

  it("shows unindexed local rows but lets indexed rows replace them", () => {
    const localTx: TxHistoryRecord = {
      tx_hash: "tx-1",
      sender: "sender",
      contract: "currency",
      function: "transfer",
      success: true,
      created_at: "2026-05-07T00:00:00.000Z",
      local: true,
      local_status: "accepted",
    };
    const indexedTx: TxHistoryRecord = {
      ...localTx,
      block_height: 10,
      created_at: "2026-05-07T00:00:05.000Z",
      local: undefined,
      local_status: undefined,
    };

    expect(mergeActivityTxs([], [localTx])).toEqual([localTx]);
    expect(mergeActivityTxs([indexedTx], [localTx])).toEqual([indexedTx]);
    expect(activityHasTx([indexedTx], "tx-1")).toBe(true);
  });

  it("ignores local activity records without canonical tx_hash", async () => {
    const getItem = AsyncStorage.getItem as jest.MockedFunction<
      typeof AsyncStorage.getItem
    >;
    getItem.mockResolvedValueOnce(
      JSON.stringify({
        network: [
          {
            hash: "LEGACY-1",
            sender: "sender",
            contract: "currency",
            function: "transfer",
            success: true,
            local: true
          }
        ]
      })
    );

    await expect(loadLocalActivityTxs("network")).resolves.toEqual([]);
  });

  it("classifies canonical BDS string payloads", () => {
    const indexedTx: TxHistoryRecord = {
      tx_hash: "TX-2",
      sender: "sender",
      contract: "con_dex",
      function: "swapExactTokensForTokens",
      success: true,
      payload: JSON.stringify({
        kwargs: { src: "currency", amountIn: { __fixed__: "100000" } }
      })
    };

    expect(classifyTx(indexedTx)).toMatchObject({ category: "buy", label: "Buy" });
  });
});
