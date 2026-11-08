import type { ApiShapeId, AuthProvider } from "./types.js";
import type { SecretStore } from "./auth-store-types.js";
import type { ApiKeyLoginOptions } from "./api-key.js";
import type { PromptForSecret } from "./auth-types.js";
export interface LoginContext {
  promptForSecret?: PromptForSecret;
  envVars?: Record<string, string | undefined>;
  store?: SecretStore;
  resolvePreferredLogin?: (input: {
    provider: AuthProvider;
    apiKey?: string;
    envValue?: string;
  }) => Promise<string>;
}
export type ProviderStoreFactory = (provider: AuthProvider) => SecretStore;
export interface ProviderRegistryOptions {
  envVars?: Record<string, string | undefined>;
}
export interface ProviderAgent {
  id: string;
  apiShapes?: readonly ApiShapeId[];
}
export declare class ProviderRegistry {
  private readonly providers;
  private readonly byId;
  private readonly storeFactory?;
  private readonly envVars;
  constructor(
    providers: readonly AuthProvider[],
    storeFactory?: ProviderStoreFactory,
    options?: ProviderRegistryOptions
  );
  list(): readonly AuthProvider[];
  get(id: string): AuthProvider | undefined;
  forAgent(agent: ProviderAgent): readonly AuthProvider[];
  isLoggedIn(
    id: string,
    options?: {
      readOnly?: boolean;
    }
  ): Promise<boolean>;
  login(id: string, options: ApiKeyLoginOptions, context?: LoginContext): Promise<void>;
  resolveCredential(
    id: string,
    options?: ApiKeyLoginOptions,
    context?: Pick<LoginContext, "envVars"> & {
      readOnly?: boolean;
    }
  ): Promise<string>;
  logout(
    id: string,
    options?: {
      store?: SecretStore;
    }
  ): Promise<void>;
  private requireProvider;
  private requireStore;
}
