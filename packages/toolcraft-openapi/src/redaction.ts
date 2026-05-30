const SENSITIVE_QUERY_KEYS = new Set([
  "apikey",
  "accesstoken",
  "authtoken",
  "clientsecret",
  "key",
  "password",
  "secret",
  "sig",
  "signature",
  "token"
]);

const SENSITIVE_HEADER_NAMES = new Set(["cookie", "proxy-authorization", "set-cookie"]);

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, redactHeaderValue(key, value)])
  );
}

export function redactHeaderValue(key: string, value: string): string {
  const normalizedKey = key.toLowerCase();

  if (normalizedKey === "authorization") {
    return value.startsWith("Bearer ") ? "Bearer ****" : "****";
  }

  if (SENSITIVE_HEADER_NAMES.has(normalizedKey)) {
    return "****";
  }

  return value;
}

export function redactSensitiveQueryValues(url: string): string {
  const redactedUrl = new URL(url);

  for (const key of redactedUrl.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEYS.has(normalizeQueryKey(key))) {
      redactedUrl.searchParams.set(key, "****");
    }
  }

  return redactedUrl.toString();
}

function normalizeQueryKey(key: string): string {
  return key.toLowerCase().replaceAll("_", "").replaceAll("-", "");
}
