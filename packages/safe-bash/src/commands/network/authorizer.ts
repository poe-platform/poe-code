import type { NetworkAuthorizer } from "./types.js";

export type OriginAllowlist = "*" | readonly string[];

export interface OriginAuthorizerOptions {
  readonly denyPrivateNetworks?: boolean;
}

function privateHostname(input: string): boolean {
  const hostname = input.toLowerCase().replace(/\.$/u, "").replace(/^\[|\]$/gu, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1") return true;
  if (hostname.includes(":")) {
    const first = hostname.split(":", 1)[0] ?? "";
    return first.startsWith("fc") || first.startsWith("fd") || ["fe8", "fe9", "fea", "feb"].some(prefix => first.startsWith(prefix));
  }
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some(part => !part || Array.from(part).some(character => character < "0" || character > "9"))) return false;
  const octets = parts.map(Number);
  if (octets.some(value => value < 0 || value > 255)) return false;
  const [first, second] = octets as [number, number, number, number];
  return first === 10 || first === 127 || first === 0 ||
    first === 169 && second === 254 || first === 192 && second === 168 ||
    first === 172 && second >= 16 && second <= 31;
}

export function createOriginAuthorizer(allowlist: OriginAllowlist = "*", options: OriginAuthorizerOptions = {}): NetworkAuthorizer {
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
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
    if (options.denyPrivateNetworks && privateHostname(hostname)) return false;
    return allowlist === "*" || origins.has(url.origin) || hosts.has(hostname);
  };
}
