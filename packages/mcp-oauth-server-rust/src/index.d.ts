export interface OAuthClientRecord { id: string; redirectUris: readonly string[]; createdAt: number; }
export interface AuthorizationTransactionRecord {
  id: string; clientId: string; redirectUri: string; codeChallenge: string;
  resource: string; scopes: readonly string[]; state?: string; createdAt: number; expiresAt: number;
}
export interface AuthorizationCodeRecord {
  tokenHash: string; grantId: string; clientId: string; subject: string;
  redirectUri: string; codeChallenge: string; resource: string; scopes: readonly string[]; expiresAt: number;
}
export interface AuthorizationGrantRecord {
  id: string; clientId: string; subject: string; resource: string;
  scopes: readonly string[]; createdAt: number; revokedAt?: number;
}
export interface RefreshTokenRecord {
  tokenHash: string; familyId: string; grantId: string; clientId: string;
  subject: string; resource: string; scopes: readonly string[];
  createdAt: number; expiresAt: number; status: "active" | "rotated" | "revoked";
}
export interface AccessTokenRecord {
  tokenHash: string; tokenId: string; grantId: string; subject: string;
  clientId: string; resource: string; expiresAt: number; revokedAt?: number;
}
export type RefreshTokenRotationResult =
  | { status: "rotated"; previous: RefreshTokenRecord }
  | { status: "replay"; grant?: AuthorizationGrantRecord }
  | { status: "invalid" };
export interface AuthorizationServerStore {
  putClient(client: OAuthClientRecord): Promise<void>;
  getClient(clientId: string): Promise<OAuthClientRecord | undefined>;
  putAuthorizationTransaction(transaction: AuthorizationTransactionRecord): Promise<void>;
  takeAuthorizationTransaction(transactionId: string): Promise<AuthorizationTransactionRecord | undefined>;
  putAuthorizationCode(code: AuthorizationCodeRecord): Promise<void>;
  takeAuthorizationCode(tokenHash: string): Promise<AuthorizationCodeRecord | undefined>;
  putGrant(grant: AuthorizationGrantRecord): Promise<void>;
  getGrant(grantId: string): Promise<AuthorizationGrantRecord | undefined>;
  putAccessToken(token: AccessTokenRecord): Promise<void>;
  getAccessToken(tokenHash: string): Promise<AccessTokenRecord | undefined>;
  putRefreshToken(token: RefreshTokenRecord): Promise<void>;
  rotateRefreshToken(tokenHash: string, replacementTokenHash: string, now: number, expiresAt: number): Promise<RefreshTokenRotationResult>;
  revokeToken(tokenHash: string, now: number): Promise<void | AuthorizationGrantRecord>;
  revokeGrant(grantId: string, now: number): Promise<void>;
}
export interface AuthorizationInteractionSecurity {
  csrfToken: string; state: string; nonce: string; setCookie: string;
}
export interface AuthorizationInteractionSecurityOptions {
  cookieName?: string; maxAgeSeconds?: number; randomToken?: () => string;
}
export interface VerifyAuthorizationInteractionCsrfInput {
  cookieHeader: string | null; submittedToken: string; cookieName?: string;
}
export declare function createInMemoryAuthorizationServerStore(): AuthorizationServerStore;
export declare function createAuthorizationInteractionSecurity(options?: AuthorizationInteractionSecurityOptions): AuthorizationInteractionSecurity;
export declare function verifyAuthorizationInteractionCsrf(input: VerifyAuthorizationInteractionCsrfInput): boolean;
export interface OAuthJsonWebKey {
  kty?: string; alg?: string; key_ops?: string[]; ext?: boolean; use?: string;
  x5c?: string[]; x5t?: string; "x5t#S256"?: string; x5u?: string; kid?: string;
  crv?: string; d?: string; dp?: string; dq?: string; e?: string; k?: string;
  n?: string; p?: string; q?: string; qi?: string; x?: string; y?: string;
}
export interface AuthorizationInteractionStartContext { request: Request; transaction: AuthorizationTransactionRecord; }
export interface AuthorizationInteraction { start(context: AuthorizationInteractionStartContext): Promise<Response> | Response; }
export interface OAuthAuthorizationServerSigningKey {
  algorithm: "ES256" | "RS256"; keyId: string;
  privateKey: import("node:crypto").KeyObject; publicJwk: OAuthJsonWebKey;
}
export interface OAuthAuthorizationServerOptions {
  issuer: string; resources: readonly string[];
  scopesSupported?: readonly string[]; defaultScopes?: readonly string[];
  signingKey: OAuthAuthorizationServerSigningKey; additionalPublicJwks?: readonly OAuthJsonWebKey[];
  store: AuthorizationServerStore; interaction: AuthorizationInteraction;
  accessTokenTtlSeconds?: number; authorizationCodeTtlSeconds?: number;
  authorizationTransactionTtlSeconds?: number; refreshTokenTtlSeconds?: number;
  maxRequestBodyBytes?: number; now?: () => number; randomToken?: () => string;
  onGrantRevoked?(grant: AuthorizationGrantRecord): Promise<void> | void;
}
export interface CompleteAuthorizationInput { transactionId: string; subject: string; scopes?: readonly string[]; }
export interface CompleteAuthorizationResult { redirectUrl: URL; grantId: string; }
export interface VerifiedAuthorizationServerToken {
  subject: string; clientId: string; resource: string; scopes: readonly string[];
  tokenId: string; expiresAt: number;
}
export interface OAuthAuthorizationServer {
  issuer: string;
  handle(request: Request): Promise<Response>;
  completeAuthorization(input: CompleteAuthorizationInput): Promise<CompleteAuthorizationResult>;
  denyAuthorization(transactionId: string, error?: string): Promise<URL>;
  revokeGrant(grantId: string): Promise<void>;
  verifyAccessToken(token: string, resource: string): Promise<VerifiedAuthorizationServerToken>;
}
export declare function createOAuthAuthorizationServer(options: OAuthAuthorizationServerOptions): OAuthAuthorizationServer;
