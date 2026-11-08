import { ApiError } from "../cli/errors.js";
import type { HttpClient } from "../cli/http.js";

export interface CheckPoeAuthOptions {
  apiKey: string;
  baseUrl: string;
  httpClient: HttpClient;
}

export async function checkPoeAuth(options: CheckPoeAuthOptions): Promise<void> {
  const response = await options.httpClient(createCurrentBalanceUrl(options.baseUrl), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${options.apiKey}`
    }
  });

  if (!response.ok) {
    throw new ApiError(`Failed to check authentication (HTTP ${response.status})`, {
      httpStatus: response.status,
      endpoint: "/usage/current_balance"
    });
  }
}

function createCurrentBalanceUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${path}/usage/current_balance`;
  return url.toString();
}
