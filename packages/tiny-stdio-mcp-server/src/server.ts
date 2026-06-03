import * as readline from "readline";
import type {
  ServerOptions,
  ToolDefinition,
  ToolHandler,
  CallToolResult,
  HandleResult,
  InitializeResult,
  Tool,
  Transport,
  JSONSchema,
  SDKTransport,
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
} from "./types.js";
import { JSON_RPC_ERROR_CODES, ToolError } from "./types.js";
import {
  parseMessage,
  formatSuccessResponse,
  formatErrorResponse,
} from "./jsonrpc.js";
import type { TypedSchema } from "./schema.js";
import { toContentBlocks } from "./content/convert.js";

const PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2025-03-26",
  "2025-06-18",
  PROTOCOL_VERSION,
]);

export interface Server {
  tool<T>(
    name: string,
    description: string,
    inputSchema: TypedSchema<T>,
    handler: ToolHandler<T>
  ): Server;
  onNotification(
    listener: (notification: JSONRPCNotification) => void
  ): () => void;
  removeTool(name: string): boolean;
  notifyToolsChanged(): Promise<void>;
  createMessageSession(): MessageSession;
  handleMessage(
    method: string,
    params?: Record<string, unknown>
  ): Promise<HandleResult>;
  listen(): Promise<void>;
  connect(transport: Transport): Promise<void>;
  connectSDK(transport: SDKTransport): Promise<void>;
}

export type MessageHandler = (
  method: string,
  params?: Record<string, unknown>
) => Promise<HandleResult>;

export interface MessageSession {
  handleMessage: MessageHandler;
  close(): void;
}

interface LifecycleState {
  initialized: boolean;
  initializeAccepted: boolean;
}

