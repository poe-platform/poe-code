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

    const data = await response.json() as unknown;
    if (!isCurrentBalanceResponse(data)) {
      return null;
    }

    return {
      email: typeof data.email === "string" && data.email.length > 0 ? data.email : null,
      balance: typeof data.current_point_balance === "number" ? data.current_point_balance : null
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

  const data = value as CurrentBalanceResponse;
  const hasEmail = typeof data.email === "string" && data.email.length > 0;
  const hasBalance = data.current_point_balance !== undefined;
  if (!hasEmail && !hasBalance) {
    return false;
  }

  return data.current_point_balance === undefined
    || data.current_point_balance === null
    || (typeof data.current_point_balance === "number" && Number.isFinite(data.current_point_balance));
}
