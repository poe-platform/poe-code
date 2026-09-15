import * as readline from "readline";
import { compileJsonSchema, formatIssues, type CompiledJsonSchema } from "toolcraft-schema";
import type {
  ServerOptions,
  ToolDefinition,
  ToolHandler,
  CallToolResult,
  InputRequiredResult,
  HandlerRequestContext,
  HandleResult,
  InitializeResult,
  DiscoverResult,
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
  OutputSchema,
  SDKTransport,
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification
} from "./types.js";
import { JSON_RPC_ERROR_CODES, ToolError } from "./types.js";
import {
  parseMessage,
  formatSuccessResponse,
  formatErrorResponse,
  isRequestId
} from "./jsonrpc.js";
import type { TypedSchema, TypedOutputSchema } from "./schema.js";
import { parseUriTemplate, type UriTemplate } from "./uri-template.js";
import { toContentBlocks, type ToolReturn } from "./content/convert.js";
import { ToolCallAdmission } from "./tool-call-admission.js";
import { StdioOutput } from "./stdio-output.js";
import { StdioInput } from "./stdio-input.js";
import { selectRequestProtocol, decorateModernResult, MODERN_PROTOCOL_VERSION } from "./protocol.js";
import { SubscriptionRegistry } from "./subscriptions.js";
import { waitForRequest } from "./request-cancellation.js";
import { isJsonValue } from "./json-value.js";
import { getParameterHeaders, validateParameterHeaders, type ParameterHeader } from "./headers.js";

const PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-03-26", "2025-06-18", PROTOCOL_VERSION, MODERN_PROTOCOL_VERSION]);

