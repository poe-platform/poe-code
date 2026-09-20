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

export interface HandleResult {
  result?: unknown;
  error?: JSONRPCError;
}

export declare class ToolError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown);
}

export interface HandlerRequestContext {
  readonly signal: AbortSignal;
  readonly requestState?: string;
  readonly inputResponses?: Record<string, unknown>;
  readonly clientCapabilities: Record<string, unknown>;
}

export interface MessageRequestContext {
  signal?: AbortSignal;
  requestId?: string | number;
  parameterHeaders?: Record<string, string | string[] | undefined>;
}

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

export type TypedSchema<T> = ToolDefinition["inputSchema"] & {
  __type?: T;
};
export interface TypedOutputSchema<T> {
  __type?: T;
  [keyword: string]: unknown;
}
type SchemaPropertyType = "string" | "number" | "integer" | "boolean" | "object" | "array";
interface SchemaPropertyDefinition {
  type: SchemaPropertyType;
  optional?: boolean;
  [keyword: string]: unknown;
}
type SchemaValue<T extends SchemaPropertyType> = T extends "string"
  ? string
  : T extends "number" | "integer"
    ? number
    : T extends "boolean"
      ? boolean
      : T extends "object"
        ? Record<string, unknown>
        : unknown[];
type SchemaValues<T extends Record<string, SchemaPropertyDefinition>> = {
  [K in keyof T as T[K]["optional"] extends true ? never : K]: SchemaValue<T[K]["type"]>;
} & {
  [K in keyof T as T[K]["optional"] extends true ? K : never]?: SchemaValue<T[K]["type"]>;
};
export declare function defineSchema<T extends Record<string, SchemaPropertyDefinition>>(
  definition: T
): TypedSchema<SchemaValues<T>>;

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
export type PromptHandler = (
  args: Record<string, string>,
  context: HandlerRequestContext
) => Promise<GetPromptResult | InputRequiredResult> | GetPromptResult | InputRequiredResult;
export type ResourceHandler = (
  uri: string,
  context: HandlerRequestContext
) => Promise<ReadResourceResult | InputRequiredResult> | ReadResourceResult | InputRequiredResult;
export interface MessageSessionContext {
  readonly signal: AbortSignal;
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
}
export interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}
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
export type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;
export type SDKMessage =
  | JSONRPCNotification
  | (Omit<JSONRPCRequest, "id"> & { id: string | number })
  | { jsonrpc: "2.0"; id: string | number; result: Record<string, unknown> }
  | {
      jsonrpc: "2.0";
      id?: string | number;
      error: { code: number; message: string; data?: unknown };
    };
export interface SDKCompatibleTransport {
  onmessage?(message: SDKMessage): void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  start(): Promise<void>;
  close(): Promise<void>;
  send(message: SDKMessage): Promise<void>;
}
export interface SDKTransport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  start: () => Promise<void>;
  close: () => Promise<void>;
  send: (message: JSONRPCMessage) => Promise<void>;
}
export type CustomMethodHandler = (
  params: Record<string, unknown> | undefined,
  context: MessageSessionContext
) => unknown | Promise<unknown>;

export interface MessageSession {
  handleMessage(
    method: string,
    params?: Record<string, unknown>,
    context?: MessageRequestContext
  ): Promise<HandleResult>;
  close(): void;
  handleLine(
    line: string,
    write?: (response: string) => Promise<void>
  ): Promise<string | undefined>;
  handleSDKMessage(message: JSONRPCMessage): Promise<JSONRPCResponse | undefined>;
}

export interface Transport {
  readable: NodeJS.ReadableStream;
  writable: NodeJS.WritableStream;
}

export interface Server {
  tool<T, TOut = ToolReturn>(
    name: string,
    description: string,
    inputSchema: TypedSchema<T>,
    handler: ToolHandler<T, TOut>,
    outputSchema?: TypedOutputSchema<TOut>
  ): Server;
  registerTool<T, TOut = ToolReturn>(
    definition: Omit<ToolDefinition<T, TOut>, "handler">,
    handler: ToolHandler<T, TOut>
  ): Server;
  removeTool(name: string): boolean;
  prompt(definition: Prompt, handler: PromptHandler): Server;
  resource(definition: Resource, handler: ResourceHandler): Server;
  resourceTemplate(definition: ResourceTemplate, handler: ResourceHandler): Server;
  method(name: string, handler: CustomMethodHandler): Server;
  removePrompt(name: string): boolean;
  removeResource(uri: string): boolean;
  removeResourceTemplate(uriTemplate: string): boolean;
  onNotification(listener: (notification: JSONRPCNotification) => void): () => void;
  notifyToolsChanged(): Promise<void>;
  notifyPromptsChanged(): Promise<void>;
  notifyResourcesChanged(): Promise<void>;
  notifyResourceUpdated(uri: string): Promise<void>;
  createMessageSession(
    listener?: (notification: JSONRPCNotification) => void | Promise<void>
  ): MessageSession;
  handleMessage: MessageSession["handleMessage"];
  connect(transport: Transport): Promise<void>;
  connectSDK(transport: SDKTransport): Promise<void>;
  connectSDK(transport: SDKCompatibleTransport): Promise<void>;
  listen(): Promise<void>;
}

