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

    const data = (await response.json()) as CurrentBalanceResponse;

    return {
      email: typeof data.email === "string" && data.email.length > 0 ? data.email : null,
      balance: typeof data.current_point_balance === "number" ? data.current_point_balance : null
    };
  } catch {
    return null;
  }
}

function createCurrentBalanceUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

  return `${normalizedBaseUrl}/usage/current_balance`;
}
