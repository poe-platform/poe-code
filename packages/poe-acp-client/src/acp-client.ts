import { isAbsolute } from "node:path";
import {
  AcpTransport,
  type AcpTransportClosedEvent,
  type AcpTransportOptions,
} from "./acp-transport.js";
import type { JsonRpcRequestOptions } from "./jsonrpc-message-layer.js";
import { isSessionNotification } from "./jsonrpc.js";
import {
  ACP_ERROR_CODE_INVALID_PARAMS,
  ACP_ERROR_CODE_RESOURCE_NOT_FOUND,
  AcpError,
  type AgentCapabilities,
  type AuthenticateResponse,
  type AuthMethod,
  type CancelNotification,
  type ClientCapabilities,
  type ContentBlock,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type EnvVariable,
  type Implementation,
  type InitializeResponse,
  type KillTerminalCommandRequest,
  type KillTerminalCommandResponse,
  type LoadSessionResponse,
  type McpServer,
  type NewSessionResponse,
  type PermissionOption,
  type PromptResponse,
  type RequestId,
  type SessionConfigId,
  type SessionConfigOption,
  type SessionConfigValueId,
  type RequestPermissionOutcome,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type ProtocolVersion,
  type SessionModeId,
  type SessionNotification,
  type SessionId,
  type SetSessionModeResponse,
  type SessionUpdateNotification,
  type ToolCallUpdate,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
  type ReleaseTerminalRequest,
  type ReleaseTerminalResponse,
} from "./types.js";

export type AcpClientState = "uninitialized" | "initialized" | "ready";
type ExtensionMethod = `_${string}`;

export interface PromptTurn extends AsyncIterable<SessionUpdateNotification> {
  response: Promise<PromptResponse>;
}

interface AsyncQueue<T> extends AsyncIterable<T>, AsyncIterator<T> {
  push(value: T): void;
  complete(): void;
  fail(error: Error): void;
}

export interface AcpClientFsHandler {
  readTextFile?: (args: {
    sessionId: SessionId;
    path: string;
    line?: number | null;
    limit?: number | null;
  }) => string | Promise<string>;
  writeTextFile?: (args: {
    sessionId: SessionId;
    path: string;
    content: string;
  }) => void | Promise<void>;
}

export interface AcpClientTerminalHandler {
  create: (args: {
    sessionId: SessionId;
    command: string;
    args?: string[];
    cwd?: string | null;
    env?: EnvVariable[];
    outputByteLimit?: number | null;
  }) => string | Promise<string>;
  output: (args: {
    sessionId: SessionId;
    terminalId: string;
  }) => TerminalOutputResponse | Promise<TerminalOutputResponse>;
  waitForExit: (args: {
    sessionId: SessionId;
    terminalId: string;
  }) => WaitForTerminalExitResponse | Promise<WaitForTerminalExitResponse>;
  kill: (args: { sessionId: SessionId; terminalId: string }) => void | Promise<void>;
  release: (args: {
    sessionId: SessionId;
    terminalId: string;
  }) => void | Promise<void>;
}

type AcpClientPermissionHandler = (args: {
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
}) => RequestPermissionOutcome | Promise<RequestPermissionOutcome>;

const validStopReasons = new Set<PromptResponse["stopReason"]>([
  "completed",
  "cancelled",
  "max_tokens",
  "end_turn",
]);

export interface AcpClientHandlers {
  permission?: AcpClientPermissionHandler;
  fs?: AcpClientFsHandler;
  terminal?: AcpClientTerminalHandler;
}

type AcpClientTransport = Pick<
  AcpTransport,
  "sendRequest" | "sendNotification" | "onRequest" | "onNotification"
> &
  Partial<Pick<AcpTransport, "dispose" | "closed">>;

