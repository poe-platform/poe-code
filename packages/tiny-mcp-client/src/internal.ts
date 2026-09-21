import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";
import { PassThrough } from "node:stream";
import type { Readable, Writable } from "node:stream";
import { HttpResponseMessages } from "./http-message-validation.js";
import { SubscriptionManager, type NotificationFilter, type SubscriptionOptions, type McpSubscription } from "./subscriptions.js";
export type { NotificationFilter, SubscriptionOptions, McpSubscription } from "./subscriptions.js";
import { isBase64, isJsonValue, isValidUri, isValidMetadata, validateCacheMetadata, validateProtocolValue, validateServerResult, validateInputRequiredResult } from "tiny-stdio-mcp-server/protocol";
import { readBoundedResponseText } from "./http-response.js";
import type { JSONRPCMessage as SdkJsonRpcMessage } from "@modelcontextprotocol/sdk/types.js";
import {
  createOAuthClientProvider,
  fetchMcpResponse,
  OAuthError,
  type OAuthClientProvider,
  type OAuthClientProviderOptions,
  type StoredOAuthTokens,
} from "mcp-oauth";
export { fetchMcpResponse } from "mcp-oauth";
import type { Tool as CoreTool, ContentItem as CoreContentItem, ResourceContents as CoreResourceContents, Server as TinyStdioMcpServer } from "tiny-stdio-mcp-server";
export type { Implementation, ResourceLink, Resource, ResourceTemplate, Prompt, PromptArgument, ToolAnnotations, Icon, ContentAnnotations, ToolExecution } from "tiny-stdio-mcp-server";
import type { Implementation, Resource, ResourceTemplate, Prompt } from "tiny-stdio-mcp-server";
import {
  encodeHeaderValue,
  getParameterHeaders,
  createParameterHeaders,
  type ParameterHeader
} from "tiny-stdio-mcp-server/headers";
import {
  OAuthMetadataDiscovery,
  parseBearerWwwAuthenticateHeader,
} from "./oauth-discovery.js";
import type {
  OAuthDiscoveryCache,
} from "./oauth-discovery.js";

export {
  OAuthMetadataDiscovery,
  discoverOAuthMetadata,
  parseBearerWwwAuthenticateHeader,
  resolveAuthorizationServerMetadataUrl,
  resolveProtectedResourceMetadataUrl,
} from "./oauth-discovery.js";
export {
  createAuthStoreSessionStore,
  createDefaultOAuthClientProvider,
} from "mcp-oauth";
export type {
  OAuthDiscoveryCache,
} from "./oauth-discovery.js";
export type { OAuthAuthorizationServerMetadata, OAuthDiscoveryResult, OAuthMetadataFetch, OAuthProtectedResourceMetadata, OAuthUnauthorizedChallenge } from "./oauth-discovery.js";
export type {
  DefaultOAuthClientProviderOptions,
  OAuthClientProvider,
  OAuthClientProviderOptions,
  OAuthSessionStore,
  StoredOAuthSession,
} from "mcp-oauth";

function isValidParamsMetadata(params: unknown): boolean {
  const property = isObjectRecord(params) ? Object.getOwnPropertyDescriptor(params, "_meta") : undefined;
  return property === undefined || property.enumerable !== true ||
    ("value" in property && isValidMetadata(property.value));
}

export type RequestId = number | string;

const inputResponseTypes = {
  "roots/list": "ListRootsResult",
  "sampling/createMessage": "CreateMessageResult",
  "elicitation/create": "ElicitResult"
} as const;


export interface ClientCapabilities {
  extensions?: Record<string, Record<string, unknown>>;
  elicitation?: { form?: Record<string, unknown>; url?: Record<string, unknown> };
  roots?: {
    listChanged?: boolean;
    [key: string]: unknown;
  };
  sampling?: {
    [key: string]: unknown;
  };
  experimental?: Record<string, unknown>;
}

export interface ServerCapabilities {
  extensions?: Record<string, Record<string, unknown>>;
  prompts?: {
    listChanged?: boolean;
    [key: string]: unknown;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
    [key: string]: unknown;
  };
  tools?: {
    listChanged?: boolean;
    [key: string]: unknown;
  };
  logging?: {
    [key: string]: unknown;
  };
  completions?: {
    [key: string]: unknown;
  };
  experimental?: Record<string, unknown>;
}

export interface InitializeParams {
  protocolVersion: string;
  capabilities: ClientCapabilities;
  clientInfo: Implementation;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: Implementation;
  instructions?: string;
}

export interface ConnectResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo?: Implementation;
  instructions?: string;
}

export type ElicitationParams =
  | { mode?: "form"; message: string; requestedSchema: Record<string, unknown> }
  | { mode: "url"; message: string; url: string; elicitationId: string };

export interface ElicitationResult {
  _meta?: Record<string, unknown>;
  action: "accept" | "decline" | "cancel";
  content?: Record<string, string | number | boolean | string[]>;
}

export interface McpClientOptions {
  clientInfo: Implementation;
  requestTimeoutMs?: number;
  maxConcurrentRequests?: number;
  protocolVersion?: "2025-03-26" | "2026-07-28";
  capabilities?: ClientCapabilities;
  onToolsChanged?: () => void | Promise<void>;
  onResourcesChanged?: () => void | Promise<void>;
  onResourceUpdated?: (uri: string) => void | Promise<void>;
  onPromptsChanged?: () => void | Promise<void>;
  onLog?: (message: LogMessage) => void | Promise<void>;
  onProgress?: (params: ProgressParams) => void | Promise<void>;
  onSamplingRequest?: (
    params: CreateMessageParams,
    context: McpRequestContext
  ) => CreateMessageResult | Promise<CreateMessageResult>;
  onRootsList?: (context: McpRequestContext) => Root[] | Promise<Root[]>;
  onElicitationRequest?: (params: ElicitationParams, context: McpRequestContext) => ElicitationResult | Promise<ElicitationResult>;
}

const MCP_PROTOCOL_VERSION = "2025-03-26";

export class McpClient {
  private currentState: "disconnected" | "initializing" | "ready" | "closed" = "disconnected";
  private currentServerCapabilities: ServerCapabilities | null = null;
  private currentClientCapabilities: ClientCapabilities | null = null;
  private currentServerInfo: Implementation | null = null;
  private currentInstructions: string | undefined;
  private readonly subscribedResourceUris = new Set<string>();
  private readonly activeProgressTokens = new Map<ProgressToken, number>();
  private readonly options: McpClientOptions;
  private transport: McpTransport | null = null;
  private messageLayer: JsonRpcMessageLayer | null = null;
  private subscriptions: SubscriptionManager | null = null;
  private readonly resourceSubscriptions = new Map<string, { controller: AbortController; subscription: Promise<McpSubscription> }>();

  constructor(options: McpClientOptions) {
    this.options = options;
  }

  get state(): "disconnected" | "initializing" | "ready" | "closed" {
    return this.currentState;
  }

  get serverCapabilities(): ServerCapabilities | null {
    return this.currentServerCapabilities === null
      ? null
      : structuredClone(this.currentServerCapabilities);
  }

  get serverInfo(): Implementation | null {
    return this.currentServerInfo === null ? null : structuredClone(this.currentServerInfo);
  }

  get instructions(): string | undefined {
    return this.currentInstructions;
  }

  private getMessageLayerOrThrow(): JsonRpcMessageLayer {
    if (this.currentState === "disconnected") {
      throw new Error("MCP client is disconnected");
    }

    if (this.currentState === "closed") {
      throw new Error("MCP client is closed");
    }

    if (this.messageLayer === null) {
      throw new Error("MCP client is disconnected");
    }

    return this.messageLayer;
  }

  async connect(transport: McpTransport, options: { signal?: AbortSignal } = {}): Promise<ConnectResult> {
    options.signal?.throwIfAborted();
    if (this.currentState !== "disconnected" && this.currentState !== "closed") {
      throw new Error("MCP client is already connected");
    }

    this.currentServerCapabilities = null;
    this.currentClientCapabilities = null;
    this.currentServerInfo = null;
    this.currentInstructions = undefined;
    this.subscribedResourceUris.clear();
    this.activeProgressTokens.clear();

    const transportClosedReason = transport.closed
      .then((closedEvent) => closedEvent.reason)
      .catch((error: unknown) =>
        error instanceof Error ? error : new Error(String(error))
      );
    const messageLayer = new JsonRpcMessageLayer(
      transport.readable,
      transport.writable,
      this.options.requestTimeoutMs,
      transportClosedReason,
      this.options.maxConcurrentRequests
    );
    this.subscriptions = null;
    this.resourceSubscriptions.clear();
    const {
      onSamplingRequest,
      onRootsList,
      onToolsChanged,
      onResourcesChanged,
      onResourceUpdated,
      onPromptsChanged,
      onLog,
      onProgress,
    } = this.options;

    messageLayer.onRequest("ping", () => ({}));

    if (onSamplingRequest !== undefined) {
      messageLayer.onRequest("sampling/createMessage", (params, context) =>
        onSamplingRequest(params as CreateMessageParams, context)
      );
    }

    messageLayer.onNotification("notifications/tools/list_changed", async (params) => {
      if (onToolsChanged === undefined) return;
      if (messageLayer.requestMetadata !== undefined) {
        if (!this.subscriptions?.accepts("notifications/tools/list_changed", params)) return;
      } else if (this.currentServerCapabilities?.tools?.listChanged !== true) return;
      await onToolsChanged();
    });
    messageLayer.onNotification("notifications/resources/list_changed", async (params) => {
      if (onResourcesChanged === undefined) return;
      if (messageLayer.requestMetadata !== undefined) {
        if (!this.subscriptions?.accepts("notifications/resources/list_changed", params)) return;
      } else if (this.currentServerCapabilities?.resources?.listChanged !== true) return;
      await onResourcesChanged();
    });
    messageLayer.onNotification("notifications/resources/updated", async (params) => {
      if (onResourceUpdated === undefined) {
        return;
      }

      if (typeof params !== "object" || params === null || Array.isArray(params)) {
        return;
      }

      if (messageLayer.requestMetadata !== undefined && !this.subscriptions?.accepts("notifications/resources/updated", params)) return;
      const { uri } = params as { uri?: unknown };
      if (typeof uri !== "string" || (messageLayer.requestMetadata === undefined && !this.subscribedResourceUris.has(uri))) {
        return;
      }

      await onResourceUpdated(uri);
    });
    messageLayer.onNotification("notifications/prompts/list_changed", async (params) => {
      if (onPromptsChanged === undefined) return;
      if (messageLayer.requestMetadata !== undefined) {
        if (!this.subscriptions?.accepts("notifications/prompts/list_changed", params)) return;
      } else if (this.currentServerCapabilities?.prompts?.listChanged !== true) return;
      await onPromptsChanged();
    });
    messageLayer.onNotification("notifications/message", async (params) => {
      if (onLog === undefined || !isObjectRecord(params) || !isLogLevel(params.level)) {
        return;
      }

      if (!hasOwn(params, "data")) {
        return;
      }

      const message: LogMessage = {
        level: params.level,
        data: params.data,
      };

      if (params.logger !== undefined) {
        if (typeof params.logger !== "string") {
          return;
        }

        message.logger = params.logger;
      }

      await onLog(message);
    });
    messageLayer.onNotification("notifications/progress", async (params) => {
      if (onProgress === undefined || !isObjectRecord(params)) {
        return;
      }

      const { progressToken, progress } = params;
      if (
        !isRequestId(progressToken) ||
        typeof progress !== "number" ||
        !this.activeProgressTokens.has(progressToken)
      ) {
        return;
      }

      const progressParams: ProgressParams = {
        progressToken,
        progress,
      };

      if (params.total !== undefined) {
        if (typeof params.total !== "number") {
          return;
        }

        progressParams.total = params.total;
      }

      if (params.message !== undefined) {
        if (typeof params.message !== "string") {
          return;
        }

        progressParams.message = params.message;
      }

      await onProgress(progressParams);
    });
    messageLayer.onNotification("notifications/cancelled", () => undefined);

    this.transport = transport;
    this.messageLayer = messageLayer;
    this.currentState = "initializing";
    this.subscribedResourceUris.clear();
    this.activeProgressTokens.clear();
    transport.closed
      .then((closedEvent) => {
        if (this.transport !== transport) {
          return;
        }

        this.messageLayer?.dispose(closedEvent.reason);
        this.messageLayer = null;
        this.transport = null;
        this.currentState = "closed";
      })
      .catch((error: unknown) => {
        if (this.transport !== transport) {
          return;
        }

        const reason = error instanceof Error ? error : new Error(String(error));
        this.messageLayer?.dispose(reason);
        this.messageLayer = null;
        this.transport = null;
        this.currentState = "closed";
      });

    const capabilities: ClientCapabilities = {
      ...(this.options.capabilities ?? {}),
    };

    if (onSamplingRequest !== undefined && capabilities.sampling === undefined) {
      capabilities.sampling = {};
    }

    if (onRootsList !== undefined) {
      capabilities.roots = {
        ...(capabilities.roots ?? {}),
      };
    }

    if (this.options.onElicitationRequest !== undefined && capabilities.elicitation === undefined) capabilities.elicitation = {};
    this.currentClientCapabilities = structuredClone(capabilities);
    if (this.options.onElicitationRequest !== undefined) messageLayer.onInputRequest("elicitation/create", async (params, context) => {
      return await this.options.onElicitationRequest!(params as ElicitationParams, context);
    });
    if (onRootsList !== undefined) messageLayer.onInputRequest("roots/list", async (_params, context) => ({ roots: await onRootsList(context) }));
    if (onSamplingRequest !== undefined) messageLayer.onInputRequest("sampling/createMessage", async (params, context) => {
      return await onSamplingRequest(params as CreateMessageParams, context);
    });

    try {
      if (!validateProtocolValue("ClientCapabilities", capabilities)) {
        throw new McpError(ERROR_INVALID_PARAMS, "Invalid client capabilities");
      }
      let discovery: unknown;
      try {
        if (this.options.protocolVersion !== "2025-03-26") discovery = await messageLayer.sendRequest("server/discover", {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": capabilities
          }
        }, { signal: options.signal, timeoutMs: this.options.protocolVersion === "2026-07-28"
          ? this.options.requestTimeoutMs ?? 30_000
          : Math.min(this.options.requestTimeoutMs ?? 30_000, 1000) });
      } catch (error) {
        options.signal?.throwIfAborted();
        if (error instanceof McpError && [-32020, -32021, -32022].includes(error.code)) throw error;
      }
      if (discovery !== undefined) {
        if (!isObjectRecord(discovery) || discovery.resultType !== "complete" ||
            !Array.isArray(discovery.supportedVersions) ||
            !discovery.supportedVersions.every((version) => typeof version === "string") ||
            !isServerCapabilities(discovery.capabilities)) {
          throw new McpError(ERROR_INVALID_REQUEST, "Invalid server/discover result");
        }
        const cacheError = validateCacheMetadata("server/discover", discovery);
        if (cacheError !== undefined) throw new McpError(ERROR_INVALID_REQUEST, cacheError);
        if (!validateServerResult("server/discover", discovery)) throw new McpError(ERROR_INVALID_REQUEST, "Invalid server/discover result");
        if (!discovery.supportedVersions.includes("2026-07-28")) {
          throw new McpError(-32022, "No mutually supported modern protocol version");
        }
        const metadata = discovery._meta;
        const identity = isObjectRecord(metadata) ? metadata["io.modelcontextprotocol/serverInfo"] : undefined;
        if (identity !== undefined && (!isObjectRecord(identity) ||
            typeof identity.name !== "string" || typeof identity.version !== "string")) {
          throw new McpError(ERROR_INVALID_REQUEST, "Invalid discovery serverInfo");
        }
        if (discovery.instructions !== undefined && typeof discovery.instructions !== "string") {
          throw new McpError(ERROR_INVALID_REQUEST, "Invalid discovery instructions");
        }
        this.currentInstructions = discovery.instructions;
        this.currentServerCapabilities = structuredClone(discovery.capabilities);
        this.currentServerInfo = identity === undefined ? null : structuredClone(identity as unknown as Implementation);
        messageLayer.requestMetadata = {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": structuredClone(capabilities)
        };
        this.subscriptions = new SubscriptionManager(messageLayer);
        this.currentState = "ready";
        const notificationFilter: NotificationFilter = {
          ...(onToolsChanged === undefined ? {} : { toolsListChanged: true }),
          ...(onPromptsChanged === undefined ? {} : { promptsListChanged: true }),
          ...(onResourcesChanged === undefined ? {} : { resourcesListChanged: true })
        };
        if (Object.keys(notificationFilter).length > 0) await this.subscriptions.listen(notificationFilter, options);
        return {
          protocolVersion: "2026-07-28", capabilities: structuredClone(discovery.capabilities),
          ...(this.currentInstructions === undefined ? {} : { instructions: this.currentInstructions }),
          ...(this.currentServerInfo === null ? {} : { serverInfo: structuredClone(this.currentServerInfo) })
        };
      }
      const initializeResultValue = await messageLayer.sendRequest("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        clientInfo: this.options.clientInfo,
        capabilities,
      }, { signal: options.signal });

