import {
  spawn as spawnChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import {
  JsonRpcMessageLayer,
  type JsonRpcNotificationHandler,
  type JsonRpcRequestHandler,
  type JsonRpcRequestOptions,
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
  WriteTextFileResponse,
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
  "terminal/kill": AcpRequestShape<
    KillTerminalCommandRequest,
    KillTerminalCommandResponse
  >;
  "terminal/release": AcpRequestShape<ReleaseTerminalRequest, ReleaseTerminalResponse>;
}

export interface AcpClientNotificationMap {
  "session/update": SessionNotification;
}

type ExtensionMethod = `_${string}`;

function assertExtensionMethod(method: string): asserts method is ExtensionMethod {
  if (!method.startsWith("_")) {
    throw new Error('Extension method must start with "_"');
  }
}

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
  requestTimeoutMs?: number;
  firstRequestId?: number;
  spawn?: SpawnFunction;
}

export interface AcpTransportClosedEvent {
  code: number | null;
  signal: NodeJS.Signals | null;
  reason: Error;
  stderr: string;
}

export class AcpTransport {
  readonly closed: Promise<AcpTransportClosedEvent>;

  private readonly command: string;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly layer: JsonRpcMessageLayer;
  private readonly stderrChunks: string[] = [];
  private resolveClosed: ((value: AcpTransportClosedEvent) => void) | null = null;
  private closeEvent: AcpTransportClosedEvent | null = null;
  private closeReason: Error | null = null;

  constructor(options: AcpTransportOptions) {
    const {
      command,
      args = [],
      cwd,
      env,
      requestTimeoutMs,
      firstRequestId,
      spawn = spawnChildProcess,
    } = options;

    this.command = command;
    this.closed = new Promise<AcpTransportClosedEvent>((resolve) => {
      this.resolveClosed = resolve;
    });

    this.child = spawn(command, [...args], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderrChunks.push(String(chunk));
    });

    this.layer = new JsonRpcMessageLayer({
      input: this.child.stdout,
      output: this.child.stdin,
      requestTimeoutMs,
      firstRequestId,
    });

    this.child.once("error", (error) => {
      const reason = error instanceof Error ? error : new Error(String(error));
      this.close(reason, this.child.exitCode ?? null, this.child.signalCode ?? null);
    });

    this.child.once("close", (code, signal) => {
      const reason =
        this.closeReason ??
        new Error(
          `ACP transport closed (command "${this.command}", code: ${code ?? "null"}${
            signal ? `, signal: ${signal}` : ""
          })`
        );
      this.close(reason, code ?? null, signal ?? null);
    });
  }

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
  sendRequest(
    method: string,
    params?: unknown,
    options: JsonRpcRequestOptions = {}
  ): Promise<unknown> {
    return this.layer.sendRequest(method, params, options);
  }

  sendExtRequest<TResult = unknown>(
    method: ExtensionMethod,
    params?: unknown,
    options?: JsonRpcRequestOptions
  ): Promise<TResult>;
  sendExtRequest<TResult = unknown>(
    method: string,
    params?: unknown,
    options: JsonRpcRequestOptions = {}
  ): Promise<TResult> {
    assertExtensionMethod(method);
    return this.layer.sendRequest(method, params, options) as Promise<TResult>;
  }

  sendNotification<TMethod extends keyof AcpAgentNotificationMap>(
    method: TMethod,
    params: AcpAgentNotificationMap[TMethod]
  ): void;
  sendNotification(method: string, params?: unknown): void;
  sendNotification(method: string, params?: unknown): void {
    this.layer.sendNotification(method, params);
  }

  sendExtNotification(method: ExtensionMethod, params?: unknown): void;
  sendExtNotification(method: string, params?: unknown): void;
  sendExtNotification(method: string, params?: unknown): void {
    assertExtensionMethod(method);
    this.layer.sendNotification(method, params);
  }

  onRequest<TMethod extends keyof AcpClientRequestMap>(
    method: TMethod,
    handler: (
      params: AcpClientRequestMap[TMethod]["params"],
      context: { id: RequestId; method: TMethod }
    ) =>
      | AcpClientRequestMap[TMethod]["result"]
      | Promise<AcpClientRequestMap[TMethod]["result"]>
  ): void;
  onRequest(method: string, handler: JsonRpcRequestHandler): void;
  onRequest(method: string, handler: JsonRpcRequestHandler): void {
    this.layer.onRequest(method, handler);
  }

  onExtRequest<TMethod extends ExtensionMethod>(
    method: TMethod,
    handler: (
      params: unknown,
      context: { id: RequestId; method: TMethod }
    ) => unknown | Promise<unknown>
  ): void;
  onExtRequest(method: string, handler: JsonRpcRequestHandler): void;
  onExtRequest(method: string, handler: JsonRpcRequestHandler): void {
    assertExtensionMethod(method);
    this.layer.onRequest(method, handler);
  }

  onNotification<TMethod extends keyof AcpClientNotificationMap>(
    method: TMethod,
    handler: (
      params: AcpClientNotificationMap[TMethod],
      context: { method: TMethod }
    ) => void | Promise<void>
  ): void;
  onNotification(method: string, handler: JsonRpcNotificationHandler): void;
  onNotification(method: string, handler: JsonRpcNotificationHandler): void {
    this.layer.onNotification(method, handler);
  }

  onExtNotification<TMethod extends ExtensionMethod>(
    method: TMethod,
    handler: (params: unknown, context: { method: TMethod }) => void | Promise<void>
  ): void;
  onExtNotification(method: string, handler: JsonRpcNotificationHandler): void;
  onExtNotification(method: string, handler: JsonRpcNotificationHandler): void {
    assertExtensionMethod(method);
    this.layer.onNotification(method, handler);
  }

  getStderrOutput(): string {
    return this.stderrChunks.join("");
  }

  pendingRequestCount(): number {
    return this.layer.pendingRequestCount();
  }

  dispose(reason: Error = new Error("ACP transport disposed")): void {
    if (this.closeEvent !== null) {
      return;
    }

    this.closeReason = reason;
    this.layer.dispose(reason);

    if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded) {
      this.child.stdin.end();
    }

    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      this.close(reason, this.child.exitCode, this.child.signalCode);
      return;
    }

    const killed = this.child.kill();
    if (!killed) {
      this.close(reason, this.child.exitCode, this.child.signalCode);
    }
  }

  private close(reason: Error, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.closeEvent !== null) {
      return;
    }

    this.layer.dispose(reason);
    this.closeEvent = {
      code,
      signal,
      reason,
      stderr: this.getStderrOutput(),
    };
    this.resolveClosed?.(this.closeEvent);
    this.resolveClosed = null;
  }
}
