import type { HttpClient } from "../cli/http.js";
import { createPoeClient } from "./llm-client.js";
import type { LlmClient } from "./llm-client.js";

let globalClient: LlmClient | null = null;

export function setGlobalClient(client: LlmClient): void {
  globalClient = client;
}

export function getGlobalClient(): LlmClient {
  if (!globalClient) {
    throw new Error("LLM client not initialized. Call setGlobalClient() first.");
  }
  return globalClient;
}

export function hasGlobalClient(): boolean {
  return globalClient !== null;
}

export async function initializeClient(options: {
  apiKey: string;
  baseUrl: string;
  httpClient?: HttpClient;
}): Promise<void> {
  if (globalClient !== null) {
    return;
  }

  const client = createPoeClient({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    httpClient: options.httpClient
  });

  setGlobalClient(client);
}