      if (!isInitializeResult(initializeResultValue)) {
        throw new McpError(ERROR_INVALID_REQUEST, "Invalid initialize result");
      }

      const initializeResult = initializeResultValue;

      if (initializeResult.protocolVersion !== MCP_PROTOCOL_VERSION) {
        throw new McpError(
          ERROR_INVALID_REQUEST,
          `Unsupported protocol version: ${initializeResult.protocolVersion}`
        );
      }

      this.currentServerCapabilities = structuredClone(initializeResult.capabilities);
      this.currentServerInfo = structuredClone(initializeResult.serverInfo);
      this.currentInstructions = initializeResult.instructions;
      if (onRootsList !== undefined) {
        messageLayer.onRequest("roots/list", async (_params, context) => ({
          roots: await onRootsList(context),
        }));
      }
      if (this.options.onElicitationRequest !== undefined) {
        messageLayer.onRequest("elicitation/create", async (params, context) =>
          this.options.onElicitationRequest!(params as ElicitationParams, context)
        );
      }
      if (transport.completeInitialization === undefined) messageLayer.sendNotification("notifications/initialized");
      else await transport.completeInitialization({ signal: options.signal, timeoutMs: this.options.requestTimeoutMs ?? 30_000 });
      this.currentState = "ready";

      return initializeResult;
    } catch (error) {
      if (this.transport === transport) {
        const reason = error instanceof Error ? error : new Error(String(error));
        messageLayer.dispose(reason);
        transport.dispose(reason);
        this.messageLayer = null;
        this.transport = null;
        this.currentState = "disconnected";
      }

      throw error;
    }
  }

  private getServerCapabilitiesOrThrow(): ServerCapabilities {
    if (this.currentServerCapabilities === null) {
      throw new Error("MCP client has not completed initialization");
    }

    return this.currentServerCapabilities;
  }

  async listTools(params: PaginatedParams = {}, options: { signal?: AbortSignal } = {}): Promise<PaginatedResult & { tools: Tool[] }> {
    const messageLayer = this.getMessageLayerOrThrow();
    const serverCapabilities = this.getServerCapabilitiesOrThrow();
    if (serverCapabilities.tools === undefined) {
      throw new Error("Server does not support tools");
    }

    const requestParams = params.cursor === undefined ? undefined : { cursor: params.cursor };
    const result = await messageLayer.sendRequest("tools/list", requestParams, options);
    if (!isToolsListResult(result)) {
      throw new McpError(ERROR_INVALID_REQUEST, "Invalid tools/list result");
    }

    return {
      ...result,
      tools:
        this.transport?.filterTools?.(result.tools, params.cursor === undefined) ?? result.tools
    };
  }

  async callTool(params: CallToolParams, options: CallToolOptions = {}): Promise<CallToolResult> {
    const messageLayer = this.getMessageLayerOrThrow();
    const serverCapabilities = this.getServerCapabilitiesOrThrow();
    if (serverCapabilities.tools === undefined) {
      throw new Error("Server does not support tools");
    }

    if (options.signal?.aborted) {
      throw options.signal.reason;
    }

    const requestParams =
      options.progressToken === undefined
        ? params
        : {
            ...params,
            _meta: {
              progressToken: options.progressToken,
            },
          };

    if (options.progressToken !== undefined) {
      this.activeProgressTokens.set(
        options.progressToken,
        (this.activeProgressTokens.get(options.progressToken) ?? 0) + 1
      );
    }

    try {
      let requestId: RequestId | undefined;
      let cancellationSent = false;
      const sendCancellationNotification = () => {
        if (requestId === undefined || cancellationSent) {
          return;
        }
        cancellationSent = true;
        messageLayer.sendNotification("notifications/cancelled", { requestId });
      };
      const requestPromise = messageLayer.sendRequest("tools/call", requestParams, {
        signal: options.signal,
        onRequestId: (nextRequestId) => {
          requestId = nextRequestId;
        },
        onTimeout: sendCancellationNotification,
      }).then((result) => {
        if (!isCallToolResult(result, messageLayer.requestMetadata !== undefined)) {
          throw new McpError(ERROR_INVALID_REQUEST, "Invalid tool result");
        }

        return result;
      });
      if (options.signal === undefined) {
        return await requestPromise;
      }
      const signal = options.signal;

      let abortListener: (() => void) | undefined;
      const abortPromise = new Promise<CallToolResult>((_, reject) => {
        const rejectWithAbortReason = () => {
          sendCancellationNotification();
          if (requestId !== undefined) {
            messageLayer.cancelRequest(requestId, signal.reason);
          }
          reject(signal.reason);
        };

        abortListener = rejectWithAbortReason;
        signal.addEventListener("abort", abortListener, { once: true });
        if (signal.aborted) {
          signal.removeEventListener("abort", abortListener);
          rejectWithAbortReason();
        }
      });

      try {
        return (await Promise.race([requestPromise, abortPromise])) as CallToolResult;
      } finally {
        if (abortListener !== undefined) {
          signal.removeEventListener("abort", abortListener);
        }
      }
    } finally {
      if (options.progressToken !== undefined) {
        const activeCount = this.activeProgressTokens.get(options.progressToken);
        if (activeCount === 1) {
          this.activeProgressTokens.delete(options.progressToken);
        } else if (activeCount !== undefined) {
          this.activeProgressTokens.set(options.progressToken, activeCount - 1);
        }
      }
    }
  }

  async listResources(
    params: PaginatedParams = {}, options: { signal?: AbortSignal } = {}
  ): Promise<PaginatedResult & { resources: Resource[] }> {
    const messageLayer = this.getMessageLayerOrThrow();
    const serverCapabilities = this.getServerCapabilitiesOrThrow();
    if (serverCapabilities.resources === undefined) {
      throw new Error("Server does not support resources");
    }

    const requestParams = params.cursor === undefined ? undefined : { cursor: params.cursor };
    const result = await messageLayer.sendRequest("resources/list", requestParams, options);
    if (!isResourcesListResult(result)) {
      throw new McpError(ERROR_INVALID_REQUEST, "Invalid resources/list result");
    }

    return result;
  }

  async listResourceTemplates(
    params: PaginatedParams = {}, options: { signal?: AbortSignal } = {}
  ): Promise<PaginatedResult & { resourceTemplates: ResourceTemplate[] }> {
    const messageLayer = this.getMessageLayerOrThrow();
    const serverCapabilities = this.getServerCapabilitiesOrThrow();
    if (serverCapabilities.resources === undefined) {
      throw new Error("Server does not support resources");
    }

    const requestParams = params.cursor === undefined ? undefined : { cursor: params.cursor };
    const result = await messageLayer.sendRequest("resources/templates/list", requestParams, options);
    if (!isResourceTemplatesListResult(result)) {
      throw new McpError(ERROR_INVALID_REQUEST, "Invalid resources/templates/list result");
    }

    return result;
  }

  async readResource(params: ReadResourceParams, options: { signal?: AbortSignal } = {}): Promise<CacheableResultMetadata & { contents: ResourceContents[] }> {
    const messageLayer = this.getMessageLayerOrThrow();
    const serverCapabilities = this.getServerCapabilitiesOrThrow();
    if (serverCapabilities.resources === undefined) {
      throw new Error("Server does not support resources");
    }

    const result = await messageLayer.sendRequest("resources/read", params, options);
    if (!isReadResourceResult(result)) {
      throw new McpError(ERROR_INVALID_REQUEST, "Invalid resources/read result");
    }

    return result;
  }

  async listenNotifications(
    filter: NotificationFilter,
    options: SubscriptionOptions = {}
  ): Promise<McpSubscription> {
    const layer = this.getMessageLayerOrThrow();
    if (layer.requestMetadata === undefined || this.subscriptions === null)
      throw new Error("Notification streams require modern MCP");
    return await this.subscriptions.listen(filter, options);
  }

  async subscribe(uri: string, options: { signal?: AbortSignal } = {}): Promise<void> {
    options.signal?.throwIfAborted();
    const messageLayer = this.getMessageLayerOrThrow();
    const serverCapabilities = this.getServerCapabilitiesOrThrow();
    if (messageLayer.requestMetadata !== undefined) {
      if (serverCapabilities.resources === undefined)
        throw new Error("Server does not support resources");
      const existing = this.resourceSubscriptions.get(uri);
      if (existing !== undefined) {
        const signal = options.signal;
        if (signal === undefined) await existing.subscription;
        else {
          let abort: () => void;
          const canceled = new Promise<never>((_resolve, reject) => {
            abort = () => reject(signal.reason);
            signal.addEventListener("abort", abort, { once: true });
          });
          try {
            signal.throwIfAborted();
            await Promise.race([existing.subscription, canceled]);
          } finally { signal.removeEventListener("abort", abort!); }
        }
        return;
      }
      const controller = new AbortController();
      const abortSetup = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", abortSetup, { once: true });
      const subscribing = this.subscriptions!.listen(
        { resourceSubscriptions: [uri] },
        { signal: controller.signal }
      ).then((listening) => {
        if (this.resourceSubscriptions.get(uri)?.subscription !== subscribing) {
          listening.cancel();
          throw new Error("Resource subscription canceled");
        }
        if (!listening.notifications.resourceSubscriptions?.includes(uri)) {
          listening.cancel();
          throw new Error("Server declined the resource subscription");
        }
        this.subscribedResourceUris.add(uri);
        void listening.closed
          .finally(() => {
            if (this.resourceSubscriptions.get(uri)?.subscription === subscribing) {
              this.resourceSubscriptions.delete(uri);
              this.subscribedResourceUris.delete(uri);
            }
          })
          .catch(() => undefined);
        return listening;
      }).finally(() => options.signal?.removeEventListener("abort", abortSetup));
      this.resourceSubscriptions.set(uri, { controller, subscription: subscribing });
      try {
        await subscribing;
      } catch (error) {
        if (this.resourceSubscriptions.get(uri)?.subscription === subscribing)
          this.resourceSubscriptions.delete(uri);
        throw error;
      }
      return;
    }
    if (serverCapabilities.resources?.subscribe !== true) {
      throw new Error("Server does not support resource subscriptions");
    }

    await messageLayer.sendRequest("resources/subscribe", { uri }, options);
    this.subscribedResourceUris.add(uri);
  }

  async unsubscribe(uri: string, options: { signal?: AbortSignal } = {}): Promise<void> {
    options.signal?.throwIfAborted();
    const messageLayer = this.getMessageLayerOrThrow();
    const serverCapabilities = this.getServerCapabilitiesOrThrow();
    if (messageLayer.requestMetadata !== undefined) {
      if (serverCapabilities.resources === undefined)
        throw new Error("Server does not support resources");
      const pending = this.resourceSubscriptions.get(uri);
      this.resourceSubscriptions.delete(uri);
      this.subscribedResourceUris.delete(uri);
      pending?.controller.abort(new Error("Resource subscription canceled"));
      return;
    }
    if (serverCapabilities.resources?.subscribe !== true) {
      throw new Error("Server does not support resource subscriptions");
    }

    await messageLayer.sendRequest("resources/unsubscribe", { uri }, options);
    this.subscribedResourceUris.delete(uri);
  }

  async listPrompts(params: PaginatedParams = {}, options: { signal?: AbortSignal } = {}): Promise<PaginatedResult & { prompts: Prompt[] }> {
    const messageLayer = this.getMessageLayerOrThrow();
    const serverCapabilities = this.getServerCapabilitiesOrThrow();
    if (serverCapabilities.prompts === undefined) {
      throw new Error("Server does not support prompts");
    }

    const requestParams = params.cursor === undefined ? undefined : { cursor: params.cursor };
    return (await messageLayer.sendRequest("prompts/list", requestParams, options)) as {
      prompts: Prompt[];
      nextCursor?: string;
    };
  }

  async getPrompt(params: GetPromptParams, options: { signal?: AbortSignal } = {}): Promise<GetPromptResult> {
    const messageLayer = this.getMessageLayerOrThrow();
    const serverCapabilities = this.getServerCapabilitiesOrThrow();
    if (serverCapabilities.prompts === undefined) {
      throw new Error("Server does not support prompts");
    }

    const result = await messageLayer.sendRequest("prompts/get", params, options);
    if (!isGetPromptResult(result)) {
      throw new McpError(ERROR_INVALID_REQUEST, "Invalid prompts/get result");
    }

    return result;
  }

  async complete(params: CompleteParams, options: { signal?: AbortSignal } = {}): Promise<CompleteResult> {
    const messageLayer = this.getMessageLayerOrThrow();
    const serverCapabilities = this.getServerCapabilitiesOrThrow();
    if (serverCapabilities.completions === undefined) {
      throw new Error("Server does not support completions");
    }

    const result = await messageLayer.sendRequest("completion/complete", params, options);
    if (!isCompleteResult(result)) {
      throw new McpError(ERROR_INVALID_REQUEST, "Invalid completion/complete result");
    }

    return result;
  }

  async setLogLevel(level: LogLevel, options: { signal?: AbortSignal } = {}): Promise<void> {
    options.signal?.throwIfAborted();
    const messageLayer = this.getMessageLayerOrThrow();
    if (messageLayer.requestMetadata !== undefined) throw new Error("Log level changes require legacy MCP");
    const serverCapabilities = this.getServerCapabilitiesOrThrow();
    if (serverCapabilities.logging === undefined) {
      throw new Error("Server does not support logging");
    }

    await messageLayer.sendRequest("logging/setLevel", { level }, options);
  }

  async cancel(requestId: RequestId, reason?: string): Promise<void> {
    const messageLayer = this.getMessageLayerOrThrow();
    const params: { requestId: RequestId; reason?: string } = { requestId };

    if (reason !== undefined) {
      params.reason = reason;
    }

    messageLayer.sendNotification("notifications/cancelled", params);
  }

  async sendRootsChanged(): Promise<void> {
    const messageLayer = this.getMessageLayerOrThrow();
    if (this.currentClientCapabilities?.roots?.listChanged !== true) {
      throw new Error("Client did not advertise roots list changes");
    }

    messageLayer.sendNotification("notifications/roots/list_changed");
  }

  async ping(options: { signal?: AbortSignal } = {}): Promise<void> {
    const messageLayer = this.getMessageLayerOrThrow();
    await messageLayer.sendRequest(messageLayer.requestMetadata === undefined ? "ping" : "server/discover", undefined, options);
  }

  async close(): Promise<void> {
    if (this.currentState === "closed") {
      return;
    }

    const closeError = new Error("MCP client closed");
    this.subscriptions?.close();
    this.subscriptions = null;
    this.resourceSubscriptions.clear();
    this.messageLayer?.dispose(closeError);
    this.transport?.dispose(closeError);
    this.messageLayer = null;
    this.transport = null;
    this.currentServerCapabilities = null;
    this.currentClientCapabilities = null;
    this.currentServerInfo = null;
    this.currentInstructions = undefined;
    this.subscribedResourceUris.clear();
    this.activeProgressTokens.clear();
    this.currentState = "closed";
  }
}

