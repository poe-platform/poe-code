import * as readline from "readline";
import type {
  ServerOptions,
  ToolDefinition,
  ToolHandler,
  CallToolResult,
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
import { JSON_RPC_ERROR_CODES } from "./types.js";
import {
  parseMessage,
  formatSuccessResponse,
  formatErrorResponse,
} from "./jsonrpc.js";
import type { TypedSchema } from "./schema.js";
import { toContentBlocks } from "./content/convert.js";

const PROTOCOL_VERSION = "2025-11-25";

export interface Server {
  tool<T>(
    name: string,
    description: string,
    inputSchema: TypedSchema<T>,
    handler: ToolHandler<T>
  ): Server;
  removeTool(name: string): boolean;
  notifyToolsChanged(): Promise<void>;
  listen(): Promise<void>;
  connect(transport: Transport): Promise<void>;
  connectSDK(transport: SDKTransport): Promise<void>;
}

export function createServer(options: ServerOptions): Server {
  const tools = new Map<string, ToolDefinition>();
  let initialized = false;
  let activeTransport: Transport | null = null;
  let activeSDKTransport: SDKTransport | null = null;

  const handleRequest = async (
    method: string,
    params?: Record<string, unknown>
  ): Promise<{ result?: unknown; error?: { code: number; message: string } }> => {
    // Allow ping and initialize before initialization
    if (method === "ping") {
      return { result: {} };
    }

    if (method === "initialize") {
      initialized = true;
      const requestedProtocol =
        typeof params?.protocolVersion === "string"
          ? params.protocolVersion
          : null;
      const result: InitializeResult = {
        protocolVersion: requestedProtocol ?? PROTOCOL_VERSION,
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
      return { result: undefined };
    }

    // All other methods require initialization
    if (!initialized) {
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
      const toolArgs = (params?.arguments as Record<string, unknown>) || {};

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

      try {
        const handlerResult = await tool.handler(toolArgs);
        const result: CallToolResult = { content: toContentBlocks(handlerResult) };
        return { result };
      } catch (err) {
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

  const processLine = async (
    line: string,
    write: (data: string) => void
  ): Promise<void> => {
    const parsed = parseMessage(line);

    if (!parsed.success) {
      write(formatErrorResponse(parsed.id, parsed.error) + "\n");
      return;
    }

    const { request, isNotification } = parsed;
    const { result, error } = await handleRequest(request.method, request.params);

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

  const sendNotification = async (method: string): Promise<void> => {
    const notification: JSONRPCNotification = {
      jsonrpc: "2.0",
      method,
    };

    if (activeSDKTransport) {
      await activeSDKTransport.send(notification);
    } else if (activeTransport) {
      activeTransport.writable.write(JSON.stringify(notification) + "\n");
    }
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

    removeTool(name: string): boolean {
      return tools.delete(name);
    },

    async notifyToolsChanged(): Promise<void> {
      if (initialized) {
        await sendNotification("notifications/tools/list_changed");
      }
    },

    async listen(): Promise<void> {
      return server.connect({
        readable: process.stdin,
        writable: process.stdout,
      });
    },

    async connect(transport: Transport): Promise<void> {
      activeTransport = transport;
      activeSDKTransport = null;

      return new Promise((resolve) => {
        const rl = readline.createInterface({
          input: transport.readable,
          crlfDelay: Infinity,
        });

        rl.on("line", (line) => {
          processLine(line, (data) => transport.writable.write(data));
        });

        rl.on("close", () => {
          activeTransport = null;
          resolve();
        });
      });
    },

    async connectSDK(transport: SDKTransport): Promise<void> {
      activeSDKTransport = transport;
      activeTransport = null;

      return new Promise<void>((resolve) => {
        transport.onmessage = async (message: JSONRPCMessage) => {
          // Ignore responses (we only handle requests/notifications)
          if (!("method" in message)) {
            return;
          }

          // Handle notifications (no id) - don't respond
          if (!("id" in message) || message.id === undefined) {
            await handleRequest(message.method, message.params);
            return;
          }

          const request = message as JSONRPCRequest;
          const { result, error } = await handleRequest(request.method, request.params);

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
          activeSDKTransport = null;
          resolve();
        };

        transport.start();
      });
    },
  };

  return server;
}
