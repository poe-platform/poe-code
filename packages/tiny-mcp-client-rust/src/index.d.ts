export type RequestId = string | number;
export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: RequestId;
  method: string;
  params?: unknown;
}
export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}
export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: RequestId;
  result: unknown;
}
export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: RequestId;
  error: JsonRpcErrorObject;
}
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;
export type ParsedJsonRpcMessage =
  | { type: "request"; message: JsonRpcRequest }
  | { type: "notification"; message: JsonRpcNotification }
  | { type: "response"; message: JsonRpcResponse }
  | { type: "invalid"; id: RequestId | null; error: McpError };
export declare class McpError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown);
}
export declare function parseJsonRpcMessage(line: string): ParsedJsonRpcMessage;
export declare const ERROR_PARSE: -32700;
export declare const ERROR_INVALID_REQUEST: -32600;
export declare const ERROR_METHOD_NOT_FOUND: -32601;
export declare const ERROR_INVALID_PARAMS: -32602;
export declare const ERROR_INTERNAL: -32603;

export interface JsonRpcRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number | null;
  onRequestId?: (id: RequestId) => void;
  onTimeout?: (id: RequestId) => void;
}
export interface McpRequestContext {
  readonly id: RequestId;
  readonly method: string;
  readonly signal: AbortSignal;
}
export declare class JsonRpcMessageLayer {
  requestMetadata?: Record<string, unknown>;
  readonly requestTimeoutMs: number;
  constructor(
    input: NodeJS.ReadableStream,
    output: NodeJS.WritableStream,
    requestTimeoutMs?: number,
    inputClosedReason?: Promise<Error>,
    maxConcurrentRequests?: number
  );
  sendRequest(method: string, params?: unknown, options?: JsonRpcRequestOptions): Promise<unknown>;
  sendNotification(method: string, params?: unknown): void;
  onRequest(
    method: string,
    handler: (params: unknown, context: McpRequestContext) => unknown | Promise<unknown>
  ): void;
  onNotification(
    method: string,
    handler: (params: unknown, context: { method: string }) => unknown | Promise<unknown>
  ): void;
  onInputRequest(
    method: string,
    handler: (params: unknown, context: McpRequestContext) => unknown | Promise<unknown>
  ): void;
  cancelRequest(id: RequestId, reason: unknown): boolean;
  dispose(reason?: Error): void;
}

