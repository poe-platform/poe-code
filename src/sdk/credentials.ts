import { createSecretStore } from "auth-store";

/**
 * Reads the Poe API key with the following priority:
 * 1. `POE_API_KEY` environment variable (if set)
 * 2. Auth store (`auth-store`)
 *
 * @returns The API key
 * @throws Error if no credentials found
 */
export async function getPoeApiKey(): Promise<string> {
  const envKey = process.env.POE_API_KEY;
  if (typeof envKey === "string" && envKey.trim().length > 0) {
    return envKey.trim();
  }

  const { store } = createSecretStore({
    backendEnvVar: "POE_AUTH_BACKEND",
    fileStore: {
      salt: "poe-code:encrypted-file-auth-store:v1",
      defaultDirectory: ".poe-code",
      defaultFileName: "credentials.enc"
    }
  });
  const storedKey = await store.get();

  if (typeof storedKey === "string" && storedKey.trim().length > 0) {
    return storedKey.trim();
  }

  throw new Error("No API key found. Set POE_API_KEY or run 'poe-code login'.");
}

export async function ensurePoeApiKeyEnv(): Promise<void> {
  const envKey = process.env.POE_API_KEY;
  if (typeof envKey === "string" && envKey.trim().length > 0) {
    return;
  }

  process.env.POE_API_KEY = await getPoeApiKey();
}
