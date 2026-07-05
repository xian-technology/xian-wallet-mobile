function normalizeParsedHostname(hostname: string): string {
  const normalized = hostname.toLowerCase();
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
}

export function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = normalizeParsedHostname(url.hostname);
    return (
      url.protocol === "http:" &&
      (hostname === "localhost" ||
        hostname === "::1" ||
        /^127(?:\.\d{1,3}){3}$/.test(hostname))
    );
  } catch {
    return false;
  }
}

export function assertRpcTransportAllowed(
  rpcUrl: string,
  allowInsecureHttp: boolean | undefined
): void {
  let parsed: URL;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new TypeError("network RPC URL must be a valid URL");
  }
  if (
    parsed.protocol === "http:" &&
    !allowInsecureHttp &&
    !isLoopbackHttpUrl(rpcUrl)
  ) {
    throw new Error(
      "HTTP RPC URLs are disabled for this network. Enable HTTP data transfers only for endpoints you trust."
    );
  }
}

export function activeNetworkAllowsInsecureHttp(state: {
  activeNetworkId?: string;
  networkPresets: Array<{ id: string; allowInsecureHttp?: boolean }>;
}): boolean {
  return (
    state.networkPresets.find((preset) => preset.id === state.activeNetworkId)
      ?.allowInsecureHttp === true
  );
}
