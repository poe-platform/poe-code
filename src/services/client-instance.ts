import type { FileSystem } from "../utils/file-system.js";
import type { HttpClient } from "../cli/http.js";
import { AuthenticationError } from "../cli/errors.js";
import { loadCredentials } from "./credentials.js";
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
  fs: FileSystem;
  credentialsPath: string;
  baseUrl: string;
  httpClient?: HttpClient;
}): Promise<void> {
  // Don't reinitialize if a client is already set (e.g., in tests)
  if (globalClient !== null) {
    return;
  }

  const apiKey = await loadCredentials({
    fs: options.fs,
    filePath: options.credentialsPath
  });
  if (!apiKey) {
    throw new AuthenticationError(
      "Poe API key not found. Run 'poe-code login' first."
    );
  }

  const client = createPoeClient({
    apiKey,
    baseUrl: options.baseUrl,
    httpClient: options.httpClient
  });

  setGlobalClient(client);
}