export function createServer(options: ServerOptions): Server {
  const tools = new Map<string, ToolDefinition>();
  const notificationListeners = new Set<
    (notification: JSONRPCNotification) => void
  >();
  const connectionNotificationListeners = new Map<
    (notification: JSONRPCNotification) => void | Promise<void>,
    LifecycleState
  >();
  const defaultLifecycle: LifecycleState = {
    initialized: false,
    initializeAccepted: false,
  };
  const messageLifecycles = new Set<LifecycleState>([defaultLifecycle]);

  const handleMessageWithLifecycle = async (
    method: string,
    lifecycle: LifecycleState,
    params?: Record<string, unknown>
  ): Promise<HandleResult> => {
    // Allow ping and initialize before initialization
    if (method === "ping") {
      return { result: {} };
    }

    if (method === "initialize") {
      // Re-initialize on the same connection is idempotent: real MCP clients
      // (e.g. kimi-cli via fastmcp) re-send `initialize` on a persistent
      // connection per tool call, and the official MCP SDK server re-responds
      // with InitializeResult instead of erroring. Per-connection isolation is
      // still enforced by the separate lifecycle object given to each connection.
      lifecycle.initializeAccepted = true;
      lifecycle.initialized = true;
      const requestedProtocol =
        typeof params?.protocolVersion === "string"
          ? params.protocolVersion
          : undefined;
      const result: InitializeResult = {
        protocolVersion:
          requestedProtocol !== undefined && SUPPORTED_PROTOCOL_VERSIONS.has(requestedProtocol)
            ? requestedProtocol
            : PROTOCOL_VERSION,
        capabilities: {
          tools: {
            listChanged: true,
          },
        },
        serverInfo: {
          name: options.name,
          version: options.version,
        },
      };
      return { result };
    }

    if (method === "notifications/initialized") {
      if (!lifecycle.initializeAccepted) {
        return {
          error: {
            code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
            message: "Server not initialized",
          },
        };
      }

      return { result: undefined };
    }

    // All other methods require initialization
    if (!lifecycle.initialized) {
      return {
        error: {
          code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
          message: "Server not initialized",
        },
      };
    }

    if (method === "tools/list") {
      const toolList: Tool[] = [];
      for (const tool of tools.values()) {
        toolList.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
      return { result: { tools: toolList } };
    }

    if (method === "tools/call") {
      const toolName = params?.name as string | undefined;

      if (!toolName) {
        return {
          error: {
            code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
            message: "Tool name required",
          },
        };
      }

      const tool = tools.get(toolName);
      if (!tool) {
        return {
          error: {
            code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
            message: `Tool not found: ${toolName}`,
          },
        };
      }

      const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
      if (options.validateToolArguments !== false && !areValidToolArguments(tool.inputSchema, toolArgs)) {
        return {
          error: {
            code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
            message: "Invalid tool arguments",
          },
        };
      }

      try {
        const handlerResult = await tool.handler(toolArgs);
        if (hasContentArray(handlerResult) && !isCallToolResult(handlerResult)) {
          throw new Error("Invalid tool result");
        }
        const result: CallToolResult = isCallToolResult(handlerResult)
          ? handlerResult
          : { content: toContentBlocks(handlerResult) };
        return { result };
      } catch (err) {
        if (err instanceof ToolError) {
          return {
            error: {
              code: err.code,
              message: err.message,
            },
          };
        }

        const errorMessage =
          err instanceof Error ? err.message : String(err);
        const result: CallToolResult = {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
        return { result };
      }
    }

    return {
      error: {
        code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
        message: "Method not found",
      },
    };
  };

  const createMessageSession = (): MessageSession => {
    const lifecycle: LifecycleState = {
      initialized: false,
      initializeAccepted: false,
    };
    messageLifecycles.add(lifecycle);

    return {
      handleMessage: (method, params) => handleMessageWithLifecycle(method, lifecycle, params),
      close: () => {
        messageLifecycles.delete(lifecycle);
      },
    };
  };

  const handleMessage: MessageHandler = (method, params) =>
    handleMessageWithLifecycle(method, defaultLifecycle, params);

  const processLine = async (
    line: string,
    write: (data: string) => void,
    messageHandler: MessageHandler
  ): Promise<void> => {
    const parsed = parseMessage(line);

    if (!parsed.success) {
      write(formatErrorResponse(parsed.id, parsed.error) + "\n");
      return;
    }

    const { request, isNotification } = parsed;

    if (isNotification && request.method === "initialize") {
      return;
    }

    if (!isNotification && request.method === "notifications/initialized") {
      const requestWithId = request as JSONRPCRequest;
      write(formatErrorResponse(requestWithId.id, {
        code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        message: "Invalid Request",
      }) + "\n");
      return;
    }

    const { result, error } = await messageHandler(request.method, request.params);

    if (isNotification) {
      return;
    }

    const requestWithId = request as JSONRPCRequest;

    if (error) {
      write(formatErrorResponse(requestWithId.id, error) + "\n");
    } else if (result !== undefined) {
      write(formatSuccessResponse(requestWithId.id, result) + "\n");
    }
  };

  const broadcastNotification = async (method: string): Promise<void> => {
    const notification: JSONRPCNotification = {
      jsonrpc: "2.0",
      method,
    };

    for (const listener of notificationListeners) {
      listener(notification);
    }

    await Promise.all(
      [...connectionNotificationListeners].map(async ([listener, lifecycle]) => {
        if (lifecycle.initialized) {
          await listener(notification);
        }
      })
    );
  };

  const server: Server = {
    tool<T>(
      name: string,
      description: string,
      inputSchema: TypedSchema<T>,
      handler: ToolHandler<T>
    ): Server {
      tools.set(name, {
        name,
        description,
        inputSchema: inputSchema as JSONSchema,
        handler: handler as ToolHandler,
      });
      return server;
    },

    onNotification(
      listener: (notification: JSONRPCNotification) => void
    ): () => void {
      notificationListeners.add(listener);
      return () => {
        notificationListeners.delete(listener);
      };
    },

    removeTool(name: string): boolean {
      return tools.delete(name);
    },

    async notifyToolsChanged(): Promise<void> {
      if ([...messageLifecycles].some((lifecycle) => lifecycle.initialized)) {
        await broadcastNotification("notifications/tools/list_changed");
      }
    },

    createMessageSession,
    handleMessage,

    async listen(): Promise<void> {
      return server.connect({
        readable: process.stdin,
        writable: process.stdout,
      });
    },

    async connect(transport: Transport): Promise<void> {
      return new Promise((resolve) => {
        const lifecycle: LifecycleState = { initialized: false, initializeAccepted: false };
        const messageHandler: MessageHandler = (method, params) =>
          handleMessageWithLifecycle(method, lifecycle, params);
        messageLifecycles.add(lifecycle);
        const listener = (notification: JSONRPCNotification) => {
          transport.writable.write(`${JSON.stringify(notification)}\n`);
        };
        connectionNotificationListeners.set(listener, lifecycle);
        const rl = readline.createInterface({
          input: transport.readable,
          crlfDelay: Infinity,
        });
        const pendingMessages = new Set<Promise<void>>();

        rl.on("line", (line) => {
          const message = processLine(line, (data) => transport.writable.write(data), messageHandler);
          pendingMessages.add(message);
          void message.finally(() => {
            pendingMessages.delete(message);
          });
        });

        rl.on("close", async () => {
          await Promise.all([...pendingMessages]);
          connectionNotificationListeners.delete(listener);
          messageLifecycles.delete(lifecycle);
          resolve();
        });
      });
    },

    async connectSDK(transport: SDKTransport): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const lifecycle: LifecycleState = { initialized: false, initializeAccepted: false };
        const messageHandler: MessageHandler = (method, params) =>
          handleMessageWithLifecycle(method, lifecycle, params);
        messageLifecycles.add(lifecycle);
        const listener = (notification: JSONRPCNotification) => transport.send(notification);
        connectionNotificationListeners.set(listener, lifecycle);

        transport.onmessage = async (message: JSONRPCMessage) => {
          // Ignore responses (we only handle requests/notifications)
          if (!("method" in message)) {
            return;
          }

          // Handle notifications (no id) - don't respond
          if (!("id" in message) || message.id === undefined) {
            if (message.method === "initialize") {
              return;
            }

            await messageHandler(message.method, message.params);
            return;
          }

          if (message.method === "notifications/initialized") {
            await transport.send({
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
                message: "Invalid Request",
              },
            });
            return;
          }

          const request = message as JSONRPCRequest;
          const { result, error } = await messageHandler(request.method, request.params);

          if (error) {
            const response: JSONRPCResponse = {
              jsonrpc: "2.0",
              id: request.id,
              error,
            };
            await transport.send(response);
          } else if (result !== undefined) {
            const response: JSONRPCResponse = {
              jsonrpc: "2.0",
              id: request.id,
              result,
            };
            await transport.send(response);
          }
        };

        transport.onclose = () => {
          connectionNotificationListeners.delete(listener);
          messageLifecycles.delete(lifecycle);
          resolve();
        };

        void transport.start().catch((error: unknown) => {
          connectionNotificationListeners.delete(listener);
          messageLifecycles.delete(lifecycle);
          reject(error);
        });
      });
    },
  };

  return server;
}

