interface ObjectRecord{[key:string]:unknown}
export interface OAuthTestStaticClient {
    clientId: string;
    redirectUris: string[];
    scopes?: string[];
}
export interface OAuthTestServerOptions {
    issuer?: string;
    signingKey?: string | ObjectRecord;
    signingKeySeed?: string;
    clockSkewSeconds?: number;
    defaultTokenTtlSeconds?: number;
    requireDcr?: boolean;
    staticClients?: OAuthTestStaticClient[];
    defaultAuthorization?: {
        autoApprove?: boolean;
        scopes?: string[];
    };
}
export interface OAuthTestServerListenOptions {
    port?: number;
    hostname?: string;
}
export interface OAuthTestServerListeningHandle {
    url: string;
    port: number;
    close(): Promise<void>;
}
export interface OAuthTestServerRequest {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
}
export interface DirectTokenIssueOptions {
    clientId: string;
    resource: string;
    scopes: string[];
    ttlSeconds?: number;
}
export interface NextAuthorizationOptions {
    autoApprove: boolean;
    scopes?: string[];
}
export interface OAuthTestServer {
    readonly issuer: string;
    readonly requestLog: readonly OAuthTestServerRequest[];
    listen(options?: OAuthTestServerListenOptions): Promise<OAuthTestServerListeningHandle>;
    issueTokenFor(options: DirectTokenIssueOptions): Promise<string>;
    setNextAuthorization(options: NextAuthorizationOptions): void;
    isTokenRevoked(token: string): boolean;
    revoke(token: string): void;
}
export declare function createOAuthTestServer(options?:OAuthTestServerOptions):OAuthTestServer;
