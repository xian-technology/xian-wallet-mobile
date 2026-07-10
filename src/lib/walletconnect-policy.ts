import { buildApprovedNamespaces } from "@walletconnect/utils";
import {
  XIAN_WALLETCONNECT_EVENTS,
  XIAN_WALLETCONNECT_METHODS,
  XIAN_WALLETCONNECT_NAMESPACE,
  xianAccountFromCaip10,
  xianAccountToCaip10,
  xianChainIdFromCaip2,
  xianChainIdToCaip2,
} from "@xian-tech/provider";

interface ProposalNamespace {
  chains?: string[];
  methods?: string[];
  events?: string[];
}

export interface WalletConnectProposalScope {
  requiredNamespaces?: Record<string, ProposalNamespace>;
  optionalNamespaces?: Record<string, ProposalNamespace>;
}

export interface WalletConnectSessionNamespace {
  accounts?: string[];
  chains?: string[];
  methods?: string[];
  events?: string[];
}

export interface WalletConnectApprovedNamespace {
  accounts: string[];
  chains?: string[];
  methods: string[];
  events: string[];
}

export interface WalletConnectAuthorizedRequest {
  account: string;
  chainId: string;
}

export type WalletConnectScopeErrorReason =
  | "UNSUPPORTED_NAMESPACE_KEY"
  | "UNSUPPORTED_CHAINS"
  | "UNSUPPORTED_METHODS"
  | "UNSUPPORTED_EVENTS"
  | "UNAUTHORIZED_METHOD";

export class WalletConnectScopeError extends Error {
  constructor(
    readonly reason: WalletConnectScopeErrorReason,
    message: string
  ) {
    super(message);
    this.name = "WalletConnectScopeError";
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function namespaceChains(key: string, namespace: ProposalNamespace): string[] {
  return key.includes(":") ? [key] : namespace.chains ?? [];
}

export function buildRequiredXianApprovedNamespaces(input: {
  proposal: WalletConnectProposalScope;
  chainId: string;
  account: string;
}): Record<string, WalletConnectApprovedNamespace> {
  const caipChainId = xianChainIdToCaip2(input.chainId);
  const requiredNamespaces = input.proposal.requiredNamespaces ?? {};
  const methods: string[] = [];
  const events: string[] = [];
  let foundXianNamespace = false;

  for (const [key, namespace] of Object.entries(requiredNamespaces)) {
    if (key.split(":", 1)[0] !== XIAN_WALLETCONNECT_NAMESPACE) {
      throw new WalletConnectScopeError(
        "UNSUPPORTED_NAMESPACE_KEY",
        `unsupported required WalletConnect namespace: ${key}`
      );
    }
    foundXianNamespace = true;
    const chains = namespaceChains(key, namespace);
    if (chains.length === 0 || chains.some((chain) => chain !== caipChainId)) {
      throw new WalletConnectScopeError(
        "UNSUPPORTED_CHAINS",
        `WalletConnect proposal must require only the active chain ${caipChainId}`
      );
    }
    for (const method of namespace.methods ?? []) {
      if (!(XIAN_WALLETCONNECT_METHODS as readonly string[]).includes(method)) {
        throw new WalletConnectScopeError(
          "UNSUPPORTED_METHODS",
          `unsupported required WalletConnect method: ${method}`
        );
      }
      methods.push(method);
    }
    for (const event of namespace.events ?? []) {
      if (!(XIAN_WALLETCONNECT_EVENTS as readonly string[]).includes(event)) {
        throw new WalletConnectScopeError(
          "UNSUPPORTED_EVENTS",
          `unsupported required WalletConnect event: ${event}`
        );
      }
      events.push(event);
    }
  }

  if (!foundXianNamespace || methods.length === 0) {
    throw new WalletConnectScopeError(
      "UNSUPPORTED_NAMESPACE_KEY",
      "WalletConnect proposal has no required Xian method scope"
    );
  }

  // WalletConnect's helper normally merges optional permissions. Supplying a
  // proposal with optionalNamespaces removed makes the approval exactly the
  // required scope the user reviewed.
  return buildApprovedNamespaces({
    proposal: {
      ...input.proposal,
      requiredNamespaces,
      optionalNamespaces: {},
    } as Parameters<typeof buildApprovedNamespaces>[0]["proposal"],
    supportedNamespaces: {
      [XIAN_WALLETCONNECT_NAMESPACE]: {
        chains: [caipChainId],
        methods: unique(methods),
        events: unique(events),
        accounts: [xianAccountToCaip10(input.chainId, input.account)],
      },
    },
  });
}

export function authorizeXianWalletConnectRequest(input: {
  namespaces: Record<string, WalletConnectSessionNamespace> | undefined;
  caipChainId: string;
  method: string;
}): WalletConnectAuthorizedRequest {
  const chainId = xianChainIdFromCaip2(input.caipChainId);
  if (!chainId) {
    throw new WalletConnectScopeError(
      "UNSUPPORTED_CHAINS",
      `request uses an unsupported chain: ${input.caipChainId}`
    );
  }

  for (const [key, namespace] of Object.entries(input.namespaces ?? {})) {
    if (key.split(":", 1)[0] !== XIAN_WALLETCONNECT_NAMESPACE) {
      continue;
    }
    const approvedChains = new Set([
      ...(key.includes(":") ? [key] : []),
      ...(namespace.chains ?? []),
      ...(namespace.accounts ?? []).map((account) => {
        const parsed = xianAccountFromCaip10(account);
        return parsed ? xianChainIdToCaip2(parsed.chainId) : "";
      }),
    ]);
    if (!approvedChains.has(input.caipChainId)) {
      continue;
    }
    if (!(namespace.methods ?? []).includes(input.method)) {
      throw new WalletConnectScopeError(
        "UNAUTHORIZED_METHOD",
        `WalletConnect method was not approved for this session: ${input.method}`
      );
    }
    const account = (namespace.accounts ?? [])
      .map(xianAccountFromCaip10)
      .find((entry) => entry?.chainId === chainId)?.account;
    if (!account) {
      throw new WalletConnectScopeError(
        "UNSUPPORTED_CHAINS",
        "WalletConnect session has no approved account for the request chain"
      );
    }
    return { account, chainId };
  }

  throw new WalletConnectScopeError(
    "UNSUPPORTED_CHAINS",
    `request chain was not approved for this session: ${input.caipChainId}`
  );
}
