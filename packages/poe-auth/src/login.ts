import { isValidApiKeyFormat } from "./api-key-validation.js";
import { createAuthStore } from "./create-auth-store.js";
import { createOAuthClient } from "./oauth-client.js";

export interface LoginOptions {
  apiKey?: string;
  openBrowser?: (url: string) => Promise<void>;
  readLine?: () => Promise<string>;
}

export async function login(options: LoginOptions = {}): Promise<string> {
  const apiKey = options.apiKey;

  if (typeof apiKey === "string") {
    return await storeApiKey(apiKey);
  }

  const authorization = await createOAuthClient({
    clientId: "client_f520ee4d8ca84a13ba876a8731d264d0",
    authorizationEndpoint: "https://poe.com/oauth/authorize",
    tokenEndpoint: "https://api.poe.com/token",
    openBrowser: options.openBrowser,
    readLine: options.readLine
  }).authorize();
  const result = await authorization.waitForResult();

  return await storeApiKey(result.apiKey);
}

async function storeApiKey(apiKey: string): Promise<string> {
  if (!isValidApiKeyFormat(apiKey)) {
    throw new Error("POE API key format is invalid.");
  }

  await createAuthStore().store.setApiKey(apiKey);

  return apiKey;
}
