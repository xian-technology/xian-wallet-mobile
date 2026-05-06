import { describe, expect, it, jest } from "@jest/globals";
import {
  makeLocalActivityTx,
  mergeActivityTxs,
} from "../local-activity";
import type { TxHistoryRecord } from "../rpc-client";

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
        hash: "TX-1",
        sender: "sender",
        contract: "currency",
        function: "transfer",
        success: true,
        local: true,
        local_status: "accepted",
      })
    );
    expect(tx?.payload?.kwargs?.amount).toBe("9007199254740993");
  });

  it("shows unindexed local rows but lets indexed rows replace them", () => {
    const localTx: TxHistoryRecord = {
      hash: "TX-1",
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
  });
});
