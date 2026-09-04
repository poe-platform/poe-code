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
  RESOURCE_NOT_FOUND: -32002
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

export interface InitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: ToolsCapability;
    prompts?: PromptsCapability;
    resources?: ResourcesCapability;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

export interface Tool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  annotations?: ToolAnnotations;
  execution?: ToolExecution;
  icons?: Icon[];
  _meta?: Record<string, unknown>;
}

export interface CallToolResult {
  content: ContentItem[];
  structuredContent?: Record<string, unknown>;
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

export interface ResourceLink {
  type: "resource_link";
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  annotations?: ContentAnnotations;
}

export interface PromptArgument {
  name: string;
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
  content: PromptContentItem;
}

export interface GetPromptResult {
  description?: string;
  messages: PromptMessage[];
}

export type PromptHandler = (
  args: Record<string, string>
) => Promise<GetPromptResult> | GetPromptResult;

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
  | { uri: string; mimeType?: string; text: string }
  | { uri: string; mimeType?: string; blob: string };

export interface ReadResourceResult {
  contents: ResourceContents[];
}

export type ResourceHandler = (uri: string) => Promise<ReadResourceResult> | ReadResourceResult;

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
  | { type: "text"; text: string; annotations?: ContentAnnotations }
  | {
      type: "image";
      data: string;
      mimeType: string;
      annotations?: ContentAnnotations;
    }
  | {
      type: "audio";
      data: string;
      mimeType: string;
      annotations?: ContentAnnotations;
    }
  | {
      type: "resource";
      annotations?: ContentAnnotations;
      resource:
        | { uri: string; mimeType?: string; text: string }
        | { uri: string; mimeType?: string; blob: string };
    };

// ContentItem is a union of all possible tool result content block types.
export type ContentItem = PromptContentItem | ResourceLink;

export interface JSONSchema {
  type: "object";
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
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
  validateToolArguments?: boolean;
  supportNotifications?: boolean;
  supportResourceSubscriptions?: boolean;
}

import type { ToolReturn } from "./content/index.js";

export type ToolHandler<T = Record<string, unknown>, TOut = ToolReturn> = (
  args: T
) => Promise<TOut | CallToolResult> | TOut | CallToolResult;

export interface ToolDefinition<T = Record<string, unknown>, TOut = ToolReturn> {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
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
