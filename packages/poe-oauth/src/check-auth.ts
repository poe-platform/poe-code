export interface AuthIdentity {
  email: string | null;
  balance: number | null;
}

export interface CheckAuthOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

interface CurrentBalanceResponse {
  email?: unknown;
  current_point_balance?: unknown;
}

const DEFAULT_BASE_URL = "https://api.poe.com";

export async function checkAuth(options: CheckAuthOptions): Promise<AuthIdentity | null> {
  try {
    const fetchImplementation = options.fetch ?? globalThis.fetch;

    const response = await fetchImplementation(
      createCurrentBalanceUrl(options.baseUrl ?? DEFAULT_BASE_URL),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${options.apiKey}`
        }
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as unknown;
    if (!isCurrentBalanceResponse(data)) {
      return null;
    }

    return {
      email: getOwnString(data, "email") ?? null,
      balance: getOwnNumber(data, "current_point_balance") ?? null
    };
  } catch {
    return null;
  }
}

function createCurrentBalanceUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${path}/usage/current_balance`;
  return url.toString();
}

function isCurrentBalanceResponse(value: unknown): value is CurrentBalanceResponse {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const data = value as Record<string, unknown>;
  const email = getOwnString(data, "email");
  const balance = getOwnEntry(data, "current_point_balance");
  const hasEmail = email !== undefined;
  const hasBalance = balance !== undefined;
  if (!hasEmail && !hasBalance) {
    return false;
  }

  return (
    balance === undefined ||
    balance === null ||
    (typeof balance === "number" && Number.isFinite(balance) && balance >= 0)
  );
}

function getOwnEntry(record: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? (record as Record<string, unknown>)[key]
    : undefined;
}

function getOwnString(record: object, key: string): string | undefined {
  const value = getOwnEntry(record, key);
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getOwnNumber(record: object, key: string): number | undefined {
  const value = getOwnEntry(record, key);
  return typeof value === "number" ? value : undefined;
}
