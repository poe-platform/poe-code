import { createAuthStore } from '@poe-code/auth';

function normalizeApiKey(key: string | undefined): string | null {
  if (typeof key !== 'string') {
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
    const { store } = createAuthStore({
      env: process.env,
      platform: process.platform
    });
    const storedKey = await store.getApiKey();
    return normalizeApiKey(storedKey ?? undefined);
  } catch {
    return null;
  }
}

export async function hasApiKey(): Promise<boolean> {
  return (await getApiKey()) !== null;
}