export interface Tool extends Omit<CoreTool, "inputSchema" | "outputSchema"> {
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface CallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface CallToolOptions {
  signal?: AbortSignal;
  progressToken?: ProgressToken;
}

export interface ReadResourceParams {
  uri: string;
}

export interface PaginatedParams {
  cursor?: string;
}

export interface ResultMetadata {
  resultType?: "complete";
  _meta?: Record<string, unknown>;
}

export interface CacheableResultMetadata extends ResultMetadata {
  ttlMs?: number;
  cacheScope?: "public" | "private";
}

export interface PaginatedResult extends CacheableResultMetadata {
  nextCursor?: string;
}

export type TextResourceContents = Extract<CoreResourceContents, { text: string }>;
export type BlobResourceContents = Extract<CoreResourceContents, { blob: string }>;
export type ResourceContents = CoreResourceContents;
export type TextContent = Extract<CoreContentItem, { type: "text" }>;
export type ImageContent = Extract<CoreContentItem, { type: "image" }>;
export type AudioContent = Extract<CoreContentItem, { type: "audio" }>;
export type EmbeddedResource = Extract<CoreContentItem, { type: "resource" }>;
export type ContentItem = CoreContentItem;

export interface PromptMessage {
  role: "user" | "assistant";
  content: ContentItem;
}

export interface GetPromptResult extends ResultMetadata {
  description?: string;
  messages: PromptMessage[];
}

export interface GetPromptParams {
  name: string;
  arguments?: Record<string, string>;
}

export interface CallToolResult extends ResultMetadata {
  content: ContentItem[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface Root {
  _meta?: Record<string, unknown>;
  uri: string;
  name?: string;
}

export type LogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

export interface LogMessage {
  level: LogLevel;
  logger?: string;
  data: unknown;
}

export type ProgressToken = RequestId;

export interface ProgressParams {
  progressToken: ProgressToken;
  progress: number;
  total?: number;
  message?: string;
}

export interface ModelHint {
  name?: string;
}

export interface ModelPreferences {
  hints?: ModelHint[];
  costPriority?: number;
  speedPriority?: number;
  intelligencePriority?: number;
}

export interface ToolUseContent {
  _meta?: Record<string, unknown>;
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  _meta?: Record<string, unknown>;
  type: "tool_result";
  toolUseId: string;
  content: ContentItem[];
  structuredContent?: unknown;
  isError?: boolean;
}

export type SamplingContent = TextContent | ImageContent | AudioContent | ToolUseContent | ToolResultContent;

export interface SamplingMessage {
  _meta?: Record<string, unknown>;
  role: "user" | "assistant";
  content: SamplingContent | SamplingContent[];
}

export type IncludeContext = "none" | "thisServer" | "allServers";

export interface CreateMessageParams {
  messages: SamplingMessage[];
  modelPreferences?: ModelPreferences;
  systemPrompt?: string;
  includeContext?: IncludeContext;
  temperature?: number;
  maxTokens: number;
  tools?: Tool[];
  toolChoice?: { mode: "auto" | "required" | "none" };
  stopSequences?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateMessageResult {
  _meta?: Record<string, unknown>;
  model: string;
  content: SamplingContent | SamplingContent[];
  role: "user" | "assistant";
  stopReason?: string;
}

export interface PromptReference {
  type: "ref/prompt";
  name: string;
}

export interface ResourceReference {
  type: "ref/resource";
  uri: string;
}

export interface CompleteArgument {
  name: string;
  value: string;
}

export interface CompleteParams {
  context?: { arguments?: Record<string, string> };
  ref: PromptReference | ResourceReference;
  argument: CompleteArgument;
}

export interface Completion {
  values: string[];
  hasMore?: boolean;
  total?: number;
}

export interface CompleteResult extends ResultMetadata {
  completion: Completion;
}

export const ERROR_PARSE = -32700;
export const ERROR_INVALID_REQUEST = -32600;
export const ERROR_METHOD_NOT_FOUND = -32601;
export const ERROR_INVALID_PARAMS = -32602;
export const ERROR_INTERNAL = -32603;

export interface McpTransportClosedEvent {
  reason: Error;
  code?: number;
  signal?: NodeJS.Signals;
}

export interface McpTransport {
  readable: Readable;
  writable: Writable;
  closed: Promise<McpTransportClosedEvent>;
  dispose(reason?: Error): void;
  filterTools?(tools: Tool[], reset?: boolean): Tool[];
  /** Complete a legacy initialization handshake before the client reports ready. */
  completeInitialization?(options: { signal?: AbortSignal; timeoutMs: number }): Promise<void>;
}

export interface InMemoryServerTransport {
  readable: Readable;
  writable: Writable;
}

export interface InMemoryTransportPair {
  clientTransport: McpTransport;
  serverTransport: InMemoryServerTransport;
}

export function createInMemoryTransportPair(): InMemoryTransportPair {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  let disposed = false;
  let resolveClosed:
    | ((closedEvent: McpTransportClosedEvent) => void)
    | undefined;

  const closed = new Promise<McpTransportClosedEvent>((resolve) => {
    resolveClosed = resolve;
  });

  const resolveClosedOnce = (reason: Error): void => {
    if (resolveClosed === undefined) {
      return;
    }

    const currentResolve = resolveClosed;
    resolveClosed = undefined;
    currentResolve({ reason });
  };

  const dispose = (reason = new Error("In-memory transport disposed")): void => {
    if (disposed) {
      return;
    }

    disposed = true;

    if (!clientToServer.destroyed && !clientToServer.writableEnded) {
      clientToServer.end();
    }

    if (!serverToClient.destroyed && !serverToClient.writableEnded) {
      serverToClient.end();
    }

    resolveClosedOnce(reason);
  };

  clientToServer.once("error", (error) => {
    dispose(error instanceof Error ? error : new Error(String(error)));
  });
  serverToClient.once("error", (error) => {
    dispose(error instanceof Error ? error : new Error(String(error)));
  });

  return {
    clientTransport: {
      readable: serverToClient,
      writable: clientToServer,
      closed,
      dispose,
    },
    serverTransport: {
      readable: clientToServer,
      writable: serverToClient,
    },
  };
}

interface SdkTransportAdapterInput {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: SdkJsonRpcMessage, extra?: any) => void;
  start(): Promise<void>;
  close(): Promise<void>;
  send(message: SdkJsonRpcMessage): Promise<void>;
}

export interface McpClientConnection {
  connect(transport: McpTransport): Promise<void>;
  close(): Promise<void>;
}

interface SdkServerConnection {
  connect(transport: unknown): Promise<void>;
}

export interface SdkTestPair<TClient extends McpClientConnection> {
  client: TClient;
  cleanup: () => Promise<void>;
}

export class SdkTransportAdapter implements McpTransport {
  readonly readable: Readable;
  readonly writable: Writable;
  readonly closed: Promise<McpTransportClosedEvent>;
  private readonly sdkTransport: SdkTransportAdapterInput;
  private readonly readStream = new PassThrough();
  private readonly writeStream = new PassThrough();
  private resolveClosed:
    | ((closedEvent: McpTransportClosedEvent) => void)
    | undefined;
  private disposed = false;

  constructor(sdkTransport: SdkTransportAdapterInput) {
    this.sdkTransport = sdkTransport;
    this.readable = this.readStream;
    this.writable = this.writeStream;
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });

    this.sdkTransport.onmessage = (message) => {
      this.readStream.write(serializeJsonRpcMessage(message as JsonRpcMessage));
    };
    this.sdkTransport.onclose = () => {
      this.dispose(new Error("SDK transport closed"));
    };
    this.sdkTransport.onerror = (error) => {
      this.dispose(error instanceof Error ? error : new Error(String(error)));
    };

    this.readStream.once("error", (error) => {
      this.dispose(error instanceof Error ? error : new Error(String(error)));
    });
    this.writeStream.once("error", (error) => {
      this.dispose(error instanceof Error ? error : new Error(String(error)));
    });

    this.consumeWrittenLines().catch((error) => {
      this.dispose(error instanceof Error ? error : new Error(String(error)));
    });
    this.sdkTransport.start().catch((error) => {
      this.dispose(error instanceof Error ? error : new Error(String(error)));
    });
  }

  dispose(reason = new Error("SDK transport adapter disposed")): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    if (!this.writeStream.destroyed && !this.writeStream.writableEnded) {
      this.writeStream.end();
    }

    if (!this.readStream.destroyed && !this.readStream.writableEnded) {
      this.readStream.end();
    }

    if (this.resolveClosed !== undefined) {
      const resolveClosed = this.resolveClosed;
      this.resolveClosed = undefined;
      resolveClosed({ reason });
    }

    this.sdkTransport.close().catch(() => undefined);
  }

  private async consumeWrittenLines(): Promise<void> {
    for await (const line of readLines(this.writeStream)) {
      if (this.disposed || line.length === 0) {
        continue;
      }

      let parsedMessage: unknown;
      try {
        parsedMessage = JSON.parse(line);
      } catch {
        throw new Error(`Malformed JSON line: ${line}`);
      }

      if (typeof parsedMessage !== "object" || parsedMessage === null || Array.isArray(parsedMessage)) {
        throw new Error(`Malformed JSON line: ${line}`);
      }

      await this.sdkTransport.send(parsedMessage as SdkJsonRpcMessage);
    }
  }
}

export async function createSdkTestPair<TClient extends McpClientConnection>(
  server: SdkServerConnection,
  createClient: () => TClient
): Promise<SdkTestPair<TClient>> {
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const [clientSdkTransport, serverSdkTransport] = InMemoryTransport.createLinkedPair();
  const clientTransport = new SdkTransportAdapter(clientSdkTransport);
  const serverPromise = server.connect(serverSdkTransport);
  const client = createClient();

  try {
    await client.connect(clientTransport);
  } catch (error) {
    clientTransport.dispose(new Error("SDK test pair setup failed"));
    await clientSdkTransport.close();
    await serverSdkTransport.close();
    await serverPromise;
    throw error;
  }

  const cleanup = async (): Promise<void> => {
    await client.close();
    clientTransport.dispose(new Error("SDK test pair cleanup"));
    await clientSdkTransport.close();
    await serverSdkTransport.close();
    await serverPromise;
  };

  return { client, cleanup };
}

export async function createMockEchoToolServer(): Promise<SdkServerConnection> {
  const [{ Server }, { CallToolRequestSchema, ListToolsRequestSchema }] =
    await Promise.all([
      import("@modelcontextprotocol/sdk/server/index.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]);

  const server = new Server(
    { name: "mock-echo-tool-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  const echoTool = {
    name: "echo",
    description: "Echoes the provided message.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
        },
      },
      required: ["message"],
    },
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [echoTool],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "echo") {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const message = request.params.arguments?.message;
    if (typeof message !== "string") {
      throw new Error("Echo tool requires a string message argument");
    }

    return {
      content: [
        {
          type: "text" as const,
          text: message,
        },
      ],
    };
  });

  return server;
}

export async function createMockMultiToolServer(): Promise<SdkServerConnection> {
  const [{ Server }, { CallToolRequestSchema, ListToolsRequestSchema }] =
    await Promise.all([
      import("@modelcontextprotocol/sdk/server/index.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]);

  const server = new Server(
    { name: "mock-multi-tool-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  const tools = [
    {
      name: "add",
      description: "Adds two numbers and returns the sum as text.",
      inputSchema: {
        type: "object" as const,
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
        required: ["a", "b"],
      },
    },
    {
      name: "greet",
      description: "Greets a user with optional formal tone.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: { type: "string" },
          formal: { type: "boolean" },
        },
        required: ["name"],
      },
    },
    {
      name: "fail",
      description: "Returns an intentional tool error payload.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "add") {
      const a = request.params.arguments?.a;
      const b = request.params.arguments?.b;

      if (typeof a !== "number" || typeof b !== "number") {
        throw new Error("Add tool requires numeric a and b arguments");
      }

      return {
        content: [
          {
            type: "text" as const,
            text: String(a + b),
          },
        ],
      };
    }

    if (request.params.name === "greet") {
      const name = request.params.arguments?.name;
      const formal = request.params.arguments?.formal;

      if (typeof name !== "string") {
        throw new Error("Greet tool requires a string name argument");
      }
      if (formal !== undefined && typeof formal !== "boolean") {
        throw new Error("Greet tool formal argument must be boolean when provided");
      }

      return {
        content: [
          {
            type: "text" as const,
            text: formal ? `Good day, ${name}.` : `Hello, ${name}!`,
          },
        ],
      };
    }

    if (request.params.name === "fail") {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Intentional tool failure.",
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  return server;
}

export async function createMockPaginatedToolsServer(): Promise<SdkServerConnection> {
  const [{ Server }, { ListToolsRequestSchema }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]);

  const server = new Server(
    { name: "mock-paginated-tools-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  const pageSize = 5;
  const tools = Array.from({ length: 20 }, (_, index) => ({
    name: `tool-${index + 1}`,
    description: `Mock paginated tool ${index + 1}.`,
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  }));

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const cursor = request.params?.cursor;
    const startIndex = cursor === undefined ? 0 : Number(cursor);

    if (
      !Number.isInteger(startIndex) ||
      startIndex < 0 ||
      startIndex > tools.length ||
      startIndex % pageSize !== 0
    ) {
      throw new Error(`Invalid cursor: ${String(cursor)}`);
    }

    const pageTools = tools.slice(startIndex, startIndex + pageSize);
    const nextIndex = startIndex + pageSize;
    if (nextIndex >= tools.length) {
      return { tools: pageTools };
    }

    return {
      tools: pageTools,
      nextCursor: String(nextIndex),
    };
  });

  return server;
}

export async function createMockResourceServer(): Promise<SdkServerConnection> {
  const [
    { Server },
    {
      ListResourcesRequestSchema,
      ListResourceTemplatesRequestSchema,
      ReadResourceRequestSchema,
    },
  ] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]);

  const server = new Server(
    { name: "mock-resource-server", version: "1.0.0" },
    { capabilities: { resources: {} } }
  );
  const resources = [
    {
      uri: "file:///readme.txt",
      name: "readme.txt",
      mimeType: "text/plain",
    },
    {
      uri: "file:///image.png",
      name: "image.png",
      mimeType: "image/png",
    },
  ];
  const resourceContentsByUri = new Map<string, ResourceContents>([
    [
      "file:///readme.txt",
      {
        uri: "file:///readme.txt",
        mimeType: "text/plain",
        text: "This is a mock README resource.",
      },
    ],
    [
      "file:///image.png",
      {
        uri: "file:///image.png",
        mimeType: "image/png",
        blob: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgL9qj3QAAAAASUVORK5CYII=",
      },
    ],
  ]);
  const resourceTemplates = [
    {
      uriTemplate: "file:///{path}",
      name: "file-template",
    },
  ];

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources,
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resourceContent = resourceContentsByUri.get(request.params.uri);
    if (resourceContent === undefined) {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }

    return {
      contents: [resourceContent],
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates,
  }));

  return server;
}

export async function createMockSubscribableResourceServer(): Promise<
  SdkServerConnection & {
    triggerResourceUpdated: (uri: string, updatedText?: string) => Promise<void>;
    triggerResourceListChanged: () => Promise<void>;
  }
