import * as readline from "readline";
import AjvModule from "ajv";
import uriTemplateParser from "uri-template";
import UriTemplate from "uri-template-lite";
import type {
  ServerOptions,
  ToolDefinition,
  ToolHandler,
  CallToolResult,
  HandleResult,
  InitializeResult,
  Tool,
  Prompt,
  PromptDefinition,
  PromptHandler,
  Resource,
  ResourceDefinition,
  ResourceHandler,
  ResourceTemplate,
  ResourceTemplateDefinition,
  Transport,
  JSONSchema,
  SDKTransport,
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
  JSONSchemaProperty,
} from "./types.js";
import { JSON_RPC_ERROR_CODES, ToolError } from "./types.js";
import {
  parseMessage,
  formatSuccessResponse,
  formatErrorResponse,
} from "./jsonrpc.js";
import type { TypedSchema } from "./schema.js";
import { toContentBlocks, type ToolReturn } from "./content/convert.js";

const PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2025-03-26",
  "2025-06-18",
  PROTOCOL_VERSION,
]);

export interface Server {
  tool<TIn, TOut = never>(
    name: string,
    description: string,
    inputSchema: TypedSchema<TIn>,
    handler: ToolHandler<TIn, TOut>,
    outputSchema?: TypedSchema<TOut>
  ): Server;
  registerTool<TIn, TOut = never>(
    definition: Omit<ToolDefinition<TIn, TOut>, "handler">,
    handler: ToolHandler<TIn, TOut>
  ): Server;
  prompt(definition: Prompt, handler: PromptHandler): Server;
  resource(definition: Resource, handler: ResourceHandler): Server;
  resourceTemplate(definition: ResourceTemplate, handler: ResourceHandler): Server;
  onNotification(
    listener: (notification: JSONRPCNotification) => void
  ): () => void;
  removeTool(name: string): boolean;
  removePrompt(name: string): boolean;
  removeResource(uri: string): boolean;
  removeResourceTemplate(uriTemplate: string): boolean;
  notifyToolsChanged(): Promise<void>;
  notifyPromptsChanged(): Promise<void>;
  notifyResourcesChanged(): Promise<void>;
  notifyResourceUpdated(uri: string): Promise<void>;
  createMessageSession(
    listener?: (notification: JSONRPCNotification) => void | Promise<void>
  ): MessageSession;
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
  notificationReady: boolean;
  resourceSubscriptions: Set<string>;
}

