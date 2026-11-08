import { privateHostname } from "./private-address.js";
import type { NetworkAuthorizer } from "./types.js";

export type OriginAllowlist = "*" | readonly string[];

export interface OriginAuthorizerOptions {
  readonly denyPrivateNetworks?: boolean;
}

export function createOriginAuthorizer(allowlist: OriginAllowlist = "*", options: OriginAuthorizerOptions = {}): NetworkAuthorizer {
  const denyPrivateNetworks = options.denyPrivateNetworks === true;
  const origins = new Set<string>();
  const hosts = new Set<string>();
  for (const entry of allowlist === "*" ? [] : allowlist) {
    const value = entry.trim();
    if (!value) throw new TypeError("Origin allowlist entries must not be empty");
    if (value.includes("://")) {
      const url = new URL(value);
      if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
        throw new TypeError(`Origin allowlist entry must be an origin: ${entry}`);
      }
      origins.add(url.origin);
    } else {
      if (value.includes("/") || value.includes("@")) throw new TypeError(`Invalid hostname allowlist entry: ${entry}`);
      hosts.add(value.toLowerCase().replace(/\.$/u, ""));
    }
  }
  return request => {
    const url = new URL(request.url);
    // An origin allowlist does not authorize routing to a different virtual host.
    const hostHeaders = request.headers?.filter(([name]) => name.toLowerCase() === "host") ?? [];
    if (hostHeaders.length > 1 || hostHeaders.some(([, value]) => value.toLowerCase() !== url.host.toLowerCase())) return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
    if (denyPrivateNetworks) {
      request.requirePrivateNetworkDeny?.();
      if (privateHostname(hostname)) return false;
    }
    return allowlist === "*" || origins.has(url.origin) || hosts.has(hostname);
  };
}
