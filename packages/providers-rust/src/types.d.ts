import type { ApiShapeId } from "./agent-types.js";
export type { ApiShapeId } from "./agent-types.js";
export type EnvValueSource =
  | {
      kind: "literal";
      value: string;
    }
  | {
      kind: "providerCredential";
      prefix?: string;
    }
  | {
      kind: "providerBaseUrl";
    }
  | {
      kind: "providerField";
      path: string;
    };
export interface ApiKeyPrompt {
  title: string;
  placeholder?: string;
}
export interface ApiKeyAuth {
  kind: "api-key";
  envVar: string;
  storageKey: string;
  prompt: ApiKeyPrompt;
  preferredLogin?: "oauth";
}
export interface OAuthAuth {
  kind: "oauth";
}
export type AuthMethod = ApiKeyAuth | OAuthAuth;
export interface ApiShapeBinding {
  readonly id: ApiShapeId;
  readonly baseUrlPath?: string;
  readonly envBaseUrlPath?: string;
  readonly defaultBaseUrl?: string;
}
export interface ProviderModelInput {
  readonly kind: "freeform";
}
export interface AuthProvider {
  readonly id: string;
  readonly label: string;
  readonly summary?: string;
  readonly baseUrl?: string;
  readonly agentBaseUrl?: string;
  readonly baseUrlEnvVar?: string;
  readonly baseUrlEnvPath?: string;
  readonly agentBaseUrlPath?: string;
  readonly requiresBaseUrl?: boolean;
  readonly modelInput?: ProviderModelInput;
  readonly auth: AuthMethod;
  readonly apiShapes?: readonly ApiShapeBinding[];
  readonly env?: Readonly<Record<string, EnvValueSource>>;
}
export declare function defineProvider(provider: AuthProvider): AuthProvider;
