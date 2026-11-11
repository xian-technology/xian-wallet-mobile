import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const MOCK_ACCOUNT = "ab".repeat(32);
const MOCK_CHAIN_ID = "xian-devnet-1";

type Handler = (event: unknown) => void;

const mockHandlers = new Map<string, Handler>();
const mockRespondSessionRequest = jest.fn(async (_input: unknown) => undefined);
const mockBroadcast = jest.fn() as jest.Mock;

jest.mock("@walletconnect/react-native-compat", () => ({}), { virtual: true });
jest.mock("fast-text-encoding", () => ({}), { virtual: true });
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { walletConnectProjectId: "test-project" } } },
}));
jest.mock("expo-linking", () => ({
  getInitialURL: jest.fn(async () => null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock("@walletconnect/core", () => ({ Core: class {} }), { virtual: true });
jest.mock(
  "@walletconnect/jsonrpc-utils",
  () => ({
    formatJsonRpcResult: (id: number, result: unknown) => ({ id, result }),
    formatJsonRpcError: (id: number, error: unknown) => ({ id, error }),
  }),
  { virtual: true }
);
jest.mock(
  "@walletconnect/utils",
  () => ({ getSdkError: (reason: string) => ({ code: 0, message: reason }) }),
  { virtual: true }
);
jest.mock(
  "@reown/walletkit",
  () => ({
    WalletKit: {
      init: jest.fn(async () => ({
        on: (event: string, handler: Handler) => mockHandlers.set(event, handler),
        getActiveSessions: () => ({
          topic: { topic: "topic", peer: { metadata: { name: "Dapp" } } },
        }),
        respondSessionRequest: (input: unknown) => mockRespondSessionRequest(input),
      })),
    },
  }),
  { virtual: true }
);
jest.mock(
  "@xian-tech/client",
  () => ({
    createXianMessageSigningPayload: jest.fn(() => "payload"),
    Ed25519Signer: class {
      signMessage() {
        return "signature";
      }
    },
  }),
  { virtual: true }
);
jest.mock(
  "@xian-tech/provider",
  () => ({
    createXianDappPolicyForRequest: jest.fn(() => null),
    findMatchingXianDappPolicy: jest.fn(() => ({ matched: false })),
    parseXianDappAction: jest.fn(() => null),
    xianChainIdFromCaip2: (value: string) =>
      value.startsWith("xian:") ? value.slice("xian:".length) : null,
  }),
  { virtual: true }
);
jest.mock("../storage", () => ({
  loadWalletState: jest.fn(async () => null),
  saveWalletState: jest.fn(async () => undefined),
  touchTrustedDappPolicy: jest.fn(async () => undefined),
  upsertTrustedDappPolicy: jest.fn(async () => undefined),
}));
jest.mock("../wallet-controller", () => ({
  loadUnlockedWalletMaterial: jest.fn(async () => ({
    state: {
      publicKey: MOCK_ACCOUNT,
      rpcUrl: "http://127.0.0.1:26657",
      networkPresets: [],
      trustedDappPolicies: [],
    },
    privateKey: "11".repeat(32),
  })),
}));
jest.mock("../rpc-client", () => ({
  XianRpcClient: class {
    async getChainId() {
      return MOCK_CHAIN_ID;
    }
    async buildTransaction(input: Record<string, unknown>) {
      return {
        payload: {
          sender: input.sender,
          contract: input.contract,
          function: input.function,
          kwargs: input.kwargs,
          chain_id: MOCK_CHAIN_ID,
          nonce: 1,
          chi_supplied: 1000,
        },
      };
    }
    async signTransaction(_privateKey: string, tx: unknown) {
      return tx;
    }
    async broadcastSignedTransaction(...args: unknown[]) {
      return mockBroadcast(...args);
    }
  },
}));
jest.mock("../network-security", () => ({
  activeNetworkAllowsInsecureHttp: () => true,
}));
jest.mock("../local-activity", () => ({
  activityNetworkKey: () => "key",
  makeLocalActivityTx: () => null,
  saveLocalActivityTx: jest.fn(async () => undefined),
}));
jest.mock("../signing-policy", () => ({ isUnsafeMessageToSign: () => false }));
jest.mock("../walletconnect-policy", () => ({
  authorizeXianWalletConnectRequest: () => ({ account: MOCK_ACCOUNT, chainId: MOCK_CHAIN_ID }),
  buildRequiredXianApprovedNamespaces: jest.fn(),
  WalletConnectScopeError: class extends Error {},
}));

import {
  approveWalletConnectRequest,
  getWalletConnectState,
  initializeWalletConnect,
  rejectWalletConnectRequest,
} from "../walletconnect";

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

let nextRequestId = 100;

async function queueSendCall(): Promise<number> {
  await initializeWalletConnect();
  const id = nextRequestId++;
  mockHandlers.get("session_request")?.({
    id,
    topic: "topic",
    params: {
      chainId: `xian:${MOCK_CHAIN_ID}`,
      request: {
        method: "xian_sendCall",
        params: {
          intent: { contract: "currency", function: "transfer", kwargs: { amount: 5, to: "bob" } },
        },
      },
    },
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await flush();
    if (getWalletConnectState().requests.some((request) => request.id === id)) {
      return id;
    }
  }
  throw new Error("request was not queued");
}

describe("WalletConnect request resolution", () => {
  beforeEach(() => {
    mockRespondSessionRequest.mockClear();
    mockBroadcast.mockReset();
  });

  it("does not let a rejection overtake an approval that is already executing", async () => {
    const id = await queueSendCall();
    const broadcast = deferred<unknown>();
    mockBroadcast.mockImplementation(() => broadcast.promise);

    const approval = approveWalletConnectRequest(id);
    await flush();
    expect(mockBroadcast).toHaveBeenCalledTimes(1);

    await rejectWalletConnectRequest(id);
    broadcast.resolve({ txHash: "HASH", accepted: true, finalized: false });
    await approval;

    expect(mockRespondSessionRequest).toHaveBeenCalledTimes(1);
    expect(mockRespondSessionRequest).toHaveBeenCalledWith({
      topic: "topic",
      response: { id, result: { txHash: "HASH", accepted: true, finalized: false } },
    });
    expect(getWalletConnectState().requests.some((request) => request.id === id)).toBe(false);
  });

  it("executes a request once when approval is triggered twice", async () => {
    const id = await queueSendCall();
    const broadcast = deferred<unknown>();
    mockBroadcast.mockImplementation(() => broadcast.promise);

    const first = approveWalletConnectRequest(id);
    const second = approveWalletConnectRequest(id);
    await expect(second).rejects.toThrow("already being processed");
    broadcast.resolve({ txHash: "HASH", accepted: true, finalized: false });
    await first;

    expect(mockBroadcast).toHaveBeenCalledTimes(1);
    expect(mockRespondSessionRequest).toHaveBeenCalledTimes(1);
  });

  it("does not execute a request whose rejection is being sent", async () => {
    const id = await queueSendCall();
    const response = deferred<undefined>();
    mockRespondSessionRequest.mockImplementationOnce(() => response.promise);

    const rejection = rejectWalletConnectRequest(id);
    await expect(approveWalletConnectRequest(id)).rejects.toThrow("already being processed");
    response.resolve(undefined);
    await rejection;

    expect(mockBroadcast).not.toHaveBeenCalled();
    expect(mockRespondSessionRequest).toHaveBeenCalledTimes(1);
  });

  it("answers the dapp with the execution error and drops the request", async () => {
    const id = await queueSendCall();
    mockBroadcast.mockImplementation(async () => {
      throw new Error("broadcast failed");
    });

    await expect(approveWalletConnectRequest(id, { trust: "exact" })).rejects.toThrow(
      "broadcast failed"
    );

    expect(mockRespondSessionRequest).toHaveBeenCalledWith({
      topic: "topic",
      response: { id, error: "broadcast failed" },
    });
    expect(getWalletConnectState().requests.some((request) => request.id === id)).toBe(false);
  });

  it("refuses to approve a request that is not pending", async () => {
    await initializeWalletConnect();

    await expect(approveWalletConnectRequest(424242)).rejects.toThrow(
      "WalletConnect request not found"
    );
    expect(mockBroadcast).not.toHaveBeenCalled();
  });
});
