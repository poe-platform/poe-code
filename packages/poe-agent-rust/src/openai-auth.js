import { createSecretStore } from "./openai-auth-store.js";
export async function resolveOpenaiApiKey(explicit) {
  const explicitKey = typeof explicit === "string" ? explicit.trim() : undefined;
  if (explicitKey) return explicitKey;
  const environmentKey = process.env.POE_API_KEY?.trim();
  if (environmentKey) return environmentKey;
  const { store } = createSecretStore({
    backendEnvVar: "POE_AUTH_BACKEND",
    fileStore: {
      salt: "poe-code:encrypted-file-auth-store:v1",
      defaultDirectory: ".poe-code",
      defaultFileName: "credentials.enc"
    }
  });
  const key = (await store.get())?.trim();
  if (key) return key;
  throw new Error("Missing Poe API key. Provide apiKey or run 'poe-code login'.");
}