> {
  const [
    { Server },
    {
      ListResourcesRequestSchema,
      ReadResourceRequestSchema,
      SubscribeRequestSchema,
      UnsubscribeRequestSchema,
    },
  ] =
    await Promise.all([
      import("@modelcontextprotocol/sdk/server/index.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]);

  const server = new Server(
    { name: "mock-subscribable-resource-server", version: "1.0.0" },
    { capabilities: { resources: { subscribe: true, listChanged: true } } }
  );
  const resources = [
    {
      uri: "file:///readme.txt",
      name: "readme.txt",
      mimeType: "text/plain",
    },
  ];
  const resourceContentsByUri = new Map<string, ResourceContents>([
    [
      "file:///readme.txt",
      {
        uri: "file:///readme.txt",
        mimeType: "text/plain",
        text: "Initial subscribable resource text.",
      },
    ],
  ]);
  const subscribedUris = new Set<string>();

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources,
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resourceContent = resourceContentsByUri.get(request.params.uri);
    if (resourceContent === undefined) {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }

    return {
      contents: [resourceContent],
    };
  });

  server.setRequestHandler(SubscribeRequestSchema, async (request) => {
    subscribedUris.add(request.params.uri);
    return {};
  });

  server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    subscribedUris.delete(request.params.uri);
    return {};
  });

  return Object.assign(server, {
    triggerResourceUpdated: async (uri: string, updatedText?: string): Promise<void> => {
      if (updatedText !== undefined) {
        const existingContent = resourceContentsByUri.get(uri);
        if (existingContent === undefined || "blob" in existingContent) {
          throw new Error(`Unknown text resource: ${uri}`);
        }

        resourceContentsByUri.set(uri, {
          uri,
          mimeType: existingContent.mimeType,
          text: updatedText,
        });
      }

      if (!subscribedUris.has(uri)) {
        return;
      }

      await server.sendResourceUpdated({ uri });
    },
    triggerResourceListChanged: async (): Promise<void> => {
      await server.sendResourceListChanged();
    },
  });
}

export async function createMockPromptServer(): Promise<SdkServerConnection> {
  const [
    { Server },
    { ErrorCode, GetPromptRequestSchema, ListPromptsRequestSchema, McpError: SdkMcpError },
  ] =
    await Promise.all([
      import("@modelcontextprotocol/sdk/server/index.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]);

  const server = new Server(
    { name: "mock-prompt-server", version: "1.0.0" },
    { capabilities: { prompts: {} } }
  );
  const promptTemplates = [
    {
      prompt: {
        name: "code_review",
        description: "Review code for correctness and maintainability.",
        arguments: [
          {
            name: "code",
            description: "Code to review.",
            required: true,
          },
        ],
      },
      messages: [
        {
          role: "user" as const,
          textTemplate: "Please review the following code:\n{{code}}",
        },
        {
          role: "assistant" as const,
          textTemplate: "I will review the code for potential issues and improvements.",
        },
      ],
    },
    {
      prompt: {
        name: "summarize",
        description: "Summarize the provided text.",
      },
      messages: [
        {
          role: "user" as const,
          textTemplate: "Please summarize the provided text.",
        },
      ],
    },
  ];
  const promptsByName = new Map(promptTemplates.map((template) => [template.prompt.name, template]));

  const renderPromptMessage = (
    textTemplate: string,
    argumentsMap: Record<string, unknown> | undefined
  ): string => {
    if (argumentsMap === undefined) {
      return textTemplate;
    }

    let renderedText = textTemplate;
    for (const [name, value] of Object.entries(argumentsMap)) {
      if (typeof value !== "string") {
        continue;
      }

      renderedText = renderedText.split(`{{${name}}}`).join(value);
    }

    return renderedText;
  };

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: promptTemplates.map((template) => template.prompt),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const template = promptsByName.get(request.params.name);
    if (template === undefined) {
      throw new SdkMcpError(ErrorCode.InvalidParams, `Unknown prompt: ${request.params.name}`);
    }

    const requestArguments = request.params.arguments;
    for (const argument of template.prompt.arguments ?? []) {
      if (!argument.required) {
        continue;
      }

      const value = requestArguments?.[argument.name];
      if (typeof value !== "string") {
        throw new SdkMcpError(
          ErrorCode.InvalidParams,
          `Missing required prompt argument: ${argument.name}`
        );
      }
    }

    return {
      description: template.prompt.description,
      messages: template.messages.map((message) => ({
        role: message.role,
        content: {
          type: "text" as const,
          text: renderPromptMessage(message.textTemplate, requestArguments),
        },
      })),
    };
  });

  return server;
}

export async function createMockCompletionServer(): Promise<SdkServerConnection> {
  const [{ Server }, { CompleteRequestSchema }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]);

  const server = new Server(
    { name: "mock-completion-server", version: "1.0.0" },
    { capabilities: { completions: {} } }
  );
  const promptArgumentCompletions = new Map<string, string[]>([
    ["code_review:language", ["python", "pydantic", "pytest", "pytorch", "pyright", "rust"]],
  ]);
  const maxValues = 3;

  server.setRequestHandler(CompleteRequestSchema, async (request) => {
    if (request.params.ref.type !== "ref/prompt") {
      return {
        completion: {
          values: [],
        },
      };
    }

    const completionKey = `${request.params.ref.name}:${request.params.argument.name}`;
    const candidates = promptArgumentCompletions.get(completionKey) ?? [];
    const partialValue = request.params.argument.value.toLowerCase();
    const matchingValues = candidates.filter((candidate) =>
      candidate.toLowerCase().startsWith(partialValue)
    );
    const values = matchingValues.slice(0, maxValues);

    if (values.length < matchingValues.length) {
      return {
        completion: {
          values,
          hasMore: true,
          total: matchingValues.length,
        },
      };
    }

    return {
      completion: {
        values,
      },
    };
  });

  return server;
}

export async function createMockProgressServer(): Promise<SdkServerConnection> {
  const [{ Server }, { CallToolRequestSchema, ListToolsRequestSchema }] =
    await Promise.all([
      import("@modelcontextprotocol/sdk/server/index.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]);

  const server = new Server(
    { name: "mock-progress-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  const totalSteps = 4;
  const tool = {
    name: "slow_task",
    description: "Runs a simulated slow task and streams progress updates.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [tool],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.name !== "slow_task") {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const progressToken = request.params._meta?.progressToken;
    if (progressToken !== undefined) {
      for (let step = 1; step <= totalSteps; step += 1) {
        await extra.sendNotification({
          method: "notifications/progress",
          params: {
            progressToken,
            progress: step,
            total: totalSteps,
            message: `Completed step ${step} of ${totalSteps}`,
          },
        });

        await new Promise<void>((resolve) => {
          setTimeout(resolve, 5);
        });
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: "slow_task complete",
        },
      ],
    };
  });

  return server;
}

export interface MockSlowToolServerOptions {
  delayMs?: number;
  pollIntervalMs?: number;
}

export async function createMockSlowToolServer(
  options: MockSlowToolServerOptions = {}
): Promise<
  SdkServerConnection & {
    wasStarted: () => boolean;
    getStartedRequestIds: () => RequestId[];
    wasCancelled: () => boolean;
    getCancelledRequestIds: () => RequestId[];
  }
> {
  const [{ Server }, { CallToolRequestSchema, ListToolsRequestSchema }] =
    await Promise.all([
      import("@modelcontextprotocol/sdk/server/index.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]);

  const defaultDelayMs = options.delayMs ?? 1_000;
  const pollIntervalMs = options.pollIntervalMs ?? 10;
  if (!Number.isFinite(defaultDelayMs) || defaultDelayMs < 0) {
    throw new Error("createMockSlowToolServer delayMs must be a finite non-negative number");
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error("createMockSlowToolServer pollIntervalMs must be a finite positive number");
  }

  const server = new Server(
    { name: "mock-slow-tool-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  const startedRequestIds = new Set<RequestId>();
  const cancelledRequestIds = new Set<RequestId>();
  const tool = {
    name: "slow",
    description: "Delays the response and supports cancellation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        delayMs: {
          type: "number",
        },
      },
      additionalProperties: false,
    },
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [tool],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.name !== "slow") {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
    startedRequestIds.add(extra.requestId);

    const delayArgument = request.params.arguments?.delayMs;
    const delayMs =
      delayArgument === undefined
        ? defaultDelayMs
        : typeof delayArgument === "number" && Number.isFinite(delayArgument) && delayArgument >= 0
          ? delayArgument
          : NaN;
    if (!Number.isFinite(delayMs)) {
      throw new Error("slow tool delayMs argument must be a finite non-negative number");
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < delayMs) {
      if (extra.signal.aborted) {
        cancelledRequestIds.add(extra.requestId);
        throw new Error("slow tool cancelled");
      }

      const elapsedMs = Date.now() - startedAt;
      const remainingMs = delayMs - elapsedMs;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, Math.max(0, Math.min(pollIntervalMs, remainingMs)));
      });
    }

    if (extra.signal.aborted) {
      cancelledRequestIds.add(extra.requestId);
      throw new Error("slow tool cancelled");
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `slow complete after ${delayMs}ms`,
        },
      ],
    };
  });

  return Object.assign(server, {
    wasStarted: (): boolean => startedRequestIds.size > 0,
    getStartedRequestIds: (): RequestId[] => Array.from(startedRequestIds),
    wasCancelled: (): boolean => cancelledRequestIds.size > 0,
    getCancelledRequestIds: (): RequestId[] => Array.from(cancelledRequestIds),
  });
}

export async function createMockErrorServer(): Promise<SdkServerConnection> {
  const [
    { Server },
    { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError: SdkMcpError },
  ] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]);

  const server = new Server(
    { name: "mock-error-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  const tools = [
    {
      name: "invalid_params",
      description: "Returns a JSON-RPC Invalid Params error.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "is_error",
      description: "Returns a tools/call result with isError: true.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "internal_error",
      description: "Throws an internal server error.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        additionalProperties: false,
      },
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "invalid_params") {
      throw new SdkMcpError(
        ErrorCode.InvalidParams,
        "Intentional invalid params error from mock-error-server."
      );
    }

    if (request.params.name === "is_error") {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Intentional isError tool failure.",
          },
        ],
      };
    }

    if (request.params.name === "internal_error") {
      throw new Error("Intentional internal error from mock-error-server.");
    }

    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  return server;
}

export async function createMockSamplingServer(): Promise<SdkServerConnection> {
  const [{ Server }, { CallToolRequestSchema, ListToolsRequestSchema }] =
    await Promise.all([
      import("@modelcontextprotocol/sdk/server/index.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]);

  const server = new Server(
    { name: "mock-sampling-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  const tool = {
    name: "sample_message",
    description: "Requests sampling/createMessage from the client and returns the sampled text.",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic: {
          type: "string",
        },
      },
      required: ["topic"],
      additionalProperties: false,
    },
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [tool],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "sample_message") {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const topic = request.params.arguments?.topic;
    if (typeof topic !== "string") {
      throw new Error("sample_message requires a string topic argument");
    }

    const samplingResult = await server.createMessage({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Provide a concise sentence about ${topic}.`,
          },
        },
      ],
      maxTokens: 64,
      modelPreferences: {
        hints: [{ name: "mock-sampling-model" }],
        speedPriority: 0.2,
        intelligencePriority: 0.9,
      },
      systemPrompt: "Return exactly one concise sentence.",
    });

    const sampledText =
      samplingResult.content.type === "text"
        ? samplingResult.content.text
        : JSON.stringify(samplingResult.content);

    return {
      content: [
        {
          type: "text" as const,
          text: `Sampled response: ${sampledText}`,
        },
      ],
    };
  });

  return server;
}

export async function createMockRootsServer(): Promise<SdkServerConnection> {
  const [
    { Server },
    {
      CallToolRequestSchema,
      ListToolsRequestSchema,
      RootsListChangedNotificationSchema,
    },
  ] =
    await Promise.all([
      import("@modelcontextprotocol/sdk/server/index.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]);

  const server = new Server(
    { name: "mock-roots-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  const tool = {
    name: "roots_summary",
    description: "Requests roots/list from the client and returns a summary of roots.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [tool],
  }));

  server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
    await server.listRoots();
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "roots_summary") {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const rootsResult = await server.listRoots();
    const rootSummary = rootsResult.roots
      .map((root) => (root.name === undefined ? root.uri : `${root.name} (${root.uri})`))
      .join(", ");

    return {
      content: [
        {
          type: "text" as const,
          text: rootSummary.length === 0 ? "Roots: none" : `Roots: ${rootSummary}`,
        },
      ],
    };
  });

  return server;
}

export async function createMockLoggingServer(): Promise<SdkServerConnection> {
  const [{ Server }, { CallToolRequestSchema, ListToolsRequestSchema }] =
    await Promise.all([
      import("@modelcontextprotocol/sdk/server/index.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]);

  const server = new Server(
    { name: "mock-logging-server", version: "1.0.0" },
    { capabilities: { tools: {}, logging: {} } }
  );
  const tool = {
    name: "emit_logs",
    description: "Emits mock log messages at multiple levels.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [tool],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "emit_logs") {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    await server.sendLoggingMessage({
      level: "debug",
      logger: "mock-logging-server",
      data: { message: "Debug message" },
    });
    await server.sendLoggingMessage({
      level: "info",
      logger: "mock-logging-server",
      data: { message: "Info message" },
    });
    await server.sendLoggingMessage({
      level: "error",
      logger: "mock-logging-server",
      data: { message: "Error message" },
    });

    return {
      content: [
        {
          type: "text" as const,
          text: "Emitted log messages.",
        },
      ],
    };
  });

  return server;
}

export async function createMockFullFeaturedServer(): Promise<SdkServerConnection> {
  const [
    { Server },
    {
      CallToolRequestSchema,
      CompleteRequestSchema,
      GetPromptRequestSchema,
      ListPromptsRequestSchema,
      ListResourcesRequestSchema,
      ListToolsRequestSchema,
      ReadResourceRequestSchema,
    },
  ] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]);

  const server = new Server(
    { name: "mock-full-featured-server", version: "1.0.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
        completions: {},
      },
    }
  );
  const tool = {
    name: "full_featured_ping",
    description: "Returns a text response and emits an info log.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  };
  const resources = [
    {
      uri: "file:///full-featured.txt",
      name: "full-featured.txt",
      mimeType: "text/plain",
    },
  ];
  const prompts = [
    {
      name: "full_featured_prompt",
      description: "Returns a short prompt message for a topic.",
      arguments: [
        {
          name: "topic",
          description: "Topic to include in the prompt output.",
          required: false,
        },
      ],
    },
  ];
  const completionValues = ["alpha", "beta", "gamma"];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [tool],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "full_featured_ping") {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    await server.sendLoggingMessage({
      level: "info",
      logger: "mock-full-featured-server",
      data: {
        message: "full_featured_ping called",
      },
    });

    return {
      content: [
        {
          type: "text" as const,
          text: "full_featured_ping ok",
        },
      ],
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources,
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== "file:///full-featured.txt") {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }

    return {
      contents: [
        {
          uri: "file:///full-featured.txt",
          mimeType: "text/plain",
          text: "Mock full-featured resource",
        },
      ],
    };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts,
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    if (request.params.name !== "full_featured_prompt") {
      throw new Error(`Unknown prompt: ${request.params.name}`);
    }

    const topic = request.params.arguments?.topic;
    const topicText = typeof topic === "string" && topic.length > 0 ? topic : "general";

    return {
      description: "Mock prompt from full-featured server.",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Provide a short summary for ${topicText}.`,
          },
        },
      ],
    };
  });

  server.setRequestHandler(CompleteRequestSchema, async (request) => {
    if (
      request.params.ref.type !== "ref/prompt" ||
      request.params.ref.name !== "full_featured_prompt" ||
      request.params.argument.name !== "topic"
    ) {
      return {
        completion: {
          values: [],
        },
      };
    }

    const partialValue = request.params.argument.value.toLowerCase();
    const values = completionValues.filter((value) => value.startsWith(partialValue));

    return {
      completion: {
        values,
      },
    };
  });

  return server;
}

