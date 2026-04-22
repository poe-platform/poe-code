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
}

export interface OAuthAuth {
  kind: "oauth";
}

export type AuthMethod = ApiKeyAuth | OAuthAuth;

export interface AuthProvider {
  readonly id: string;
  readonly label: string;
  readonly summary?: string;
  readonly baseUrl: string;
  readonly auth: AuthMethod;
  readonly supportsAgents: readonly string[];
  readonly env?: Readonly<Record<string, EnvValueSource>>;
}
