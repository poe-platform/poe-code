const REDACTED_VALUE = "<redacted>";
const SENSITIVE_NAME_PARTS = ["password", "token", "apikey", "secret"];
const AUTHORIZATION_HEADER_NAMES = new Set(["authorization", "proxyauthorization"]);
const SECRET_HEADER_NAMES = new Set(["cookie", "setcookie"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSensitiveName(name: string): boolean {
  const normalized = normalizeName(name);
  return SENSITIVE_NAME_PARTS.some((candidate) => normalized.includes(candidate));
}

function redactSecretLikeFieldsValue(
  value: unknown,
  name: string,
  seen: WeakSet<object>
): unknown {
  if (name.length > 0 && isSensitiveName(name)) {
    return REDACTED_VALUE;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    return value.map((entry) => redactSecretLikeFieldsValue(entry, name, seen));
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactSecretLikeFieldsValue(entry, key, seen)
      ])
    );
  }

  return value;
}

export function redactSecretLikeFields(value: unknown, name = ""): unknown {
  return redactSecretLikeFieldsValue(value, name, new WeakSet<object>());
}

function parseJsonObjectOrArray(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isPlainObject(parsed) || Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function redactHttpBody(body: unknown): unknown {
  if (typeof body === "string") {
    const parsed = parseJsonObjectOrArray(body);
    return parsed === undefined ? body : redactSecretLikeFields(parsed);
  }

  return redactSecretLikeFields(body);
}

export function redactHttpHeaderValue(name: string, value: string): string {
  const normalized = normalizeName(name);

  if (AUTHORIZATION_HEADER_NAMES.has(normalized)) {
    return "Bearer ****";
  }

  if (SECRET_HEADER_NAMES.has(normalized) || isSensitiveName(name)) {
    return REDACTED_VALUE;
  }

  return value;
}
