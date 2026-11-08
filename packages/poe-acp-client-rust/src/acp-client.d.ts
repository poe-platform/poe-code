import {
  AcpTransport,
  type AcpTransportClosedEvent,
  type AcpTransportOptions
} from "./acp-transport.js";
import type { JsonRpcRequestOptions } from "./jsonrpc-message-layer.js";
import {
  type AgentCapabilities,
  type AuthenticateResponse,
  type AuthMethod,
  type ClientCapabilities,
  type ContentBlock,
  type EnvVariable,
  type Implementation,
  type InitializeResponse,
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
  type ProtocolVersion,
  type SessionModeId,
  type SessionId,
  type SetSessionModeResponse,
  type SessionUpdateNotification,
  type ToolCallUpdate,
  type TerminalOutputResponse,
  type WaitForTerminalExitResponse
} from "./types.js";
export type AcpClientState = "uninitialized" | "initialized" | "ready";
type ExtensionMethod = `_${string}`;
export interface PromptTurn extends AsyncIterable<SessionUpdateNotification> {
  response: Promise<PromptResponse>;
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
  release: (args: { sessionId: SessionId; terminalId: string }) => void | Promise<void>;
}
type AcpClientPermissionHandler = (args: {
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
}) => RequestPermissionOutcome | Promise<RequestPermissionOutcome>;
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
export declare class AcpClient {
  constructor(options: AcpClientOptions);
  get state(): AcpClientState;
  get negotiatedProtocolVersion(): ProtocolVersion | null;
  get authMethods(): AuthMethod[];
  get agentCapabilities(): AgentCapabilities | undefined;
  get agentInfo(): Implementation | null | undefined;
  get closed(): Promise<AcpTransportClosedEvent> | undefined;
  initialize(clientCapabilities?: ClientCapabilities): Promise<InitializeResponse>;
  authenticate(methodId: string): Promise<AuthenticateResponse>;
  newSession(cwd: string, mcpServers: McpServer[]): Promise<NewSessionResponse>;
  loadSession(
    sessionId: SessionId,
    cwd: string,
    mcpServers: McpServer[]
  ): Promise<LoadSessionResponse>;
  cancelSession(sessionId: SessionId): Promise<void>;
  setMode(sessionId: SessionId, modeId: SessionModeId): Promise<SetSessionModeResponse>;
  setConfigOption(
    sessionId: SessionId,
    configId: SessionConfigId,
    value: SessionConfigValueId
  ): Promise<SessionConfigOption[]>;
  prompt(sessionId: SessionId, content: ContentBlock[]): PromptTurn;
  sendExtRequest<TResult = unknown>(
    method: ExtensionMethod,
    params?: unknown,
    options?: JsonRpcRequestOptions
  ): Promise<TResult>;
  sendExtNotification(method: ExtensionMethod, params?: unknown): Promise<void>;
  onExtRequest<TMethod extends ExtensionMethod>(
    method: TMethod,
    handler: (
      params: unknown,
      context: {
        id: RequestId;
        method: TMethod;
      }
    ) => unknown | Promise<unknown>
  ): void;
  onExtNotification<TMethod extends ExtensionMethod>(
    method: TMethod,
    handler: (
      params: unknown,
      context: {
        method: TMethod;
      }
    ) => void | Promise<void>
  ): void;
  dispose(): Promise<void>;
  assertReady(operation: string): void;
}
export {};
