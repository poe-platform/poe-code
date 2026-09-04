import * as readline from "readline";
import { compileJsonSchema, formatIssues, type CompiledJsonSchema } from "toolcraft-schema";
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
  JSONRPCNotification
} from "./types.js";
import { JSON_RPC_ERROR_CODES, ToolError } from "./types.js";
import { parseMessage, formatSuccessResponse, formatErrorResponse } from "./jsonrpc.js";
import type { TypedSchema } from "./schema.js";
import { parseUriTemplate, type UriTemplate } from "./uri-template.js";
import { toContentBlocks, type ToolReturn } from "./content/convert.js";
import { ToolCallAdmission } from "./tool-call-admission.js";

const PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-03-26", "2025-06-18", PROTOCOL_VERSION]);

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
  method(name: string, handler: CustomMethodHandler): Server;
  onNotification(listener: (notification: JSONRPCNotification) => void): () => void;
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
  handleMessage(method: string, params?: Record<string, unknown>): Promise<HandleResult>;
  listen(): Promise<void>;
  connect(transport: Transport): Promise<void>;
  connectSDK(transport: SDKTransport): Promise<void>;
}

export interface MessageSessionContext {
  readonly signal: AbortSignal;
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
}

export type CustomMethodHandler = (
  params: Record<string, unknown> | undefined,
  session: MessageSessionContext
) => unknown | Promise<unknown>;

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
  abortController: AbortController;
  listener?: (notification: JSONRPCNotification) => void | Promise<void>;
}

interface RegisteredToolDefinition extends ToolDefinition {
  inputValidator: CompiledJsonSchema;
  outputValidator?: CompiledJsonSchema;
}

interface RegisteredResourceTemplateDefinition extends ResourceTemplateDefinition {
  template: UriTemplate;
}

function compileToolSchema(schema: JSONSchema): CompiledJsonSchema {
  try {
    return compileJsonSchema(schema);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`schema is invalid: ${message}`, { cause: error });
  }
}