export async function createTestPair<TClient extends McpClientConnection>(
  server: TinyStdioMcpServer,
  createClient: () => TClient
): Promise<SdkTestPair<TClient>> {
  const { clientTransport, serverTransport } = createInMemoryTransportPair();
  const serverPromise = server.connect(serverTransport);
  const client = createClient();

  try {
    await client.connect(clientTransport);
  } catch (error) {
    clientTransport.dispose(new Error("tiny-stdio-mcp-server test pair setup failed"));
    await serverPromise;
    throw error;
  }

  const cleanup = async (): Promise<void> => {
    await client.close();
    clientTransport.dispose(new Error("tiny-stdio-mcp-server test pair cleanup"));
    await serverPromise;
  };

  return { client, cleanup };
}

export type StdioSpawn = (
  command: string,
  args: ReadonlyArray<string>,
  options: SpawnOptions
) => ChildProcessWithoutNullStreams;

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawn?: StdioSpawn;
}

export type HttpTransportFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export class HttpTransportError extends Error {
  constructor(message: string, readonly status: number, readonly method: "GET" | "POST" | "DELETE", readonly rpcMethod?: string) {
    super(message);
    this.name = "HttpTransportError";
  }
}

export interface HttpTransportOptions {
  url: string;
  /** Legacy SSE uses a GET stream that announces the RPC POST endpoint. */
  mode?: "streamable-http" | "sse";
  headers?: RequestInit["headers"];
  fetch?: HttpTransportFetch;
  oauth?: OAuthClientProviderOptions;
  oauthDiscoveryCache?: OAuthDiscoveryCache;
  onWarning?: (message: string) => void;
  maxResponseBytes?: number;
}

function defaultStdioSpawn(
  command: string,
  args: ReadonlyArray<string>,
  options: SpawnOptions
): ChildProcessWithoutNullStreams {
  return spawn(command, args, options) as ChildProcessWithoutNullStreams;
}

function defaultHttpTransportFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

export class StdioTransport implements McpTransport {
  readonly readable: Readable;
  readonly writable: Writable;
  readonly closed: Promise<McpTransportClosedEvent>;
  private readonly child: ChildProcessWithoutNullStreams;
  private disposed = false;
  private stderrOutput = "";
  private static readonly STDERR_MAX_LENGTH = 65_536;

  constructor({
    command,
    args = [],
    cwd,
    env,
    spawn: spawnProcess = defaultStdioSpawn,
  }: StdioTransportOptions) {
    this.child = spawnProcess(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const child = this.child;

    this.readable = child.stdout;
    this.writable = child.stdin;
    const stderrDecoder = new TextDecoder();
    child.stderr.on("data", (chunk: unknown) => {
      const decoded =
        chunk instanceof Uint8Array
          ? stderrDecoder.decode(chunk, { stream: true })
          : `${stderrDecoder.decode()}${String(chunk)}`;
      this.appendStderrOutput(decoded);
    });
    child.stderr.once("end", () => {
      this.appendStderrOutput(stderrDecoder.decode());
    });
    this.closed = new Promise((resolve) => {
      let settled = false;
      let streamError: Error | undefined;
      const resolveClosed = (event: McpTransportClosedEvent) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(event);
      };

      for (const stream of [child.stdin, child.stdout, child.stderr]) {
        stream.once("error", (reason: Error) => {
          streamError ??= reason;
          this.dispose(reason);
        });
      }

      child.once("exit", (code, signal) => {
        const closedEvent: McpTransportClosedEvent = {
          reason: streamError ?? new Error("Stdio transport process exited"),
        };

        if (code !== null) {
          closedEvent.code = code;
        }

        if (signal !== null) {
          closedEvent.signal = signal;
        }

        resolveClosed(closedEvent);
      });

      child.once("error", (error) => {
        const closedEvent: McpTransportClosedEvent = {
          reason: error instanceof Error ? error : new Error(String(error)),
        };

        if (child.exitCode !== null) {
          closedEvent.code = child.exitCode;
        }

        if (child.signalCode !== null) {
          closedEvent.signal = child.signalCode;
        }

        resolveClosed(closedEvent);
      });
    });
  }

  getStderrOutput(): string {
    return this.stderrOutput;
  }

  private appendStderrOutput(chunk: string): void {
    if (chunk.length === 0) {
      return;
    }

    this.stderrOutput += chunk;
    if (this.stderrOutput.length > StdioTransport.STDERR_MAX_LENGTH) {
      this.stderrOutput = this.stderrOutput.slice(-StdioTransport.STDERR_MAX_LENGTH);
    }
  }

  dispose(reason = new Error("Stdio transport disposed")): void {
    void reason;

    if (this.disposed) {
      return;
    }

    this.disposed = true;

    if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded) {
      this.child.stdin.end();
    }

    if (this.child.exitCode === null && this.child.signalCode === null && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
  }
}

export class HttpTransport implements McpTransport {
  readonly readable: Readable;
  readonly writable: Writable;
  readonly closed: Promise<McpTransportClosedEvent>;
  private readonly url: string;
  private readonly mode: "streamable-http" | "sse";
  private legacyEndpoint: string | undefined;
  private legacyEndpointReady: Promise<string> | undefined;
  private resolveLegacyEndpoint: ((endpoint: string) => void) | undefined;
  private rejectLegacyEndpoint: ((reason: Error) => void) | undefined;
  private readonly headers: HeadersInit;
  private readonly fetchImpl: HttpTransportFetch;
  private readonly readStream = new PassThrough();
  private readonly writeStream = new PassThrough();
  private resolveClosed:
    | ((closedEvent: McpTransportClosedEvent) => void)
    | undefined;
  private sessionId: string | undefined;
  private lastEventId: string | undefined;
  private getSseStreamStarted = false;
  private disposed = false;
  private readonly oauthProvider: OAuthClientProvider | undefined;
  private readonly oauthMetadataDiscovery: OAuthMetadataDiscovery | undefined;
  private readonly inFlightFetchAbortControllers = new Set<AbortController>();
  private readonly inFlightOAuthAbortControllers = new Set<AbortController>();
  private readonly oauthRequestTokens = new WeakMap<Headers, StoredOAuthTokens>();
  private readonly openResponseReaders = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  private readonly modernRequests = new Map<RequestId, AbortController>();
  private modernMode = false;
  private readonly maxResponseBytes: number;
  private readonly toolParameterHeaders = new Map<string, ParameterHeader[]>();
  private readonly onWarning: ((message: string) => void) | undefined;