export declare function createServer(options: ServerOptions): Server;
export type MessageHandler = MessageSession["handleMessage"];
export declare const JSON_RPC_ERROR_CODES: Readonly<{
  PARSE_ERROR: -32700;
  INVALID_REQUEST: -32600;
  METHOD_NOT_FOUND: -32601;
  INVALID_PARAMS: -32602;
  INTERNAL_ERROR: -32603;
  RESOURCE_NOT_FOUND: -32002;
  UNSUPPORTED_PROTOCOL_VERSION: -32022;
}>;

export type ProtocolDefinition =
  | "InputRequest"
  | "InputResponses"
  | "ClientCapabilities"
  | "ElicitResult"
  | "CreateMessageResult"
  | "ListRootsResult"
  | "DiscoverResult"
  | "ListToolsResult"
  | "CallToolResult"
  | "ListPromptsResult"
  | "GetPromptResult"
  | "ListResourcesResult"
  | "ListResourceTemplatesResult"
  | "ReadResourceResult"
  | "CompleteResult"
  | "Result";
export declare function validateProtocolValue(
  definition: ProtocolDefinition,
  value: unknown
): boolean;

export type UriTemplateValue = string | string[] | Record<string, string>;
export interface UriTemplate {
  expand(variables: Record<string, UriTemplateValue>): string;
  match(uri: string): Record<string, string> | null;
}
export declare function parseUriTemplate(source: string): UriTemplate;

export interface FileTypeResult {
  mime: string;
  ext: string;
}
export declare function fileTypeFromBuffer(data: Uint8Array): FileTypeResult | undefined;
export declare const DEFAULT_FROM_URL_MAX_BYTES: number;
export interface FromUrlOptions {
  maxBytes?: number;
}
export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
  annotations?: ContentAnnotations;
  _meta?: Record<string, unknown>;
}
export interface AudioContent {
  type: "audio";
  data: string;
  mimeType: string;
  annotations?: ContentAnnotations;
  _meta?: Record<string, unknown>;
}
export interface TextResourceContents {
  uri: string;
  mimeType: string;
  text: string;
  _meta?: Record<string, unknown>;
}
export interface BlobResourceContents {
  uri: string;
  mimeType: string;
  blob: string;
  _meta?: Record<string, unknown>;
}
export interface EmbeddedResource {
  type: "resource";
  resource: TextResourceContents | BlobResourceContents;
  annotations?: ContentAnnotations;
  _meta?: Record<string, unknown>;
}
export interface ContentAnnotations {
  audience?: Array<"user" | "assistant">;
  priority?: number;
  lastModified?: string;
}
export interface TextContent {
  type: "text";
  text: string;
  annotations?: ContentAnnotations;
  _meta?: Record<string, unknown>;
}
export interface ResourceLink extends Resource {
  type: "resource_link";
}
export type ContentBlock =
  | TextContent
  | ImageContent
  | AudioContent
  | EmbeddedResource
  | ResourceLink;
type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];
export type ToolReturn = undefined | JsonValue | Image | Audio | File | ContentBlock | ToolReturn[];
export declare function toContentBlocks(result: ToolReturn): ContentBlock[];
export declare class Image {
  private constructor();
  static fromBytes(data: Uint8Array, format?: string): Image;
  static fromBase64(base64: string, mimeType: string): Image;
  static fromUrl(url: string, options?: FromUrlOptions): Promise<Image>;
  toContentBlock(): ImageContent;
}
export declare class Audio {
  private constructor();
  static fromBytes(data: Uint8Array, format?: string): Audio;
  static fromBase64(base64: string, mimeType: string): Audio;
  static fromUrl(url: string, options?: FromUrlOptions): Promise<Audio>;
  toContentBlock(): AudioContent;
}
export declare class File {
  private constructor();
  static fromBytes(data: Uint8Array, mimeType: string): File;
  static fromBase64(base64: string, mimeType: string): File;
  static fromText(text: string, mimeType?: string): File;
  static fromUrl(url: string, options?: FromUrlOptions): Promise<File>;
  toContentBlock(): EmbeddedResource;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

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

export interface PromptMessage {
  role: "user" | "assistant";
  content: ContentItem;
}

export interface GetPromptResult {
  description?: string;
  messages: PromptMessage[];
}

export interface PromptDefinition extends Prompt {
  handler: PromptHandler;
}

export type ResourceContents =
  | { uri: string; mimeType?: string; text: string; _meta?: Record<string, unknown> }
  | { uri: string; mimeType?: string; blob: string; _meta?: Record<string, unknown> };

export interface ReadResourceResult {
  contents: ResourceContents[];
}

export interface ResourceDefinition extends Resource {
  handler: ResourceHandler;
}

export interface ResourceTemplateDefinition extends ResourceTemplate {
  handler: ResourceHandler;
}

export type PromptContentItem =
  | {
      type: "text";
      text: string;
      annotations?: ContentAnnotations;
      _meta?: Record<string, unknown>;
    }
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

export type ToolHandler<T = Record<string, unknown>, TOut = ToolReturn> = (
  args: T,
  context: HandlerRequestContext
) =>
  | Promise<TOut | CallToolResult | InputRequiredResult>
  | TOut
  | CallToolResult
  | InputRequiredResult;
