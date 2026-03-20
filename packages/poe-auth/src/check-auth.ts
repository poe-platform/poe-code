import { createAuthStore } from "./create-auth-store.js";

export interface AuthIdentity {
  email: string;
  balance: number | null;
}

interface CheckAuthOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

interface CurrentBalanceResponse {
  email?: unknown;
  current_point_balance?: unknown;
}

const DEFAULT_BASE_URL = "https://poe.com";

export async function checkAuth(options: CheckAuthOptions = {}): Promise<AuthIdentity | null> {
  try {
    const apiKey = options.apiKey ?? (await createAuthStore().store.getApiKey());

    if (!apiKey) {
      return null;
    }

    const fetchImplementation = options.fetch ?? globalThis.fetch;

    const response = await fetchImplementation(
      createCurrentBalanceUrl(options.baseUrl ?? DEFAULT_BASE_URL),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as CurrentBalanceResponse;

    if (typeof data.email !== "string" || data.email.length === 0) {
      return null;
    }

    return {
      email: data.email,
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