export function createServer(options: ServerOptions): Server {
  if (
    options.toolCallTimeoutMs !== undefined &&
    (!Number.isInteger(options.toolCallTimeoutMs) || options.toolCallTimeoutMs <= 0)
  ) {
    throw new Error("toolCallTimeoutMs must be a positive integer.");
  }

  const maxConcurrentToolCalls = options.maxConcurrentToolCalls ?? 4;
  const maxQueuedToolCalls = options.maxQueuedToolCalls ?? 64;
  for (const [name, value, minimum] of [
    ["maxConcurrentToolCalls", maxConcurrentToolCalls, 1],
    ["maxQueuedToolCalls", maxQueuedToolCalls, 0]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new Error(`${name} must be a safe integer greater than or equal to ${minimum}.`);
    }
  }
  const toolAdmission = new ToolCallAdmission(maxConcurrentToolCalls, maxQueuedToolCalls);

  const supportNotifications = options.supportNotifications !== false;
  const supportResourceSubscriptions = options.supportResourceSubscriptions !== false;
  const tools = new Map<string, RegisteredToolDefinition>();
  const prompts = new Map<string, PromptDefinition>();
  const resources = new Map<string, ResourceDefinition>();
  const resourceTemplates = new Map<string, RegisteredResourceTemplateDefinition>();
  const methods = new Map<string, CustomMethodHandler>();
  const notificationListeners = new Set<(notification: JSONRPCNotification) => void>();
  const connectionNotificationListeners = new Map<
    (notification: JSONRPCNotification) => void | Promise<void>,
    LifecycleState
  >();
  const defaultLifecycle: LifecycleState = {
    initialized: false,
    initializeAccepted: false,
    notificationReady: false,
    resourceSubscriptions: new Set(),
    abortController: new AbortController()
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
        typeof params?.protocolVersion === "string" ? params.protocolVersion : undefined;
      const result: InitializeResult = {
        protocolVersion:
          requestedProtocol !== undefined && SUPPORTED_PROTOCOL_VERSIONS.has(requestedProtocol)
            ? requestedProtocol
            : PROTOCOL_VERSION,
        capabilities: {
          tools: {
            ...(supportNotifications ? { listChanged: true } : {})
          },
          prompts: {
            ...(supportNotifications ? { listChanged: true } : {})
          },
          resources: {
            ...(supportNotifications ? { listChanged: true } : {}),
            ...(supportResourceSubscriptions ? { subscribe: true } : {})
          }
        },
        serverInfo: {
          name: options.name,
          version: options.version
        }
      };
      return { result };
    }

    if (method === "notifications/initialized") {
      if (!lifecycle.initializeAccepted) {
        return {
          error: {
            code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
            message: "Server not initialized"
          }
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
          message: "Server not initialized"
        }
      };
    }

    if (method === "tools/list") {
      const toolList: Tool[] = [];
      for (const tool of tools.values()) {
        const descriptor = { ...tool };
        delete (descriptor as Partial<RegisteredToolDefinition>).handler;
        delete (descriptor as Partial<RegisteredToolDefinition>).inputValidator;
        delete (descriptor as Partial<RegisteredToolDefinition>).outputValidator;
        toolList.push({
          ...(descriptor as Tool)
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
            message: "Tool name required"
          }
        };
      }

      const tool = tools.get(toolName);
      if (!tool) {
        const availableTools = [...tools.keys()].slice(0, 20);
        return {
          error: {
            code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
            message: `Tool not found: ${toolName}${
              availableTools.length === 0 ? "" : `. Available: ${availableTools.join(", ")}`
            }`
          }
        };
      }

      const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
      const inputValidation = tool.inputValidator.validate(toolArgs);
      if (options.validateToolArguments !== false && !inputValidation.ok) {
        return {
          error: {
            code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
            message: `Invalid tool arguments: ${formatIssues(inputValidation.issues)}`,
            data: inputValidation.issues
          }
        };
      }

      try {
        let handlerResult: ToolReturn | CallToolResult;
        const admissionTimeout = options.toolCallTimeoutMs === undefined ? undefined : new AbortController();
        const admissionSignal = AbortSignal.any([
          lifecycle.abortController.signal,
          ...(admissionTimeout === undefined ? [] : [admissionTimeout.signal])
        ]);
        const handlerPromise = (async () => {
          const release = await toolAdmission.acquire(admissionSignal);
          try {
            admissionSignal.throwIfAborted();
            return await tool.handler(toolArgs);
          } finally { release(); }
        })();
        if (options.toolCallTimeoutMs === undefined) {
          handlerResult = await handlerPromise;
        } else {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          handlerResult = await Promise.race([
            handlerPromise,
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(() => {
                const error = new ToolError(
                  JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
                  `Tool call timed out: ${toolName}`
                );
                admissionTimeout!.abort(error);
                reject(error);
              }, options.toolCallTimeoutMs);
            })
          ]).finally(() => {
            if (timeout !== undefined) {
              clearTimeout(timeout);
            }
          });
        }
        const result = normalizeToolResult(handlerResult, tool.outputSchema);
        const outputValidation = tool.outputValidator?.validate(result.structuredContent);
        if (result.isError !== true && outputValidation !== undefined && !outputValidation.ok) {
          throw new ToolError(
            JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
            `Invalid structured tool result: ${formatIssues(outputValidation.issues)}`,
            outputValidation.issues
          );
        }
        return { result };
      } catch (err) {
        if (err instanceof ToolError) {
          return {
            error: {
              code: err.code,
              message: err.message,
              ...(err.data === undefined ? {} : { data: err.data })
            }
          };
        }

        const errorMessage = err instanceof Error ? err.message : String(err);
        const result: CallToolResult = {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true
        };
        return { result };
      }
    }

    if (method === "prompts/list") {
      return {
        result: {
          prompts: [...prompts.values()].map(({ handler: _handler, ...prompt }) => prompt)
        }
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
          resources: [...resources.values()].map(({ handler: _handler, ...resource }) => resource)
        }
      };
    }

    if (method === "resources/templates/list") {
      return {
        result: {
          resourceTemplates: [...resourceTemplates.values()].map(
            ({ handler: _handler, template: _template, ...resourceTemplate }) => resourceTemplate
          )
        }
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
            message: "Method not found"
          }
        };
      }
      const uri = typeof params?.uri === "string" ? params.uri : undefined;
      if (uri === undefined || !isValidUri(uri)) {
        return invalidParams("Resource URI required");
      }
      if (
        method === "resources/subscribe" &&
        findReadableResource(uri, resources, resourceTemplates) === undefined
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

    const customMethod = methods.get(method);
    if (customMethod !== undefined) {
      try {
        const result = await customMethod(params, {
          signal: lifecycle.abortController.signal,
          async notify(notificationMethod, notificationParams) {
            if (!lifecycle.notificationReady || lifecycle.listener === undefined) {
              return;
            }
            await lifecycle.listener({
              jsonrpc: "2.0",
              method: notificationMethod,
              ...(notificationParams === undefined ? {} : { params: notificationParams })
            });
          }
        });
        return { result };
      } catch (error) {
        return internalError(toErrorMessage(error));
      }
    }

    return {
      error: {
        code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
        message: "Method not found"
      }
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
      abortController: new AbortController(),
      listener
    };
    messageLifecycles.add(lifecycle);
    if (listener !== undefined) {
      connectionNotificationListeners.set(listener, lifecycle);
    }

    return {
      handleMessage: (method, params) => handleMessageWithLifecycle(method, lifecycle, params),
      close: () => {
        lifecycle.abortController.abort();
        if (listener !== undefined) {
          connectionNotificationListeners.delete(listener);
        }
        messageLifecycles.delete(lifecycle);
      }
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
      write(
        formatErrorResponse(requestWithId.id, {
          code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
          message: "Invalid Request"
        }) + "\n"
      );
      return;
    }

    let handled: HandleResult;
    try {
      handled = await messageHandler(request.method, request.params);
    } catch {
      if (!isNotification) {
        const requestWithId = request as JSONRPCRequest;
        write(
          formatErrorResponse(requestWithId.id, {
            code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
            message: "Internal error"
          }) + "\n"
        );
      }
      return;
    }

    const { result, error } = handled;

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
      ...(params === undefined ? {} : { params })
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
      if (tools.has(name)) {
        throw new Error(`Tool already registered: ${name}`);
      }
      const inputValidator = compileToolSchema(inputSchema as JSONSchema);
      let outputValidator: CompiledJsonSchema | undefined;
      if (outputSchema !== undefined) {
        assertObjectRootSchema(outputSchema, "outputSchema");
        outputValidator = compileToolSchema(outputSchema as JSONSchema);
      }
      tools.set(name, {
        name,
        description,
        inputSchema: inputSchema as JSONSchema,
        ...(outputSchema === undefined ? {} : { outputSchema: outputSchema as JSONSchema }),
        handler: handler as ToolHandler,
        inputValidator,
        ...(outputValidator === undefined ? {} : { outputValidator })
      });
      return server;
    },

    registerTool<TIn, TOut = never>(
      definition: Omit<ToolDefinition<TIn, TOut>, "handler">,
      handler: ToolHandler<TIn, TOut>
    ): Server {
      assertNonEmptyName(definition.name, "Tool name required");
      if (tools.has(definition.name)) {
        throw new Error(`Tool already registered: ${definition.name}`);
      }
      const inputValidator = compileToolSchema(definition.inputSchema);
      let outputValidator: CompiledJsonSchema | undefined;
      if (definition.outputSchema !== undefined) {
        assertObjectRootSchema(definition.outputSchema, "outputSchema");
        outputValidator = compileToolSchema(definition.outputSchema);
      }
      tools.set(definition.name, {
        ...definition,
        handler: handler as ToolHandler,
        inputValidator,
        ...(outputValidator === undefined ? {} : { outputValidator })
      });
      return server;
    },

    prompt(definition: Prompt, handler: PromptHandler): Server {
      assertNonEmptyName(definition.name, "Prompt name required");
      if (prompts.has(definition.name)) {
        throw new Error(`Prompt already registered: ${definition.name}`);
      }
      prompts.set(definition.name, { ...definition, handler });
      return server;
    },

    resource(definition: Resource, handler: ResourceHandler): Server {
      if (!isValidUri(definition.uri)) {
        throw new Error(`Invalid resource URI: ${definition.uri}`);
      }
      if (resources.has(definition.uri)) {
        throw new Error(`Resource already registered: ${definition.uri}`);
      }
      resources.set(definition.uri, { ...definition, handler });
      return server;
    },

    resourceTemplate(definition: ResourceTemplate, handler: ResourceHandler): Server {
      const template = parseReadableUriTemplate(definition.uriTemplate);
      if (resourceTemplates.has(definition.uriTemplate)) {
        throw new Error(`Resource template already registered: ${definition.uriTemplate}`);
      }
      resourceTemplates.set(definition.uriTemplate, { ...definition, handler, template });
      return server;
    },

    method(name: string, handler: CustomMethodHandler): Server {
      assertNonEmptyName(name, "Method name required");
      methods.set(name, handler);
      return server;
    },

    onNotification(listener: (notification: JSONRPCNotification) => void): () => void {
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
      if (
        supportNotifications &&
        [...messageLifecycles].some((lifecycle) => lifecycle.notificationReady)
      ) {
        await broadcastNotification("notifications/tools/list_changed");
      }
    },

    async notifyPromptsChanged(): Promise<void> {
      if (
        supportNotifications &&
        [...messageLifecycles].some((lifecycle) => lifecycle.notificationReady)
      ) {
        await broadcastNotification("notifications/prompts/list_changed");
      }
    },

    async notifyResourcesChanged(): Promise<void> {
      if (
        supportNotifications &&
        [...messageLifecycles].some((lifecycle) => lifecycle.notificationReady)
      ) {
        await broadcastNotification("notifications/resources/list_changed");
      }
    },

    async notifyResourceUpdated(uri: string): Promise<void> {
      if (!supportResourceSubscriptions) {
        return;
      }
      await broadcastNotification("notifications/resources/updated", { uri }, (lifecycle) =>
        lifecycle.resourceSubscriptions.has(uri)
      );
    },

    createMessageSession,
    handleMessage,

    async listen(): Promise<void> {
      return server.connect({
        readable: process.stdin,
        writable: process.stdout
      });
    },

    async connect(transport: Transport): Promise<void> {
      return new Promise((resolve) => {
        const listener = (notification: JSONRPCNotification) => {
          transport.writable.write(`${JSON.stringify(notification)}\n`);
        };
        const session = server.createMessageSession(listener);
        const rl = readline.createInterface({
          input: transport.readable,
          crlfDelay: Infinity
        });
        const pendingMessages = new Set<Promise<void>>();

        rl.on("line", (line) => {
          const message = processLine(
            line,
            (data) => transport.writable.write(data),
            session.handleMessage
          );
          pendingMessages.add(message);
          void message.finally(() => {
            pendingMessages.delete(message);
          });
        });

        rl.on("close", async () => {
          await Promise.all([...pendingMessages]);
          session.close();
          resolve();
        });
      });
    },

    async connectSDK(transport: SDKTransport): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const listener = (notification: JSONRPCNotification) => transport.send(notification);
        const session = server.createMessageSession(listener);

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

            try {
              await session.handleMessage(message.method, message.params);
            } catch {
              return;
            }
            return;
          }

          if (message.method === "notifications/initialized") {
            await transport.send({
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
                message: "Invalid Request"
              }
            });
            return;
          }

          const request = message as JSONRPCRequest;
          let handled: HandleResult;
          try {
            handled = await session.handleMessage(request.method, request.params);
          } catch {
            await transport.send({
              jsonrpc: "2.0",
              id: request.id,
              error: {
                code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
                message: "Internal error"
              }
            });
            return;
          }

          const { result, error } = handled;

          if (error) {
            const response: JSONRPCResponse = {
              jsonrpc: "2.0",
              id: request.id,
              error
            };
            await transport.send(response);
          } else if (result !== undefined) {
            const response: JSONRPCResponse = {
              jsonrpc: "2.0",
              id: request.id,
              result
            };
            await transport.send(response);
          }
        };

        transport.onclose = () => {
          session.close();
          resolve();
        };

        void transport.start().catch((error: unknown) => {
          session.close();
          reject(error);
        });
      });
    }
  };

  return server;
}