function isCallToolResult(value: unknown): value is CallToolResult {
  return hasContentArray(value) && value.content.every(isContentItem);
}

function hasContentArray(value: unknown): value is { content: unknown[] } {
  return typeof value === "object" && value !== null && "content" in value
    && Array.isArray((value as { content: unknown }).content);
}

function areValidToolArguments(schema: JSONSchema, value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const argumentsObject = value as Record<string, unknown>;
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(argumentsObject, key)) {
      return false;
    }
  }

  for (const [key, property] of Object.entries(schema.properties)) {
    if (!Object.hasOwn(argumentsObject, key)) {
      continue;
    }

    const argument = argumentsObject[key];
    if (argument === null && property.nullable === true) {
      continue;
    }

    if (
      (property.type === "array" && !Array.isArray(argument))
      || (property.type === "object" && (typeof argument !== "object" || argument === null || Array.isArray(argument)))
      || (property.type === "integer" && (!Number.isInteger(argument)))
      || (property.type !== "array" && property.type !== "object" && property.type !== "integer" && typeof argument !== property.type)
    ) {
      return false;
    }
  }

  return true;
}

function isContentItem(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }

  const block = value as Record<string, unknown>;
  if (block.type === "text") {
    return typeof block.text === "string";
  }

  if (block.type === "image" || block.type === "audio") {
    return typeof block.data === "string" && typeof block.mimeType === "string";
  }

  if (block.type !== "resource" || typeof block.resource !== "object" || block.resource === null) {
    return false;
  }

  const resource = block.resource as Record<string, unknown>;
  return typeof resource.uri === "string"
    && typeof resource.mimeType === "string"
    && (typeof resource.text === "string" || typeof resource.blob === "string");
}
