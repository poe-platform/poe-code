import { copyBoundedOAuthJson } from "./bounded-json.js";
import { normalizeOAuthScope } from "./scope.js";
import type { StoredOAuthTokens } from "./types.js";

export interface OAuthTokenGrantImportOptions {
  /** Absolute Unix epoch milliseconds; a numeric value takes precedence. */
  readonly expiresAt?: number | null;
  /** Original Unix epoch milliseconds for a delayed relative-lifetime import. */
  readonly issuedAt?: number;
  readonly now?: () => number;
}

/** Validate a raw RFC token response and anchor its lifetime once for persistence. */
export function parseOAuthTokenGrant(value: unknown, options: OAuthTokenGrantImportOptions = {}): StoredOAuthTokens {
  options = { ...options, expiresAt: options.expiresAt, issuedAt: options.issuedAt, now: options.now?.bind(options) };
  const invalid = () => new Error("Invalid OAuth token grant");
  const result = copyBoundedOAuthJson(value, "Invalid OAuth token grant");
  if (typeof result !== "object" || result === null || Array.isArray(result)) throw invalid();
  const record = result as Record<string, unknown>;
  const own = (key: string) => Object.hasOwn(record, key) ? record[key] : undefined;
  const access = own("access_token"), refresh = own("refresh_token"), type = own("token_type");
  if (typeof access !== "string" || access.trim() === "" || typeof type !== "string" || type.toLowerCase() !== "bearer" ||
    (refresh !== undefined && (typeof refresh !== "string" || refresh.trim() === ""))) throw invalid();
  const accessToken = access.trim();
  try { new Headers({ Authorization: `Bearer ${accessToken}` }); } catch { throw invalid(); }
  const lifetime = own("expires_in"), seconds = own("expires_at"), milliseconds = own("expiresAt");
  if ((lifetime !== undefined && (typeof lifetime !== "number" || !Number.isSafeInteger(lifetime) || lifetime < 0)) ||
    (seconds !== undefined && seconds !== null && (typeof seconds !== "number" || !Number.isSafeInteger(seconds)))) throw invalid();
  const validTimestamp = (input: unknown): input is number => typeof input === "number" && Number.isSafeInteger(input) && Math.abs(input) <= 8_640_000_000_000_000;
  if ((milliseconds !== undefined && milliseconds !== null && !validTimestamp(milliseconds)) ||
    (options.expiresAt !== undefined && options.expiresAt !== null && !validTimestamp(options.expiresAt)) ||
    (options.issuedAt !== undefined && !validTimestamp(options.issuedAt))) throw invalid();
  // Validate every supplied timing field, even if a higher-precedence absolute
  // value is selected. Reload uses only the resulting normalized timestamp.
  const absoluteSeconds = typeof seconds === "number" ? seconds * 1000 : undefined;
  if (absoluteSeconds !== undefined && !validTimestamp(absoluteSeconds)) throw invalid();
  const anchor = typeof lifetime === "number" ? options.issuedAt ?? (options.now ?? Date.now)() : undefined;
  if (typeof lifetime === "number" && !validTimestamp(anchor)) throw invalid();
  const relative = typeof lifetime === "number" ? (anchor as number) + lifetime * 1000 : undefined;
  if (relative !== undefined && !validTimestamp(relative)) throw invalid();
  const expiresAt = options.expiresAt ?? (typeof milliseconds === "number" ? milliseconds : undefined) ?? absoluteSeconds ?? relative ?? null;
  let scope: string | undefined;
  try { scope = normalizeOAuthScope(own("scope")); } catch { throw invalid(); }
  if (own("scope") !== undefined && scope === undefined) throw invalid();
  return { accessToken, tokenType: "Bearer", expiresAt,
    ...(refresh === undefined ? {} : { refreshToken: (refresh as string).trim() }),
    ...(scope === undefined ? {} : { scope }) };
}
