export interface JwksTokenVerifierOptions {
  jwksUrl: string | URL;
  clockSkewSeconds?: number;
  allowedAlgorithms?: readonly string[];
  jwksCacheTtlMs?: number;
  jwksFetchTimeoutMs?: number;
  jwksRefreshCooldownMs?: number;
  allowInsecureJwks?: boolean;
  requireAccessTokenType?: boolean;
  fetch?: typeof fetch;
}
export interface JwksVerifiedAccessToken {
  token: string;
  issuer: string;
  audience: string[];
  scopes: string[];
  expiresAt: number;
  claims: Record<string, unknown>;
  subject?: string;
  clientId?: string;
}
export interface JwksTokenVerifier {
  verify(input: { token: string; resource: string; authorizationServers: readonly string[]; requiredScopes: readonly string[] }): Promise<JwksVerifiedAccessToken>;
}
export declare function createJwksTokenVerifier(options: JwksTokenVerifierOptions): JwksTokenVerifier;
