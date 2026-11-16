import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { XianRpcClient } from "../rpc-client";
import { rpcClientForState } from "../network-client";

describe("mobile automatic nonce ownership", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it.each([false, true])("submits simultaneous wallet sends with distinct nonces (shared wrappers: %s)", async (shared) => {
    let nextNonce = 7;
    const nonces: number[] = [];
    const json = (value: unknown) => new Response(JSON.stringify(value), {
      status: 200, headers: { "content-type": "application/json" }
    });
    global.fetch = jest.fn(async (input: unknown) => {
      const url = new URL(String(input));
      if (url.pathname === "/status") return json({ result: { node_info: { network: "nonce-test" } } });
      if (url.pathname === "/abci_query") {
        return json({ result: { response: { code: 0, value: btoa(String(nextNonce)) } } });
      }
      if (url.pathname === "/broadcast_tx_sync") {
        const hex = url.searchParams.get("tx")!.replaceAll('"', "");
        const transaction = JSON.parse(Buffer.from(hex, "hex").toString("utf8"));
        const nonce = transaction.payload.nonce as number;
        nonces.push(nonce);
        const code = nonce === nextNonce ? 0 : 1;
        if (code === 0) nextNonce++;
        return json({ result: { code, hash: "hash-" + nonce, log: "bad nonce" } });
      }
      return json({ result: { hash: url.searchParams.get("hash"), tx_result: { code: 0 } } });
    }) as unknown as typeof fetch;
    const network = { rpcUrl: "http://127.0.0.1:27657", networkPresets: [] };
    const first = shared ? rpcClientForState(network) : new XianRpcClient("http://127.0.0.1:26657");
    const second = shared ? rpcClientForState({ ...network }) : first;
    const send = (client: XianRpcClient) => client.sendTransaction({
      privateKey: "11".repeat(32), contract: "currency", function: "transfer",
      kwargs: { to: "ab".repeat(32), amount: 1 }, chi: 500
    });
    const results = await Promise.all([send(first), send(second)]);
    expect(results.map((result) => result.accepted)).toEqual([true, true]);
    expect(nonces).toEqual([7, 8]);
  });

  it("keeps an old review's RPC endpoint when the selected network changes", async () => {
    global.fetch = jest.fn(async (input: unknown) => new Response(JSON.stringify({
      result: { node_info: { network: new URL(String(input)).port } }
    }), { status: 200 })) as unknown as typeof fetch;
    const first = rpcClientForState({ rpcUrl: "http://127.0.0.1:28657", networkPresets: [] });
    const selected = rpcClientForState({ rpcUrl: "http://127.0.0.1:29657", networkPresets: [] });
    await expect(selected.getChainId()).resolves.toBe("29657");
    await expect(first.getChainId()).resolves.toBe("28657");
  });
});
