import type { NetworkAuthorizer } from "./types.js";

export type OriginAllowlist = "*" | readonly string[];

export interface OriginAuthorizerOptions {
  readonly denyPrivateNetworks?: boolean;
}

function privateIPv4(first: number, second: number): boolean {
  return first === 10 || first === 127 || first === 0 ||
    first === 169 && second === 254 || first === 192 && second === 168 ||
    first === 172 && second >= 16 && second <= 31;
}

function privateHostname(input: string): boolean {
  const hostname = input.toLowerCase().replace(/\.$/u, "").replace(/^\[|\]$/gu, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1") return true;
  if (hostname.includes(":")) {
    // URL parsing has already validated the literal and canonicalized any
    // dotted IPv4 suffix. Expand its at-most-eight numeric hextets.
    const [prefix, suffix] = hostname.split("::");
    const leading = prefix ? prefix.split(":") : [];
    const trailing = suffix ? suffix.split(":") : [];
    const hextets = new Array<number>(8).fill(0);
    for (let index = 0; index < leading.length; index++) hextets[index] = Number.parseInt(leading[index]!, 16);
    for (let index = 0; index < trailing.length; index++) hextets[8 - trailing.length + index] = Number.parseInt(trailing[index]!, 16);
    if (hextets.every(value => value === 0)) return true;
    if (hextets.slice(0, 5).every(value => value === 0) && hextets[5] === 0xffff) {
      return privateIPv4(hextets[6]! >>> 8, hextets[6]! & 255);
    }
    return (hextets[0]! & 0xfe00) === 0xfc00 || (hextets[0]! & 0xffc0) === 0xfe80;
  }
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some(part => !part || Array.from(part).some(character => character < "0" || character > "9"))) return false;
  const octets = parts.map(Number);
  if (octets.some(value => value < 0 || value > 255)) return false;
  const [first, second] = octets as [number, number, number, number];
  return privateIPv4(first, second);
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