import type { Readable, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";
import type { Implementation, Resource, ResourceTemplate, Prompt, Tool as CoreTool, ContentItem as CoreContentItem, ResourceContents as CoreResourceContents } from "tiny-stdio-mcp-server-rust";
export type { Implementation, Resource, ResourceTemplate, Prompt, ResourceLink, PromptArgument, ToolAnnotations, Icon, ContentAnnotations, ToolExecution } from "tiny-stdio-mcp-server-rust";
export interface ServerCapabilities {
    extensions?: Record<string, Record<string, unknown>>;
    prompts?: {
        listChanged?: boolean;
        [key: string]: unknown;
    };
    resources?: {
        subscribe?: boolean;
        listChanged?: boolean;
        [key: string]: unknown;
    };
    tools?: {
        listChanged?: boolean;
        [key: string]: unknown;
    };
    logging?: {
        [key: string]: unknown;
    };
    completions?: {
        [key: string]: unknown;
    };
    experimental?: Record<string, unknown>;
}

export interface InitializeParams {
    protocolVersion: string;
    capabilities: ClientCapabilities;
    clientInfo: Implementation;
}

export interface InitializeResult {
    protocolVersion: string;
    capabilities: ServerCapabilities;
    serverInfo: Implementation;
    instructions?: string;
}

export interface ConnectResult {
    protocolVersion: string;
    capabilities: ServerCapabilities;
    serverInfo?: Implementation;
    instructions?: string;
}

export type ElicitationParams = {
    mode?: "form";
    message: string;
    requestedSchema: Record<string, unknown>;
} | {
    mode: "url";
    message: string;
    url: string;
    elicitationId: string;
};

export interface ElicitationResult {
    _meta?: Record<string, unknown>;
    action: "accept" | "decline" | "cancel";
    content?: Record<string, string | number | boolean | string[]>;
}

export interface McpClientOptions {
    clientInfo: Implementation;
    requestTimeoutMs?: number;
    maxConcurrentRequests?: number;
    protocolVersion?: "2025-03-26" | "2026-07-28";
    capabilities?: ClientCapabilities;
    onToolsChanged?: () => void | Promise<void>;
    onResourcesChanged?: () => void | Promise<void>;
    onResourceUpdated?: (uri: string) => void | Promise<void>;
    onPromptsChanged?: () => void | Promise<void>;
    onLog?: (message: LogMessage) => void | Promise<void>;
    onProgress?: (params: ProgressParams) => void | Promise<void>;
    onSamplingRequest?: (params: CreateMessageParams, context: McpRequestContext) => CreateMessageResult | Promise<CreateMessageResult>;
    onRootsList?: (context: McpRequestContext) => Root[] | Promise<Root[]>;
    onElicitationRequest?: (params: ElicitationParams, context: McpRequestContext) => ElicitationResult | Promise<ElicitationResult>;
}

export interface CallToolParams {
    name: string;
    arguments?: Record<string, unknown>;
}

export interface CallToolOptions {
    signal?: AbortSignal;
    progressToken?: ProgressToken;
}

export interface ReadResourceParams {
    uri: string;
}

export interface PaginatedParams {
    cursor?: string;
}

export interface ResultMetadata {
    resultType?: "complete";
    _meta?: Record<string, unknown>;
}

export interface CacheableResultMetadata extends ResultMetadata {
    ttlMs?: number;
    cacheScope?: "public" | "private";
}

export interface PaginatedResult extends CacheableResultMetadata {
    nextCursor?: string;
}

export type TextResourceContents = Extract<CoreResourceContents, {
    text: string;
}>;

export type BlobResourceContents = Extract<CoreResourceContents, {
    blob: string;
}>;

export type ResourceContents = CoreResourceContents;

export type TextContent = Extract<CoreContentItem, {
    type: "text";
}>;

export type ImageContent = Extract<CoreContentItem, {
    type: "image";
}>;

export type AudioContent = Extract<CoreContentItem, {
    type: "audio";
}>;

export type EmbeddedResource = Extract<CoreContentItem, {
    type: "resource";
}>;

export type ContentItem = CoreContentItem;

export interface PromptMessage {
    role: "user" | "assistant";
    content: ContentItem;
}

export interface GetPromptResult extends ResultMetadata {
    description?: string;
    messages: PromptMessage[];
}

export interface GetPromptParams {
    name: string;
    arguments?: Record<string, string>;
}

export interface CallToolResult extends ResultMetadata {
    content: ContentItem[];
    structuredContent?: unknown;
    isError?: boolean;
}

export interface Root {
    _meta?: Record<string, unknown>;
    uri: string;
    name?: string;
}

export type LogLevel = "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency";

export interface LogMessage {
    level: LogLevel;
    logger?: string;
    data: unknown;
}

export type ProgressToken = RequestId;

export interface ProgressParams {
    progressToken: ProgressToken;
    progress: number;
    total?: number;
    message?: string;
}

export interface ModelHint {
    name?: string;
}

export interface ModelPreferences {
    hints?: ModelHint[];
    costPriority?: number;
    speedPriority?: number;
    intelligencePriority?: number;
}

export interface ToolUseContent {
    _meta?: Record<string, unknown>;
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
}

export interface ToolResultContent {
    _meta?: Record<string, unknown>;
    type: "tool_result";
    toolUseId: string;
    content: ContentItem[];
    structuredContent?: unknown;
    isError?: boolean;
}

export type SamplingContent = TextContent | ImageContent | AudioContent | ToolUseContent | ToolResultContent;

export interface SamplingMessage {
    _meta?: Record<string, unknown>;
    role: "user" | "assistant";
    content: SamplingContent | SamplingContent[];
}

export type IncludeContext = "none" | "thisServer" | "allServers";

export interface CreateMessageParams {
    messages: SamplingMessage[];
    modelPreferences?: ModelPreferences;
    systemPrompt?: string;
    includeContext?: IncludeContext;
    temperature?: number;
    maxTokens: number;
    tools?: Tool[];
    toolChoice?: {
        mode: "auto" | "required" | "none";
    };
    stopSequences?: string[];
    metadata?: Record<string, unknown>;
}

export interface CreateMessageResult {
    _meta?: Record<string, unknown>;
    model: string;
    content: SamplingContent | SamplingContent[];
    role: "user" | "assistant";
    stopReason?: string;
}

export interface PromptReference {
    type: "ref/prompt";
    name: string;
}

export interface ResourceReference {
    type: "ref/resource";
    uri: string;
}

export interface CompleteArgument {
    name: string;
    value: string;
}

export interface CompleteParams {
    context?: {
        arguments?: Record<string, string>;
    };
    ref: PromptReference | ResourceReference;
    argument: CompleteArgument;
}

export interface Completion {
    values: string[];
    hasMore?: boolean;
    total?: number;
}

export interface CompleteResult extends ResultMetadata {
    completion: Completion;
}

export interface McpTransportClosedEvent {
    reason: Error;
    code?: number;
    signal?: NodeJS.Signals;
}

export interface McpTransport {
    readable: Readable;
    writable: Writable;
    closed: Promise<McpTransportClosedEvent>;
    dispose(reason?: Error): void;
    filterTools?(tools: Tool[], reset?: boolean): Tool[];
}

export interface InMemoryServerTransport { readable: Readable; writable: Writable; }
export interface InMemoryTransportPair {
  clientTransport: McpTransport;
  serverTransport: InMemoryServerTransport;
}
export declare function createInMemoryTransportPair(): InMemoryTransportPair;
export type StdioSpawn = (command: string, args: ReadonlyArray<string>, options: SpawnOptions) => ChildProcessWithoutNullStreams;
export interface StdioTransportOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawn?: StdioSpawn;
}
export declare class StdioTransport implements McpTransport {
  readonly readable: Readable;
  readonly writable: Writable;
  readonly closed: Promise<McpTransportClosedEvent>;
  constructor(options: StdioTransportOptions);
  getStderrOutput(): string;
  dispose(reason?: Error): void;
}
export declare class McpClient {
  constructor(options: McpClientOptions);
  readonly state: "disconnected" | "initializing" | "ready" | "closed";
  readonly serverCapabilities: ServerCapabilities | null;
  readonly serverInfo: Implementation | null;
  readonly instructions: string | undefined;
  connect(transport: McpTransport, options?: { signal?: AbortSignal }): Promise<ConnectResult>;
  listTools(params?: PaginatedParams, options?: { signal?: AbortSignal }): Promise<PaginatedResult & { tools: Tool[] }>;
  callTool(params: CallToolParams, options?: CallToolOptions): Promise<CallToolResult>;
  listResources(params?: PaginatedParams, options?: { signal?: AbortSignal }): Promise<PaginatedResult & { resources: Resource[] }>;
  listResourceTemplates(params?: PaginatedParams, options?: { signal?: AbortSignal }): Promise<PaginatedResult & { resourceTemplates: ResourceTemplate[] }>;
  readResource(params: ReadResourceParams, options?: { signal?: AbortSignal }): Promise<CacheableResultMetadata & { contents: ResourceContents[] }>;
  listenNotifications(filter: NotificationFilter, options?: SubscriptionOptions): Promise<McpSubscription>;
  subscribe(uri: string, options?: { signal?: AbortSignal }): Promise<void>;
  unsubscribe(uri: string, options?: { signal?: AbortSignal }): Promise<void>;
  listPrompts(params?: PaginatedParams, options?: { signal?: AbortSignal }): Promise<PaginatedResult & { prompts: Prompt[] }>;
  getPrompt(params: GetPromptParams, options?: { signal?: AbortSignal }): Promise<GetPromptResult>;
  complete(params: CompleteParams, options?: { signal?: AbortSignal }): Promise<CompleteResult>;
  setLogLevel(level: LogLevel, options?: { signal?: AbortSignal }): Promise<void>;
  cancel(requestId: RequestId, reason?: string): Promise<void>;
  sendRootsChanged(): Promise<void>;
  ping(options?: { signal?: AbortSignal }): Promise<void>;
  close(): Promise<void>;
}

export interface NotificationFilter {
  toolsListChanged?: boolean;
  promptsListChanged?: boolean;
  resourcesListChanged?: boolean;
  resourceSubscriptions?: string[];
}
export interface SubscriptionOptions { signal?: AbortSignal; }
export interface McpSubscription {
  readonly id: RequestId;
  readonly notifications: NotificationFilter;
  readonly closed: Promise<void>;
  cancel(): void;
}

export interface McpClientConnection {
  connect(transport: McpTransport): Promise<unknown>;
  close(): Promise<void>;
}
export interface SdkTestPair<TClient extends McpClientConnection> {
  client: TClient;
  cleanup(): Promise<void>;
}
export declare function createSdkTestPair<TClient extends McpClientConnection>(
  server: { connect(transport: unknown): Promise<unknown> },
  createClient: () => TClient
): Promise<SdkTestPair<TClient>>;
export declare function createTestPair<TClient extends McpClientConnection>(
  server: { connect(transport: InMemoryServerTransport): Promise<unknown> },
  createClient: () => TClient
): Promise<SdkTestPair<TClient>>;
