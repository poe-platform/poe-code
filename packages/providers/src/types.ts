import type { ApiShapeId } from "@poe-code/agent-defs";

export type { ApiShapeId } from "@poe-code/agent-defs";

export type EnvValueSource =
  | { kind: "literal"; value: string }
  | { kind: "providerCredential"; prefix?: string }
  | { kind: "providerBaseUrl" }
  | { kind: "providerField"; path: string };

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

export function defineProvider(provider: AuthProvider): AuthProvider {
  if (provider.auth.kind === "api-key") {
    Object.freeze(provider.auth.prompt);
  }
  Object.freeze(provider.auth);
  for (const shape of provider.apiShapes ?? []) {
    Object.freeze(shape);
  }
  if (provider.apiShapes !== undefined) {
    Object.freeze(provider.apiShapes);
  }
  if (provider.modelInput !== undefined) {
    Object.freeze(provider.modelInput);
  }
  for (const source of Object.values(provider.env ?? {})) {
    Object.freeze(source);
  }
  if (provider.env !== undefined) {
    Object.freeze(provider.env);
  }
  return Object.freeze(provider);
}
