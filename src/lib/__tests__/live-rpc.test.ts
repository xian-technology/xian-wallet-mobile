import { expect, it } from "@jest/globals";
import { fixed, generatePrivateKey, publicKeyFromPrivateKey } from "@xian-tech/client";
import { XianRpcClient } from "../rpc-client";

const rpcUrl = process.env.XIAN_LIVE_SDK_RPC;
const fundingKey = process.env.XIAN_WALLET_TEST_FUNDING_KEY;
const liveTest = rpcUrl && fundingKey ? it : it.skip;

liveTest("signs, finalizes, and displays a decimal transfer through the mobile RPC client", async () => {
  const client = new XianRpcClient(rpcUrl!);
  const recipient = publicKeyFromPrivateKey(generatePrivateKey());
  const outcome = await client.sendTransaction({
    privateKey: fundingKey!,
    contract: "currency",
    function: "transfer",
    kwargs: { to: recipient, amount: fixed("0.125") },
    chi: 20_000
  });
  expect(outcome).toMatchObject({ submitted: true, accepted: true, finalized: true });
  expect(outcome.message).toBeUndefined();
  await expect(client.getBalanceResult(recipient)).resolves.toMatchObject({
    status: "available",
    balance: "0.125"
  });
}, 30_000);
