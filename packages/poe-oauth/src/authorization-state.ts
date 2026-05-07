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
    const parsed = JSON.parse(decoded) as Partial<AuthorizationStatePayload>;
    if (
      parsed.v !== 1
      || typeof parsed.n !== "string"
      || parsed.n.length === 0
      || typeof parsed.i !== "string"
      || parsed.i.length === 0
      || typeof parsed.r !== "boolean"
    ) {
      return null;
    }

    return {
      issuer: parsed.i,
      requireIssuer: parsed.r,
    };
  } catch {
    return null;
  }
}
