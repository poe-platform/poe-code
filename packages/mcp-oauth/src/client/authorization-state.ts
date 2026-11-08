import { base64url } from "jose";

interface AuthorizationStatePayload {
  v: 1;
  n: string;
  i: string;
  r: boolean;
}

export function createAuthorizationState(input: {
  issuer: string;
  requireIssuer: boolean;
}): string {
  const payload: AuthorizationStatePayload = {
    v: 1,
    n: base64url.encode(crypto.getRandomValues(new Uint8Array(16))),
    i: input.issuer,
    r: input.requireIssuer,
  };

  return base64url.encode(JSON.stringify(payload));
}

export function parseAuthorizationState(
  value: string | null
): { issuer: string; requireIssuer: boolean } | null {
  if (value === null || value.length === 0) {
    return null;
  }

  try {
    const decoded = new TextDecoder().decode(base64url.decode(value));
    const parsed = JSON.parse(decoded) as unknown;
    if (!isObjectRecord(parsed)) {
      return null;
    }

    const version = getOwnEntry(parsed, "v");
    const nonce = getOwnEntry(parsed, "n");
    const issuer = getOwnEntry(parsed, "i");
    const requireIssuer = getOwnEntry(parsed, "r");
    if (
      version !== 1
      || typeof nonce !== "string"
      || nonce.length === 0
      || typeof issuer !== "string"
      || issuer.length === 0
      || typeof requireIssuer !== "boolean"
    ) {
      return null;
    }

    return {
      issuer,
      requireIssuer,
    };
  } catch {
    return null;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}
