import type { SecretStore } from "auth-store";
import type { ApiKeyPrompt, AuthProvider } from "../types.js";

export type PromptForSecret = (prompt: ApiKeyPrompt) => Promise<string | undefined>;

export interface AuthStrategyContext {
  secretStore: SecretStore;
  promptForSecret?: PromptForSecret;
  readOnly?: boolean;
}

export interface AuthStrategy<TLoginOptions> {
  login(
    provider: AuthProvider,
    options: TLoginOptions,
    context: AuthStrategyContext
  ): Promise<string>;
  logout(provider: AuthProvider, context: AuthStrategyContext): Promise<void>;
  isLoggedIn(provider: AuthProvider, context: AuthStrategyContext): Promise<boolean>;
  resolveCredential(
    provider: AuthProvider,
    context: AuthStrategyContext
  ): Promise<string>;
}
