import type { ApiShapeId } from "@poe-code/agent-defs";

export type { ApiShapeId } from "@poe-code/agent-defs";

export type EnvValueSource =
  | { kind: "literal"; value: string }
  | { kind: "providerCredential" }
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
  readonly defaultBaseUrl?: string;
}

export interface AuthProvider {
  readonly id: string;
  readonly label: string;
  readonly summary?: string;
  readonly baseUrl: string;
  readonly requiresBaseUrl?: boolean;
  readonly auth: AuthMethod;
  readonly apiShapes?: readonly ApiShapeBinding[];
  readonly env?: Readonly<Record<string, EnvValueSource>>;
}
