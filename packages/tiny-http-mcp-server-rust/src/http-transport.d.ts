import { type IncomingMessage, type ServerResponse } from "node:http";
import type { Server } from "./stdio-server.js";
import { type SessionStore } from "./session.js";
export type HttpObservabilityEvent = {
    type: "request.start";
    requestId: string;
    method: string;
    path: string;
    sessionId?: string;
} | {
    type: "request.end";
    requestId: string;
    method: string;
    statusCode: number;
    durationMs: number;
    sessionId?: string;
    reason?: string;
} | {
    type: "request.error";
    requestId: string;
    method: string;
    durationMs: number;
    error: unknown;
    sessionId?: string;
} | {
    type: "auth.failure";
    statusCode: number;
    challenge?: string;
    sessionId?: string;
} | {
    type: "session.created";
    sessionId: string;
} | {
    type: "session.deleted";
    sessionId: string;
    reason: "client" | "expired" | "closed";
} | {
    type: "stream.opened";
    sessionId: string;
    streamCount: number;
} | {
    type: "stream.closed";
    sessionId: string;
    streamCount: number;
} | {
    type: "tool.start";
    requestId: string;
    sessionId?: string;
    toolName?: string;
} | {
    type: "tool.end";
    requestId: string;
    sessionId?: string;
    toolName?: string;
    ok: boolean;
    durationMs: number;
};
export interface HttpObservabilityOptions {
    onEvent?(event: HttpObservabilityEvent): void;
}
export interface StreamableHttpTransportOptions {
    sessionIdGenerator?: (() => string) | undefined;
    enableJsonResponse?: boolean;
    allowedOrigins?: readonly string[];
    allowedHosts?: readonly string[];
    maxRequestBytes?: number;
    maxResponseBytes?: number;
    maxBatchSize?: number;
    maxSessions?: number;
    /** Maximum sessions per authenticated subject or client ID; defaults to 16. */
    maxSessionsPerSubject?: number;
    sessionTtlMs?: number;
    maxStreamsPerSession?: number;
    maxStreamBufferBytes?: number;
    maxSseEventHistory?: number;
    sseKeepAliveMs?: number;
    maxConcurrentToolCalls?: number;
    sessionStore?: SessionStore;
    requestIdGenerator?: () => string;
    observability?: HttpObservabilityOptions;
    trustedProxy?: boolean;
}
type RequestContextRunner = <T>(req: IncomingMessage, callback: () => Promise<T>) => Promise<T>;
export declare class StreamableHttpTransport {
    constructor(server:Server,options?:StreamableHttpTransportOptions,runWithRequestContext?:RequestContextRunner);
    handleRequest(req:IncomingMessage,res:ServerResponse):Promise<void>;
    close():Promise<void>;
}
export {};