function invalidParams(message: string): HandleResult {
  return {
    error: {
      code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
      message
    }
  };
}

function internalError(message: string): HandleResult {
  return {
    error: {
      code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
      message
    }
  };
}

function resourceNotFound(uri: string): HandleResult {
  return {
    error: {
      code: JSON_RPC_ERROR_CODES.RESOURCE_NOT_FOUND,
      message: `Resource not found: ${uri}`
    }
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

function parseReadableUriTemplate(uriTemplate: string): UriTemplate {
  const template = parseUriTemplate(uriTemplate);
  if (!isValidUri(template.expand({}))) {
    throw new Error(`Invalid resource URI template: ${uriTemplate}`);
  }
  return template;
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
  resourceTemplates: Map<string, RegisteredResourceTemplateDefinition>
): ResourceDefinition | ResourceTemplateDefinition | undefined {
  const resource = resources.get(uri);
  if (resource !== undefined) {
    return resource;
  }

  return [...resourceTemplates.values()].find((template) => template.template.match(uri) !== null);
}

function isCallToolResult(value: unknown): value is CallToolResult {
  if (!hasContentArray(value) || !value.content.every(isContentItem)) {
    return false;
  }

  if (
    hasOwnProperty(value, "structuredContent") &&
    value.structuredContent !== undefined &&
    !isJsonObject(value.structuredContent)
  ) {
    return false;
  }

  return !(
    hasOwnProperty(value, "isError") &&
    value.isError !== undefined &&
    typeof value.isError !== "boolean"
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

  if (isCallToolResult(handlerResult) && handlerResult.isError === true) {
    return handlerResult;
  }

  const callToolResult = isCallToolResult(handlerResult) ? handlerResult : undefined;
  const structuredContent = callToolResult ? callToolResult.structuredContent : handlerResult;

  if (!isJsonObject(structuredContent)) {
    throw new ToolError(
      JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
      "Structured tool result must be an object"
    );
  }

  return {
    content:
      callToolResult !== undefined && callToolResult.content.length > 0
        ? callToolResult.content
        : [{ type: "text", text: JSON.stringify(structuredContent) }],
    ...(callToolResult?.isError !== undefined ? { isError: callToolResult.isError } : {}),
    structuredContent
  };
}

function assertObjectRootSchema(schema: JSONSchema, path: string): void {
  if (schema.type !== "object") {
    throw new Error(`${path} root type must be "object"`);
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGetPromptResult(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !hasOwnProperty(value, "messages")) {
    return false;
  }

  return (
    (!hasOwnProperty(value, "description") ||
      value.description === undefined ||
      typeof value.description === "string") &&
    Array.isArray(value.messages) &&
    value.messages.every(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        hasOwnProperty(message, "role") &&
        (message.role === "user" || message.role === "assistant") &&
        hasOwnProperty(message, "content") &&
        isPromptContentItem(message.content)
    )
  );
}

function isReadResourceResult(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !hasOwnProperty(value, "contents")) {
    return false;
  }

  return Array.isArray(value.contents) && value.contents.every(isResourceContents);
}

function hasContentArray(value: unknown): value is { content: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "content") &&
    Array.isArray((value as { content: unknown }).content)
  );
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
    return (
      hasOwnProperty(block, "data") &&
      typeof block.data === "string" &&
      isBase64(block.data) &&
      hasOwnProperty(block, "mimeType") &&
      typeof block.mimeType === "string"
    );
  }

  if (block.type === "resource_link") {
    return (
      hasOwnProperty(block, "uri") &&
      typeof block.uri === "string" &&
      isValidUri(block.uri) &&
      hasOwnProperty(block, "name") &&
      typeof block.name === "string" &&
      (!hasOwnProperty(block, "title") ||
        block.title === undefined ||
        typeof block.title === "string") &&
      (!hasOwnProperty(block, "description") ||
        block.description === undefined ||
        typeof block.description === "string") &&
      (!hasOwnProperty(block, "mimeType") ||
        block.mimeType === undefined ||
        typeof block.mimeType === "string") &&
      (!hasOwnProperty(block, "size") || block.size === undefined || typeof block.size === "number")
    );
  }

  if (
    block.type !== "resource" ||
    !hasOwnProperty(block, "resource") ||
    typeof block.resource !== "object" ||
    block.resource === null
  ) {
    return false;
  }

  return isResourceContents(block.resource);
}

