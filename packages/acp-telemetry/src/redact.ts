const MAX_STRING_BYTES = 65_536;
const MAX_JSON_BYTES = 262_144;
const BINARY_SCAN_BYTES = 1_024;
const REDACTED_SECRET = "[redacted]";
const BEARER_TOKEN_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const AUTH_HEADER_PATTERN =
  /\b((?:Proxy-)?Authorization\s*:\s*(?:Bearer|Basic|Token)\s+)[^\s"'\r\n]+/gi;
const COOKIE_HEADER_PATTERN = /\b((?:Set-)?Cookie\s*:\s*)[^\r\n"']+/gi;
const URL_USERINFO_PATTERN = /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#\s@]+@)/g;
const ASSIGNED_SECRET_NAME_PATTERN = String.raw`(?:(?:[A-Za-z0-9]+[-_])*api[-_ ]?key|(?:[A-Za-z0-9]+[-_])*(?:token|secret|password|private[-_ ]?key))`;
const ASSIGNED_SECRET_PATTERN = new RegExp(
  String.raw`\b(${ASSIGNED_SECRET_NAME_PATTERN}\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[A-Za-z0-9._~+/=-]+)`,
  "gi"
);

export function redact(value: unknown): unknown {
  const serialized = safelySerialize(value);
  if (serialized !== undefined) {
    const originalBytes = Buffer.byteLength(serialized, "utf8");
    if (originalBytes > MAX_JSON_BYTES) {
      return `[truncated:${originalBytes}]`;
    }
  }

  return redactLeaf(value, new WeakSet());
}

function redactLeaf(value: unknown, ancestors: WeakSet<object>, key?: string): unknown {
  if (key !== undefined && isSensitiveKey(key)) {
    return REDACTED_SECRET;
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (value instanceof Uint8Array) {
    const scanLength = Math.min(value.byteLength, BINARY_SCAN_BYTES);
    for (let index = 0; index < scanLength; index += 1) {
      if (value[index] === 0x00) {
        return `[binary:${value.byteLength}]`;
      }
    }

    return value;
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return "[circular]";
    }

    ancestors.add(value);
    const redacted = value.map((item) => redactLeaf(item, ancestors));
    ancestors.delete(value);
    return redacted;
  }

  if (value !== null && typeof value === "object") {
    if (ancestors.has(value)) {
      return "[circular]";
    }

    ancestors.add(value);
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      Object.defineProperty(redacted, key, {
        configurable: true,
        enumerable: true,
        value: redactLeaf(item, ancestors, key),
        writable: true
      });
    }
    ancestors.delete(value);
    return redacted;
  }

  return value;
}

function redactString(value: string): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > MAX_STRING_BYTES) {
    return `[truncated:${bytes}]`;
  }

  return value
    .replace(URL_USERINFO_PATTERN, `$1${REDACTED_SECRET}@`)
    .replace(AUTH_HEADER_PATTERN, `$1${REDACTED_SECRET}`)
    .replace(COOKIE_HEADER_PATTERN, `$1${REDACTED_SECRET}`)
    .replace(BEARER_TOKEN_PATTERN, `$1${REDACTED_SECRET}`)
    .replace(ASSIGNED_SECRET_PATTERN, redactAssignedSecretValue);
}

function redactAssignedSecretValue(match: string, prefix: string): string {
  const secret = match.slice(prefix.length);
  const quote = secret[0];
  if (quote === '"' || quote === "'") {
    return `${prefix}${quote}${REDACTED_SECRET}${quote}`;
  }

  return `${prefix}${REDACTED_SECRET}`;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.length === 0) {
    return false;
  }

  if (
    normalized === "authorization" ||
    normalized === "proxyauthorization" ||
    normalized === "cookie" ||
    normalized === "setcookie" ||
    normalized === "apikey" ||
    normalized === "xapikey" ||
    normalized === "token" ||
    normalized === "accesstoken" ||
    normalized === "refreshtoken" ||
    normalized === "idtoken" ||
    normalized === "authtoken" ||
    normalized === "bearertoken" ||
    normalized === "secret" ||
    normalized === "clientsecret" ||
    normalized === "password" ||
    normalized === "passwd" ||
    normalized === "pwd" ||
    normalized === "privatekey"
  ) {
    return true;
  }

  if (
    normalized.endsWith("apikey") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("privatekey")
  ) {
    return true;
  }

  return normalized.endsWith("token") && !normalized.endsWith("tokens");
}

function safelySerialize(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
