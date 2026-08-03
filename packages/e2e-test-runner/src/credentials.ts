import { createSecretStore } from "auth-store";

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
    return envKey;
  }

  try {
    const currentKey = await readStoredApiKey('credentials.poe.enc');
    if (currentKey) {
      return currentKey;
    }
    return await readStoredApiKey('credentials.enc');
  } catch {
    return null;
  }
}

async function readStoredApiKey(defaultFileName: string): Promise<string | null> {
  const { store } = createSecretStore({
      backendEnvVar: "POE_AUTH_BACKEND",
      env: process.env,
      platform: process.platform,
      fileStore: {
        salt: "poe-code:encrypted-file-auth-store:v1",
        defaultDirectory: ".poe-code",
        defaultFileName
      }
    });
  return normalizeApiKey((await store.get()) ?? undefined);
}

export async function hasApiKey(): Promise<boolean> {
  return (await getApiKey()) !== null;
}
