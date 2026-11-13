import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const MOCK_ACCOUNT = "ab".repeat(32);
const MOCK_CHAIN_ID = "xian-devnet-1";

type Handler = (event: unknown) => void;

const mockHandlers = new Map<string, Handler>();
const mockRespondSessionRequest = jest.fn(async (_input: unknown) => undefined);
const mockBroadcast = jest.fn() as jest.Mock;
const mockEstimateChi = jest.fn() as jest.Mock;
const mockApproveSession = jest.fn() as jest.Mock;
const mockRejectSession = jest.fn() as jest.Mock;

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
        approveSession: (input: unknown) => mockApproveSession(input),
        rejectSession: (input: unknown) => mockRejectSession(input),
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
    parseXianDappAction: jest.fn((request: { method: string; params?: unknown }) => {
      if (request.method !== "xian_sendCall") return null;
      const root = (Array.isArray(request.params) ? request.params[0] : request.params) as {
        intent: Record<string, unknown>;
      };
      const intent = root.intent;
      return {
        method: request.method,
        contract: intent.contract,
        function: intent.function,
        chi: intent.chiSupplied ?? intent.chi,
        kwargs: intent.kwargs,
      };
    }),
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
    async estimateChi(...args: unknown[]) {
      return mockEstimateChi(...args);
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
  ...(jest.requireActual("../walletconnect-policy") as object),
  authorizeXianWalletConnectRequest: jest.fn(() => ({ account: MOCK_ACCOUNT, chainId: MOCK_CHAIN_ID })),
  buildRequiredXianApprovedNamespaces: jest.fn(() => ({})),
}));

import {
  approveWalletConnectProposal,
  approveWalletConnectRequest,
  getWalletConnectState,
  initializeWalletConnect,
  rejectWalletConnectProposal,
  rejectWalletConnectRequest,
} from "../walletconnect";

const mockStorage = jest.requireMock("../storage") as Record<string, jest.Mock>;
const mockProvider = jest.requireMock("@xian-tech/provider") as Record<string, jest.Mock>;
const mockController = jest.requireMock("../wallet-controller") as Record<string, jest.Mock>;
const mockPolicy = jest.requireMock("../walletconnect-policy") as Record<string, jest.Mock>;

const WALLET_STATE = {
  publicKey: MOCK_ACCOUNT,
  rpcUrl: "http://127.0.0.1:26657",
  networkPresets: [],
  trustedDappPolicies: [],
};

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

