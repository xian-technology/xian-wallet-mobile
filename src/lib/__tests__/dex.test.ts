import { describe, expect, it, jest } from "@jest/globals";

import {
  buildDexQuote,
  loadDexSnapshot,
  minReceived,
  runtimeFixedFromNumber,
  runtimeFixedFromString,
  sortedDexTokens,
  type WalletDexSnapshot,
} from "../dex";
import type { XianRpcClient } from "../rpc-client";

function snapshot(): WalletDexSnapshot {
  return {
    available: true,
    contract: "con_dex",
    pairsContract: "con_pairs",
    tradeFeeBps: 30,
    maxHops: 3,
    tokens: [
      {
        contract: "currency",
        name: "Xian",
        symbol: "XIAN",
        logoUrl: null,
        logoSvg: null,
        precision: 8,
        balance: 100,
        allowance: 100,
        feeOnTransfer: false,
      },
      {
        contract: "con_a",
        name: "Token A",
        symbol: "AAA",
        logoUrl: null,
        logoSvg: null,
        precision: 8,
        balance: 0,
        allowance: 0,
        feeOnTransfer: false,
      },
      {
        contract: "con_b",
        name: "Token B",
        symbol: "BBB",
        logoUrl: null,
        logoSvg: null,
        precision: 8,
        balance: 0,
        allowance: 0,
        feeOnTransfer: false,
      },
    ],
    pairs: [
      {
        id: 1,
        token0: "currency",
        token1: "con_b",
        reserve0: 100,
        reserve1: 100,
        totalSupply: 100,
        blockTimestampLast: null,
        creationTime: null,
      },
      {
        id: 2,
        token0: "currency",
        token1: "con_a",
        reserve0: 100,
        reserve1: 300,
        totalSupply: 100,
        blockTimestampLast: null,
        creationTime: null,
      },
      {
        id: 3,
        token0: "con_a",
        token1: "con_b",
        reserve0: 300,
        reserve1: 300,
        totalSupply: 100,
        blockTimestampLast: null,
        creationTime: null,
      },
    ],
  };
}

describe("DEX helpers", () => {
  it("chooses the best multi-hop route and applies slippage", () => {
    const quote = buildDexQuote(snapshot(), "currency", "con_b", 10);

    expect(quote).not.toBeNull();
    expect(quote?.path).toEqual([2, 3]);
    expect(quote?.amountOut).toBeGreaterThan(20);
    expect(minReceived(quote!, 100)).toBeCloseTo(quote!.amountOut * 0.99);
  });

  it("sorts currency first and then by token symbol", () => {
    expect(sortedDexTokens(snapshot()).map((token) => token.contract)).toEqual([
      "currency",
      "con_a",
      "con_b",
    ]);
  });

  it("encodes DEX decimal amounts as fixed runtime values", () => {
    expect(runtimeFixedFromString("001.2300")).toEqual({ __fixed__: "1.23" });
    expect(runtimeFixedFromNumber(902.2955123456789, { floor: true })).toEqual({
      __fixed__: "902.295512345678",
    });
  });

  it("loads con_dex market state from RPC", async () => {
    const getState = jest.fn(async (
      contract: string,
      variable: string,
      keys: string[] = []
    ) => {
      const key = `${contract}.${variable}:${keys.join(":")}`;
      const values: Record<string, unknown> = {
        "con_pairs.pairs_num:": 1,
        "con_pairs.pairs:1:token0": "currency",
        "con_pairs.pairs:1:token1": "con_wtt",
        "con_pairs.pairs:1:reserve0": "100",
        "con_pairs.pairs:1:reserve1": "200",
        "con_pairs.pairs:1:totalSupply": "100",
        "con_pairs.pairs:1:blockTimestampLast": "123",
        "con_pairs.pairs:1:creationTime": "2026-06-05",
        "currency.metadata:precision": 8,
        "con_wtt.metadata:precision": 8,
        "currency.approvals:sender:con_dex": "10",
        "con_wtt.approvals:sender:con_dex": "0",
        "con_dex.fee_on_transfer_tokens:currency": false,
        "con_dex.fee_on_transfer_tokens:con_wtt": true,
      };
      return values[key] ?? null;
    });
    const rpc = {
      getContractMethods: jest.fn(async () => [
        { name: "swapExactTokensForTokens", arguments: [] },
      ]),
      getState,
      getTokenMetadata: jest.fn(async (contract: string) => ({
        contract,
        name: contract === "currency" ? "Xian" : "Wallet Test Token",
        symbol: contract === "currency" ? "XIAN" : "WTT",
        logoUrl: null,
        logoSvg: null,
      })),
      getBalanceResult: jest.fn(async (_address: string, contract: string) => ({
        contract,
        balance: contract === "currency" ? "12.5" : "0",
        status: "available",
      })),
      call: jest.fn(async () => 30),
    } as unknown as XianRpcClient;

    await expect(
      loadDexSnapshot(
        {
          publicKey: "sender",
          activeNetworkId: "local",
          rpcUrl: "http://127.0.0.1:26657",
          watchedAssets: [{ contract: "currency", name: "Xian", symbol: "XIAN" }],
        },
        rpc
      )
    ).resolves.toMatchObject({
      available: true,
      pairs: [{ id: 1, token0: "currency", token1: "con_wtt" }],
      tokens: expect.arrayContaining([
        expect.objectContaining({
          contract: "currency",
          balance: 12.5,
          allowance: 10,
        }),
        expect.objectContaining({
          contract: "con_wtt",
          symbol: "WTT",
          feeOnTransfer: true,
        }),
      ]),
    });
  });

  it("reports unavailable when con_dex has no swap exports", async () => {
    const rpc = {
      getContractMethods: jest.fn(async () => [{ name: "notSwap", arguments: [] }]),
    } as unknown as XianRpcClient;

    await expect(
      loadDexSnapshot(
        {
          publicKey: "sender",
          activeNetworkId: "local",
          rpcUrl: "http://127.0.0.1:26657",
          watchedAssets: [],
        },
        rpc
      )
    ).resolves.toMatchObject({
      available: false,
      reason: "con_dex is not deployed on this network.",
    });
  });
});
