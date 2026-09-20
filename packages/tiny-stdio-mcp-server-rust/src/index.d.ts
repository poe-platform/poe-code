export interface ServerOptions {
  name: string;
  version: string;
  supportNotifications?: boolean;
  supportResourceSubscriptions?: boolean;
}

export interface HandleResult {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
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
  [field: string]: unknown;
}

export interface MessageSession {
  handleMessage(
    method: string,
    params?: Record<string, unknown>,
    context?: MessageRequestContext
  ): Promise<HandleResult>;
  close(): void;
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
}

export declare function createServer(options: ServerOptions): Server;