export function createServer(options: ServerOptions): Server {
  const Ajv = "default" in AjvModule ? AjvModule.default : AjvModule;
  const jsonSchemaValidator = new Ajv({ strict: false });
  const supportNotifications = options.supportNotifications !== false;
  const supportResourceSubscriptions = options.supportResourceSubscriptions !== false;
  const tools = new Map<string, ToolDefinition>();
  const prompts = new Map<string, PromptDefinition>();
  const resources = new Map<string, ResourceDefinition>();
  const resourceTemplates = new Map<string, ResourceTemplateDefinition>();
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
    notificationReady: false,
    resourceSubscriptions: new Set(),
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
      lifecycle.notificationReady = false;
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
            ...(supportNotifications ? { listChanged: true } : {}),
          },
          prompts: {
            ...(supportNotifications ? { listChanged: true } : {}),
          },
          resources: {
            ...(supportNotifications ? { listChanged: true } : {}),
            ...(supportResourceSubscriptions ? { subscribe: true } : {}),
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

      lifecycle.notificationReady = true;
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
        const descriptor = { ...tool };
        delete (descriptor as Partial<ToolDefinition>).handler;
        toolList.push({
          ...(descriptor as Tool),
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
      if (options.validateToolArguments !== false && !jsonSchemaValidator.validate(tool.inputSchema, toolArgs)) {
        return {
          error: {
            code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
            message: "Invalid tool arguments",
          },
        };
      }

      try {
        const handlerResult = await tool.handler(toolArgs);
        const result = normalizeToolResult(handlerResult, tool.outputSchema);
        if (tool.outputSchema !== undefined && !jsonSchemaValidator.validate(tool.outputSchema, result.structuredContent)) {
          throw new ToolError(
            JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
            "Invalid structured tool result"
          );
        }
        return { result };
      } catch (err) {
        if (err instanceof ToolError) {
          return {
            error: {
              code: err.code,
              message: err.message,
              ...(err.data === undefined ? {} : { data: err.data }),
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

    if (method === "prompts/list") {
      return {
        result: {
          prompts: [...prompts.values()].map(({ handler: _handler, ...prompt }) => prompt),
        },
      };
    }

    if (method === "prompts/get") {
      const promptName = typeof params?.name === "string" ? params.name : undefined;
      if (promptName === undefined) {
        return invalidParams("Prompt name required");
      }

      const prompt = prompts.get(promptName);
      if (prompt === undefined) {
        return invalidParams(`Prompt not found: ${promptName}`);
      }

      const args = toStringArguments(params?.arguments);
      if (args === undefined || !hasRequiredPromptArguments(prompt, args)) {
        return invalidParams("Invalid prompt arguments");
      }

      try {
        const result = await prompt.handler(args);
        if (!isGetPromptResult(result)) {
          return internalError("Invalid prompt result");
        }
        return { result };
      } catch (error) {
        return internalError(toErrorMessage(error));
      }
    }

    if (method === "resources/list") {
      return {
        result: {
          resources: [...resources.values()].map(({ handler: _handler, ...resource }) => resource),
        },
      };
    }

    if (method === "resources/templates/list") {
      return {
        result: {
          resourceTemplates: [...resourceTemplates.values()].map(
            ({ handler: _handler, ...resourceTemplate }) => resourceTemplate
          ),
        },
      };
    }

    if (method === "resources/read") {
      const uri = typeof params?.uri === "string" ? params.uri : undefined;
      if (uri === undefined || !isValidUri(uri)) {
        return invalidParams("Resource URI required");
      }

      const resource = findReadableResource(uri, resources, resourceTemplates);
      if (resource === undefined) {
        return resourceNotFound(uri);
      }

      try {
        const result = await resource.handler(uri);
        if (!isReadResourceResult(result)) {
          return internalError("Invalid resource result");
        }
        return { result };
      } catch (error) {
        return internalError(toErrorMessage(error));
      }
    }

    if (method === "resources/subscribe" || method === "resources/unsubscribe") {
      if (!supportResourceSubscriptions) {
        return {
          error: {
            code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
            message: "Method not found",
          },
        };
      }
      const uri = typeof params?.uri === "string" ? params.uri : undefined;
      if (uri === undefined || !isValidUri(uri)) {
        return invalidParams("Resource URI required");
      }
      if (
        method === "resources/subscribe"
        && findReadableResource(uri, resources, resourceTemplates) === undefined
      ) {
        return resourceNotFound(uri);
      }

      if (method === "resources/subscribe") {
        lifecycle.resourceSubscriptions.add(uri);
      } else {
        lifecycle.resourceSubscriptions.delete(uri);
      }
      return { result: {} };
    }

    return {
      error: {
        code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
        message: "Method not found",
      },
    };
  };

  const createMessageSession = (
    listener?: (notification: JSONRPCNotification) => void | Promise<void>
  ): MessageSession => {
    const lifecycle: LifecycleState = {
      initialized: false,
      initializeAccepted: false,
      notificationReady: false,
      resourceSubscriptions: new Set(),
    };
    messageLifecycles.add(lifecycle);
    if (listener !== undefined) {
      connectionNotificationListeners.set(listener, lifecycle);
    }

    return {
      handleMessage: (method, params) => handleMessageWithLifecycle(method, lifecycle, params),
      close: () => {
        if (listener !== undefined) {
          connectionNotificationListeners.delete(listener);
        }
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

  const broadcastNotification = async (
    method: string,
    params?: Record<string, unknown>,
    canSend: (lifecycle: LifecycleState) => boolean = () => true
  ): Promise<void> => {
    const notification: JSONRPCNotification = {
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    };

    for (const listener of notificationListeners) {
      listener(notification);
    }

    await Promise.all(
      [...connectionNotificationListeners].map(async ([listener, lifecycle]) => {
        if (lifecycle.notificationReady && canSend(lifecycle)) {
          await listener(notification);
        }
      })
    );
  };

  const server: Server = {
    tool<TIn, TOut = never>(
      name: string,
      description: string,
      inputSchema: TypedSchema<TIn>,
      handler: ToolHandler<TIn, TOut>,
      outputSchema?: TypedSchema<TOut>
    ): Server {
      assertNonEmptyName(name, "Tool name required");
      if (outputSchema !== undefined) {
        assertSupportedOutputSchema(outputSchema);
      }
      tools.set(name, {
        name,
        description,
        inputSchema: inputSchema as JSONSchema,
        ...(outputSchema === undefined ? {} : { outputSchema: outputSchema as JSONSchema }),
        handler: handler as ToolHandler,
      });
      return server;
    },

    registerTool<TIn, TOut = never>(
      definition: Omit<ToolDefinition<TIn, TOut>, "handler">,
      handler: ToolHandler<TIn, TOut>
    ): Server {
      assertNonEmptyName(definition.name, "Tool name required");
      if (definition.outputSchema !== undefined) {
        assertSupportedOutputSchema(definition.outputSchema);
      }
      tools.set(definition.name, {
        ...definition,
        handler: handler as ToolHandler,
      });
      return server;
    },

    prompt(definition: Prompt, handler: PromptHandler): Server {
      assertNonEmptyName(definition.name, "Prompt name required");
      prompts.set(definition.name, { ...definition, handler });
      return server;
    },

    resource(definition: Resource, handler: ResourceHandler): Server {
      if (!isValidUri(definition.uri)) {
        throw new Error(`Invalid resource URI: ${definition.uri}`);
      }
      resources.set(definition.uri, { ...definition, handler });
      return server;
    },

    resourceTemplate(definition: ResourceTemplate, handler: ResourceHandler): Server {
      assertReadableUriTemplate(definition.uriTemplate);
      new UriTemplate(definition.uriTemplate);
      resourceTemplates.set(definition.uriTemplate, { ...definition, handler });
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

    removePrompt(name: string): boolean {
      return prompts.delete(name);
    },

    removeResource(uri: string): boolean {
      return resources.delete(uri);
    },

    removeResourceTemplate(uriTemplate: string): boolean {
      return resourceTemplates.delete(uriTemplate);
    },

    async notifyToolsChanged(): Promise<void> {
      if (supportNotifications && [...messageLifecycles].some((lifecycle) => lifecycle.notificationReady)) {
        await broadcastNotification("notifications/tools/list_changed");
      }
    },

    async notifyPromptsChanged(): Promise<void> {
      if (supportNotifications && [...messageLifecycles].some((lifecycle) => lifecycle.notificationReady)) {
        await broadcastNotification("notifications/prompts/list_changed");
      }
    },

    async notifyResourcesChanged(): Promise<void> {
      if (supportNotifications && [...messageLifecycles].some((lifecycle) => lifecycle.notificationReady)) {
        await broadcastNotification("notifications/resources/list_changed");
      }
    },

    async notifyResourceUpdated(uri: string): Promise<void> {
      if (!supportResourceSubscriptions) {
        return;
      }
      await broadcastNotification(
        "notifications/resources/updated",
        { uri },
        (lifecycle) => lifecycle.resourceSubscriptions.has(uri)
      );
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
        const lifecycle: LifecycleState = { initialized: false, initializeAccepted: false, notificationReady: false, resourceSubscriptions: new Set() };
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
        const lifecycle: LifecycleState = { initialized: false, initializeAccepted: false, notificationReady: false, resourceSubscriptions: new Set() };
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

function invalidParams(message: string): HandleResult {
  return {
    error: {
      code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
      message,
    },
  };
}

function internalError(message: string): HandleResult {
  return {
    error: {
      code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
      message,
    },
  };
}

function resourceNotFound(uri: string): HandleResult {
  return {
    error: {
      code: JSON_RPC_ERROR_CODES.RESOURCE_NOT_FOUND,
      message: `Resource not found: ${uri}`,
    },
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isValidUri(uri: string): boolean {
  try {
    new URL(uri);
    return true;
  } catch {
    return false;
  }
}

function assertNonEmptyName(name: string, message: string): void {
  if (name.length === 0) {
    throw new Error(message);
  }
}

function assertReadableUriTemplate(uriTemplate: string): void {
  const parsed = uriTemplateParser.parse(uriTemplate);
  const expanded = parsed.expand(
    new Proxy({}, {
      get: (_target, property) => typeof property === "string" ? "value" : undefined,
    })
  );

  if (typeof expanded !== "string" || !isValidUri(expanded)) {
    throw new Error(`Invalid resource URI template: ${uriTemplate}`);
  }
}

function toStringArguments(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const args: Record<string, string> = {};
  for (const [name, argument] of Object.entries(value)) {
    if (typeof argument !== "string") {
      return undefined;
    }
    args[name] = argument;
  }
  return args;
}

function hasRequiredPromptArguments(
  prompt: PromptDefinition,
  args: Record<string, string>
): boolean {
  return (prompt.arguments ?? []).every(
    (argument) => argument.required !== true || args[argument.name] !== undefined
  );
}

function findReadableResource(
  uri: string,
  resources: Map<string, ResourceDefinition>,
  resourceTemplates: Map<string, ResourceTemplateDefinition>
): ResourceDefinition | ResourceTemplateDefinition | undefined {
  const resource = resources.get(uri);
  if (resource !== undefined) {
    return resource;
  }

  return [...resourceTemplates.values()].find((template) =>
    matchesUriTemplate(template.uriTemplate, uri)
  );
}

function matchesUriTemplate(template: string, uri: string): boolean {
  try {
    return new UriTemplate(template).match(uri) !== null;
  } catch {
    return false;
  }
}

function isCallToolResult(value: unknown): value is CallToolResult {
  if (!hasContentArray(value) || !value.content.every(isContentItem)) {
    return false;
  }

  if (
    hasOwnProperty(value, "structuredContent")
    && value.structuredContent !== undefined
    && !isJsonObject(value.structuredContent)
  ) {
    return false;
  }

  return !(
    hasOwnProperty(value, "isError")
    && value.isError !== undefined
    && typeof value.isError !== "boolean"
  );
}

function normalizeToolResult(
  handlerResult: unknown,
  outputSchema: JSONSchema | undefined
): CallToolResult {
  if (hasContentArray(handlerResult) && !isCallToolResult(handlerResult)) {
    throw new Error("Invalid tool result");
  }

  if (outputSchema === undefined) {
    const result = isCallToolResult(handlerResult)
      ? handlerResult
      : { content: toContentBlocks(handlerResult as ToolReturn) };
    if (!isCallToolResult(result)) {
      throw new Error("Invalid tool result");
    }

    return result;
  }

  const structuredContent = isCallToolResult(handlerResult)
    ? handlerResult.structuredContent
    : handlerResult;

  if (!isJsonObject(structuredContent)) {
    throw new ToolError(
      JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
      "Structured tool result must be an object"
    );
  }

  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    ...(isCallToolResult(handlerResult) && handlerResult.isError !== undefined
      ? { isError: handlerResult.isError }
      : {}),
    structuredContent,
  };
}

function assertSupportedOutputSchema(schema: JSONSchema): void {
  assertObjectRootSchema(schema, "outputSchema");
  assertSupportedJsonSchema(schema, "outputSchema");
}

function assertObjectRootSchema(schema: JSONSchema, path: string): void {
  if (schema.type !== "object") {
    throw new Error(`${path} root type must be "object"`);
  }
}

function assertSupportedJsonSchema(schema: JSONSchemaProperty, path: string): void {
  for (const keyword of ["anyOf", "allOf", "not", "if", "then", "else", "contains", "prefixItems"]) {
    if (schema[keyword] !== undefined) {
      throw new Error(`${path} uses unsupported keyword "${keyword}"`);
    }
  }

  const type = schema.type;
  if (Array.isArray(type)) {
    const supported = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);
    for (const item of type) {
      if (!supported.has(item)) {
        throw new Error(`${path} uses unsupported type "${item}"`);
      }
    }
  } else if (
    type !== undefined &&
    type !== "string" &&
    type !== "number" &&
    type !== "integer" &&
    type !== "boolean" &&
    type !== "object" &&
    type !== "array"
  ) {
    throw new Error(`${path} uses unsupported type "${type}"`);
  }

  if (isJsonObject(schema.properties)) {
    for (const [key, child] of Object.entries(schema.properties)) {
      if (isJsonObject(child)) {
        assertSupportedJsonSchema(child as JSONSchemaProperty, `${path}.properties.${key}`);
      } else {
        throw new Error(`${path}.properties.${key} must be an object schema`);
      }
    }
  } else if (schema.properties !== undefined) {
    throw new Error(`${path}.properties must be an object`);
  }

  const additionalProperties = schema.additionalProperties;
  if (typeof additionalProperties === "object" && additionalProperties !== null) {
    if (Array.isArray(additionalProperties)) {
      throw new Error(`${path}.additionalProperties must be an object schema or boolean`);
    }
    assertSupportedJsonSchema(additionalProperties as JSONSchemaProperty, `${path}.additionalProperties`);
  } else if (
    additionalProperties !== undefined
    && typeof additionalProperties !== "boolean"
  ) {
    throw new Error(`${path}.additionalProperties must be an object schema or boolean`);
  }

  const items = schema.items;
  if (Array.isArray(items)) {
    throw new Error(`${path}.items uses unsupported tuple array schemas`);
  }
  if (typeof items === "object" && items !== null && !Array.isArray(items)) {
    assertSupportedJsonSchema(items as JSONSchemaProperty, `${path}.items`);
  } else if (items !== undefined && typeof items !== "boolean") {
    throw new Error(`${path}.items must be an object schema or boolean`);
  }

  const oneOf = schema.oneOf;
  if (Array.isArray(oneOf)) {
    for (const [index, child] of oneOf.entries()) {
      if (typeof child === "object" && child !== null && !Array.isArray(child)) {
        assertSupportedJsonSchema(child as JSONSchemaProperty, `${path}.oneOf[${index}]`);
      } else {
        throw new Error(`${path}.oneOf[${index}] must be an object schema`);
      }
    }
  } else if (oneOf !== undefined) {
    throw new Error(`${path}.oneOf must be an array`);
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGetPromptResult(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !hasOwnProperty(value, "messages")) {
    return false;
  }

  return (!hasOwnProperty(value, "description") || value.description === undefined || typeof value.description === "string")
    && Array.isArray(value.messages)
    && value.messages.every((message) =>
      typeof message === "object"
      && message !== null
      && hasOwnProperty(message, "role")
      && (message.role === "user" || message.role === "assistant")
      && hasOwnProperty(message, "content")
      && isPromptContentItem(message.content)
    );
}

function isReadResourceResult(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !hasOwnProperty(value, "contents")) {
    return false;
  }

  return Array.isArray(value.contents)
    && value.contents.every(isResourceContents);
}

function hasContentArray(value: unknown): value is { content: unknown[] } {
  return typeof value === "object" && value !== null && hasOwnProperty(value, "content")
    && Array.isArray((value as { content: unknown }).content);
}

function isContentItem(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !hasOwnProperty(value, "type")) {
    return false;
  }

  const block = value as Record<string, unknown>;
  if (!hasValidContentAnnotations(block)) {
    return false;
  }

  if (block.type === "text") {
    return hasOwnProperty(block, "text") && typeof block.text === "string";
  }

  if (block.type === "image" || block.type === "audio") {
    return hasOwnProperty(block, "data")
      && typeof block.data === "string"
      && isBase64(block.data)
      && hasOwnProperty(block, "mimeType")
      && typeof block.mimeType === "string";
  }

  if (block.type === "resource_link") {
    return hasOwnProperty(block, "uri")
      && typeof block.uri === "string"
      && isValidUri(block.uri)
      && hasOwnProperty(block, "name")
      && typeof block.name === "string"
      && (!hasOwnProperty(block, "title") || block.title === undefined || typeof block.title === "string")
      && (!hasOwnProperty(block, "description") || block.description === undefined || typeof block.description === "string")
      && (!hasOwnProperty(block, "mimeType") || block.mimeType === undefined || typeof block.mimeType === "string")
      && (!hasOwnProperty(block, "size") || block.size === undefined || typeof block.size === "number");
  }

  if (
    block.type !== "resource"
    || !hasOwnProperty(block, "resource")
    || typeof block.resource !== "object"
    || block.resource === null
  ) {
    return false;
  }

  return isResourceContents(block.resource);
}

function isResourceContents(value: unknown): boolean {
  if (
    typeof value !== "object"
    || value === null
    || !hasOwnProperty(value, "uri")
    || typeof value.uri !== "string"
    || !isValidUri(value.uri)
  ) {
    return false;
  }

  if (hasOwnProperty(value, "mimeType") && value.mimeType !== undefined && typeof value.mimeType !== "string") {
    return false;
  }

  return (hasOwnProperty(value, "text") && typeof value.text === "string")
    || (hasOwnProperty(value, "blob") && typeof value.blob === "string" && isBase64(value.blob));
}

function hasValidContentAnnotations(value: Record<string, unknown>): boolean {
  if (!hasOwnProperty(value, "annotations") || value.annotations === undefined) {
    return true;
  }

  if (!isJsonObject(value.annotations)) {
    return false;
  }

  const { audience, priority, lastModified } = value.annotations;
  return (audience === undefined || (Array.isArray(audience) && audience.every((item) => item === "user" || item === "assistant")))
    && (priority === undefined || typeof priority === "number")
    && (lastModified === undefined || typeof lastModified === "string");
}

function isBase64(value: string): boolean {
  if (value.length === 0) {
    return true;
  }

  if (value.length % 4 !== 0) {
    return false;
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const paddingStart = value.indexOf("=");
  const encoded = paddingStart === -1 ? value : value.slice(0, paddingStart);
  const padding = paddingStart === -1 ? "" : value.slice(paddingStart);
  if (padding.length > 2 || [...padding].some((character) => character !== "=")) {
    return false;
  }
  if ([...encoded].some((character) => !alphabet.includes(character))) {
    return false;
  }

  return Buffer.from(value, "base64").toString("base64") === value;
}

function isPromptContentItem(value: unknown): boolean {
  if (!isContentItem(value)) {
    return false;
  }

  return !(typeof value === "object" && value !== null && hasOwnProperty(value, "type") && value.type === "resource_link");
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}
