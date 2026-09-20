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
  createMessageSession(): MessageSession;
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
