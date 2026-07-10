import { describe, expect, it, jest } from "@jest/globals";

jest.mock(
  "@xian-tech/provider",
  () => ({
    XIAN_WALLETCONNECT_NAMESPACE: "xian",
    XIAN_WALLETCONNECT_METHODS: [
      "xian_requestAccounts",
      "xian_signMessage",
      "xian_sendCall",
      "xian_watchAsset",
    ],
    XIAN_WALLETCONNECT_EVENTS: [
      "accountsChanged",
      "chainChanged",
      "connect",
      "disconnect",
    ],
    xianChainIdToCaip2: (chainId: string) => `xian:${chainId}`,
    xianChainIdFromCaip2: (value: string) =>
      value.startsWith("xian:") ? value.slice("xian:".length) : null,
    xianAccountToCaip10: (chainId: string, account: string) =>
      `xian:${chainId}:${account}`,
    xianAccountFromCaip10: (value: string) => {
      const match = value.match(/^xian:(.+):([^:]+)$/);
      return match ? { chainId: match[1], account: match[2] } : null;
    },
  }),
  { virtual: true }
);

import {
  authorizeXianWalletConnectRequest,
  buildRequiredXianApprovedNamespaces,
  type WalletConnectProposalScope,
} from "../walletconnect-policy";

const ACCOUNT = "ab".repeat(32);

describe("WalletConnect least-privilege policy", () => {
  it("approves only required Xian permissions and ignores optional scope", () => {
    const namespaces = buildRequiredXianApprovedNamespaces({
      chainId: "xian-local",
      account: ACCOUNT,
      proposal: {
        requiredNamespaces: {
          xian: {
            chains: ["xian:xian-local"],
            methods: ["xian_requestAccounts", "xian_signMessage"],
            events: ["accountsChanged"],
          },
        },
        optionalNamespaces: {
          xian: {
            chains: ["xian:xian-local"],
            methods: ["xian_sendCall", "xian_watchAsset"],
            events: ["chainChanged", "disconnect"],
          },
        },
      },
    });

    expect(namespaces).toEqual({
      xian: {
        chains: ["xian:xian-local"],
        methods: ["xian_requestAccounts", "xian_signMessage"],
        events: ["accountsChanged"],
        accounts: [`xian:xian-local:${ACCOUNT}`],
      },
    });
  });

  it.each([
    {
      label: "inactive chain",
      proposal: {
        requiredNamespaces: {
          xian: {
            chains: ["xian:xian-other"],
            methods: ["xian_signMessage"],
            events: [],
          },
        },
      },
      reason: "UNSUPPORTED_CHAINS",
    },
    {
      label: "unsupported method",
      proposal: {
        requiredNamespaces: {
          xian: {
            chains: ["xian:xian-local"],
            methods: ["xian_deleteWallet"],
            events: [],
          },
        },
      },
      reason: "UNSUPPORTED_METHODS",
    },
    {
      label: "unsupported event",
      proposal: {
        requiredNamespaces: {
          xian: {
            chains: ["xian:xian-local"],
            methods: ["xian_signMessage"],
            events: ["privateKeyChanged"],
          },
        },
      },
      reason: "UNSUPPORTED_EVENTS",
    },
    {
      label: "optional-only proposal",
      proposal: {
        requiredNamespaces: {},
        optionalNamespaces: {
          xian: {
            chains: ["xian:xian-local"],
            methods: ["xian_signMessage"],
            events: [],
          },
        },
      },
      reason: "UNSUPPORTED_NAMESPACE_KEY",
    },
  ])("rejects an adversarial $label proposal", ({ proposal, reason }) => {
    expect(() =>
      buildRequiredXianApprovedNamespaces({
        proposal: proposal as WalletConnectProposalScope,
        chainId: "xian-local",
        account: ACCOUNT,
      })
    ).toThrow(
      expect.objectContaining({ reason })
    );
  });

  it("enforces the live session method, chain, and account on every request", () => {
    const namespaces = {
      xian: {
        chains: ["xian:xian-local"],
        methods: ["xian_signMessage"],
        events: [],
        accounts: [`xian:xian-local:${ACCOUNT}`],
      },
    };

    expect(
      authorizeXianWalletConnectRequest({
        namespaces,
        caipChainId: "xian:xian-local",
        method: "xian_signMessage",
      })
    ).toEqual({ account: ACCOUNT, chainId: "xian-local" });
    expect(() =>
      authorizeXianWalletConnectRequest({
        namespaces,
        caipChainId: "xian:xian-local",
        method: "xian_sendCall",
      })
    ).toThrow(expect.objectContaining({ reason: "UNAUTHORIZED_METHOD" }));
    expect(() =>
      authorizeXianWalletConnectRequest({
        namespaces,
        caipChainId: "xian:xian-other",
        method: "xian_signMessage",
      })
    ).toThrow(expect.objectContaining({ reason: "UNSUPPORTED_CHAINS" }));
  });
});
