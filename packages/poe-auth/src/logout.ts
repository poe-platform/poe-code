import { createAuthStore } from "./create-auth-store.js";

export async function logout(): Promise<void> {
  await createAuthStore().store.deleteApiKey();
}
