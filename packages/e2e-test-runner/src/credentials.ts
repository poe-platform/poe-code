import { createSecretStore } from "auth-store";

let cachedApiKey: string | null = null;

function normalizeApiKey(key: string | undefined): string | null {
  if (typeof key !== "string") {
    return null;
  }
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getApiKey(): Promise<string | null> {
  const envKey = normalizeApiKey(process.env.POE_API_KEY);
  if (envKey) {
    cachedApiKey = envKey;
    return envKey;
  }

  if (cachedApiKey) {
    return cachedApiKey;
  }

  try {
    const { store } = createSecretStore({
      backendEnvVar: "POE_AUTH_BACKEND",
      env: process.env,
      platform: process.platform,
      fileStore: {
        salt: "poe-code:encrypted-file-auth-store:v1",
        defaultDirectory: ".poe-code",
        defaultFileName: "credentials.enc"
      }
    });
    const storedKey = await store.get();
    cachedApiKey = normalizeApiKey(storedKey ?? undefined);
    return cachedApiKey;
  } catch {
    return null;
  }
}

export async function hasApiKey(): Promise<boolean> {
  return (await getApiKey()) !== null;
}