export interface Server {
  tool<TIn, TOut = never>(
    name: string,
    description: string,
    inputSchema: TypedSchema<TIn>,
    handler: ToolHandler<TIn, TOut>,
    outputSchema?: TypedOutputSchema<TOut>
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
  handleMessage(
    method: string,
    params?: Record<string, unknown>,
    context?: MessageRequestContext
  ): Promise<HandleResult>;
  listen(): Promise<void>;
  connect(transport: Transport): Promise<void>;
  connectSDK(transport: SDKTransport): Promise<void>;
}

export interface MessageSessionContext {
  readonly signal: AbortSignal;
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
}

export interface MessageRequestContext {
  requestId?: string | number;
  signal?: AbortSignal;
  parameterHeaders?: Record<string, string | string[] | undefined>;
}

export type CustomMethodHandler = (
  params: Record<string, unknown> | undefined,
  session: MessageSessionContext
) => unknown | Promise<unknown>;

export type MessageHandler = (
  method: string,
  params?: Record<string, unknown>,
  context?: MessageRequestContext
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
  admissions: Set<AbortController>;
  requests: Map<string | number | symbol, AbortController>;
  subscriptions: SubscriptionRegistry;
  listener?: (notification: JSONRPCNotification) => void | Promise<void>;
}

function createLifecycleState(
  listener: ((notification: JSONRPCNotification) => void | Promise<void>) | undefined,
  supportNotifications: boolean,
  supportResourceSubscriptions: boolean
): LifecycleState {
  const abortController = new AbortController();
  const admissions = new Set<AbortController>();
  const requests = new Map<string | number | symbol, AbortController>();
  abortController.signal.addEventListener(
    "abort",
    () => {
      for (const admission of admissions) admission.abort(abortController.signal.reason);
      admissions.clear();
      for (const request of requests.values()) request.abort(abortController.signal.reason);
      requests.clear();
    },
    { once: true }
  );
  return {
    initialized: false,
    initializeAccepted: false,
    notificationReady: false,
    resourceSubscriptions: new Set(),
    abortController,
    admissions,
    requests,
    subscriptions: new SubscriptionRegistry(
      listener ?? (() => {}),
      supportNotifications,
      supportResourceSubscriptions
    ),
    listener
  };
}

interface RegisteredToolDefinition extends ToolDefinition {
  inputValidator: CompiledJsonSchema;
  outputValidator?: CompiledJsonSchema;
  parameterHeaders: ParameterHeader[];
}

interface RegisteredResourceTemplateDefinition extends ResourceTemplateDefinition {
  template: UriTemplate;
}

function compileToolSchema(schema: OutputSchema): CompiledJsonSchema {
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
  const maxStdioOutputBytes = options.maxStdioOutputBytes ?? 1024 * 1024;
  const maxPendingStdioMessages = options.maxPendingStdioMessages ?? 128;
  const maxActiveRequests = options.maxActiveRequests ?? 128;
  const maxStdioLineBytes = options.maxStdioLineBytes ?? 1024 * 1024;
  for (const [name, value, minimum] of [
    ["maxConcurrentToolCalls", maxConcurrentToolCalls, 1],
    ["maxQueuedToolCalls", maxQueuedToolCalls, 0],
    ["maxStdioOutputBytes", maxStdioOutputBytes, 1],
    ["maxPendingStdioMessages", maxPendingStdioMessages, 1],
    ["maxActiveRequests", maxActiveRequests, 1],
    ["maxStdioLineBytes", maxStdioLineBytes, 1]
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
  const defaultLifecycle = createLifecycleState(
    (notification) => {
      for (const listener of notificationListeners) listener(notification);
    },
    supportNotifications,
    supportResourceSubscriptions
  );
  const messageLifecycles = new Set<LifecycleState>([defaultLifecycle]);
  let activeRequests = 0;

  const describeCapabilities = (): InitializeResult["capabilities"] => ({
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
  });

  const dispatchMessage = async (
    method: string,
    lifecycle: LifecycleState,
    params?: Record<string, unknown>,
    modern = false,
    requestSignal = lifecycle.abortController.signal,
    parameterHeaders?: Record<string, string | string[] | undefined>
  ): Promise<HandleResult> => {
    const handlerContext: HandlerRequestContext = {
      signal: requestSignal,
      ...(modern && params?.requestState !== undefined
        ? { requestState: params.requestState as string }
        : {}),
      ...(modern && params?.inputResponses !== undefined
        ? { inputResponses: params.inputResponses as Record<string, unknown> }
        : {}),
      clientCapabilities: modern
        ? ((params?._meta as Record<string, unknown>)[
            "io.modelcontextprotocol/clientCapabilities"
          ] as Record<string, unknown>)
        : {}
    };
    if (method === "server/discover") {
      const result: DiscoverResult = {
        resultType: "complete",
        supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS].reverse(),
        capabilities: describeCapabilities(),
        _meta: {
          "io.modelcontextprotocol/serverInfo": { name: options.name, version: options.version }
        },
        ttlMs: 0,
        cacheScope: "private"
      };
      return { result };
    }
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
          requestedProtocol !== undefined && requestedProtocol !== MODERN_PROTOCOL_VERSION &&
          SUPPORTED_PROTOCOL_VERSIONS.has(requestedProtocol)
            ? requestedProtocol
            : PROTOCOL_VERSION,
        capabilities: describeCapabilities(),
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
    if (!modern && !lifecycle.initialized) {
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
        delete (descriptor as Partial<RegisteredToolDefinition>).parameterHeaders;
        if (!modern && descriptor.outputSchema?.type !== "object") delete descriptor.outputSchema;
        toolList.push(structuredClone(descriptor as Tool));
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

      if (params?.arguments !== undefined && !isJsonObject(params.arguments))
        return invalidParams("Tool arguments must be an object");
      const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
      if (modern && parameterHeaders !== undefined) {
        const headerError = validateParameterHeaders(
          tool.parameterHeaders,
          toolArgs,
          parameterHeaders
        );
        if (headerError !== undefined) return { error: { code: -32020, message: headerError } };
      }
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
        let handlerResult: ToolReturn | CallToolResult | InputRequiredResult;
        const admissionController = new AbortController();
        const sessionSignal = requestSignal;
        const admissionSignal = admissionController.signal;
        const cancelAdmission = () => admissionController.abort(sessionSignal.reason);
        if (sessionSignal.aborted) admissionController.abort(sessionSignal.reason);
        else {
          lifecycle.admissions.add(admissionController);
          if (sessionSignal !== lifecycle.abortController.signal)
            sessionSignal.addEventListener("abort", cancelAdmission, { once: true });
        }
        const handlerPromise = (async () => {
          const release = await toolAdmission.acquire(admissionSignal);
          try {
            admissionSignal.throwIfAborted();
            return await tool.handler(toolArgs, { ...handlerContext, signal: admissionSignal });
          } finally {
            release();
          }
        })();
        try {
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
                  admissionController.abort(error);
                  reject(error);
                }, options.toolCallTimeoutMs);
              })
            ]).finally(() => {
              if (timeout !== undefined) {
                clearTimeout(timeout);
              }
            });
          }
        } finally {
          lifecycle.admissions.delete(admissionController);
          sessionSignal.removeEventListener("abort", cancelAdmission);
        }
        if (modern && isInputRequiredResult(handlerResult)) return { result: handlerResult };
        const outputSchema = modern || tool.outputSchema?.type === "object" ? tool.outputSchema : undefined;
        const result = normalizeToolResult(handlerResult, outputSchema, modern);
        const outputValidation = outputSchema === undefined ? undefined : tool.outputValidator?.validate(result.structuredContent);
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
        const result = await prompt.handler(args, handlerContext);
        if (modern && isInputRequiredResult(result)) return { result };
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
        const result = await resource.handler(uri, handlerContext);
        if (modern && isInputRequiredResult(result)) return { result };
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
          signal: requestSignal,
          async notify(notificationMethod, notificationParams) {
            if (
              requestSignal.aborted ||
              (!modern && !lifecycle.notificationReady) ||
              lifecycle.listener === undefined
            ) {
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
        if (error instanceof ToolError) {
          return {
            error: {
              code: error.code,
              message: error.message,
              ...(error.data === undefined ? {} : { data: error.data })
            }
          };
        }
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

  const handleMessageWithLifecycle = async (
    method: string,
    lifecycle: LifecycleState,
    params?: Record<string, unknown>,
    context?: MessageRequestContext
  ): Promise<HandleResult> => {
    if (method === "notifications/cancelled") {
      const id = params?.requestId;
      if (typeof id === "string" || typeof id === "number") {
        lifecycle.requests.get(id)?.abort(new Error("Request cancelled"));
      }
      return { result: undefined };
    }
    const protocol = selectRequestProtocol(method, params, SUPPORTED_PROTOCOL_VERSIONS);
    if (protocol.error !== undefined) return { error: protocol.error };
    const directLegacy = !protocol.modern && context === undefined;
    if (
      protocol.modern &&
      context !== undefined &&
      context.requestId !== undefined &&
      !isRequestId(context.requestId)
    ) {
      return {
        error: { code: JSON_RPC_ERROR_CODES.INVALID_REQUEST, message: "Invalid Request ID" }
      };
    }
    if (activeRequests >= maxActiveRequests) {
      return { error: { code: -32000, message: "Too many active requests" } };
    }
    const key = context?.requestId ?? Symbol("request");
    if (lifecycle.requests.has(key)) {
      return {
        error: {
          code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
          message: "Request ID is already active"
        }
      };
    }
    const controller = new AbortController();
    const parents = context?.signal === undefined ? [] : [context.signal];
    const signal = controller.signal;
    if (lifecycle.abortController.signal.aborted)
      controller.abort(lifecycle.abortController.signal.reason);
    const abort = (event: Event) => controller.abort((event.target as AbortSignal).reason);
    for (const parent of parents) {
      if (parent.aborted) controller.abort(parent.reason);
      else parent.addEventListener("abort", abort, { once: true });
    }
    const cleanup = () => {
      for (const parent of parents) parent.removeEventListener("abort", abort);
    };
    if (signal.aborted) {
      cleanup();
      return { result: undefined };
    }
    lifecycle.requests.set(key, controller);
    activeRequests += 1;
    const operation =
      protocol.modern && method === "subscriptions/listen"
        ? lifecycle.subscriptions.listen(context?.requestId, params?.notifications, signal)
        : dispatchMessage(
            method,
            lifecycle,
            params,
            protocol.modern,
            directLegacy ? lifecycle.abortController.signal : signal,
            context?.parameterHeaders
          );
    const release = () => {
      activeRequests -= 1;
      if (lifecycle.requests.get(key) === controller) lifecycle.requests.delete(key);
    };
    void operation.then(release, release);
    try {
      const handled = directLegacy ? await operation : await waitForRequest(operation, signal);
      if (handled === undefined || (!directLegacy && signal.aborted)) return { result: undefined };
      return protocol.modern
        ? decorateModernResult(
            method,
            handled,
            { name: options.name, version: options.version },
            (params?._meta as Record<string, unknown>)[
              "io.modelcontextprotocol/clientCapabilities"
            ] as Record<string, unknown>
          )
        : handled;
    } finally {
      cleanup();
      controller.abort();
    }
  };

  const createMessageSession = (
    listener?: (notification: JSONRPCNotification) => void | Promise<void>
  ): MessageSession => {
    const lifecycle = createLifecycleState(
      listener,
      supportNotifications,
      supportResourceSubscriptions
    );
    messageLifecycles.add(lifecycle);
    if (listener !== undefined) {
      connectionNotificationListeners.set(listener, lifecycle);
    }

    return {
      handleMessage: (method, params, context) =>
        handleMessageWithLifecycle(method, lifecycle, params, context),
      close: () => {
        lifecycle.abortController.abort();
        if (listener !== undefined) {
          connectionNotificationListeners.delete(listener);
        }
        messageLifecycles.delete(lifecycle);
      }
    };
  };

  const handleMessage: MessageHandler = (method, params, context) =>
    handleMessageWithLifecycle(method, defaultLifecycle, params, context);

  const processLine = async (
    line: string,
    write: (data: string) => Promise<void>,
    messageHandler: MessageHandler,
    subscriptionSignal?: AbortSignal
  ): Promise<void> => {
    const parsed = parseMessage(line);

    if (!parsed.success) {
      await write(formatErrorResponse(parsed.id, parsed.error) + "\n");
      return;
    }

    const { request, isNotification } = parsed;
    if (
      isNotification &&
      !request.method.startsWith("notifications/") &&
      selectRequestProtocol(request.method, request.params, SUPPORTED_PROTOCOL_VERSIONS).modern
    )
      return;

    if (isNotification && request.method === "initialize") {
      return;
    }

    if (!isNotification && request.method === "notifications/initialized") {
      const requestWithId = request as JSONRPCRequest;
      await write(
        formatErrorResponse(requestWithId.id, {
          code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
          message: "Invalid Request"
        }) + "\n"
      );
      return;
    }

    let handled: HandleResult;
    try {
      handled = await messageHandler(
        request.method,
        request.params,
        !isNotification && (request as JSONRPCRequest).id !== null
          ? {
              requestId: (request as JSONRPCRequest).id as string | number,
              ...(request.method === "subscriptions/listen" ? { signal: subscriptionSignal } : {})
            }
          : undefined
      );
    } catch {
      if (!isNotification) {
        const requestWithId = request as JSONRPCRequest;
        await write(
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
      await write(formatErrorResponse(requestWithId.id, error) + "\n");
    } else if (result !== undefined) {
      await write(formatSuccessResponse(requestWithId.id, result) + "\n");
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
      [...messageLifecycles].map((lifecycle) => lifecycle.subscriptions.emit(method, params))
    );
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
      outputSchema?: TypedOutputSchema<TOut>
    ): Server {
      assertNonEmptyName(name, "Tool name required");
      if (tools.has(name)) {
        throw new Error(`Tool already registered: ${name}`);
      }
      const inputSchemaSnapshot = structuredClone(inputSchema);
      const outputSchemaSnapshot = outputSchema === undefined ? undefined : structuredClone(outputSchema);
      const inputValidator = compileToolSchema(inputSchemaSnapshot);
      assertObjectRootSchema(inputSchemaSnapshot, "inputSchema");
      let outputValidator: CompiledJsonSchema | undefined;
      if (outputSchemaSnapshot !== undefined) {
        assertOutputSchema(outputSchemaSnapshot);
        outputValidator = compileToolSchema(outputSchemaSnapshot);
      }
      tools.set(name, {
        name,
        description,
        inputSchema: inputSchemaSnapshot,
        ...(outputSchemaSnapshot === undefined ? {} : { outputSchema: outputSchemaSnapshot }),
        handler: handler as ToolHandler,
        inputValidator,
        parameterHeaders: getParameterHeaders(inputSchemaSnapshot),
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
      const descriptor = structuredClone(definition);
      const inputValidator = compileToolSchema(descriptor.inputSchema);
      assertObjectRootSchema(descriptor.inputSchema, "inputSchema");
      let outputValidator: CompiledJsonSchema | undefined;
      if (descriptor.outputSchema !== undefined) {
        assertOutputSchema(descriptor.outputSchema);
        outputValidator = compileToolSchema(descriptor.outputSchema);
      }
      tools.set(definition.name, {
        ...descriptor,
        handler: handler as ToolHandler,
        inputValidator,
        parameterHeaders: getParameterHeaders(descriptor.inputSchema),
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
        [...messageLifecycles].some(
          (lifecycle) => lifecycle.notificationReady || lifecycle.subscriptions.size > 0
        )
      ) {
        await broadcastNotification("notifications/tools/list_changed");
      }
    },

    async notifyPromptsChanged(): Promise<void> {
      if (
        supportNotifications &&
        [...messageLifecycles].some(
          (lifecycle) => lifecycle.notificationReady || lifecycle.subscriptions.size > 0
        )
      ) {
        await broadcastNotification("notifications/prompts/list_changed");
      }
    },

    async notifyResourcesChanged(): Promise<void> {
      if (
        supportNotifications &&
        [...messageLifecycles].some(
          (lifecycle) => lifecycle.notificationReady || lifecycle.subscriptions.size > 0
        )
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
      return new Promise((resolve, reject) => {
        let inputClosed = false;
        let settled = false;
        const pendingMessages = new Set<Promise<void>>();
        const subscriptions = new AbortController();
        const output = new StdioOutput(transport.writable, maxStdioOutputBytes, fail, finish);
        const listener = (notification: JSONRPCNotification) =>
          output.write(`${JSON.stringify(notification)}\n`);
        const session = server.createMessageSession(listener);
        const input = new StdioInput(maxStdioLineBytes);
        const rl = readline.createInterface({
          input,
          crlfDelay: Infinity
        });

        function fail(error: unknown): void {
          if (settled) return;
          settled = true;
          session.close();
          rl.close();
          transport.readable.unpipe(input);
          input.destroy();
          transport.readable.pause();
          transport.readable.off("error", fail);
          output.abort(error);
          pendingMessages.clear();
          reject(error);
        }

        function finish(): void {
          if (settled || !inputClosed || pendingMessages.size > 0 || output.pending > 0) return;
          settled = true;
          session.close();
          transport.readable.unpipe(input);
          input.destroy();
          transport.readable.off("error", fail);
          output.close();
          resolve();
        }

        transport.readable.on("error", fail);
        input.on("error", fail);
        rl.on("error", fail);

        rl.on("line", (line) => {
          if (settled) return;
          if (pendingMessages.size >= maxPendingStdioMessages) {
            fail(new Error("Stdio pending message limit exceeded"));
            return;
          }
          const message = processLine(
            line,
            (data) => output.write(data),
            session.handleMessage,
            subscriptions.signal
          );
          if (!settled) pendingMessages.add(message);
          void message.then(() => {
            pendingMessages.delete(message);
            finish();
          }, fail);
        });

        rl.on("close", () => {
          inputClosed = true;
          subscriptions.abort();
          finish();
        });
        transport.readable.pipe(input);
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
            if (
              !message.method.startsWith("notifications/") &&
              selectRequestProtocol(message.method, message.params, SUPPORTED_PROTOCOL_VERSIONS)
                .modern
            )
              return;
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
          if (
            selectRequestProtocol(request.method, request.params, SUPPORTED_PROTOCOL_VERSIONS)
              .modern &&
            !isRequestId(request.id)
          ) {
            await transport.send({
              jsonrpc: "2.0",
              id: null,
              error: { code: JSON_RPC_ERROR_CODES.INVALID_REQUEST, message: "Invalid Request ID" }
            });
            return;
          }
          let handled: HandleResult;
          try {
            handled = await session.handleMessage(
              request.method,
              request.params,
              request.id === null ? undefined : { requestId: request.id }
            );
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

function isInputRequiredResult(value: unknown): value is InputRequiredResult {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).resultType === "input_required"
  );
}

function isCallToolResult(value: unknown, modern: boolean): value is CallToolResult {
  if (!hasContentArray(value) || !value.content.every(isContentItem)) {
    return false;
  }

  if (
    hasOwnProperty(value, "structuredContent") &&
    value.structuredContent !== undefined &&
    !(isJsonValue(value.structuredContent) && (modern || isJsonObject(value.structuredContent)))
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
  outputSchema: OutputSchema | undefined,
  modern: boolean
): CallToolResult {
  if (hasContentArray(handlerResult) && !isCallToolResult(handlerResult, modern)) {
    throw new Error("Invalid tool result");
  }

  if (outputSchema === undefined) {
    const result = isCallToolResult(handlerResult, modern)
      ? handlerResult
      : { content: toContentBlocks(handlerResult as ToolReturn) };
    if (!isCallToolResult(result, modern)) {
      throw new Error("Invalid tool result");
    }

    return result;
  }

  if (isCallToolResult(handlerResult, modern) && handlerResult.isError === true) {
    return handlerResult;
  }

  const callToolResult = isCallToolResult(handlerResult, modern) ? handlerResult : undefined;
  const structuredContent = callToolResult ? callToolResult.structuredContent : handlerResult;

  if (!(isJsonValue(structuredContent) && (modern || isJsonObject(structuredContent)))) {
    throw new ToolError(
      JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
      modern ? "Structured tool result must be JSON" : "Structured tool result must be a JSON object"
    );
  }

  return {
    ...callToolResult,
    content:
      callToolResult !== undefined && callToolResult.content.length > 0
        ? callToolResult.content
        : [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent
  };
}

function assertObjectRootSchema(schema: JSONSchema, path: string): void {
  if (schema.type !== "object") {
    throw new Error(`${path} root type must be "object"`);
  }
}

function assertOutputSchema(schema: OutputSchema): void {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema))
    throw new Error("outputSchema must be a JSON Schema object");
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
