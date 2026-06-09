import crypto from "node:crypto";

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
    n: crypto.randomBytes(16).toString("base64url"),
    i: input.issuer,
    r: input.requireIssuer,
  };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function parseAuthorizationState(
  value: string | null
): { issuer: string; requireIssuer: boolean } | null {
  if (value === null || value.length === 0) {
    return null;
  }

  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
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
