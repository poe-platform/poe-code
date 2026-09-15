// JSON-RPC 2.0 types
export interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

// JSON-RPC error codes
export const JSON_RPC_ERROR_CODES = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  RESOURCE_NOT_FOUND: -32002,
  UNSUPPORTED_PROTOCOL_VERSION: -32022
} as const);

export class ToolError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown
  ) {
    if (!Number.isFinite(code)) {
      throw new Error("ToolError code must be a finite number");
    }

    super(message);
    this.name = "ToolError";
  }
}

// MCP protocol types
export interface ToolsCapability {
  listChanged?: boolean;
}

export interface PromptsCapability {
  listChanged?: boolean;
}

export interface ResourcesCapability {
  subscribe?: boolean;
  listChanged?: boolean;
}

export interface Implementation {
  name: string;
  title?: string;
  version: string;
  description?: string;
  websiteUrl?: string;
  icons?: Icon[];
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: {
    extensions?: Record<string, Record<string, unknown>>;
    tools?: ToolsCapability;
    prompts?: PromptsCapability;
    resources?: ResourcesCapability;
  };
  serverInfo: Implementation;
}

export interface DiscoverResult {
  resultType: "complete";
  supportedVersions: string[];
  capabilities: InitializeResult["capabilities"];
  _meta: {
    "io.modelcontextprotocol/serverInfo": InitializeResult["serverInfo"];
  };
  ttlMs: number;
  cacheScope: "public" | "private";
}

export interface Tool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JSONSchema;
  outputSchema?: OutputSchema;
  annotations?: ToolAnnotations;
  execution?: ToolExecution;
  icons?: Icon[];
  _meta?: Record<string, unknown>;
}

export interface CallToolResult {
  content: ContentItem[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolExecution {
  taskSupport?: "optional" | "required" | "forbidden";
}

export interface Icon {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: "light" | "dark";
}

export interface ContentAnnotations {
  audience?: Array<"user" | "assistant">;
  priority?: number;
  lastModified?: string;
}

export interface ResourceLink extends Resource {
  type: "resource_link";
}

export interface PromptArgument {
  name: string;
  title?: string;
  description?: string;
  required?: boolean;
}

export interface Prompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: PromptArgument[];
  icons?: Icon[];
  _meta?: Record<string, unknown>;
}

export interface PromptMessage {
  role: "user" | "assistant";
  content: ContentItem;
}

export interface GetPromptResult {
  description?: string;
  messages: PromptMessage[];
}

export type PromptHandler = (
  args: Record<string, string>,
  context: HandlerRequestContext
) => Promise<GetPromptResult | InputRequiredResult> | GetPromptResult | InputRequiredResult;

export interface PromptDefinition extends Prompt {
  handler: PromptHandler;
}

export interface Resource {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  annotations?: ContentAnnotations;
  icons?: Icon[];
  _meta?: Record<string, unknown>;
}

export interface ResourceTemplate {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  annotations?: ContentAnnotations;
  icons?: Icon[];
  _meta?: Record<string, unknown>;
}

export type ResourceContents =
  | { uri: string; mimeType?: string; text: string; _meta?: Record<string, unknown> }
  | { uri: string; mimeType?: string; blob: string; _meta?: Record<string, unknown> };

export interface ReadResourceResult {
  contents: ResourceContents[];
}

export type ResourceHandler = (
  uri: string,
  context: HandlerRequestContext
) => Promise<ReadResourceResult | InputRequiredResult> | ReadResourceResult | InputRequiredResult;

export interface ResourceDefinition extends Resource {
  handler: ResourceHandler;
}

export interface ResourceTemplateDefinition extends ResourceTemplate {
  handler: ResourceHandler;
}

export interface HandleResult {
  result?: unknown;
  error?: JSONRPCError;
}

export type PromptContentItem =
  | { type: "text"; text: string; annotations?: ContentAnnotations; _meta?: Record<string, unknown> }
  | {
      type: "image";
      data: string;
      mimeType: string;
      annotations?: ContentAnnotations;
      _meta?: Record<string, unknown>;
    }
  | {
      type: "audio";
      data: string;
      mimeType: string;
      annotations?: ContentAnnotations;
      _meta?: Record<string, unknown>;
    }
  | {
      type: "resource";
      annotations?: ContentAnnotations;
      _meta?: Record<string, unknown>;
      resource:
        | { uri: string; mimeType?: string; text: string; _meta?: Record<string, unknown> }
        | { uri: string; mimeType?: string; blob: string; _meta?: Record<string, unknown> };
    };

// ContentItem is a union of all possible tool result content block types.
export type ContentItem = PromptContentItem | ResourceLink;

export interface JSONSchema {
  type: "object";
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  [keyword: string]: unknown;
}

export interface OutputSchema {
  $schema?: string;
  [keyword: string]: unknown;
}

export interface JSONSchemaProperty extends Record<string, unknown> {
  type?: string | string[];
  description?: string;
  [keyword: string]: unknown;
}

// Server types
export interface ServerOptions {
  name: string;
  version: string;
  toolCallTimeoutMs?: number;
  /** Shared active tool-handler capacity across sessions; defaults to four. */
  maxConcurrentToolCalls?: number;
  /** Maximum tool calls waiting for capacity; defaults to 64. Zero disables waiting. */
  maxQueuedToolCalls?: number;
  /** Per-stdio-connection UTF-8 bytes queued or submitted but unsettled; defaults to 1 MiB. */
  maxStdioOutputBytes?: number;
  /** Per-stdio-connection messages awaiting handler/output settlement; defaults to 128. */
  maxPendingStdioMessages?: number;
  /** Shared in-flight requests retained until their work settles; defaults to 128. */
  maxActiveRequests?: number;
  maxStdioLineBytes?: number;
  validateToolArguments?: boolean;
  supportNotifications?: boolean;
  supportResourceSubscriptions?: boolean;
}

import type { ToolReturn } from "./content/index.js";

export interface InputRequiredResult {
  resultType: "input_required";
  inputRequests?: Record<
    string,
    {
      method: "elicitation/create" | "sampling/createMessage" | "roots/list";
      params?: Record<string, unknown>;
    }
  >;
  requestState?: string;
  _meta?: Record<string, unknown>;
}

export interface HandlerRequestContext {
  readonly signal: AbortSignal;
  readonly requestState?: string;
  readonly inputResponses?: Record<string, unknown>;
  readonly clientCapabilities: Record<string, unknown>;
}

export type ToolHandler<T = Record<string, unknown>, TOut = ToolReturn> = (
  args: T,
  context: HandlerRequestContext
) =>
  | Promise<TOut | CallToolResult | InputRequiredResult>
  | TOut
  | CallToolResult
  | InputRequiredResult;

export interface ToolDefinition<T = Record<string, unknown>, TOut = ToolReturn> {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JSONSchema;
  outputSchema?: OutputSchema;
  annotations?: ToolAnnotations;
  execution?: ToolExecution;
  icons?: Icon[];
  _meta?: Record<string, unknown>;
  handler: ToolHandler<T, TOut>;
}

// Transport types
export interface Transport {
  readable: NodeJS.ReadableStream;
  writable: NodeJS.WritableStream;
}

// SDK-compatible transport interface
export interface SDKTransport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  start: () => Promise<void>;
  close: () => Promise<void>;
  send: (message: JSONRPCMessage) => Promise<void>;
}

export type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

export interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}