async function queueSendCall(
  intent: Record<string, unknown> = {
    contract: "currency",
    function: "transfer",
    kwargs: { amount: 5, to: "bob" },
    chi: 1000,
  },
  verifyContext?: unknown,
  wrapParams = false
): Promise<number> {
  await initializeWalletConnect();
  const id = nextRequestId++;
  mockHandlers.get("session_request")?.({
    id,
    topic: "topic",
    verifyContext,
    params: {
      chainId: `xian:${MOCK_CHAIN_ID}`,
      request: { method: "xian_sendCall", params: wrapParams ? [{ intent }] : { intent } },
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
    mockEstimateChi.mockReset();
    mockStorage.loadWalletState.mockImplementation(async () => WALLET_STATE);
    mockStorage.upsertTrustedDappPolicy.mockClear();
    mockProvider.createXianDappPolicyForRequest.mockClear();
    mockProvider.findMatchingXianDappPolicy.mockClear();
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

  function queuedRequest(id: number) {
    return getWalletConnectState().requests.find((request) => request.id === id);
  }

  it("estimates chi for a send-call before asking the user", async () => {
    mockEstimateChi.mockImplementation(async () => ({ estimated: 777 }));

    const id = await queueSendCall({ contract: "currency", function: "transfer", kwargs: { to: "bob" } });

    expect(mockEstimateChi).toHaveBeenCalledWith({
      sender: MOCK_ACCOUNT,
      contract: "currency",
      function: "transfer",
      kwargs: { to: "bob" },
    });
    const queued = queuedRequest(id);
    expect((queued?.request.params as { intent: { chi?: number } }).intent.chi).toBe(777);
    expect(queued?.chi).toBe("777");
    expect(queued?.trustSuggestion).toBeDefined();
  });

  it("offers and creates no trust rule when chi could not be estimated", async () => {
    mockEstimateChi.mockImplementation(async () => {
      throw new Error("simulation unavailable");
    });
    mockBroadcast.mockImplementation(async () => ({ accepted: true, finalized: false }));
    const id = await queueSendCall({ contract: "currency", function: "transfer", kwargs: {} });

    expect(queuedRequest(id)?.trustSuggestion).toBeUndefined();
    expect(queuedRequest(id)?.chi).toBeNull();
    expect(
      (queuedRequest(id)?.request.params as { intent: Record<string, unknown> }).intent
    ).not.toHaveProperty("chi");
    await approveWalletConnectRequest(id, { trust: "any" });

    expect(mockProvider.createXianDappPolicyForRequest).not.toHaveBeenCalled();
    expect(mockStorage.upsertTrustedDappPolicy).not.toHaveBeenCalled();
  });

  it("creates a trust rule for an approved request with chi", async () => {
    mockBroadcast.mockImplementation(async () => ({ accepted: true, finalized: false }));
    const id = await queueSendCall();

    const policy = { id: "rule-1", maxChi: 5000 };
    mockProvider.createXianDappPolicyForRequest.mockImplementationOnce((() => policy) as never);

    await approveWalletConnectRequest(id, { trust: "exact" });

    expect(mockProvider.createXianDappPolicyForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ argumentScope: "exact", origin: expect.any(String) })
    );
    const [{ now, expiresAt }] = mockProvider.createXianDappPolicyForRequest.mock.calls[0] as [
      { now: number; expiresAt: number },
    ];
    expect(expiresAt - now).toBe(30 * 24 * 60 * 60 * 1000);
    expect(mockStorage.upsertTrustedDappPolicy).toHaveBeenCalledWith(policy);
  });

  it("queues a request for review while the wallet is locked", async () => {
    mockController.loadUnlockedWalletMaterial.mockImplementationOnce(async () => null);

    const id = await queueSendCall();

    expect(getWalletConnectState().requests.some((request) => request.id === id)).toBe(true);
    expect(mockProvider.findMatchingXianDappPolicy).not.toHaveBeenCalled();
  });

  it("answers, without queueing, a request whose session lapses while chi is estimated", async () => {
    mockPolicy.authorizeXianWalletConnectRequest
      .mockImplementationOnce(() => ({ account: MOCK_ACCOUNT, chainId: MOCK_CHAIN_ID }))
      .mockImplementationOnce(() => {
        throw new Error("session no longer authorizes this chain");
      });
    await initializeWalletConnect();
    const id = nextRequestId++;
    mockHandlers.get("session_request")?.({
      id,
      topic: "topic",
      params: {
        chainId: `xian:${MOCK_CHAIN_ID}`,
        request: { method: "xian_sendCall", params: { intent: { contract: "currency", function: "transfer", kwargs: {}, chi: 1000 } } },
      },
    });
    for (let attempt = 0; attempt < 20 && mockRespondSessionRequest.mock.calls.length === 0; attempt += 1) {
      await flush();
    }
    await flush();

    expect(mockRespondSessionRequest).toHaveBeenCalledWith({
      topic: "topic",
      response: { id, error: "session no longer authorizes this chain" },
    });
    expect(getWalletConnectState().requests.some((request) => request.id === id)).toBe(false);
  });

  it("ignores stored trust rules that have no chi cap", async () => {
    const capped = { id: "capped", maxChi: 5000 };
    mockController.loadUnlockedWalletMaterial.mockImplementationOnce(async () => ({
      state: { ...WALLET_STATE, trustedDappPolicies: [{ id: "uncapped" }, capped] },
      privateKey: "11".repeat(32),
    }));

    await queueSendCall();

    expect(mockProvider.findMatchingXianDappPolicy).toHaveBeenCalledWith(
      [capped],
      expect.anything(),
      expect.anything()
    );
  });

  it("estimates chi for array-wrapped params and keeps them wrapped", async () => {
    mockEstimateChi.mockImplementation(async () => ({ estimated: 42 }));

    const id = await queueSendCall({ contract: "currency", function: "transfer" }, undefined, true);

    expect(queuedRequest(id)?.request.params).toEqual([
      { intent: { contract: "currency", function: "transfer", chi: 42 } },
    ]);
  });

  it.each([0, 1.5, Number.MAX_SAFE_INTEGER + 2])(
    "leaves chi unset when the estimate is unusable (%s)",
    async (estimated) => {
      mockEstimateChi.mockImplementation(async () => ({ estimated }));

      const id = await queueSendCall({ contract: "currency", function: "transfer", kwargs: {} });

      expect(queuedRequest(id)?.chi).toBeNull();
    }
  );

  it("does not estimate without a wallet or a named contract function", async () => {
    mockStorage.loadWalletState.mockImplementation(async () => null);
    const first = await queueSendCall({ contract: "currency", function: "transfer" });
    mockStorage.loadWalletState.mockImplementation(async () => WALLET_STATE);
    const second = await queueSendCall({ contract: 5, function: "transfer" });

    expect(mockEstimateChi).not.toHaveBeenCalled();
    expect(queuedRequest(first)?.chi).toBeNull();
    expect(queuedRequest(second)?.chi).toBeNull();
  });

  it("answers a request that matches a capped trust rule without queueing it", async () => {
    mockBroadcast.mockImplementation(async () => ({ txHash: "AUTO", accepted: true, finalized: false }));
    mockProvider.findMatchingXianDappPolicy.mockImplementationOnce(() => ({
      matched: true,
      policy: { id: "rule" },
    }));
    await initializeWalletConnect();
    const id = nextRequestId++;
    mockHandlers.get("session_request")?.({
      id,
      topic: "topic",
      params: {
        chainId: `xian:${MOCK_CHAIN_ID}`,
        request: { method: "xian_sendCall", params: { intent: { contract: "currency", function: "transfer", chi: 10 } } },
      },
    });
    for (let attempt = 0; attempt < 20 && mockRespondSessionRequest.mock.calls.length === 0; attempt += 1) {
      await flush();
    }

    expect(mockRespondSessionRequest).toHaveBeenCalledWith({
      topic: "topic",
      response: { id, result: { txHash: "AUTO", accepted: true, finalized: false } },
    });
    expect(mockStorage.touchTrustedDappPolicy).toHaveBeenCalledWith("rule");
    expect(queuedRequest(id)).toBeUndefined();
  });

  async function queueRequest(request: Record<string, unknown>): Promise<number> {
    await initializeWalletConnect();
    const id = nextRequestId++;
    mockHandlers.get("session_request")?.({
      id,
      topic: "topic",
      params: { chainId: `xian:${MOCK_CHAIN_ID}`, request },
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await flush();
      if (queuedRequest(id)) return id;
    }
    throw new Error("request was not queued");
  }

  it("does not estimate requests that already carry chi or send no call", async () => {
    await queueSendCall({ contract: "currency", function: "transfer", chi: 5 });
    await queueSendCall({ contract: "currency", function: "transfer", chiSupplied: 6 });
    const message = await queueRequest({ method: "xian_signMessage", params: { message: "hi" } });

    expect(mockEstimateChi).not.toHaveBeenCalled();
    expect(queuedRequest(message)?.chi).toBeUndefined();
    expect(queuedRequest(message)?.trustSuggestion).toBeUndefined();
  });

  it("accepts the smallest positive chi estimate", async () => {
    mockEstimateChi.mockImplementation(async () => ({ estimated: 1 }));

    const id = await queueSendCall({ contract: "currency", function: "transfer" });

    expect(queuedRequest(id)?.chi).toBe("1");
  });

  it("approves a non-transaction request with trust requested but creates no rule", async () => {
    const id = await queueRequest({ method: "xian_signMessage", params: { message: "hi" } });

    await approveWalletConnectRequest(id, { trust: "exact" });

    expect(mockRespondSessionRequest).toHaveBeenCalledWith({
      topic: "topic",
      response: { id, result: "signature" },
    });
    expect(mockProvider.createXianDappPolicyForRequest).not.toHaveBeenCalled();
  });

  it("drops an expired request", async () => {
    const id = await queueSendCall();

    mockHandlers.get("session_request_expire")?.({ id });

    expect(queuedRequest(id)).toBeUndefined();
  });

  it("carries domain verification into request summaries", async () => {
    const id = await queueSendCall(undefined, {
      verified: { origin: "https://evil.example", validation: "INVALID", verifyUrl: "" },
    });

    expect(queuedRequest(id)?.verification).toEqual({
      status: "mismatch",
      origin: "https://evil.example",
    });
  });
});

describe("WalletConnect proposal resolution", () => {
  let nextProposalId = 500;

  beforeEach(() => {
    mockApproveSession.mockReset();
    mockRejectSession.mockReset();
    mockRejectSession.mockImplementation(async () => undefined);
    mockStorage.loadWalletState.mockImplementation(async () => WALLET_STATE);
  });

  async function queueProposal(
    verifyContext?: unknown,
    metadata: Record<string, unknown> = { name: "Dapp", url: "https://app.example", icons: ["icon-a", "icon-b"] }
  ): Promise<number> {
    await initializeWalletConnect();
    const id = nextProposalId++;
    mockHandlers.get("session_proposal")?.({
      id,
      verifyContext,
      params: {
        id,
        proposer: {
          metadata,
        },
        requiredNamespaces: {
          xian: { chains: [`xian:${MOCK_CHAIN_ID}`], methods: ["xian_sendCall"] },
          [`xian:${MOCK_CHAIN_ID}`]: { methods: ["xian_signMessage"] },
        },
      },
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await flush();
      if (getWalletConnectState().proposals.some((proposal) => proposal.id === id)) {
        return id;
      }
    }
    throw new Error("proposal was not queued");
  }

  it("summarizes the chains and methods a proposal requires", async () => {
    const id = await queueProposal();

    expect(getWalletConnectState().proposals.find((proposal) => proposal.id === id)).toMatchObject({
      name: "Dapp",
      url: "https://app.example",
      icon: "icon-a",
      requiredChains: [`xian:${MOCK_CHAIN_ID}`, `xian:${MOCK_CHAIN_ID}`],
      requiredMethods: ["xian_sendCall", "xian_signMessage"],
      verification: { status: "unverified" },
    });
  });

  it("summarizes a proposal whose dapp names no icon", async () => {
    const id = await queueProposal(undefined, { name: "Dapp", url: "https://app.example" });

    const proposal = getWalletConnectState().proposals.find((entry) => entry.id === id);
    expect(proposal?.name).toBe("Dapp");
    expect(proposal?.icon).toBeUndefined();
  });

  it("rejects a proposal the wallet cannot serve", async () => {
    mockStorage.loadWalletState.mockImplementation(async () => null);
    await initializeWalletConnect();
    const id = nextProposalId++;
    mockHandlers.get("session_proposal")?.({
      id,
      params: { id, proposer: { metadata: {} }, requiredNamespaces: {} },
    });
    for (let attempt = 0; attempt < 20 && mockRejectSession.mock.calls.length === 0; attempt += 1) {
      await flush();
    }

    expect(mockRejectSession).toHaveBeenCalledWith({ id, reason: expect.anything() });
    expect(getWalletConnectState().proposals.some((proposal) => proposal.id === id)).toBe(false);
  });

  it("drops an expired proposal", async () => {
    const id = await queueProposal();

    mockHandlers.get("proposal_expire")?.({ id });

    expect(getWalletConnectState().proposals.some((proposal) => proposal.id === id)).toBe(false);
  });

  it("shows whether the proposing domain was verified", async () => {
    const id = await queueProposal({
      verified: { origin: "https://app.example", validation: "VALID", verifyUrl: "", isScam: true },
    });

    expect(
      getWalletConnectState().proposals.find((proposal) => proposal.id === id)?.verification
    ).toEqual({ status: "scam", origin: "https://app.example" });
  });

  it("approves a proposal once and ignores a rejection while approving", async () => {
    const id = await queueProposal();
    const approval = deferred<{ topic: string }>();
    mockApproveSession.mockImplementation(() => approval.promise);

    const first = approveWalletConnectProposal(id);
    const second = approveWalletConnectProposal(id);
    await expect(second).rejects.toThrow("already being processed");
    await rejectWalletConnectProposal(id);
    approval.resolve({ topic: "new-topic" });
    await first;

    expect(mockApproveSession).toHaveBeenCalledTimes(1);
    expect(mockRejectSession).not.toHaveBeenCalled();
    expect(mockStorage.saveWalletState).toHaveBeenCalledWith(
      expect.objectContaining({ connectedOrigins: ["wc:new-topic"] })
    );
    expect(getWalletConnectState().proposals.some((proposal) => proposal.id === id)).toBe(false);
  });

  it("rejects a pending proposal the user declines and forgets it", async () => {
    const id = await queueProposal();

    await rejectWalletConnectProposal(id);
    await rejectWalletConnectProposal(id);

    expect(mockRejectSession).toHaveBeenCalledTimes(1);
    expect(mockRejectSession).toHaveBeenCalledWith({ id, reason: expect.anything() });
    expect(getWalletConnectState().proposals.some((proposal) => proposal.id === id)).toBe(false);
  });

  it("keeps a declined proposal answerable when sending the rejection fails", async () => {
    const id = await queueProposal();
    mockRejectSession.mockImplementationOnce(async () => {
      throw new Error("relay offline");
    });

    await expect(rejectWalletConnectProposal(id)).rejects.toThrow("relay offline");
    expect(getWalletConnectState().proposals.some((proposal) => proposal.id === id)).toBe(true);

    await rejectWalletConnectProposal(id);
    expect(mockRejectSession).toHaveBeenCalledTimes(2);
    expect(getWalletConnectState().proposals.some((proposal) => proposal.id === id)).toBe(false);
  });

  it("refuses to approve a proposal that is not pending", async () => {
    await queueProposal();

    await expect(approveWalletConnectProposal(987654)).rejects.toThrow(
      "WalletConnect proposal not found"
    );
    expect(mockApproveSession).not.toHaveBeenCalled();
  });
});

