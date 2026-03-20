import { createAuthStore } from "@poe-code/poe-auth";

/**
 * Reads the Poe API key with the following priority:
 * 1. `POE_API_KEY` environment variable (if set)
 * 2. Auth store (`@poe-code/poe-auth`)
 *
 * @returns The API key
 * @throws Error if no credentials found
 */
export async function getPoeApiKey(): Promise<string> {
  const envKey = process.env.POE_API_KEY;
  if (typeof envKey === "string" && envKey.trim().length > 0) {
    return envKey.trim();
  }

  const { store } = createAuthStore();
  const storedKey = await store.getApiKey();

  if (typeof storedKey === "string" && storedKey.trim().length > 0) {
    return storedKey.trim();
  }

  throw new Error("No API key found. Set POE_API_KEY or run 'poe-code login'.");
}
