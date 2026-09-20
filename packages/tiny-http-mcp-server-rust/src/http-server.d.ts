import { type IncomingMessage, type ServerResponse } from "node:http";
import { type Server, type ServerOptions, type ToolDefinition, type CallToolResult, type InputRequiredResult, type HandlerRequestContext, type ToolReturn, type TypedSchema, type TypedOutputSchema } from "./stdio-server.js";
import { type AuthenticatedIncomingMessage, type TokenVerifier, type VerifiedAccessToken, type RequestAuthInfo } from "./auth.js";
import { type HttpObservabilityEvent, type StreamableHttpTransportOptions } from "./http-transport.js";
export interface ProtectedResourceMetadataOptions {
    resource: string | URL;
    authorizationServers: readonly (string | URL)[];
    bearerMethodsSupported?: readonly string[];
    scopesSupported?: readonly string[];
}
export interface TinyHttpMcpServerOAuthOptions extends ProtectedResourceMetadataOptions {
    requiredScopes?: readonly string[];
    verifier: TokenVerifier;
}
export type HttpTransportOptions = ServerOptions & StreamableHttpTransportOptions & {
    oauth?: TinyHttpMcpServerOAuthOptions;
    requestHandler?: HttpAdditionalRequestHandler;
};
export type HttpAdditionalRequestHandler = (request: IncomingMessage, response: ServerResponse) => boolean | Promise<boolean>;
export interface HttpListenOptions {
    port?: number;
    hostname?: string;
    path?: string;
    signal?: AbortSignal;
    requestTimeoutMs?: number;
    headersTimeoutMs?: number;
    keepAliveTimeoutMs?: number;
}
export interface HttpServerHandle {
    url: string;
    port: number;
    close(): Promise<void>;
    closeAllConnections(): void;
}
export interface HttpServer extends Omit<Server, "tool" | "registerTool"> {
    tool<TIn, TOut = never>(name: string, description: string, inputSchema: TypedSchema<TIn>, handler: HttpToolHandler<TIn, TOut>, outputSchema?: TypedOutputSchema<TOut>): HttpServer;
    registerTool<TIn, TOut = never>(definition: Omit<ToolDefinition<TIn, TOut>, "handler">, handler: HttpToolHandler<TIn, TOut>): HttpServer;
    listenHttp(options?: HttpListenOptions): Promise<HttpServerHandle>;
    handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
    getRequestContext(): HttpRequestContext | undefined;
}
export interface HttpRequestContext {
    request: AuthenticatedIncomingMessage;
    sessionId?: string;
    auth?: RequestAuthInfo;
}
export interface HttpToolContext extends HttpRequestContext, HandlerRequestContext {
}
export type HttpToolHandler<T = Record<string, unknown>, TOut = ToolReturn> = (args: T, context: HttpToolContext) => Promise<TOut | CallToolResult | InputRequiredResult> | TOut | CallToolResult | InputRequiredResult;
export declare function createProtectedResourceMetadataDocument(options: ProtectedResourceMetadataOptions): Record<string, unknown>;
export declare function createHttpServer(options: HttpTransportOptions): HttpServer;
export type { RequestAuthInfo, TokenVerifier, VerifiedAccessToken };
export type { HttpObservabilityEvent };