interface AcpClientSharedOptions {
  protocolVersion?: ProtocolVersion;
  clientCapabilities?: ClientCapabilities;
  clientInfo?: Implementation | null;
  handlers?: AcpClientHandlers;
  permissionHandler?: AcpClientPermissionHandler;
  fsHandler?: AcpClientFsHandler;
  terminalHandler?: AcpClientTerminalHandler;
  skipAuth?: boolean;
  /**
   * Automatically approve all permission requests (selects the first
   * "allow_always" or "allow_once" option). Ignored when a custom
   * `permissionHandler` is provided.
   */
  autoApprove?: boolean;
}

export interface AcpClientProcessOptions extends AcpClientSharedOptions {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  firstRequestId?: number;
  spawn?: AcpTransportOptions["spawn"];
}

export interface AcpClientInjectedTransportOptions extends AcpClientSharedOptions {
  transport: AcpClientTransport;
}

export type AcpClientOptions = AcpClientProcessOptions | AcpClientInjectedTransportOptions;

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

function invalidParams(message: string): AcpError {
  return new AcpError(
    ACP_ERROR_CODE_INVALID_PARAMS,
    `Invalid params: ${message}`
  );
}

function resourceNotFound(resource: string): AcpError {
  return new AcpError(
    ACP_ERROR_CODE_RESOURCE_NOT_FOUND,
    `Resource not found: ${resource}`
  );
}

function assertAbsolutePath(path: string): void {
  if (!isAbsolute(path)) {
    throw invalidParams('"path" must be an absolute path');
  }
}

function assertOneBasedLineNumber(line: number | null | undefined): void {
  if (line === null || line === undefined) {
    return;
  }

  if (!Number.isInteger(line) || line < 1) {
    throw invalidParams('"line" must be a 1-based integer');
  }
}

function assertNonNegativeInteger(value: number | null | undefined, fieldName: string): void {
  if (value === null || value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw invalidParams(`"${fieldName}" must be a non-negative integer`);
  }
}

function assertNonNegativeIntegerValue(value: unknown, fieldName: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }
}

function invalidResponse(method: string, message: string): Error {
  return new Error(`Invalid response from "${method}": ${message}`);
}

function assertInitializeResponseAuthMethods(
  value: unknown
): asserts value is AuthMethod[] | undefined {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    throw new Error("Agent returned invalid authMethods.");
  }

  for (const authMethod of value) {
    if (
      typeof authMethod !== "object" ||
      authMethod === null ||
      typeof (authMethod as Partial<AuthMethod>).id !== "string" ||
      typeof (authMethod as Partial<AuthMethod>).name !== "string"
    ) {
      throw new Error("Agent returned invalid authMethods.");
    }
  }
}

function assertPromptResponse(value: PromptResponse): void {
  if (!validStopReasons.has(value.stopReason)) {
    throw invalidResponse(
      "session/prompt",
      '"stopReason" must be "completed", "cancelled", "max_tokens", or "end_turn".'
    );
  }
}

function assertExtensionMethod(method: string): asserts method is ExtensionMethod {
  if (!method.startsWith("_")) {
    throw new Error('Extension method must start with "_"');
  }
}

function isInjectedTransportOptions(
  options: AcpClientOptions
): options is AcpClientInjectedTransportOptions {
  return Object.prototype.hasOwnProperty.call(options, "transport");
}

