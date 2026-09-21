import { native } from "./native.js";
import { createCredentialStoreBindings } from "./client/oauth/auth-store-runtime.js";
export const { createSecretStore } = createCredentialStoreBindings(native);
