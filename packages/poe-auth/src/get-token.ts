import { createAuthStore } from "./create-auth-store.js";

export async function getToken(): Promise<string | null> {
  return await createAuthStore().store.getApiKey();
}
