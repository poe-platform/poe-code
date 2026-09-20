export interface ServerOptions {
  name: string;
  version: string;
  supportNotifications?: boolean;
  supportResourceSubscriptions?: boolean;
  validateToolArguments?: boolean;
  maxConcurrentToolCalls?: number;
  maxQueuedToolCalls?: number;
  toolCallTimeoutMs?: number;
  maxActiveRequests?: number;
  maxStdioLineBytes?: number;
  maxPendingStdioMessages?: number;
  maxStdioOutputBytes?: number;
}

export interface HandleResult {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export declare class ToolError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown);
}

export interface HandlerRequestContext {
  signal: AbortSignal;
  clientCapabilities: Record<string, unknown>;
  requestState?: string;
  inputResponses?: Record<string, unknown>;
}

export interface MessageRequestContext {
  signal?: AbortSignal;
  requestId?: string | number;
  parameterHeaders?: Record<string, string | string[] | undefined>;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: { type: "object"; [keyword: string]: unknown };
  outputSchema?: Record<string, unknown>;
  [field: string]: unknown;
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
  [field: string]: unknown;
}
export interface Resource {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  [field: string]: unknown;
}
export interface ResourceTemplate {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  [field: string]: unknown;
}
export type PromptHandler = (
  args: Record<string, string>,
  context: HandlerRequestContext
) => unknown | Promise<unknown>;
export type ResourceHandler = (
  uri: string,
  context: HandlerRequestContext
) => unknown | Promise<unknown>;
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
  error?: { code: number; message: string; data?: unknown };
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
export interface SDKTransport {
  onmessage?(message: SDKMessage): void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  start(): Promise<void>;
  close(): Promise<void>;
  send(message: SDKMessage): Promise<void>;
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
  tool<T, TOut = unknown>(
    name: string,
    description: string,
    inputSchema: TypedSchema<T>,
    handler: (arguments_: T, context: HandlerRequestContext) => unknown | Promise<unknown>,
    outputSchema?: TypedOutputSchema<TOut>
  ): Server;
  registerTool(
    definition: ToolDefinition,
    handler: (
      arguments_: Record<string, unknown>,
      context: HandlerRequestContext
    ) => unknown | Promise<unknown>
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
  listen(): Promise<void>;
}

export declare function createServer(options: ServerOptions): Server;

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
  audience?: ("user" | "assistant")[];
  priority?: number;
  lastModified?: string;
}
export interface TextContent {
  type: "text";
  text: string;
  annotations?: ContentAnnotations;
  _meta?: Record<string, unknown>;
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
  _meta?: Record<string, unknown>;
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
