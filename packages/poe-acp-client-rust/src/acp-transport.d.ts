import {
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio
} from "node:child_process";
import {
  type JsonRpcNotificationHandler,
  type JsonRpcRequestHandler,
  type JsonRpcRequestOptions
} from "./jsonrpc-message-layer.js";
import type {
  AuthenticateRequest,
  AuthenticateResponse,
  CancelNotification,
  CreateTerminalRequest,
  CreateTerminalResponse,
  InitializeRequest,
  InitializeResponse,
  KillTerminalCommandRequest,
  KillTerminalCommandResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestId,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse
} from "./types.js";
interface AcpRequestShape<TParams, TResult> {
  params: TParams;
  result: TResult;
}
export interface AcpAgentRequestMap {
  initialize: AcpRequestShape<InitializeRequest, InitializeResponse>;
  authenticate: AcpRequestShape<AuthenticateRequest, AuthenticateResponse>;
  "session/new": AcpRequestShape<NewSessionRequest, NewSessionResponse>;
  "session/load": AcpRequestShape<LoadSessionRequest, LoadSessionResponse>;
  "session/prompt": AcpRequestShape<PromptRequest, PromptResponse>;
  "session/set_mode": AcpRequestShape<SetSessionModeRequest, SetSessionModeResponse>;
  "session/set_config_option": AcpRequestShape<
    SetSessionConfigOptionRequest,
    SetSessionConfigOptionResponse
  >;
}
export interface AcpAgentNotificationMap {
  "session/cancel": CancelNotification;
}
export interface AcpClientRequestMap {
  "session/request_permission": AcpRequestShape<
    RequestPermissionRequest,
    RequestPermissionResponse
  >;
  "fs/read_text_file": AcpRequestShape<ReadTextFileRequest, ReadTextFileResponse>;
  "fs/write_text_file": AcpRequestShape<WriteTextFileRequest, WriteTextFileResponse>;
  "terminal/create": AcpRequestShape<CreateTerminalRequest, CreateTerminalResponse>;
  "terminal/output": AcpRequestShape<TerminalOutputRequest, TerminalOutputResponse>;
  "terminal/wait_for_exit": AcpRequestShape<
    WaitForTerminalExitRequest,
    WaitForTerminalExitResponse
  >;
  "terminal/kill": AcpRequestShape<KillTerminalCommandRequest, KillTerminalCommandResponse>;
  "terminal/release": AcpRequestShape<ReleaseTerminalRequest, ReleaseTerminalResponse>;
}
export interface AcpClientNotificationMap {
  "session/update": SessionNotification;
}
type ExtensionMethod = `_${string}`;
type SpawnFunction = (
  command: string,
  args?: ReadonlyArray<string>,
  options?: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;
export interface AcpTransportOptions {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  firstRequestId?: number;
  spawn?: SpawnFunction;
}
export interface AcpTransportClosedEvent {
  code: number | null;
  signal: NodeJS.Signals | null;
  reason: Error;
  stderr: string;
}
export declare class AcpTransport {
  readonly closed: Promise<AcpTransportClosedEvent>;
  constructor(options: AcpTransportOptions);
  sendRequest<TMethod extends keyof AcpAgentRequestMap>(
    method: TMethod,
    params: AcpAgentRequestMap[TMethod]["params"],
    options?: JsonRpcRequestOptions
  ): Promise<AcpAgentRequestMap[TMethod]["result"]>;
  sendRequest<TResult = unknown>(
    method: string,
    params?: unknown,
    options?: JsonRpcRequestOptions
  ): Promise<TResult>;
  sendExtRequest<TResult = unknown>(
    method: ExtensionMethod,
    params?: unknown,
    options?: JsonRpcRequestOptions
  ): Promise<TResult>;
  sendNotification<TMethod extends keyof AcpAgentNotificationMap>(
    method: TMethod,
    params: AcpAgentNotificationMap[TMethod]
  ): void;
  sendNotification(method: string, params?: unknown): void;
  sendExtNotification(method: ExtensionMethod, params?: unknown): void;
  sendExtNotification(method: string, params?: unknown): void;
  onRequest<TMethod extends keyof AcpClientRequestMap>(
    method: TMethod,
    handler: (
      params: AcpClientRequestMap[TMethod]["params"],
      context: {
        id: RequestId;
        method: TMethod;
      }
    ) => AcpClientRequestMap[TMethod]["result"] | Promise<AcpClientRequestMap[TMethod]["result"]>
  ): void;
  onRequest(method: string, handler: JsonRpcRequestHandler): void;
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
  onExtRequest(method: string, handler: JsonRpcRequestHandler): void;
  onNotification<TMethod extends keyof AcpClientNotificationMap>(
    method: TMethod,
    handler: (
      params: AcpClientNotificationMap[TMethod],
      context: {
        method: TMethod;
      }
    ) => void | Promise<void>
  ): void;
  onNotification(method: string, handler: JsonRpcNotificationHandler): void;
  onExtNotification<TMethod extends ExtensionMethod>(
    method: TMethod,
    handler: (
      params: unknown,
      context: {
        method: TMethod;
      }
    ) => void | Promise<void>
  ): void;
  onExtNotification(method: string, handler: JsonRpcNotificationHandler): void;
  getStderrOutput(): string;
  pendingRequestCount(): number;
  dispose(reason?: Error): void;
}
export {};