function createAsyncQueue<T>(): AsyncQueue<T> {
  const values: T[] = [];
  const waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: Error) => void;
  }> = [];
  let closed = false;
  let failure: Error | null = null;

  const resolveOne = (value: T): boolean => {
    const waiter = waiters.shift();
    if (!waiter) {
      return false;
    }

    waiter.resolve({ done: false, value });
    return true;
  };

  const iterator: AsyncQueue<T> = {
    push(value: T): void {
      if (closed || failure) {
        return;
      }

      if (!resolveOne(value)) {
        values.push(value);
      }
    },
    complete(): void {
      if (closed || failure) {
        return;
      }

      closed = true;
      while (waiters.length > 0) {
        waiters.shift()?.resolve({ done: true, value: undefined });
      }
    },
    fail(error: Error): void {
      if (closed || failure) {
        return;
      }

      failure = error;
      while (waiters.length > 0) {
        waiters.shift()?.reject(error);
      }
    },
    async next(): Promise<IteratorResult<T>> {
      if (values.length > 0) {
        const value = values.shift() as T;
        return { done: false, value };
      }

      if (failure) {
        throw failure;
      }

      if (closed) {
        return { done: true, value: undefined };
      }

      return new Promise<IteratorResult<T>>((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
    async return(): Promise<IteratorResult<T>> {
      iterator.complete();
      return { done: true, value: undefined };
    },
    async throw(error: unknown): Promise<IteratorResult<T>> {
      const normalizedError = toError(error);
      iterator.fail(normalizedError);
      throw normalizedError;
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return iterator;
    },
  };

  return iterator;
}

export class AcpClient {
  private readonly transport: AcpClientTransport;
  private readonly clientProtocolVersion: ProtocolVersion;
  private clientCapabilities?: ClientCapabilities;
  private readonly clientInfo?: Implementation | null;
  private readonly skipAuth: boolean;
  private readonly permissionHandler?: AcpClientPermissionHandler;
  private readonly fsHandler?: AcpClientFsHandler;
  private readonly terminalHandler?: AcpClientTerminalHandler;
  private readonly activePromptUpdates = new Map<
    SessionId,
    AsyncQueue<SessionUpdateNotification>
  >();
  private readonly trackedTerminalIds = new Map<SessionId, Set<string>>();
  private hasRegisteredFsReadHandler = false;
  private hasRegisteredFsWriteHandler = false;
  private hasRegisteredTerminalHandlers = false;
  private disposed = false;
  private transportDisposed = false;
  private initializing = false;
  private authenticating = false;

  private lifecycleState: AcpClientState = "uninitialized";
  private negotiatedVersion: ProtocolVersion | null = null;
  private availableAuthMethods: AuthMethod[] = [];
  private negotiatedAgentCapabilities: AgentCapabilities | undefined;
  private negotiatedAgentInfo: Implementation | null | undefined;

  constructor(options: AcpClientOptions) {
    this.transport = isInjectedTransportOptions(options)
      ? options.transport
      : new AcpTransport({
          command: options.command,
          args: options.args,
          cwd: options.cwd,
          env: options.env,
          firstRequestId: options.firstRequestId,
          spawn: options.spawn,
        });
    this.clientProtocolVersion = options.protocolVersion ?? 1;
    this.clientCapabilities = options.clientCapabilities;
    this.clientInfo = options.clientInfo;
    this.skipAuth = options.skipAuth ?? false;
    this.permissionHandler = options.handlers?.permission ?? options.permissionHandler;
    this.fsHandler = options.handlers?.fs ?? options.fsHandler;
    this.terminalHandler = options.handlers?.terminal ?? options.terminalHandler;

    const autoApprove = options.autoApprove === true && !this.permissionHandler;

    this.transport.onRequest(
      "session/request_permission",
      async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        if (this.permissionHandler) {
          const outcome = await this.permissionHandler({
            toolCall: params.toolCall,
            options: params.options,
          });
          return { outcome };
        }

        if (autoApprove) {
          if (!Array.isArray(params.options)) {
            throw invalidParams('"options" must be an array');
          }

          const allow =
            params.options.find((o: PermissionOption) => o.kind === "allow_always") ??
            params.options.find((o: PermissionOption) => o.kind === "allow_once");
          if (allow) {
            return { outcome: { outcome: "selected", optionId: allow.optionId } };
          }
        }

        return { outcome: { outcome: "cancelled" } };
      }
    );

    this.registerCapabilityHandlers(this.clientCapabilities);

    this.transport.onNotification("session/update", (params: SessionNotification) => {
      this.handleSessionUpdateNotification(params);
    });
  }

  get state(): AcpClientState {
    return this.lifecycleState;
  }

  get negotiatedProtocolVersion(): ProtocolVersion | null {
    return this.negotiatedVersion;
  }

  get authMethods(): AuthMethod[] {
    return [...this.availableAuthMethods];
  }

  get agentCapabilities(): AgentCapabilities | undefined {
    return this.negotiatedAgentCapabilities === undefined
      ? undefined
      : structuredClone(this.negotiatedAgentCapabilities);
  }

  get agentInfo(): Implementation | null | undefined {
    return this.negotiatedAgentInfo;
  }

  get closed(): Promise<AcpTransportClosedEvent> | undefined {
    return this.transport.closed;
  }

  async initialize(clientCapabilities?: ClientCapabilities): Promise<InitializeResponse> {
    this.assertNotDisposed();
    if (this.lifecycleState !== "uninitialized" || this.initializing) {
      throw new Error("initialize() can only be called once.");
    }

    assertNonNegativeIntegerValue(this.clientProtocolVersion, "Client protocol version");

    this.initializing = true;

    try {
      if (clientCapabilities !== undefined) {
        this.clientCapabilities = clientCapabilities;
      }

      const response = await this.transport.sendRequest("initialize", {
        protocolVersion: this.clientProtocolVersion,
        clientInfo: this.clientInfo,
        clientCapabilities: this.clientCapabilities,
      });

      if (
        typeof response.protocolVersion !== "number" ||
        !Number.isFinite(response.protocolVersion) ||
        !Number.isInteger(response.protocolVersion) ||
        response.protocolVersion < 0
      ) {
        throw new Error("Agent returned an invalid protocol version.");
      }
      assertInitializeResponseAuthMethods(response.authMethods);

      const negotiatedProtocolVersion = Math.min(
        this.clientProtocolVersion,
        response.protocolVersion
      );

      this.negotiatedVersion = negotiatedProtocolVersion;
      this.negotiatedAgentCapabilities = response.agentCapabilities
        ? structuredClone(response.agentCapabilities)
        : undefined;
      this.negotiatedAgentInfo = response.agentInfo;
      this.availableAuthMethods = response.authMethods ? [...response.authMethods] : [];

      const requiresAuth = this.availableAuthMethods.length > 0 && !this.skipAuth;
      this.lifecycleState = requiresAuth ? "initialized" : "ready";
      if (clientCapabilities !== undefined) {
        this.registerCapabilityHandlers(clientCapabilities);
      }

      return {
        protocolVersion: negotiatedProtocolVersion,
        ...(this.negotiatedAgentCapabilities !== undefined
          ? { agentCapabilities: structuredClone(this.negotiatedAgentCapabilities) }
          : {}),
        ...(this.negotiatedAgentInfo !== undefined ? { agentInfo: this.negotiatedAgentInfo } : {}),
        ...(this.availableAuthMethods.length > 0 ? { authMethods: this.authMethods } : {}),
      };
    } finally {
      this.initializing = false;
    }
  }

  async authenticate(methodId: string): Promise<AuthenticateResponse> {
    this.assertNotDisposed();
    if (this.lifecycleState === "uninitialized") {
      throw new Error("Cannot authenticate before initialize().");
    }

    if (this.lifecycleState === "ready") {
      throw new Error("Authentication is not required for this agent.");
    }

    if (!this.availableAuthMethods.some((authMethod) => authMethod.id === methodId)) {
      throw new Error(`Unknown auth method "${methodId}".`);
    }

    if (this.authenticating) {
      throw new Error("Authentication is already in progress.");
    }

    this.authenticating = true;
    try {
      const response = await this.transport.sendRequest("authenticate", {
        methodId,
      });

      this.lifecycleState = "ready";
      return response;
    } finally {
      this.authenticating = false;
    }
  }

  async newSession(cwd: string, mcpServers: McpServer[]): Promise<NewSessionResponse> {
    this.assertReady("session/new");
    this.assertMcpServerCapabilitySupport(mcpServers);

    const response = await this.transport.sendRequest("session/new", {
      cwd,
      mcpServers,
    });

    if (typeof response.sessionId !== "string") {
      throw invalidResponse("session/new", '"sessionId" must be a string.');
    }

    return response;
  }

  async loadSession(
    sessionId: SessionId,
    cwd: string,
    mcpServers: McpServer[]
  ): Promise<LoadSessionResponse> {
    this.assertReady("session/load");
    if (this.negotiatedAgentCapabilities?.loadSession !== true) {
      throw new Error(
        'Cannot call "session/load" because the agent does not support session loading.'
      );
    }
    this.assertMcpServerCapabilitySupport(mcpServers);

    return this.transport.sendRequest("session/load", {
      sessionId,
      cwd,
      mcpServers,
    });
  }

  async cancelSession(sessionId: SessionId): Promise<void> {
    this.assertReady("session/cancel");
    const payload: CancelNotification = { sessionId };
    this.transport.sendNotification("session/cancel", payload);
  }

  async setMode(
    sessionId: SessionId,
    modeId: SessionModeId
  ): Promise<SetSessionModeResponse> {
    this.assertReady("session/set_mode");
    return this.transport.sendRequest("session/set_mode", {
      sessionId,
      modeId,
    });
  }

  async setConfigOption(
    sessionId: SessionId,
    configId: SessionConfigId,
    value: SessionConfigValueId
  ): Promise<SessionConfigOption[]> {
    this.assertReady("session/set_config_option");
    const response = await this.transport.sendRequest("session/set_config_option", {
      sessionId,
      configId,
      value,
    });

    if (!Array.isArray(response.configOptions)) {
      throw invalidResponse(
        "session/set_config_option",
        '"configOptions" must be an array.'
      );
    }

    return response.configOptions;
  }

  prompt(sessionId: SessionId, content: ContentBlock[]): PromptTurn {
    this.assertReady("session/prompt");
    this.assertPromptContentCapabilitySupport(content);

    if (this.activePromptUpdates.has(sessionId)) {
      throw new Error(
        `Cannot call "session/prompt" while another prompt is in progress for session "${sessionId}".`
      );
    }

    const updates = createAsyncQueue<SessionUpdateNotification>();
    this.activePromptUpdates.set(sessionId, updates);

    let requestPromise: Promise<PromptResponse>;
    try {
      requestPromise = this.transport.sendRequest("session/prompt", {
        sessionId,
        prompt: content,
      });
    } catch (error) {
      const normalizedError = toError(error);
      this.activePromptUpdates.delete(sessionId);
      updates.fail(normalizedError);
      throw normalizedError;
    }

    const response = requestPromise
      .then((promptResponse) => {
        assertPromptResponse(promptResponse);
        this.activePromptUpdates.delete(sessionId);
        updates.complete();
        return promptResponse;
      })
      .catch((error) => {
        const normalizedError = toError(error);
        this.activePromptUpdates.delete(sessionId);
        updates.fail(normalizedError);
        throw normalizedError;
      });

    return {
      response,
      [Symbol.asyncIterator](): AsyncIterator<SessionUpdateNotification> {
        return updates;
      },
    };
  }

  async sendExtRequest<TResult = unknown>(
    method: ExtensionMethod,
    params?: unknown,
    options?: JsonRpcRequestOptions
  ): Promise<TResult>;
  async sendExtRequest<TResult = unknown>(
    method: string,
    params?: unknown,
    options: JsonRpcRequestOptions = {}
  ): Promise<TResult> {
    this.assertNotDisposed();
    assertExtensionMethod(method);
    return this.transport.sendRequest(method, params, options) as Promise<TResult>;
  }

  async sendExtNotification(method: ExtensionMethod, params?: unknown): Promise<void>;
  async sendExtNotification(method: string, params?: unknown): Promise<void> {
    this.assertNotDisposed();
    assertExtensionMethod(method);
    this.transport.sendNotification(method, params);
  }

  onExtRequest<TMethod extends ExtensionMethod>(
    method: TMethod,
    handler: (
      params: unknown,
      context: { id: RequestId; method: TMethod }
    ) => unknown | Promise<unknown>
  ): void;
  onExtRequest(
    method: string,
    handler: (params: unknown, context: { id: RequestId; method: string }) => unknown
  ): void {
    this.assertNotDisposed();
    assertExtensionMethod(method);
    this.transport.onRequest(method, handler);
  }

  onExtNotification<TMethod extends ExtensionMethod>(
    method: TMethod,
    handler: (params: unknown, context: { method: TMethod }) => void | Promise<void>
  ): void;
  onExtNotification(
    method: string,
    handler: (params: unknown, context: { method: string }) => void | Promise<void>
  ): void {
    this.assertNotDisposed();
    assertExtensionMethod(method);
    this.transport.onNotification(method, handler);
  }

  async dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      const disposeReason = new Error("ACP client disposed");
      for (const updates of this.activePromptUpdates.values()) {
        updates.fail(disposeReason);
      }
      this.activePromptUpdates.clear();
    }

    if (!this.transportDisposed) {
      if (typeof this.transport.dispose === "function") {
        this.transport.dispose(new Error("ACP client disposed"));
      }
      this.transportDisposed = true;
    }

    if (this.transport.closed) {
      await this.transport.closed;
    }
  }

  assertReady(operation: string): void {
    this.assertNotDisposed();
    if (this.lifecycleState === "ready") {
      return;
    }

    if (this.lifecycleState === "uninitialized") {
      throw new Error(`Cannot call "${operation}" before initialize().`);
    }

    throw new Error(`Cannot call "${operation}" before authentication completes.`);
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("ACP client disposed.");
    }
  }

  private registerCapabilityHandlers(capabilities: ClientCapabilities | undefined): void {
    if (
      !this.hasRegisteredFsReadHandler &&
      capabilities?.fs?.readTextFile === true &&
      this.fsHandler?.readTextFile
    ) {
      const readTextFile = this.fsHandler.readTextFile;
      this.transport.onRequest(
        "fs/read_text_file",
        async (params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
          assertAbsolutePath(params.path);
          assertOneBasedLineNumber(params.line);
          assertNonNegativeInteger(params.limit, "limit");

          const content = await readTextFile({
            sessionId: params.sessionId,
            path: params.path,
            line: params.line,
            limit: params.limit,
          });
          return { content };
        }
      );
      this.hasRegisteredFsReadHandler = true;
    }

    if (
      !this.hasRegisteredFsWriteHandler &&
      capabilities?.fs?.writeTextFile === true &&
      this.fsHandler?.writeTextFile
    ) {
      const writeTextFile = this.fsHandler.writeTextFile;
      this.transport.onRequest(
        "fs/write_text_file",
        async (params: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
          assertAbsolutePath(params.path);
          if (typeof params.content !== "string") {
            throw invalidParams('"content" must be a string');
          }

          await writeTextFile({
            sessionId: params.sessionId,
            path: params.path,
            content: params.content,
          });

          return {};
        }
      );
      this.hasRegisteredFsWriteHandler = true;
    }

    if (
      !this.hasRegisteredTerminalHandlers &&
      capabilities?.terminal === true &&
      this.terminalHandler
    ) {
      const terminalHandler = this.terminalHandler;
      this.transport.onRequest(
        "terminal/create",
        async (params: CreateTerminalRequest): Promise<CreateTerminalResponse> => {
          assertNonNegativeInteger(params.outputByteLimit, "outputByteLimit");
          const terminalId = await terminalHandler.create({
            sessionId: params.sessionId,
            command: params.command,
            args: params.args,
            cwd: params.cwd,
            env: params.env,
            outputByteLimit: params.outputByteLimit,
          });
          if (typeof terminalId !== "string") {
            throw invalidResponse("terminal/create", '"terminalId" must be a string.');
          }
          this.trackTerminal(params.sessionId, terminalId);

          return { terminalId };
        }
      );

      this.transport.onRequest(
        "terminal/output",
        async (params: TerminalOutputRequest): Promise<TerminalOutputResponse> => {
          this.assertKnownTerminal(params.sessionId, params.terminalId);

          return terminalHandler.output({
            sessionId: params.sessionId,
            terminalId: params.terminalId,
          });
        }
      );

      this.transport.onRequest(
        "terminal/wait_for_exit",
        async (params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> => {
          this.assertKnownTerminal(params.sessionId, params.terminalId);

          return terminalHandler.waitForExit({
            sessionId: params.sessionId,
            terminalId: params.terminalId,
          });
        }
      );

      this.transport.onRequest(
        "terminal/kill",
        async (params: KillTerminalCommandRequest): Promise<KillTerminalCommandResponse> => {
          this.assertKnownTerminal(params.sessionId, params.terminalId);

          await terminalHandler.kill({
            sessionId: params.sessionId,
            terminalId: params.terminalId,
          });

          return {};
        }
      );

      this.transport.onRequest(
        "terminal/release",
        async (params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> => {
          this.assertKnownTerminal(params.sessionId, params.terminalId);

          await terminalHandler.release({
            sessionId: params.sessionId,
            terminalId: params.terminalId,
          });
          this.untrackTerminal(params.sessionId, params.terminalId);

          return {};
        }
      );
      this.hasRegisteredTerminalHandlers = true;
    }
  }

  private assertMcpServerCapabilitySupport(mcpServers: McpServer[]): void {
    const mcpCapabilities = this.negotiatedAgentCapabilities?.mcpCapabilities;

    for (const mcpServer of mcpServers) {
      if (!("type" in mcpServer)) {
        continue;
      }

      if (mcpServer.type === "http" && mcpCapabilities?.http !== true) {
        throw new Error('Agent does not support MCP server type "http".');
      }

      if (mcpServer.type === "sse" && mcpCapabilities?.sse !== true) {
        throw new Error('Agent does not support MCP server type "sse".');
      }
    }
  }

  private handleSessionUpdateNotification(notification: SessionNotification): void {
    if (!isSessionNotification(notification)) {
      return;
    }

    const activePrompt = this.activePromptUpdates.get(notification.sessionId);
    if (!activePrompt) {
      return;
    }

    activePrompt.push({
      jsonrpc: "2.0",
      method: "session/update",
      params: notification,
    });
  }

  private trackTerminal(sessionId: SessionId, terminalId: string): void {
    const sessionTerminals = this.trackedTerminalIds.get(sessionId);
    if (sessionTerminals) {
      if (sessionTerminals.has(terminalId)) {
        throw new Error(`Terminal identifier "${terminalId}" is already active.`);
      }
      sessionTerminals.add(terminalId);
      return;
    }

    this.trackedTerminalIds.set(sessionId, new Set([terminalId]));
  }

  private assertKnownTerminal(sessionId: SessionId, terminalId: string): void {
    const sessionTerminals = this.trackedTerminalIds.get(sessionId);
    if (sessionTerminals?.has(terminalId) === true) {
      return;
    }

    throw resourceNotFound(`terminal "${terminalId}"`);
  }

  private untrackTerminal(sessionId: SessionId, terminalId: string): void {
    const sessionTerminals = this.trackedTerminalIds.get(sessionId);
    if (!sessionTerminals) {
      return;
    }

    sessionTerminals.delete(terminalId);
    if (sessionTerminals.size === 0) {
      this.trackedTerminalIds.delete(sessionId);
    }
  }

  private assertPromptContentCapabilitySupport(content: ContentBlock[]): void {
    const promptCapabilities = this.negotiatedAgentCapabilities?.promptCapabilities;

    for (const block of content) {
      if (block.type === "image" && promptCapabilities?.image !== true) {
        throw new Error('Agent does not support prompt content type "image".');
      }

      if (block.type === "audio" && promptCapabilities?.audio !== true) {
        throw new Error('Agent does not support prompt content type "audio".');
      }

      if (block.type === "resource" && promptCapabilities?.embeddedContext !== true) {
        throw new Error('Agent does not support prompt content type "resource".');
      }
    }
  }
}