function isResourceContents(value: unknown): boolean {
  if (
    typeof value !== "object" ||
    value === null ||
    !hasOwnProperty(value, "uri") ||
    typeof value.uri !== "string" ||
    !isValidUri(value.uri)
  ) {
    return false;
  }

  if (
    hasOwnProperty(value, "mimeType") &&
    value.mimeType !== undefined &&
    typeof value.mimeType !== "string"
  ) {
    return false;
  }

  return (
    (hasOwnProperty(value, "text") && typeof value.text === "string") ||
    (hasOwnProperty(value, "blob") && typeof value.blob === "string" && isBase64(value.blob))
  );
}

function hasValidContentAnnotations(value: Record<string, unknown>): boolean {
  if (!hasOwnProperty(value, "annotations") || value.annotations === undefined) {
    return true;
  }

  if (!isJsonObject(value.annotations)) {
    return false;
  }

  const { audience, priority, lastModified } = value.annotations;
  return (
    (audience === undefined ||
      (Array.isArray(audience) &&
        audience.every((item) => item === "user" || item === "assistant"))) &&
    (priority === undefined || typeof priority === "number") &&
    (lastModified === undefined || typeof lastModified === "string")
  );
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

  return !(
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "type") &&
    value.type === "resource_link"
  );
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}
