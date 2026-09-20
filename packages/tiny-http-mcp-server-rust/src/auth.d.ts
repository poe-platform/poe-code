import type { IncomingMessage } from "node:http";
export declare const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";
export declare const PROTECTED_RESOURCE_METADATA_CACHE_CONTROL = "public, max-age=300";
export interface VerifiedAccessToken {
    token: string;
    issuer: string;
    audience: readonly string[];
    scopes: readonly string[];
    expiresAt: number;
    claims: Record<string, unknown>;
    subject?: string;
    clientId?: string;
}
export interface TokenVerifier {
    verify(input: {
        token: string;
        resource: string;
        authorizationServers: readonly string[];
        requiredScopes: readonly string[];
    }): Promise<VerifiedAccessToken>;
}
export type BearerChallengeErrorCode = "invalid_token" | "insufficient_scope";
export interface BearerChallengeOptions {
    error?: BearerChallengeErrorCode;
    errorDescription?: string;
    scope?: readonly string[];
}
export declare class TokenVerificationError extends Error {
    readonly error: BearerChallengeErrorCode;
    readonly errorDescription?: string;
    readonly scope?: readonly string[];
    constructor(input: {
        error: BearerChallengeErrorCode;
        errorDescription?: string;
        scope?: readonly string[];
    });
}
export interface RequestAuthInfo extends VerifiedAccessToken {
    audience: string[];
    clientId: string;
    scopes: string[];
    resource: URL;
    extra: Record<string, unknown>;
}
export type AuthenticatedIncomingMessage = IncomingMessage & {
    auth?: RequestAuthInfo;
};
export interface BearerAuthOptions {
    resource: string | URL;
    authorizationServers: readonly (string | URL)[];
    protectedResourcePath?: string;
    requiredScopes?: readonly string[];
    trustedProxy?: boolean;
    verifier: TokenVerifier;
}
export type BearerAuthResult = {
    ok: true;
    auth: RequestAuthInfo;
} | {
    ok: false;
    statusCode: 401 | 403;
    challenge: string;
} | {
    ok: false;
    statusCode: 503;
};
export declare function getProtectedResourceMetadataUrl(req: Pick<IncomingMessage, "headers" | "socket">, protectedResourcePath?: string, trustedProxy?: boolean): string;
export declare function createBearerChallenge(req: Pick<IncomingMessage, "headers" | "socket">, options?: BearerChallengeOptions, protectedResourcePath?: string, trustedProxy?: boolean): string;
export declare function authorizeBearerRequest(req: AuthenticatedIncomingMessage, options: BearerAuthOptions): Promise<BearerAuthResult>;
