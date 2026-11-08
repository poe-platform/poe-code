import { type OAuthTestStaticClient, type OAuthTestServer } from "./oauth/index.js";
export interface McpOAuthTestServerOptions {
    mcpPath?: string;
    issuer?: string;
    resource?: string;
    ttlSeconds?: number;
    autoApprove?: boolean;
    scopes?: string[];
    staticClients?: OAuthTestStaticClient[];
}
export interface McpOAuthTestServerListenOptions {
    port?: number;
    hostname?: string;
}
export interface McpOAuthTestServerHandle {
    url: string;
    mcpUrl: string;
    prmUrl: string;
    resource: string;
    oauth: OAuthTestServer;
    close(): Promise<void>;
}
export interface McpOAuthTestServer {
    listen(options?: McpOAuthTestServerListenOptions): Promise<McpOAuthTestServerHandle>;
}
export declare function createMcpOAuthTestServer(options?: McpOAuthTestServerOptions): McpOAuthTestServer;
