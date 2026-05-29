import { createSecretStore } from "auth-store";

export async function resolveOpenaiApiKey(explicit: string | undefined): Promise<string> {
  const normalizedExplicitApiKey = toNonEmptyString(explicit);
  if (normalizedExplicitApiKey) {
    return normalizedExplicitApiKey;
  }

  const environmentApiKey = toNonEmptyString(process.env.POE_API_KEY);
  if (environmentApiKey) {
    return environmentApiKey;
  }

  const { store } = createSecretStore({
    backendEnvVar: "POE_AUTH_BACKEND",
    fileStore: {
      salt: "poe-code:encrypted-file-auth-store:v1",
      defaultDirectory: ".poe-code",
      defaultFileName: "credentials.enc"
    }
  });
  const storedApiKey = toNonEmptyString(await store.get());
  if (storedApiKey) {
    return storedApiKey;
  }

  throw new Error("Missing Poe API key. Provide apiKey or run 'poe-code login'.");
}

function toNonEmptyString(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
