import type { AuthStrategy } from "./auth-types.js";
export interface ApiKeyLoginOptions {
  apiKey?: string;
}
export declare const apiKeyAuthStrategy: AuthStrategy<ApiKeyLoginOptions>;