  constructor({
    url,
    mode = "streamable-http",
    headers = {},
    fetch: fetchImpl = defaultHttpTransportFetch,
    oauth,
    oauthDiscoveryCache,
    onWarning,
    maxResponseBytes = 16 * 1024 * 1024,
  }: HttpTransportOptions) {
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1)
      throw new Error("HTTP response byte limit must be a positive safe integer");
    this.maxResponseBytes = maxResponseBytes;
    this.url = url;
    this.mode = mode;
    this.headers = headers;
    this.fetchImpl = fetchImpl;
    this.onWarning = onWarning;
    this.oauthProvider = oauth === undefined
      ? undefined
      : createOAuthClientProvider(oauth);
    this.oauthMetadataDiscovery = oauth === undefined
      ? undefined
      : new OAuthMetadataDiscovery({
          fetch: (input, init) => this.fetchWithAbort(input, init ?? {}),
          cache: oauthDiscoveryCache,
        });
    this.readable = this.readStream;
    this.writable = this.writeStream;
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });

    this.readStream.once("error", (error) => {
      this.dispose(error instanceof Error ? error : new Error(String(error)));
    });
    this.writeStream.once("error", (error) => {
      this.dispose(error instanceof Error ? error : new Error(String(error)));
    });

    this.consumeWrittenLines().catch((error) => {
      this.dispose(error instanceof Error ? error : new Error(String(error)));
    });
  }

  async completeInitialization(options: { signal?: AbortSignal; timeoutMs: number }): Promise<void> {
    const deadline = options.timeoutMs > 0 ? AbortSignal.timeout(Math.ceil(options.timeoutMs)) : undefined;
    const signals = [options.signal, deadline].filter((signal): signal is AbortSignal => signal !== undefined);
    const signal = signals.length === 0 ? new AbortController().signal : AbortSignal.any(signals);
    signal.throwIfAborted();
    try {
      await this.sendPost(serializeJsonRpcMessage({ jsonrpc: "2.0", method: "notifications/initialized" }), signal);
      signal.throwIfAborted();
      if (this.disposed) throw (await this.closed).reason;
    } catch (error) {
      if (error instanceof HttpTransportError)
        throw new HttpTransportError(error.message, error.status, error.method, "notifications/initialized");
      throw error;
    }
  }

  filterTools(tools: Tool[], reset = true): Tool[] {
    if (reset) this.toolParameterHeaders.clear();
    const accepted: Tool[] = [];
    for (const tool of tools) {
      try {
        this.toolParameterHeaders.set(tool.name, getParameterHeaders(tool.inputSchema));
        accepted.push(tool);
      } catch (error) {
        this.toolParameterHeaders.delete(tool.name);
        this.onWarning?.(
          `Rejected MCP tool ${tool.name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return accepted;
  }

  dispose(reason = new Error("HTTP transport disposed")): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.rejectLegacyEndpoint?.(reason);
    this.rejectLegacyEndpoint = undefined;
    this.resolveLegacyEndpoint = undefined;
    this.toolParameterHeaders.clear();
    this.abortInFlightFetches(reason);
    this.cancelOpenResponseReaders();

    if (!this.writeStream.destroyed && !this.writeStream.writableEnded) {
      this.writeStream.end();
    }

    if (!this.readStream.destroyed && !this.readStream.writableEnded) {
      this.readStream.end();
    }

    void this.closeWithSessionTermination(reason);
  }

  private async closeWithSessionTermination(reason: Error): Promise<void> {
    let closeReason = reason;
    if (this.sessionId !== undefined) {
      const sessionId = this.sessionId;
      this.sessionId = undefined;
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          const error = new Error("HTTP transport session termination timed out");
          controller.abort(error);
          reject(error);
        }, 1000);
      });
      try {
        await Promise.race([this.sendSessionTerminationRequest(sessionId, controller.signal), expired]);
      } catch (error) {
        closeReason = error instanceof Error ? error : new Error(String(error));
      } finally { clearTimeout(timeout); }
    }

    const resolveClosed = this.resolveClosed;
    this.resolveClosed = undefined;
    resolveClosed?.({ reason: closeReason });
  }

  private abortInFlightFetches(reason: Error): void {
    for (const controller of this.modernRequests.values()) controller.abort(reason);
    this.modernRequests.clear();
    for (const abortController of this.inFlightFetchAbortControllers) {
      abortController.abort(reason);
    }
    for (const controller of this.inFlightOAuthAbortControllers) controller.abort(reason);
    this.inFlightOAuthAbortControllers.clear();
    this.inFlightFetchAbortControllers.clear();
  }

  private cancelOpenResponseReaders(): void {
    for (const reader of this.openResponseReaders) {
      void reader.cancel().catch(() => undefined);
    }

    this.openResponseReaders.clear();
  }

  private async fetchWithAbort(
    input: string | URL,
    init: RequestInit,
    controller?: AbortController
  ): Promise<Response> {
    if (this.disposed) {
      throw new Error("HTTP transport disposed");
    }

    const abortController = controller ?? new AbortController();
    abortController.signal.throwIfAborted();
    const signal = init.signal == null ? abortController.signal
      : AbortSignal.any([init.signal, abortController.signal]);
    signal.throwIfAborted();
    this.inFlightFetchAbortControllers.add(abortController);

    try {
      return await fetchMcpResponse(this.fetchImpl, input, {
        ...init,
        signal
      });
    } finally {
      this.inFlightFetchAbortControllers.delete(abortController);
    }
  }

  private async consumeWrittenLines(): Promise<void> {
    for await (const line of readLines(this.writeStream)) {
      if (this.disposed || line.length === 0) {
        continue;
      }

      const parsed = parseJsonRpcMessage(line);
      const post = this.sendPost(line);
      if (
        (parsed.type === "request" && parsed.message.method === "initialize") ||
        (parsed.type === "notification" && parsed.message.method === "notifications/initialized")
      ) {
        await post;
      } else {
        void post.catch((error) => {
          this.dispose(error instanceof Error ? error : new Error(String(error)));
        });
      }
    }
  }

  private async sendPost(line: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const parsed = parseJsonRpcMessage(line);
    const message =
      parsed.type === "request" || parsed.type === "notification" ? parsed.message : undefined;
    const metadata = isObjectRecord(message?.params) ? message.params._meta : undefined;
    const modern =
      isObjectRecord(metadata) &&
      typeof metadata["io.modelcontextprotocol/protocolVersion"] === "string";
    if (modern) this.modernMode = true;
    if (parsed.type === "request" && parsed.message.method === "initialize")
      this.modernMode = false;
    if (
      this.modernMode &&
      parsed.type === "notification" &&
      parsed.message.method === "notifications/cancelled"
    ) {
      const requestId = isObjectRecord(parsed.message.params)
        ? parsed.message.params.requestId
        : undefined;
      if (typeof requestId === "string" || typeof requestId === "number")
        this.modernRequests.get(requestId)?.abort();
      return;
    }
    const controller = (modern && parsed.type === "request") || signal !== undefined ? new AbortController() : undefined;
    const aborted = () => controller?.abort(signal?.reason);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
    const id = parsed.type === "request" ? parsed.message.id : undefined;
    if (controller !== undefined && id !== undefined) this.modernRequests.set(id, controller);
    try {
      const postUrl = this.mode === "sse" ? await this.ensureLegacyEndpoint() : this.url;
      const hasSessionId = !modern && this.sessionId !== undefined;
      const response = await this.fetchWithOAuthRetry({
        url: postUrl,
        method: "POST",
        createHeaders: signal => this.createPostHeaders(message, modern, signal),
        body: line,
        controller
      });

      if (this.disposed || controller?.signal.aborted) {
        void response.body?.cancel().catch(() => undefined);
        return;
      }

      if (hasSessionId && response.status === 404) {
        void response.body?.cancel().catch(() => undefined);
        this.sessionId = undefined;
        this.dispose(new HttpTransportError("HTTP transport session expired (404 response)", 404, "POST"));
        return;
      }

      if (
        await this.throwForPostHttpError(
          response,
          modern && parsed.type === "request" ? parsed.message : undefined,
          controller?.signal
        )
      )
        return;
      if (this.disposed || controller?.signal.aborted) {
        void response.body?.cancel().catch(() => undefined);
        return;
      }
      if (!modern && this.mode !== "sse") {
        this.captureSessionId(response);
        this.maybeOpenGetSseStream();
      }
      if (controller !== undefined) await this.forwardResponseMessages(response, controller.signal, parsed.type === "request" ? new HttpResponseMessages(parsed.message) : undefined);
      else
        void this.forwardResponseMessages(response).catch((error) => {
          this.dispose(error instanceof Error ? error : new Error(String(error)));
        });
    } catch (error) {
      if (!controller?.signal.aborted) throw error;
    } finally {
      signal?.removeEventListener("abort", aborted);
      if (id !== undefined && this.modernRequests.get(id) === controller)
        this.modernRequests.delete(id);
    }
  }

  private async createPostHeaders(
    message?: JsonRpcRequest | JsonRpcNotification,
    modern = false,
    signal?: AbortSignal
  ): Promise<Headers> {
    const headers = new Headers(this.headers);
    headers.set("Accept", "application/json, text/event-stream");
    headers.set("Content-Type", "application/json");
    if (
      modern &&
      message !== undefined &&
      isObjectRecord(message.params) &&
      isObjectRecord(message.params._meta)
    ) {
      headers.delete("Mcp-Session-Id");
      headers.delete("Last-Event-ID");
      headers.set(
        "MCP-Protocol-Version",
        message.params._meta["io.modelcontextprotocol/protocolVersion"] as string
      );
      if ("id" in message) {
        headers.set("Mcp-Method", message.method);
        const name = message.method === "resources/read" ? message.params.uri : message.params.name;
        if (
          (message.method === "tools/call" ||
            message.method === "resources/read" ||
            message.method === "prompts/get") &&
          typeof name === "string"
        )
          headers.set("Mcp-Name", encodeHeaderValue(name));
        else headers.delete("Mcp-Name");
        if (message.method === "tools/call" && typeof message.params.name === "string") {
          const definitions = this.toolParameterHeaders.get(message.params.name) ?? [];
          for (const definition of definitions) headers.delete(definition.name);
          for (const [name, value] of Object.entries(
            createParameterHeaders(definitions, message.params.arguments)
          ))
            headers.set(name, value);
        }
      }
    } else if (this.sessionId !== undefined) {
      headers.set("Mcp-Session-Id", this.sessionId);
      headers.set("MCP-Protocol-Version", MCP_PROTOCOL_VERSION);
    }
    return this.authorizeRequestHeaders(headers, signal);
  }

  private async createGetHeaders(signal?: AbortSignal): Promise<Headers> {
    const headers = new Headers(this.headers);
    headers.set("Accept", "text/event-stream");
    if (this.sessionId !== undefined) {
      headers.set("Mcp-Session-Id", this.sessionId);
      headers.set("MCP-Protocol-Version", MCP_PROTOCOL_VERSION);
    }
    if (this.lastEventId !== undefined) {
      headers.set("Last-Event-ID", this.lastEventId);
    }
    return this.authorizeRequestHeaders(headers, signal);
  }

  private async createDeleteHeaders(sessionId: string, signal?: AbortSignal): Promise<Headers> {
    const headers = new Headers(this.headers);
    headers.set("Mcp-Session-Id", sessionId);
    headers.set("MCP-Protocol-Version", MCP_PROTOCOL_VERSION);
    return this.authorizeRequestHeaders(headers, signal);
  }

  private async authorizeRequestHeaders(headers: Headers, signal?: AbortSignal): Promise<Headers> {
    signal?.throwIfAborted();
    const tokens = await this.oauthProvider?.authorizeRequest?.({
      requestUrl: new URL(this.url),
      headers, signal,
      fetch: (url, init) => fetchMcpResponse(this.fetchImpl, url, {
        ...init, signal: signal === undefined ? init?.signal : init?.signal == null ? signal : AbortSignal.any([signal, init.signal])
      }),
    });
    if (tokens !== undefined) this.oauthRequestTokens.set(headers, { ...tokens });
    signal?.throwIfAborted();
    return headers;
  }

  private captureSessionId(response: Response): void {
    const sessionId = response.headers.get("Mcp-Session-Id");
    if (sessionId === null || sessionId.length === 0) {
      return;
    }

    if (this.sessionId !== undefined && this.sessionId !== sessionId) {
      throw new Error("HTTP transport response changed active session ID");
    }

    this.sessionId = sessionId;
  }

  private maybeOpenGetSseStream(): void {
    if (this.disposed || this.sessionId === undefined || this.getSseStreamStarted) {
      return;
    }

    this.getSseStreamStarted = true;
    this.consumeGetSseStream().catch((error) => {
      if (error instanceof HttpTransportGetSseNotSupportedError || this.disposed) {
        return;
      }

      this.dispose(error instanceof Error ? error : new Error(String(error)));
    });
  }

  private ensureLegacyEndpoint(): Promise<string> {
    if (this.legacyEndpointReady !== undefined) return this.legacyEndpointReady;
    this.legacyEndpointReady = new Promise((resolve, reject) => {
      this.resolveLegacyEndpoint = resolve;
      this.rejectLegacyEndpoint = reject;
    });
    void this.consumeGetSseStream().catch((error: unknown) => {
      this.dispose(error instanceof Error ? error : new Error(String(error)));
    });
    return this.legacyEndpointReady;
  }

  private async sendSessionTerminationRequest(sessionId: string, signal: AbortSignal): Promise<void> {
    const headers = await this.createDeleteHeaders(sessionId, signal);
    signal.throwIfAborted();
    const response = await fetchMcpResponse(this.fetchImpl, this.url, {
      method: "DELETE",
      headers, signal,
    });
    if (signal.aborted) {
      void response.body?.cancel().catch(() => undefined);
      signal.throwIfAborted();
    }

    if (response.status === 405 || response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return;
    }

    const responseBody = (await readBoundedResponseText(response, this.maxResponseBytes, this.openResponseReaders, signal)).trim();
    const statusDescriptor = `${response.status} ${response.statusText}`.trim();
    const message = responseBody.length === 0
      ? `HTTP transport DELETE failed (${statusDescriptor})`
      : `HTTP transport DELETE failed (${statusDescriptor}): ${responseBody}`;
    throw new HttpTransportError(message, response.status, "DELETE");
  }

  private async consumeGetSseStream(): Promise<void> {
    const response = await this.fetchWithOAuthRetry({
      method: "GET",
      createHeaders: signal => this.createGetHeaders(signal),
    });
    if (this.disposed) {
      void response.body?.cancel().catch(() => undefined);
      return;
    }

    if (response.status === 405) {
      void response.body?.cancel().catch(() => undefined);
      if (this.mode === "sse") throw new HttpTransportError("Legacy SSE GET failed (405)", 405, "GET");
      throw new HttpTransportGetSseNotSupportedError();
    }

    if (response.status === 404) {
      void response.body?.cancel().catch(() => undefined);
      this.sessionId = undefined;
      throw new HttpTransportError("HTTP transport session expired (GET 404 response)", 404, "GET");
    }

    if (!response.ok) {
      const responseBody = (await readBoundedResponseText(response, this.maxResponseBytes, this.openResponseReaders)).trim();
      const statusDescriptor = `${response.status} ${response.statusText}`.trim();
      const message = responseBody.length === 0
        ? `HTTP transport GET failed (${statusDescriptor})`
        : `HTTP transport GET failed (${statusDescriptor}): ${responseBody}`;
      throw new HttpTransportError(message, response.status, "GET");
    }

    const contentType = response.headers.get("Content-Type");
    if (contentType === null) {
      void response.body?.cancel().catch(() => undefined);
      if (this.mode === "sse") throw new Error("Legacy SSE GET returned an unsupported content type");
      return;
    }

    if (contentType.split(";")[0]?.trim().toLowerCase() === "text/event-stream") {
      await this.forwardSseResponseMessages(response, undefined, undefined, this.mode === "sse");
      if (this.mode === "sse") {
        if (!this.disposed) throw new Error("Legacy SSE stream ended");
        return;
      }
      this.getSseStreamStarted = false;
      if (!this.disposed && this.sessionId !== undefined && this.lastEventId !== undefined) {
        this.maybeOpenGetSseStream();
      }
      return;
    }

    void response.body?.cancel().catch(() => undefined);
    if (this.mode === "sse") throw new Error("Legacy SSE GET returned an unsupported content type");
  }

  private async throwForPostHttpError(
    response: Response,
    request?: JsonRpcRequest,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (response.status < 400) {
      return false;
    }

    const responseBody = (
      await readBoundedResponseText(
        response,
        this.maxResponseBytes,
        this.openResponseReaders,
        signal
      )
    ).trim();
    if (request !== undefined && responseBody.length > 0) {
      let parsed = parseJsonRpcMessage(responseBody);
      if (parsed.type === "invalid") {
        try {
          const raw: unknown = JSON.parse(responseBody);
          if (
            isObjectRecord(raw) &&
            raw.jsonrpc === "2.0" &&
            (!hasOwn(raw, "id") || raw.id === null) &&
            !hasOwn(raw, "method") &&
            !hasOwn(raw, "result") &&
            isJsonRpcErrorObject(raw.error)
          ) {
            parsed = parseJsonRpcMessage(JSON.stringify({ ...raw, id: request.id }));
          }
        } catch {
          /* Unrecognized HTTP error bodies use normal fallback rules. */
        }
      }
      if (
        parsed.type === "response" &&
        "error" in parsed.message &&
        parsed.message.id === request.id
      ) {
        this.writeReadableLine(serializeJsonRpcMessage(parsed.message));
        return true;
      }
    }
    if (request?.method === "server/discover" && response.status >= 400 && response.status < 500) {
      this.writeReadableLine(
        serializeJsonRpcMessage({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: ERROR_METHOD_NOT_FOUND, message: "Modern discovery unavailable" }
        })
      );
      return true;
    }
    const statusDescriptor = `${response.status} ${response.statusText}`.trim();
    const message =
      responseBody.length === 0
        ? `HTTP transport POST failed (${statusDescriptor})`
        : `HTTP transport POST failed (${statusDescriptor}): ${responseBody}`;
    throw new HttpTransportError(message, response.status, "POST");
  }

  private async maybeHandleUnauthorizedResponse(response: Response, signal: AbortSignal, requestHeaders: Headers, presentedTokens: StoredOAuthTokens | null): Promise<boolean> {
    if (response.status !== 401 || this.oauthProvider === undefined) {
      return false;
    }

    const discoveryClient = this.oauthMetadataDiscovery;
    if (discoveryClient === undefined) {
      return false;
    }

    const challenge = parseBearerWwwAuthenticateHeader(response.headers.get("WWW-Authenticate"));
    const resourceMetadataUrl = challenge?.params.resource_metadata;
    try {
      const discovery = await discoveryClient.discover(this.url, { resourceMetadataUrl, signal });
      const providerResponse = response.clone();
      let result;
      try {
        result = await this.oauthProvider.handleUnauthorized({
          requestUrl: new URL(this.url), response: providerResponse, challenge, discovery,
          signal,
          requestHeaders: new Headers(requestHeaders),
          presentedTokens,
          fetch: (url, init) => fetchMcpResponse(this.fetchImpl, url, {
            ...init, signal: init?.signal == null ? signal : AbortSignal.any([signal, init.signal])
          }),
        });
        signal.throwIfAborted();
      } finally {
        // Cancel both tee branches without awaiting adapter cleanup.
        void providerResponse.body?.cancel().catch(() => undefined);
      }
      if (result.action === "retry") {
        void response.body?.cancel().catch(() => undefined);
        return true;
      }
      if (result.error !== undefined) throw result.error;
      return false;
    } catch (error) {
      void response.body?.cancel().catch(() => undefined);
      throw error;
    }
  }

  private async forwardResponseMessages(response: Response, signal?: AbortSignal, context?: HttpResponseMessages): Promise<void> {
    if (response.status === 202) {
      void response.body?.cancel().catch(() => undefined);
      return;
    }

    const contentType = response.headers.get("Content-Type");
    if (contentType === null) {
      void response.body?.cancel().catch(() => undefined);
      return;
    }

    const normalizedContentType = contentType.split(";")[0]?.trim().toLowerCase();
    if (normalizedContentType === "text/event-stream") {
      await this.forwardSseResponseMessages(response, signal, context);
      return;
    }

    if (normalizedContentType === "application/json") {
      await this.forwardJsonResponseMessage(response, signal, context);
      return;
    }

    void response.body?.cancel().catch(() => undefined);
    throw new Error("HTTP transport POST returned an unsupported response content type");
  }

  private async forwardSseResponseMessages(
    response: Response,
    signal?: AbortSignal,
    context?: HttpResponseMessages,
    acceptEndpoint = false
  ): Promise<void> {
    if (response.body === null) {
      return;
    }

    const parser = new SseParser(this.maxResponseBytes, acceptEndpoint);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const reader = response.body.getReader();
    this.openResponseReaders.add(reader);
    const abort = (): void => {
      void reader.cancel().catch(() => undefined);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();

    try {
      while (true) {
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        if (done) {
          break;
        }

        if (value === undefined) {
          continue;
        }

        const messages = parser.push(decoder.decode(value, { stream: true }));
        this.writeSseMessages(messages, context);
        if (context?.completed) { void reader.cancel().catch(() => undefined); return; }
        this.lastEventId = parser.lastEventId;
      }

      const trailingChunk = decoder.decode();
      if (trailingChunk.length > 0) {
        this.writeSseMessages(parser.push(trailingChunk), context);
        this.lastEventId = parser.lastEventId;
      }

      this.writeSseMessages(parser.flush(), context);
      this.lastEventId = parser.lastEventId;
      if (context !== undefined && !context.completed) throw new Error("MCP HTTP stream ended before its final response");
    } catch (error) {
      void reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      this.openResponseReaders.delete(reader);
      reader.releaseLock();
    }
  }

  private async forwardJsonResponseMessage(
    response: Response,
    signal?: AbortSignal,
    context?: HttpResponseMessages
  ): Promise<void> {
    const payload = await readBoundedResponseText(
      response,
      this.maxResponseBytes,
      this.openResponseReaders,
      signal
    );
    if (payload.length === 0) {
      if (context !== undefined) throw new Error("MCP HTTP response body is empty");
      return;
    }

    if (context !== undefined) { this.writeReadableLine(context.validate(payload, false)); return; }
    const parsedPayload = JSON.parse(payload) as unknown;
    this.writeReadableLine(JSON.stringify(parsedPayload));
  }

  private writeSseMessages(messages: ParsedSseMessage[], context?: HttpResponseMessages): void {
    for (const message of messages) {
      if (message.event === "endpoint") {
        const endpoint = new URL(message.data, this.url);
        const resource = new URL(this.url);
        if ((endpoint.protocol !== "http:" && endpoint.protocol !== "https:") ||
            endpoint.origin !== resource.origin || endpoint.username || endpoint.password || endpoint.hash)
          throw new Error("Unsafe legacy SSE endpoint");
        if (this.legacyEndpoint !== undefined && this.legacyEndpoint !== endpoint.href)
          throw new Error("Legacy SSE endpoint changed during the active connection");
        this.legacyEndpoint = endpoint.href;
        this.resolveLegacyEndpoint?.(endpoint.href);
        this.resolveLegacyEndpoint = undefined;
        this.rejectLegacyEndpoint = undefined;
        continue;
      }
      this.writeReadableLine(context?.validate(message.data, true) ?? message.data);
      if (context?.completed) return;
    }
  }

  private writeReadableLine(line: string): void {
    if (this.disposed || this.readStream.destroyed || this.readStream.writableEnded) {
      return;
    }

    this.readStream.write(`${line}\n`);
  }

  private async fetchWithOAuthRetry(input: {
    url?: string;
    method: "GET" | "POST";
    createHeaders: (signal: AbortSignal) => Promise<Headers>;
    body?: BodyInit;
    controller?: AbortController;
  }): Promise<Response> {
    const controller = input.controller ?? new AbortController();
    this.inFlightOAuthAbortControllers.add(controller);
    const request = async (): Promise<{ response: Response; headers: Headers; tokens: StoredOAuthTokens | null }> => {
      controller.signal.throwIfAborted();
      const headers = await input.createHeaders(controller.signal);
      const headerSnapshot = new Headers(headers);
      const tokens = this.oauthRequestTokens.get(headers) ?? null;
      controller.signal.throwIfAborted();
      const response = await this.fetchWithAbort(input.url ?? this.url, {
        method: input.method, headers, body: input.body
      }, controller);
      return { response, headers: headerSnapshot, tokens };
    };
    try {
      let attempt = await request();
      if (await this.maybeHandleUnauthorizedResponse(attempt.response, controller.signal, attempt.headers, attempt.tokens)) attempt = await request();
      const response = attempt.response;
      const oauthError = this.oauthProvider === undefined ? null : this.readOAuthChallengeError(response);
      if (oauthError !== null) {
        void response.body?.cancel().catch(() => undefined);
        throw oauthError;
      }
      return response;
    } finally { this.inFlightOAuthAbortControllers.delete(controller); }
  }

  private readOAuthChallengeError(response: Response): OAuthError | null {
    if (response.status !== 401 && response.status !== 403) {
      return null;
    }

    const challenge = parseBearerWwwAuthenticateHeader(response.headers.get("WWW-Authenticate"));
    const error = challenge?.params.error;
    if (error === undefined || error.length === 0) {
      return null;
    }

    return new OAuthError(
      {
        error,
        error_description: challenge?.params.error_description,
        error_uri: challenge?.params.error_uri,
      },
      response.status
    );
  }
}

class HttpTransportGetSseNotSupportedError extends Error {
  constructor() {
    super("HTTP transport server does not support GET SSE streams");
  }
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: RequestId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export class McpError extends Error {
  readonly code: number;
  declare readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "McpError";
    this.code = code;
    if (data !== undefined) {
      this.data = data;
    }
  }
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: RequestId;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: RequestId;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export type ParsedJsonRpcMessage =
  | {
      type: "request";
      message: JsonRpcRequest;
    }
  | {
      type: "notification";
      message: JsonRpcNotification;
    }
  | {
      type: "response";
      message: JsonRpcResponse;
    }
  | {
      type: "invalid";
      id: RequestId | null;
      error: McpError;
    };

export function serializeJsonRpcMessage(message: JsonRpcMessage): string {
  if ("result" in message && !isJsonValue(message.result)) {
    throw new McpError(ERROR_INTERNAL, "Response result must contain only JSON values");
  }
  if ("params" in message && message.params !== undefined && !isJsonValue(message.params)) {
    throw new McpError(ERROR_INVALID_PARAMS, "Message params must contain only JSON values");
  }
  return `${JSON.stringify(message)}\n`;
}

function normalizeLine(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

export async function* readLines(stream: Readable, maxLineBytes = 16 * 1024 * 1024): AsyncGenerator<string> {
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1) {
    throw new Error("Stdio line byte limit must be a positive safe integer");
  }
  let parts: string[] = [];
  let bytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const append = (part: string): void => {
    bytes += Buffer.byteLength(part, "utf8");
    if (bytes > maxLineBytes) throw new Error(`Stdio input line byte limit exceeded (${maxLineBytes} bytes)`);
    if (part.length > 0) parts.push(part);
  };

  for await (const chunk of stream as AsyncIterable<unknown>) {
    const text = chunk instanceof Uint8Array
      ? decoder.decode(chunk, { stream: true })
      : decoder.decode() + String(chunk);
    let start = 0;
    let newline = text.indexOf("\n", start);
    while (newline !== -1) {
      append(text.slice(start, newline));
      yield normalizeLine(parts.join(""));
      parts = [];
      bytes = 0;
      start = newline + 1;
      newline = text.indexOf("\n", start);
    }
    append(text.slice(start));
  }
  append(decoder.decode());
  if (parts.length > 0) yield normalizeLine(parts.join(""));
}

export interface ParsedSseMessage {
  data: string;
  id?: string;
  event?: "endpoint";
}

export class SseParser {
  private buffer = "";
  private skipLf = false;
  private eventType: string | undefined;
  private dataLines: string[] = [];
  private eventId = "";
  private hasEventId = false;
  private _lastEventId: string | undefined;
  private dataBytes = 0;

  constructor(private readonly maxEventBytes = 16 * 1024 * 1024, private readonly acceptEndpoint = false) {
    if (!Number.isSafeInteger(maxEventBytes) || maxEventBytes < 1)
      throw new Error("SSE event byte limit must be a positive safe integer");
  }

  get lastEventId(): string | undefined {
    return this._lastEventId;
  }

  push(chunk: string): ParsedSseMessage[] {
    if (chunk.length === 0) {
      return [];
    }

    if (this.skipLf) {
      this.skipLf = false;
      if (chunk.startsWith("\n")) chunk = chunk.slice(1);
    }
    this.buffer += chunk;
    const messages: ParsedSseMessage[] = [];
    let start = 0;
    for (let index = 0; index < this.buffer.length; index += 1) {
      const character = this.buffer[index];
      if (character !== "\n" && character !== "\r") continue;
      const line = this.buffer.slice(start, index);
      if (character === "\r") {
        if (this.buffer[index + 1] === "\n") index += 1;
        else if (index === this.buffer.length - 1) this.skipLf = true;
      }
      start = index + 1;
      if (Buffer.byteLength(line, "utf8") > this.maxEventBytes)
        throw new Error(`SSE event exceeds ${this.maxEventBytes} bytes`);
      this.consumeLine(line, messages);
      this.assertEventSize("");
    }
    this.buffer = this.buffer.slice(start);

    this.assertEventSize(this.buffer);

    return messages;
  }

  flush(): ParsedSseMessage[] {
    this.buffer = "";
    this.skipLf = false;
    this.resetEvent();
    return [];
  }

  private consumeLine(line: string, messages: ParsedSseMessage[]): void {
    if (line.length === 0) {
      this.emitEvent(messages);
      return;
    }

    if (line.startsWith(":")) {
      return;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") {
      this.eventType = value;
      return;
    }

    if (field === "data") {
      this.dataBytes += Buffer.byteLength(value, "utf8") + (this.dataLines.length > 0 ? 1 : 0);
      this.dataLines.push(value);
      return;
    }

    if (field === "id") {
      if (value.includes("\0")) {
        return;
      }

      this.eventId = value;
      this.hasEventId = true;
    }
  }

  private emitEvent(messages: ParsedSseMessage[]): void {
    const eventType = this.eventType ?? "message";

    if (this.hasEventId) {
      this._lastEventId = this.eventId;
    }

    if (this.dataLines.length === 0 || (eventType !== "message" && !(this.acceptEndpoint && eventType === "endpoint"))) {
      this.resetEvent();
      return;
    }

    const message: ParsedSseMessage = {
      data: this.dataLines.join("\n"),
    };
    if (eventType === "endpoint") message.event = "endpoint";

    if (this.hasEventId) {
      message.id = this.eventId;
    }

    messages.push(message);
    this.resetEvent();
  }

  private resetEvent(): void {
    this.eventType = undefined;
    this.dataLines = [];
    this.eventId = "";
    this.hasEventId = false;
    this.dataBytes = 0;
  }

  private assertEventSize(partialLine: string): void {
    if (this.dataBytes + Buffer.byteLength(this.eventType ?? "", "utf8") +
        Buffer.byteLength(this.eventId, "utf8") + Buffer.byteLength(partialLine, "utf8") > this.maxEventBytes)
      throw new Error(`SSE event exceeds ${this.maxEventBytes} bytes`);
  }
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
  timeout: ReturnType<typeof setTimeout> | undefined;
}

interface ActiveIncomingRequest {
  controller: AbortController;
}

export interface JsonRpcRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number | null;
  onRequestId?: (requestId: RequestId) => void;
  onTimeout?: (requestId: RequestId) => void;
}

export interface McpRequestContext {
  readonly id: RequestId;
  readonly method: string;
  readonly signal: AbortSignal;
}

type JsonRpcRequestHandler = (
  params: unknown,
  context: McpRequestContext
) => unknown | Promise<unknown>;

interface JsonRpcNotificationContext {
  method: string;
}

type JsonRpcNotificationHandler = (
  params: unknown,
  context: JsonRpcNotificationContext
) => unknown | Promise<unknown>;

export class JsonRpcMessageLayer {
  requestMetadata?: Record<string, unknown>;
  readonly requestTimeoutMs: number;
  private readonly input: Readable;
  private readonly output: Writable;
  private readonly inputClosedReason: Promise<Error> | undefined;
  private nextRequestId = 1;
  private readonly exchangeControllers = new Set<AbortController>();
  private disposedError: Error | undefined;
  private readonly pendingRequests = new Map<RequestId, PendingRequest>();
  private readonly activeIncomingRequests = new Map<RequestId, ActiveIncomingRequest>();
  private readonly requestHandlers = new Map<string, JsonRpcRequestHandler>();
  private readonly inputRequestHandlers = new Map<string, JsonRpcRequestHandler>();
  private readonly notificationHandlers = new Map<string, JsonRpcNotificationHandler>();

  constructor(
    input: Readable,
    output: Writable,
    requestTimeoutMs = 30_000,
    inputClosedReason?: Promise<Error>,
    private readonly maxConcurrentRequests = 128
  ) {
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 0) {
      throw new Error("requestTimeoutMs must be a non-negative finite number");
    }
    if (!Number.isSafeInteger(maxConcurrentRequests) || maxConcurrentRequests < 1)
      throw new Error("maxConcurrentRequests must be a positive safe integer");

    this.input = input;
    this.output = output;
    this.inputClosedReason = inputClosedReason;
    this.requestTimeoutMs = requestTimeoutMs;
    output.once("error", (reason: Error) => this.dispose(reason));
    output.once("close", () => {
      if (this.disposedError !== undefined) return;
      void this.resolveInputStreamClosedReason(new Error("JSON-RPC output closed"))
        .then((reason) => this.dispose(reason));
    });
    this.consumeInput().catch(() => undefined);
  }

  sendNotification(method: string, params?: unknown): void {
    if (this.disposedError !== undefined) {
      throw this.disposedError;
    }

    if (params !== undefined && !isJsonValue(params)) {
      throw new McpError(ERROR_INVALID_PARAMS, "Notification params must contain only JSON values");
    }
    if (!isValidParamsMetadata(params)) {
      throw new McpError(ERROR_INVALID_PARAMS, "Invalid notification metadata");
    }

    const message: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
    };

    if (params !== undefined) {
      message.params = params;
    }

    this.output.write(serializeJsonRpcMessage(message));
  }

  onRequest(method: string, handler: JsonRpcRequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  onNotification(method: string, handler: JsonRpcNotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  onInputRequest(method: string, handler: JsonRpcRequestHandler): void {
    this.inputRequestHandlers.set(method, handler);
  }

  sendRequest(
    method: string,
    params?: unknown,
    options: JsonRpcRequestOptions = {}
  ): Promise<unknown> {
    if (this.disposedError !== undefined) throw this.disposedError;
    const timeoutMs =
      options.timeoutMs === null ? null : (options.timeoutMs ?? this.requestTimeoutMs);
    if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
      throw new Error("timeoutMs must be a non-negative finite number");
    }
    if (this.exchangeControllers.size >= this.maxConcurrentRequests)
      throw new Error("JSON-RPC request capacity exceeded");
    if (params !== undefined && !isJsonValue(params)) {
      return Promise.reject(new McpError(ERROR_INVALID_PARAMS, "Request params must contain only JSON values"));
    }
    if (!isValidParamsMetadata(params) ||
        (this.requestMetadata !== undefined && !isValidMetadata(this.requestMetadata))) {
      return Promise.reject(new McpError(ERROR_INVALID_PARAMS, "Invalid request metadata"));
    }
    const originalParams = this.requestMetadata === undefined ? params : structuredClone(params);
    const controller = new AbortController();
    const callerSignal = options.signal;
    const onRequestId = options.onRequestId;
    let currentRequestId: RequestId | undefined;
    let rejectAbort: (reason: unknown) => void;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const cancel = () => {
      if (currentRequestId !== undefined) this.cancelRequest(currentRequestId, controller.signal.reason);
      rejectAbort(controller.signal.reason);
    };
    const forwardAbort = () => controller.abort(callerSignal?.reason);
    controller.signal.addEventListener("abort", cancel, { once: true });
    callerSignal?.addEventListener("abort", forwardAbort, { once: true });
    this.exchangeControllers.add(controller);
    options = { ...options, signal: controller.signal, onRequestId: (id) => {
      currentRequestId = id;
      onRequestId?.(id);
    } };
    if (callerSignal?.aborted) forwardAbort();
    const work = (async () => {
      let retryParams = originalParams;
      for (let round = 0; round <= 64; round += 1) {
        if (this.disposedError !== undefined) throw this.disposedError;
        if (options.signal?.aborted) throw options.signal.reason;
        const result = await this.sendRequestOnce(method, retryParams, options);
        if (this.requestMetadata === undefined) return result;
        if (
          !isObjectRecord(result) ||
          (result.resultType !== "complete" && result.resultType !== "input_required")
        ) {
          throw new McpError(ERROR_INVALID_REQUEST, "Invalid modern resultType");
        }
        if (result.resultType === "complete") {
          const cacheError = validateCacheMetadata(method, result);
          if (cacheError !== undefined) throw new McpError(ERROR_INVALID_REQUEST, cacheError);
          if (!validateServerResult(method, result)) throw new McpError(ERROR_INVALID_REQUEST, `Invalid ${method} result`);
          return result;
        }
        const validation = validateInputRequiredResult(
          method,
          result,
          this.requestMetadata["io.modelcontextprotocol/clientCapabilities"] as Record<
            string,
            unknown
          >
        );
        if (validation?.error !== undefined) {
          const error = validation.error;
          throw new McpError(
            error.code === ERROR_INTERNAL ? ERROR_INVALID_REQUEST : error.code,
            error.message,
            error.data
          );
        }
        if (round === 64)
          throw new McpError(ERROR_INVALID_REQUEST, "MCP input round limit exceeded");
        const inputs = Object.entries(result.inputRequests ?? {});
        if (inputs.length > 64)
          throw new McpError(ERROR_INVALID_REQUEST, "MCP input request limit exceeded");
        for (const [, input] of inputs) {
          if (!this.inputRequestHandlers.has((input as { method: string }).method)) {
            throw new McpError(-32021, "Unsupported MCP input request");
          }
        }
        const inputResponses: Record<string, unknown> = Object.create(null);
        for (const [key, input] of inputs) {
          if (this.disposedError !== undefined) throw this.disposedError;
          if (options.signal?.aborted) throw options.signal.reason;
          const request = input as { method: keyof typeof inputResponseTypes; params?: unknown };
          const response = await this.inputRequestHandlers.get(request.method)!(request.params, {
            id: key,
            method: request.method,
            signal: controller.signal
          });
          if (!validateProtocolValue(inputResponseTypes[request.method], response)) {
            throw new McpError(ERROR_INVALID_REQUEST, "Invalid MCP input response");
          }
          inputResponses[key] = response;
        }
        if (this.disposedError !== undefined) throw this.disposedError;
        if (options.signal?.aborted) throw options.signal.reason;
        const original = isObjectRecord(originalParams) ? originalParams : {};
        const {
          requestState: ignoredState,
          inputResponses: ignoredResponses,
          ...baseParams
        } = original;
        retryParams = {
          ...baseParams,
          ...(result.requestState === undefined ? {} : { requestState: result.requestState }),
          ...(result.inputRequests === undefined ? {} : { inputResponses })
        };
      }
      throw new McpError(ERROR_INTERNAL, "Unreachable MCP retry state");
    })();
    return Promise.race([work, aborted]).finally(() => {
      callerSignal?.removeEventListener("abort", forwardAbort);
      controller.signal.removeEventListener("abort", cancel);
      this.exchangeControllers.delete(controller);
    });
  }

  private sendRequestOnce(
    method: string,
    params?: unknown,
    options: JsonRpcRequestOptions = {}
  ): Promise<unknown> {
    if (this.disposedError !== undefined) {
      throw this.disposedError;
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const timeoutMs =
      options.timeoutMs === null ? null : (options.timeoutMs ?? this.requestTimeoutMs);

    if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
      throw new Error("timeoutMs must be a non-negative finite number");
    }
    if (options.onRequestId !== undefined) {
      options.onRequestId(id);
    }
    options.signal?.throwIfAborted();

    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method
    };

    if (this.requestMetadata !== undefined) {
      if (params !== undefined && !isObjectRecord(params)) {
        throw new McpError(ERROR_INVALID_PARAMS, "Modern request params must be an object");
      }
      const supplied = isObjectRecord(params) && isObjectRecord(params._meta) ? params._meta : {};
      message.params = {
        ...(params ?? {}),
        _meta: { ...supplied, ...structuredClone(this.requestMetadata) }
      };
    } else if (params !== undefined) {
      message.params = params;
    }

    return new Promise((resolve, reject) => {
      const timeout =
        timeoutMs === null
          ? undefined
          : setTimeout(() => {
              this.pendingRequests.delete(id);
              options.onTimeout?.(id);
              reject(new Error(`JSON-RPC request "${method}" timed out after ${timeoutMs}ms`));
            }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      try {
        this.output.write(serializeJsonRpcMessage(message));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  cancelRequest(requestId: RequestId, reason: unknown): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (pending === undefined) {
      return false;
    }

    this.pendingRequests.delete(requestId);
    clearTimeout(pending.timeout);
    pending.reject(reason);
    return true;
  }

  dispose(reason = new Error("JSON-RPC message layer disposed")): void {
    if (this.disposedError !== undefined) {
      return;
    }

    this.disposedError = reason;
    for (const controller of this.exchangeControllers) controller.abort(reason);

    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(reason);
    }

    this.pendingRequests.clear();
    for (const request of this.activeIncomingRequests.values()) request.controller.abort(reason);
    this.activeIncomingRequests.clear();
  }

  private async consumeInput(): Promise<void> {
    try {
      for await (const line of readLines(this.input)) {
        if (this.disposedError !== undefined) {
          break;
        }

        if (line.length === 0) {
          continue;
        }

        let parsedLine: unknown;
        try {
          parsedLine = JSON.parse(line);
        } catch {
          await this.processParsedMessage({
            type: "invalid",
            id: null,
            error: parseError(),
          });
          continue;
        }

        if (Array.isArray(parsedLine)) {
          for (const message of parsedLine) {
            if (this.disposedError !== undefined) {
              break;
            }

            await this.processParsedMessage(parseJsonRpcPayload(message));
          }
          continue;
        }

        await this.processParsedMessage(parseJsonRpcPayload(parsedLine));
      }
    } catch (error) {
      if (this.disposedError === undefined) {
        this.dispose(
          error instanceof Error
            ? error
            : new Error(`JSON-RPC input stream failed: ${String(error)}`)
        );
      }
      return;
    }

    if (this.disposedError === undefined) {
      const streamClosedReason = await this.resolveInputStreamClosedReason();
      if (this.disposedError === undefined) {
        this.dispose(streamClosedReason);
      }
    }
  }

  private async resolveInputStreamClosedReason(
    streamClosedError = new Error("JSON-RPC input stream closed")
  ): Promise<Error> {
    if (this.inputClosedReason === undefined) {
      return streamClosedError;
    }

    try {
      return await Promise.race([
        this.inputClosedReason,
        new Promise<Error>((resolve) => {
          setTimeout(() => {
            resolve(streamClosedError);
          }, 50);
        }),
      ]);
    } catch {
      return streamClosedError;
    }
  }

  private async processParsedMessage(parsed: ParsedJsonRpcMessage): Promise<void> {
    if (parsed.type === "request") {
      if (this.requestMetadata !== undefined) {
        this.output.write(serializeJsonRpcMessage({
          jsonrpc: "2.0", id: parsed.message.id,
          error: { code: ERROR_INVALID_REQUEST, message: "Modern MCP servers cannot initiate JSON-RPC requests" }
        }));
        return;
      }
      const handler = this.requestHandlers.get(parsed.message.method);
      if (handler === undefined) {
        this.output.write(
          serializeJsonRpcMessage({
            jsonrpc: "2.0",
            id: parsed.message.id,
            error: {
              code: ERROR_METHOD_NOT_FOUND,
              message: `Method not found: ${parsed.message.method}`,
            },
          })
        );
        return;
      }

      this.handleIncomingRequest(parsed.message, handler);
      return;
    }

    if (parsed.type === "notification") {
      if (parsed.message.method === "notifications/cancelled") {
        this.handleCancellationNotification(parsed.message.params);
      }

      const handler = this.notificationHandlers.get(parsed.message.method);
      if (handler === undefined) {
        return;
      }

      try {
        await handler(parsed.message.params, {
          method: parsed.message.method,
        });
      } catch {
        return;
      }
      return;
    }

    if (parsed.type === "invalid") {
      const errorResponse: {
        jsonrpc: "2.0";
        id: RequestId | null;
        error: JsonRpcErrorObject;
      } = {
        jsonrpc: "2.0",
        id: parsed.id,
        error: {
          code: parsed.error.code,
          message: parsed.error.message,
        },
      };

      if (parsed.error.data !== undefined) {
        errorResponse.error.data = parsed.error.data;
      }

      this.output.write(`${JSON.stringify(errorResponse)}\n`);
      return;
    }

    if (parsed.type !== "response") {
      return;
    }

    const pending = this.pendingRequests.get(parsed.message.id);
    if (pending === undefined) {
      return;
    }

    this.pendingRequests.delete(parsed.message.id);
    clearTimeout(pending.timeout);
    if ("result" in parsed.message) {
      pending.resolve(parsed.message.result);
      return;
    }

    pending.reject(
      new McpError(
        parsed.message.error.code,
        parsed.message.error.message,
        parsed.message.error.data
      )
    );
  }

  private handleIncomingRequest(message: JsonRpcRequest, handler: JsonRpcRequestHandler): void {
    if (this.activeIncomingRequests.has(message.id) || this.activeIncomingRequests.size >= this.maxConcurrentRequests) {
      const duplicate = this.activeIncomingRequests.has(message.id);
      this.output.write(serializeJsonRpcMessage({
        jsonrpc: "2.0", id: message.id,
        error: { code: duplicate ? ERROR_INVALID_REQUEST : -32000,
          message: duplicate ? "Duplicate active server request ID" : "Server request capacity exceeded" }
      }));
      return;
    }
    const activeRequest: ActiveIncomingRequest = {
      controller: new AbortController(),
    };
    this.activeIncomingRequests.set(message.id, activeRequest);

    void (async () => {
      try {
        const responseType = inputResponseTypes[message.method as keyof typeof inputResponseTypes];
        if (responseType !== undefined && !validateProtocolValue("InputRequest", {
          method: message.method,
          ...(message.params === undefined ? {} : { params: message.params })
        })) {
          throw new McpError(ERROR_INVALID_PARAMS, "Invalid client input request");
        }
        const result = await handler(message.params, {
          id: message.id,
          method: message.method,
          signal: activeRequest.controller.signal,
        });

        if (this.disposedError !== undefined || activeRequest.controller.signal.aborted) {
          return;
        }

        if (responseType !== undefined && !validateProtocolValue(responseType, result)) {
          throw new McpError(ERROR_INTERNAL, "Invalid client input response");
        }
        this.output.write(
          serializeJsonRpcMessage({
            jsonrpc: "2.0",
            id: message.id,
            result,
          })
        );
      } catch (error) {
        if (this.disposedError !== undefined || activeRequest.controller.signal.aborted) {
          return;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        this.output.write(
          serializeJsonRpcMessage({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: error instanceof McpError ? error.code : ERROR_INTERNAL,
              message: errorMessage,
            },
          })
        );
      } finally {
        const inFlightRequest = this.activeIncomingRequests.get(message.id);
        if (inFlightRequest === activeRequest) {
          this.activeIncomingRequests.delete(message.id);
        }
      }
    })();
  }

  private handleCancellationNotification(params: unknown): void {
    if (!isObjectRecord(params)) {
      return;
    }

    const requestId = params.requestId;
    if (!isRequestId(requestId)) {
      return;
    }

    const activeRequest = this.activeIncomingRequests.get(requestId);
    if (activeRequest === undefined) {
      return;
    }

    activeRequest.controller.abort(new Error(typeof params.reason === "string" ? params.reason : "Server request cancelled"));
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInitializeResult(value: unknown): value is InitializeResult {
  if (!isObjectRecord(value) || typeof value.protocolVersion !== "string") {
    return false;
  }

  if (!isServerCapabilities(value.capabilities)) {
    return false;
  }

  if (
    !isObjectRecord(value.serverInfo)
    || typeof value.serverInfo.name !== "string"
    || value.serverInfo.name.length === 0
    || typeof value.serverInfo.version !== "string"
    || value.serverInfo.version.length === 0
  ) {
    return false;
  }

  return value.instructions === undefined || typeof value.instructions === "string";
}

function isServerCapabilities(value: unknown): value is ServerCapabilities {
  if (!isObjectRecord(value)) {
    return false;
  }

  for (const capability of ["prompts", "resources", "tools", "logging", "completions", "experimental"] as const) {
    if (value[capability] !== undefined && !isObjectRecord(value[capability])) {
      return false;
    }
  }

  return true;
}

function isCallToolResult(value: unknown, modern = false): value is CallToolResult {
  if (!isObjectRecord(value) || !Array.isArray(value.content)) {
    return false;
  }

  if (!modern && value.structuredContent !== undefined && !isObjectRecord(value.structuredContent)) {
    return false;
  }

  if (value.isError !== undefined && typeof value.isError !== "boolean") {
    return false;
  }

  return value.content.every(isContentItem);
}

function isToolsListResult(value: unknown): value is { tools: Tool[]; nextCursor?: string } {
  return (
    isObjectRecord(value) &&
    Array.isArray(value.tools) &&
    value.tools.every(
      (tool) =>
        isObjectRecord(tool) &&
        typeof tool.name === "string" &&
        isObjectRecord(tool.inputSchema) &&
        tool.inputSchema.type === "object"
    ) &&
    (value.nextCursor === undefined || typeof value.nextCursor === "string")
  );
}

function isResourcesListResult(value: unknown): value is { resources: Resource[]; nextCursor?: string } {
  return isObjectRecord(value)
    && Array.isArray(value.resources)
    && value.resources.every(isResource)
    && (value.nextCursor === undefined || typeof value.nextCursor === "string");
}

function isResourceTemplatesListResult(
  value: unknown
): value is { resourceTemplates: ResourceTemplate[]; nextCursor?: string } {
  return isObjectRecord(value)
    && Array.isArray(value.resourceTemplates)
    && value.resourceTemplates.every(isResourceTemplate)
    && (value.nextCursor === undefined || typeof value.nextCursor === "string");
}

function isReadResourceResult(value: unknown): value is { contents: ResourceContents[] } {
  return isObjectRecord(value)
    && Array.isArray(value.contents)
    && value.contents.every(isResourceContents);
}

function isGetPromptResult(value: unknown): value is GetPromptResult {
  return isObjectRecord(value)
    && (value.description === undefined || typeof value.description === "string")
    && Array.isArray(value.messages)
    && value.messages.every(isPromptMessage);
}

function isCompleteResult(value: unknown): value is CompleteResult {
  return isObjectRecord(value)
    && isObjectRecord(value.completion)
    && Array.isArray(value.completion.values)
    && value.completion.values.every((candidate) => typeof candidate === "string")
    && (value.completion.hasMore === undefined || typeof value.completion.hasMore === "boolean")
    && (value.completion.total === undefined || typeof value.completion.total === "number");
}

function isResource(value: unknown): value is Resource {
  return isObjectRecord(value)
    && typeof value.uri === "string"
    && isValidUri(value.uri)
    && typeof value.name === "string"
    && (value.description === undefined || typeof value.description === "string")
    && (value.mimeType === undefined || typeof value.mimeType === "string")
    && (value.size === undefined || typeof value.size === "number");
}

function isResourceTemplate(value: unknown): value is ResourceTemplate {
  return isObjectRecord(value)
    && typeof value.uriTemplate === "string"
    && typeof value.name === "string"
    && (value.description === undefined || typeof value.description === "string")
    && (value.mimeType === undefined || typeof value.mimeType === "string");
}

function isResourceContents(value: unknown): value is ResourceContents {
  if (!isObjectRecord(value) || typeof value.uri !== "string" || !isValidUri(value.uri)) {
    return false;
  }

  if (value.mimeType !== undefined && typeof value.mimeType !== "string") {
    return false;
  }

  const hasText = value.text !== undefined;
  const hasBlob = value.blob !== undefined;

  if (!hasText && !hasBlob) {
    return false;
  }

  return (!hasText || typeof value.text === "string")
    && (!hasBlob || (typeof value.blob === "string" && isBase64(value.blob)));
}

function isPromptMessage(value: unknown): value is PromptMessage {
  return isObjectRecord(value)
    && (value.role === "user" || value.role === "assistant")
    && isContentItem(value.content);
}

function isContentItem(value: unknown): value is ContentItem {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (value.type === "text") {
    return typeof value.text === "string";
  }

  if (value.type === "image" || value.type === "audio") {
    return typeof value.data === "string" && isBase64(value.data) && typeof value.mimeType === "string";
  }

  if (value.type === "resource_link") return isResource(value);

  if (value.type !== "resource" || !isObjectRecord(value.resource)) {
    return false;
  }

  return isResourceContents(value.resource);
}

function hasOwn(
  value: Record<string, unknown>,
  property: string
): property is keyof typeof value {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === "string" || typeof value === "number";
}

function isLogLevel(value: unknown): value is LogLevel {
  return (
    value === "debug" ||
    value === "info" ||
    value === "notice" ||
    value === "warning" ||
    value === "error" ||
    value === "critical" ||
    value === "alert" ||
    value === "emergency"
  );
}

function toRequestId(value: unknown): RequestId | null {
  return isRequestId(value) ? value : null;
}

function parseError(): McpError {
  return new McpError(ERROR_PARSE, "Parse error");
}

function invalidRequest(): McpError {
  return new McpError(ERROR_INVALID_REQUEST, "Invalid Request");
}

function isJsonRpcErrorObject(value: unknown): value is JsonRpcErrorObject {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (!Number.isInteger(value.code) || typeof value.message !== "string") {
    return false;
  }

  return value.data === undefined || hasOwn(value, "data");
}

export function parseJsonRpcMessage(line: string): ParsedJsonRpcMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return {
      type: "invalid",
      id: null,
      error: parseError(),
    };
  }

  return parseJsonRpcPayload(parsed);
}

function parseJsonRpcPayload(parsed: unknown): ParsedJsonRpcMessage {
  if (!isObjectRecord(parsed)) {
    return {
      type: "invalid",
      id: null,
      error: invalidRequest(),
    };
  }

  const id = toRequestId(parsed.id);

  if (parsed.jsonrpc !== "2.0") {
    return {
      type: "invalid",
      id,
      error: invalidRequest(),
    };
  }

  const hasMethod = hasOwn(parsed, "method");
  const hasId = hasOwn(parsed, "id");

  if (hasMethod) {
    if (typeof parsed.method !== "string") {
      return {
        type: "invalid",
        id,
        error: invalidRequest(),
      };
    }

    if (hasId) {
      if (!isRequestId(parsed.id)) {
        return {
          type: "invalid",
          id: null,
          error: invalidRequest(),
        };
      }

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: parsed.id,
        method: parsed.method,
      };

      if (hasOwn(parsed, "params")) {
        request.params = parsed.params;
      }

      return {
        type: "request",
        message: request,
      };
    }

    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method: parsed.method,
    };

    if (hasOwn(parsed, "params")) {
      notification.params = parsed.params;
    }

    return {
      type: "notification",
      message: notification,
    };
  }

  if (!hasId || !isRequestId(parsed.id)) {
    return {
      type: "invalid",
      id,
      error: invalidRequest(),
    };
  }

  const hasResult = hasOwn(parsed, "result");
  const hasError = hasOwn(parsed, "error");

  if (hasResult === hasError) {
    return {
      type: "invalid",
      id: parsed.id,
      error: invalidRequest(),
    };
  }

  if (hasResult) {
    return {
      type: "response",
      message: {
        jsonrpc: "2.0",
        id: parsed.id,
        result: parsed.result,
      },
    };
  }

  if (!isJsonRpcErrorObject(parsed.error)) {
    return {
      type: "invalid",
      id: parsed.id,
      error: invalidRequest(),
    };
  }

  return {
    type: "response",
    message: {
      jsonrpc: "2.0",
      id: parsed.id,
      error: parsed.error,
    },
  };
}
