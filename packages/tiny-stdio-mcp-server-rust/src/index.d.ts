export interface ServerOptions {
  name: string;
  version: string;
  supportNotifications?: boolean;
  supportResourceSubscriptions?: boolean;
  validateToolArguments?: boolean;
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
}

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: { type: "object"; [keyword: string]: unknown };
  outputSchema?: Record<string, unknown>;
  [field: string]: unknown;
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
}

export interface Transport {
  readable: NodeJS.ReadableStream;
  writable: NodeJS.WritableStream;
}

export interface Server {
  tool<T>(
    name: string,
    description: string,
    inputSchema: ToolDefinition["inputSchema"],
    handler: (arguments_: T, context: HandlerRequestContext) => unknown | Promise<unknown>
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
  listen(): Promise<void>;
}

export declare function createServer(options: ServerOptions): Server;

export type UriTemplateValue = string | string[] | Record<string, string>;
export interface UriTemplate {
  expand(variables: Record<string, UriTemplateValue>): string;
  match(uri: string): Record<string, string> | null;
}
export declare function parseUriTemplate(source: string): UriTemplate;
