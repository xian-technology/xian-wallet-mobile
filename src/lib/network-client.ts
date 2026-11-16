import { XianRpcClient } from "./rpc-client";
import { rpcOptionsForState } from "./network-security";

interface NetworkState {
  rpcUrl: string;
  activeNetworkId?: string;
  networkPresets: Array<{ id: string; chainId?: string; allowInsecureHttp?: boolean }>;
}

const clients = new Map<string, XianRpcClient>();

/** Screens and WalletConnect share one nonce owner without mutating another network's client. */
export function rpcClientForState(state: NetworkState): XianRpcClient {
  const options = rpcOptionsForState(state);
  const key = JSON.stringify([state.rpcUrl, options.expectedChainId, options.allowInsecureHttp]);
  let client = clients.get(key);
  if (!client) {
    client = new XianRpcClient(state.rpcUrl, options);
    clients.set(key, client);
  }
  return client;
}
