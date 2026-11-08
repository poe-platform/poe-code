const MAX_STRING_BYTES = 65_536;
const MAX_JSON_BYTES = 262_144;
const REDACTED_SECRET = "[redacted]";
const BEARER_TOKEN_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/giu;
const ASSIGNED_SECRET_NAME_PATTERN =
  String.raw`(?:(?:[A-Za-z0-9]+[-_])*api[-_ ]?key|(?:[A-Za-z0-9]+[-_])*(?:token|secret|password|private[-_ ]?key))`;
const ASSIGNED_SECRET_PATTERN = new RegExp(
  String.raw`\b(${ASSIGNED_SECRET_NAME_PATTERN}\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[A-Za-z0-9._~+/=-]+)`,
  "giu"
);
const BARE_TOKEN_PATTERNS = [
  /\bsk-(?:(?:ant|live|proj|test)-)?[A-Za-z0-9_-]{10,}\b/giu,
  /\bpka_[A-Za-z0-9_-]{16,}\b/gu,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/gu,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/gu
] as const;
const BARE_TOKEN_PATTERN = new RegExp(
  BARE_TOKEN_PATTERNS.map((pattern) => pattern.source).join("|"),
  "giu"
);

export function redactSecrets(value: unknown): unknown {
  const serialized = safeJsonStringify(value);
  if (serialized !== undefined) {
    const originalBytes = Buffer.byteLength(serialized, "utf8");
    if (originalBytes > MAX_JSON_BYTES) {
      return `[truncated:${originalBytes}]`;
    }
  }

  return redactValue(value, new WeakSet<object>());
}

export function redactSecretString(value: string): string {
  return redactString(value);
}

export function redactHttpBodyText(value: string): string {
  const trimmed = value.trim();
  const parsed = parseJsonObjectOrArray(trimmed);
  if (parsed !== undefined) {
    return JSON.stringify(redactSecrets(parsed));
  }

  return redactString(trimmed);
}

function redactValue(value: unknown, ancestors: WeakSet<object>, key?: string): unknown {
  if (key !== undefined && isSensitiveKey(key)) {
    return REDACTED_SECRET;
  }

  if (typeof value === "string") {
    return redactStringValue(value, key);
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return "[circular]";
    }

    ancestors.add(value);
    const redacted = value.map((item) => redactValue(item, ancestors));
    ancestors.delete(value);
    return redacted;
  }

  if (value !== null && typeof value === "object") {
    if (ancestors.has(value)) {
      return "[circular]";
    }

    ancestors.add(value);
    const redacted: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      Object.defineProperty(redacted, entryKey, {
        configurable: true,
        enumerable: true,
        value: redactValue(entryValue, ancestors, entryKey),
        writable: true
      });
    }
    ancestors.delete(value);
    return redacted;
  }

  return value;
}

function redactStringValue(value: string, key: string | undefined): string {
  if (key !== undefined && isHttpBodyKey(key)) {
    const parsed = parseJsonObjectOrArray(value.trim());
    if (parsed !== undefined) {
      return JSON.stringify(redactSecrets(parsed));
    }
  }

  return redactString(value);
}

function redactString(value: string): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > MAX_STRING_BYTES) {
    return `[truncated:${bytes}]`;
  }

  return value
    .replace(BEARER_TOKEN_PATTERN, `$1${REDACTED_SECRET}`)
    .replace(ASSIGNED_SECRET_PATTERN, redactAssignedSecretValue)
    .replace(BARE_TOKEN_PATTERN, REDACTED_SECRET);
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
  const normalized = normalizeKey(key);
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

function isHttpBodyKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return normalized === "requestbody" || normalized === "responsebody";
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseJsonObjectOrArray(value: string): unknown | undefined {
  if (!value.startsWith("{") && !value.startsWith("[")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isJsonObjectOrArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isJsonObjectOrArray(value: unknown): boolean {
  return Array.isArray(value) || (typeof value === "object" && value !== null);
}

function safeJsonStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
