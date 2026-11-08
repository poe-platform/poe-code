import type {
  AcpError,
  AcpErrorCode,
  AcpExtensible,
  AgentCapabilities,
  AgentMessageChunk,
  AgentThoughtChunk,
  AuthenticateRequest,
  AuthenticateResponse,
  AuthMethod,
  AvailableCommandsUpdate,
  CancelNotification,
  ClientCapabilities,
  ConfigOptionUpdate,
  CreateTerminalRequest,
  CreateTerminalResponse,
  CurrentModeUpdate,
  EnvVariable,
  ExtMethodRequest,
  ExtNotification,
  FileSystemCapability,
  HttpHeader,
  Implementation,
  InitializeRequest,
  InitializeResponse,
  KillTerminalCommandRequest,
  KillTerminalCommandResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  McpCapabilities,
  McpServer,
  McpServerHttp,
  McpServerSse,
  McpServerStdio,
  NewSessionRequest,
  NewSessionResponse,
  PermissionOption,
  PermissionOptionKind,
  Plan,
  PromptCapabilities,
  PromptRequest,
  PromptResponse,
  ProtocolVersion,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestId,
  RequestPermissionCancelledOutcome,
  RequestPermissionOutcome,
  RequestPermissionRequest,
  RequestPermissionResponse,
  RequestPermissionSelectedOutcome,
  SessionCapabilities,
  SessionMode,
  SessionModeState,
  SessionInfoUpdate,
  SessionUpdate,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
  StableSessionUpdate,
  StopReason,
  TerminalExitStatus,
  TerminalOutputRequest,
  TerminalOutputResponse,
  ToolCall,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolCallUpdate,
  ToolKind,
  UnstableSessionUpdate,
  UsageUpdate,
  UserMessageChunk,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "./types.js";
import type {
  AcpError as AcpErrorFromIndex,
  AcpErrorCode as AcpErrorCodeFromIndex,
  AgentCapabilities as AgentCapabilitiesFromIndex,
  AuthenticateRequest as AuthenticateRequestFromIndex,
  AuthenticateResponse as AuthenticateResponseFromIndex,
  AuthMethod as AuthMethodFromIndex,
  CancelNotification as CancelNotificationFromIndex,
  ClientCapabilities as ClientCapabilitiesFromIndex,
  CreateTerminalRequest as CreateTerminalRequestFromIndex,
  CreateTerminalResponse as CreateTerminalResponseFromIndex,
  EnvVariable as EnvVariableFromIndex,
  ExtMethodRequest as ExtMethodRequestFromIndex,
  ExtNotification as ExtNotificationFromIndex,
  FileSystemCapability as FileSystemCapabilityFromIndex,
  HttpHeader as HttpHeaderFromIndex,
  Implementation as ImplementationFromIndex,
  InitializeRequest as InitializeRequestFromIndex,
  InitializeResponse as InitializeResponseFromIndex,
  KillTerminalCommandRequest as KillTerminalCommandRequestFromIndex,
  KillTerminalCommandResponse as KillTerminalCommandResponseFromIndex,
  LoadSessionRequest as LoadSessionRequestFromIndex,
  LoadSessionResponse as LoadSessionResponseFromIndex,
  McpCapabilities as McpCapabilitiesFromIndex,
  McpServer as McpServerFromIndex,
  NewSessionRequest as NewSessionRequestFromIndex,
  NewSessionResponse as NewSessionResponseFromIndex,
  PermissionOption as PermissionOptionFromIndex,
  PermissionOptionKind as PermissionOptionKindFromIndex,
  PromptCapabilities as PromptCapabilitiesFromIndex,
  PromptRequest as PromptRequestFromIndex,
  PromptResponse as PromptResponseFromIndex,
  ProtocolVersion as ProtocolVersionFromIndex,
  ReadTextFileRequest as ReadTextFileRequestFromIndex,
  ReadTextFileResponse as ReadTextFileResponseFromIndex,
  ReleaseTerminalRequest as ReleaseTerminalRequestFromIndex,
  ReleaseTerminalResponse as ReleaseTerminalResponseFromIndex,
  RequestId as RequestIdFromIndex,
  RequestPermissionOutcome as RequestPermissionOutcomeFromIndex,
  RequestPermissionRequest as RequestPermissionRequestFromIndex,
  RequestPermissionResponse as RequestPermissionResponseFromIndex,
  SessionCapabilities as SessionCapabilitiesFromIndex,
  SessionMode as SessionModeFromIndex,
  SessionModeState as SessionModeStateFromIndex,
  SetSessionConfigOptionRequest as SetSessionConfigOptionRequestFromIndex,
  SetSessionConfigOptionResponse as SetSessionConfigOptionResponseFromIndex,
  SetSessionModeRequest as SetSessionModeRequestFromIndex,
  SetSessionModeResponse as SetSessionModeResponseFromIndex,
  StopReason as StopReasonFromIndex,
  TerminalExitStatus as TerminalExitStatusFromIndex,
  TerminalOutputRequest as TerminalOutputRequestFromIndex,
  TerminalOutputResponse as TerminalOutputResponseFromIndex,
  WaitForTerminalExitRequest as WaitForTerminalExitRequestFromIndex,
  WaitForTerminalExitResponse as WaitForTerminalExitResponseFromIndex,
  WriteTextFileRequest as WriteTextFileRequestFromIndex,
  WriteTextFileResponse as WriteTextFileResponseFromIndex,
} from "./index.js";

type AssertAssignable<To, ignoredFrom extends To> = true;
type AssertExtensible<ignoredT extends AcpExtensible> = true;

type ignoredSessionUpdateUnionIncludesStable = AssertAssignable<
  SessionUpdate,
  | UserMessageChunk
  | AgentMessageChunk
  | AgentThoughtChunk
  | ToolCall
  | ToolCallUpdate
  | Plan
  | AvailableCommandsUpdate
  | CurrentModeUpdate
  | ConfigOptionUpdate
>;

type ignoredSessionUpdateUnionIncludesUnstable = AssertAssignable<
  SessionUpdate,
  UnstableSessionUpdate
>;

type ignoredSessionUpdateStableAndUnstable = AssertAssignable<
  SessionUpdate,
  StableSessionUpdate | UnstableSessionUpdate
>;

type ignoredSessionInfoUpdateIsValid = AssertAssignable<
  SessionInfoUpdate,
  { sessionUpdate: "session_info_update"; title: "Story" }
>;

type ignoredUsageUpdateIsValid = AssertAssignable<
  UsageUpdate,
  { sessionUpdate: "usage_update"; used: 1; size: 2 }
>;

type ignoredToolKindShape = AssertAssignable<
  ToolKind,
  "read" | "write" | "execute" | "other"
>;
type ignoredToolKindShapeMatches = AssertAssignable<
  "read" | "write" | "execute" | "other",
  ToolKind
>;

type ignoredToolCallStatusIncludesCancelled = AssertAssignable<
  ToolCallStatus,
  "cancelled"
>;

type ignoredToolCallLocationLineNumber = AssertAssignable<
  ToolCallLocation,
  { path: "/repo/file.ts"; lineNumber: 3 }
>;

type ignoredToolCallContentText = AssertAssignable<
  ToolCallContent,
  { type: "text"; text: "hello" }
>;

type ignoredToolCallContentDiff = AssertAssignable<
  ToolCallContent,
  { type: "diff"; path: "/repo/file.ts"; newText: "new"; oldText: "old" }
>;

type ignoredToolCallContentImage = AssertAssignable<
  ToolCallContent,
  { type: "image"; data: "base64"; mimeType: "image/png" }
>;

type ignoredToolCallContentResourceLink = AssertAssignable<
  ToolCallContent,
  { type: "resource_link"; uri: "file:///repo/file.ts"; name: "file.ts" }
>;

type ignoredToolCallContentResource = AssertAssignable<
  ToolCallContent,
  {
    type: "resource";
    resource: {
      text: "content";
      uri: "file:///repo/file.ts";
    };
  }
>;

type ignoredToolCallContentTerminal = AssertAssignable<
  ToolCallContent,
  { type: "terminal"; terminalId: "term-1" }
>;

type ignoredRequestIdNull = AssertAssignable<RequestId, null>;
type ignoredRequestIdNumber = AssertAssignable<RequestId, 42>;
type ignoredRequestIdString = AssertAssignable<RequestId, "req-1">;

type ignoredStopReasonShape = AssertAssignable<
  StopReason,
  "completed" | "end_turn" | "cancelled" | "max_tokens"
>;

type ignoredAcpErrorCodeShape = AssertAssignable<
  AcpErrorCode,
  -32700 | -32600 | -32601 | -32602 | -32603 | -32000 | -32002
>;

type ignoredAcpErrorCodeCustom = AssertAssignable<AcpErrorCode, 10_001>;

type ignoredAcpErrorShape = AssertAssignable<
  { code: number; message: string; data?: unknown },
  AcpError
>;

type ignoredProtocolVersionShape = AssertAssignable<ProtocolVersion, 1>;

type ignoredImplementationShape = AssertAssignable<
  Implementation,
  { name: "poe-code"; version: "1.0.0" }
>;

type ignoredAuthMethodShape = AssertAssignable<
  AuthMethod,
  { id: "oauth"; name: "OAuth" }
>;

type ignoredClientCapabilitiesShape = AssertAssignable<
  ClientCapabilities,
  { fs: { readTextFile: true; writeTextFile: true }; terminal: true }
>;

type ignoredAgentCapabilitiesShape = AssertAssignable<
  AgentCapabilities,
  {
    loadSession: true;
    mcpCapabilities: { http: true; sse: true };
    promptCapabilities: { image: true; audio: true; embeddedContext: true };
    sessionCapabilities: { _meta: null };
  }
>;

type ignoredSessionModeShape = AssertAssignable<
  SessionMode,
  { id: "code"; name: "Code" }
>;

type ignoredSessionModeStateShape = AssertAssignable<
  SessionModeState,
  {
    availableModes: [{ id: "code"; name: "Code" }];
    currentModeId: "code";
  }
>;

type ignoredMcpServerStdioShape = AssertAssignable<
  McpServerStdio,
  {
    name: "local";
    command: "npx";
    args: ["server"];
    env: [{ name: "TOKEN"; value: "value" }];
  }
>;

type ignoredMcpServerHttpShape = AssertAssignable<
  McpServerHttp,
  {
    type: "http";
    name: "remote-http";
    url: "https://example.com/mcp";
    headers: [{ name: "Authorization"; value: "Bearer token" }];
  }
>;

type ignoredMcpServerSseShape = AssertAssignable<
  McpServerSse,
  {
    type: "sse";
    name: "remote-sse";
    url: "https://example.com/sse";
    headers: [{ name: "Authorization"; value: "Bearer token" }];
  }
>;

type ignoredMcpServerUnionShape = AssertAssignable<
  McpServer,
  | {
      name: "local";
      command: "npx";
      args: ["server"];
      env: [{ name: "TOKEN"; value: "value" }];
    }
  | {
      type: "http";
      name: "remote-http";
      url: "https://example.com/mcp";
      headers: [{ name: "Authorization"; value: "Bearer token" }];
    }
>;

type ignoredPermissionOptionKindShape = AssertAssignable<
  PermissionOptionKind,
  "allow_once" | "allow_always" | "reject_once" | "reject_always"
>;

type ignoredPermissionOptionShape = AssertAssignable<
  PermissionOption,
  { optionId: "allow-once"; kind: "allow_once"; name: "Allow once" }
>;

type ignoredRequestPermissionCancelledShape = AssertAssignable<
  RequestPermissionCancelledOutcome,
  { outcome: "cancelled" }
>;

type ignoredRequestPermissionSelectedShape = AssertAssignable<
  RequestPermissionSelectedOutcome,
  { outcome: "selected"; optionId: "allow-once" }
>;

type ignoredRequestPermissionOutcomeShape = AssertAssignable<
  RequestPermissionOutcome,
  { outcome: "cancelled" } | { outcome: "selected"; optionId: "allow-once" }
>;

type ignoredTerminalExitStatusShape = AssertAssignable<
  TerminalExitStatus,
  { exitCode: 0; signal: null }
>;

type ignoredInitializeRequestShape = AssertAssignable<
  InitializeRequest,
  {
    protocolVersion: 1;
    clientCapabilities: { fs: { readTextFile: true }; terminal: true };
    clientInfo: { name: "poe-code"; version: "1.0.0" };
  }
>;

type ignoredInitializeResponseShape = AssertAssignable<
  InitializeResponse,
  {
    protocolVersion: 1;
    agentCapabilities: { loadSession: true };
    agentInfo: { name: "agent"; version: "1.0.0" };
    authMethods: [{ id: "oauth"; name: "OAuth" }];
  }
>;

type ignoredAuthenticateRequestShape = AssertAssignable<
  AuthenticateRequest,
  { methodId: "oauth" }
>;

type ignoredAuthenticateResponseShape = AssertAssignable<AuthenticateResponse, { _meta: null }>;

type ignoredNewSessionRequestShape = AssertAssignable<
  NewSessionRequest,
  {
    cwd: "/workspace";
    mcpServers: [
      {
        name: "local";
        command: "npx";
        args: ["server"];
        env: [{ name: "TOKEN"; value: "value" }];
      },
    ];
  }
>;

type ignoredNewSessionResponseShape = AssertAssignable<
  NewSessionResponse,
  {
    sessionId: "session-1";
    modes: {
      availableModes: [{ id: "code"; name: "Code" }];
      currentModeId: "code";
    };
  }
>;

type ignoredLoadSessionRequestShape = AssertAssignable<
  LoadSessionRequest,
  {
    sessionId: "session-1";
    cwd: "/workspace";
    mcpServers: [];
  }
>;

type ignoredLoadSessionResponseShape = AssertAssignable<
  LoadSessionResponse,
  {
    modes: {
      availableModes: [{ id: "code"; name: "Code" }];
      currentModeId: "code";
    };
  }
>;

type ignoredPromptRequestShape = AssertAssignable<
  PromptRequest,
  {
    sessionId: "session-1";
    prompt: [{ type: "text"; text: "Hello" }];
  }
>;

type ignoredPromptResponseShape = AssertAssignable<
  PromptResponse,
  { stopReason: "completed" }
>;

type ignoredSetSessionModeRequestShape = AssertAssignable<
  SetSessionModeRequest,
  { sessionId: "session-1"; modeId: "code" }
>;

type ignoredSetSessionModeResponseShape = AssertAssignable<SetSessionModeResponse, { _meta: null }>;

type ignoredSetSessionConfigOptionRequestShape = AssertAssignable<
  SetSessionConfigOptionRequest,
  { sessionId: "session-1"; configId: "model"; value: "gpt-4.1" }
>;

type ignoredSetSessionConfigOptionResponseShape = AssertAssignable<
  SetSessionConfigOptionResponse,
  {
    configOptions: [
      {
        type: "select";
        id: "model";
        name: "Model";
        currentValue: "gpt-4.1";
        options: [{ value: "gpt-4.1"; name: "GPT-4.1" }];
      },
    ];
  }
>;

type ignoredCancelNotificationShape = AssertAssignable<
  CancelNotification,
  { sessionId: "session-1" }
>;

type ignoredRequestPermissionRequestShape = AssertAssignable<
  RequestPermissionRequest,
  {
    sessionId: "session-1";
    toolCall: { sessionUpdate: "tool_call_update"; toolCallId: "tool-1" };
    options: [{ optionId: "allow-once"; kind: "allow_once"; name: "Allow once" }];
  }
>;

type ignoredRequestPermissionResponseShape = AssertAssignable<
  RequestPermissionResponse,
  { outcome: { outcome: "selected"; optionId: "allow-once" } }
>;

type ignoredReadTextFileRequestShape = AssertAssignable<
  ReadTextFileRequest,
  { sessionId: "session-1"; path: "/workspace/file.ts"; line: 1; limit: 100 }
>;

type ignoredReadTextFileResponseShape = AssertAssignable<
  ReadTextFileResponse,
  { content: "text" }
>;

type ignoredWriteTextFileRequestShape = AssertAssignable<
  WriteTextFileRequest,
  { sessionId: "session-1"; path: "/workspace/file.ts"; content: "text" }
>;

type ignoredWriteTextFileResponseShape = AssertAssignable<WriteTextFileResponse, { _meta: null }>;

type ignoredCreateTerminalRequestShape = AssertAssignable<
  CreateTerminalRequest,
  {
    sessionId: "session-1";
    command: "npm";
    args: ["test"];
    cwd: "/workspace";
    env: [{ name: "FORCE_COLOR"; value: "1" }];
    outputByteLimit: 1024;
  }
>;

type ignoredCreateTerminalResponseShape = AssertAssignable<
  CreateTerminalResponse,
  { terminalId: "terminal-1" }
>;

type ignoredTerminalOutputRequestShape = AssertAssignable<
  TerminalOutputRequest,
  { sessionId: "session-1"; terminalId: "terminal-1" }
>;

type ignoredTerminalOutputResponseShape = AssertAssignable<
  TerminalOutputResponse,
  {
    output: "stdout";
    truncated: false;
    exitStatus: { exitCode: 0 };
  }
>;

type ignoredWaitForTerminalExitRequestShape = AssertAssignable<
  WaitForTerminalExitRequest,
  { sessionId: "session-1"; terminalId: "terminal-1" }
>;

type ignoredWaitForTerminalExitResponseShape = AssertAssignable<
  WaitForTerminalExitResponse,
  { exitCode: 0; signal: null }
>;

type ignoredKillTerminalCommandRequestShape = AssertAssignable<
  KillTerminalCommandRequest,
  { sessionId: "session-1"; terminalId: "terminal-1" }
>;

type ignoredKillTerminalCommandResponseShape = AssertAssignable<
  KillTerminalCommandResponse,
  { _meta: null }
>;

type ignoredReleaseTerminalRequestShape = AssertAssignable<
  ReleaseTerminalRequest,
  { sessionId: "session-1"; terminalId: "terminal-1" }
>;

type ignoredReleaseTerminalResponseShape = AssertAssignable<ReleaseTerminalResponse, { _meta: null }>;

type ignoredExtMethodRequestShape = AssertAssignable<
  ExtMethodRequest,
  { method: "_example/request"; params: { value: 1 } }
>;

type ignoredExtNotificationShape = AssertAssignable<
  ExtNotification,
  { method: "_example/notification"; params: { value: 1 } }
>;

type ignoredFileSystemCapabilityExtensible = AssertExtensible<FileSystemCapability>;
type ignoredClientCapabilitiesExtensible = AssertExtensible<ClientCapabilities>;
type ignoredAgentCapabilitiesExtensible = AssertExtensible<AgentCapabilities>;
type ignoredMcpCapabilitiesExtensible = AssertExtensible<McpCapabilities>;
type ignoredPromptCapabilitiesExtensible = AssertExtensible<PromptCapabilities>;
type ignoredSessionCapabilitiesExtensible = AssertExtensible<SessionCapabilities>;
type ignoredSessionModeExtensible = AssertExtensible<SessionMode>;
type ignoredSessionModeStateExtensible = AssertExtensible<SessionModeState>;
type ignoredHttpHeaderExtensible = AssertExtensible<HttpHeader>;
type ignoredEnvVariableExtensible = AssertExtensible<EnvVariable>;
type ignoredPermissionOptionExtensible = AssertExtensible<PermissionOption>;
type ignoredRequestPermissionCancelledExtensible =
  AssertExtensible<RequestPermissionCancelledOutcome>;
type ignoredRequestPermissionSelectedExtensible =
  AssertExtensible<RequestPermissionSelectedOutcome>;
type ignoredTerminalExitStatusExtensible = AssertExtensible<TerminalExitStatus>;
type ignoredInitializeRequestExtensible = AssertExtensible<InitializeRequest>;
type ignoredInitializeResponseExtensible = AssertExtensible<InitializeResponse>;
type ignoredAuthenticateRequestExtensible = AssertExtensible<AuthenticateRequest>;
type ignoredAuthenticateResponseExtensible = AssertExtensible<AuthenticateResponse>;
type ignoredNewSessionRequestExtensible = AssertExtensible<NewSessionRequest>;
type ignoredNewSessionResponseExtensible = AssertExtensible<NewSessionResponse>;
type ignoredLoadSessionRequestExtensible = AssertExtensible<LoadSessionRequest>;
type ignoredLoadSessionResponseExtensible = AssertExtensible<LoadSessionResponse>;
type ignoredPromptRequestExtensible = AssertExtensible<PromptRequest>;
type ignoredPromptResponseExtensible = AssertExtensible<PromptResponse>;
type ignoredSetSessionModeRequestExtensible = AssertExtensible<SetSessionModeRequest>;
type ignoredSetSessionModeResponseExtensible = AssertExtensible<SetSessionModeResponse>;
type ignoredSetSessionConfigOptionRequestExtensible =
  AssertExtensible<SetSessionConfigOptionRequest>;
type ignoredSetSessionConfigOptionResponseExtensible =
  AssertExtensible<SetSessionConfigOptionResponse>;
type ignoredCancelNotificationExtensible = AssertExtensible<CancelNotification>;
type ignoredRequestPermissionRequestExtensible = AssertExtensible<RequestPermissionRequest>;
type ignoredRequestPermissionResponseExtensible = AssertExtensible<RequestPermissionResponse>;
type ignoredReadTextFileRequestExtensible = AssertExtensible<ReadTextFileRequest>;
type ignoredReadTextFileResponseExtensible = AssertExtensible<ReadTextFileResponse>;
type ignoredWriteTextFileRequestExtensible = AssertExtensible<WriteTextFileRequest>;
type ignoredWriteTextFileResponseExtensible = AssertExtensible<WriteTextFileResponse>;
type ignoredCreateTerminalRequestExtensible = AssertExtensible<CreateTerminalRequest>;
type ignoredCreateTerminalResponseExtensible = AssertExtensible<CreateTerminalResponse>;
type ignoredTerminalOutputRequestExtensible = AssertExtensible<TerminalOutputRequest>;
type ignoredTerminalOutputResponseExtensible = AssertExtensible<TerminalOutputResponse>;
type ignoredWaitForTerminalExitRequestExtensible = AssertExtensible<WaitForTerminalExitRequest>;
type ignoredWaitForTerminalExitResponseExtensible = AssertExtensible<WaitForTerminalExitResponse>;
type ignoredKillTerminalCommandRequestExtensible = AssertExtensible<KillTerminalCommandRequest>;
type ignoredKillTerminalCommandResponseExtensible =
  AssertExtensible<KillTerminalCommandResponse>;
type ignoredReleaseTerminalRequestExtensible = AssertExtensible<ReleaseTerminalRequest>;
type ignoredReleaseTerminalResponseExtensible = AssertExtensible<ReleaseTerminalResponse>;
type ignoredExtMethodRequestExtensible = AssertExtensible<ExtMethodRequest>;
type ignoredExtNotificationExtensible = AssertExtensible<ExtNotification>;

type ignoredProtocolVersionExported = AssertAssignable<ProtocolVersion, ProtocolVersionFromIndex>;
type ignoredRequestIdExported = AssertAssignable<RequestId, RequestIdFromIndex>;
type ignoredStopReasonExported = AssertAssignable<StopReason, StopReasonFromIndex>;
type ignoredImplementationExported = AssertAssignable<Implementation, ImplementationFromIndex>;
type ignoredAuthMethodExported = AssertAssignable<AuthMethod, AuthMethodFromIndex>;
type ignoredClientCapabilitiesExported = AssertAssignable<ClientCapabilities, ClientCapabilitiesFromIndex>;
type ignoredFileSystemCapabilityExported = AssertAssignable<
  FileSystemCapability,
  FileSystemCapabilityFromIndex
>;
type ignoredAgentCapabilitiesExported = AssertAssignable<AgentCapabilities, AgentCapabilitiesFromIndex>;
type ignoredMcpCapabilitiesExported = AssertAssignable<McpCapabilities, McpCapabilitiesFromIndex>;
type ignoredPromptCapabilitiesExported = AssertAssignable<PromptCapabilities, PromptCapabilitiesFromIndex>;
type ignoredSessionCapabilitiesExported = AssertAssignable<SessionCapabilities, SessionCapabilitiesFromIndex>;
type ignoredSessionModeExported = AssertAssignable<SessionMode, SessionModeFromIndex>;
type ignoredSessionModeStateExported = AssertAssignable<SessionModeState, SessionModeStateFromIndex>;
type ignoredMcpServerExported = AssertAssignable<McpServer, McpServerFromIndex>;
type ignoredHttpHeaderExported = AssertAssignable<HttpHeader, HttpHeaderFromIndex>;
type ignoredEnvVariableExported = AssertAssignable<EnvVariable, EnvVariableFromIndex>;
type ignoredPermissionOptionExported = AssertAssignable<PermissionOption, PermissionOptionFromIndex>;
type ignoredPermissionOptionKindExported = AssertAssignable<
  PermissionOptionKind,
  PermissionOptionKindFromIndex
>;
type ignoredRequestPermissionOutcomeExported = AssertAssignable<
  RequestPermissionOutcome,
  RequestPermissionOutcomeFromIndex
>;
type ignoredTerminalExitStatusExported = AssertAssignable<
  TerminalExitStatus,
  TerminalExitStatusFromIndex
>;
type ignoredAcpErrorCodeExported = AssertAssignable<AcpErrorCode, AcpErrorCodeFromIndex>;
type ignoredAcpErrorExported = AssertAssignable<AcpError, AcpErrorFromIndex>;
type ignoredInitializeRequestExported = AssertAssignable<InitializeRequest, InitializeRequestFromIndex>;
type ignoredInitializeResponseExported = AssertAssignable<InitializeResponse, InitializeResponseFromIndex>;
type ignoredAuthenticateRequestExported = AssertAssignable<
  AuthenticateRequest,
  AuthenticateRequestFromIndex
>;
type ignoredAuthenticateResponseExported = AssertAssignable<
  AuthenticateResponse,
  AuthenticateResponseFromIndex
>;
type ignoredNewSessionRequestExported = AssertAssignable<NewSessionRequest, NewSessionRequestFromIndex>;
type ignoredNewSessionResponseExported = AssertAssignable<
  NewSessionResponse,
  NewSessionResponseFromIndex
>;
type ignoredLoadSessionRequestExported = AssertAssignable<LoadSessionRequest, LoadSessionRequestFromIndex>;
type ignoredLoadSessionResponseExported = AssertAssignable<
  LoadSessionResponse,
  LoadSessionResponseFromIndex
>;
type ignoredPromptRequestExported = AssertAssignable<PromptRequest, PromptRequestFromIndex>;
type ignoredPromptResponseExported = AssertAssignable<PromptResponse, PromptResponseFromIndex>;
type ignoredSetSessionModeRequestExported = AssertAssignable<
  SetSessionModeRequest,
  SetSessionModeRequestFromIndex
>;
type ignoredSetSessionModeResponseExported = AssertAssignable<
  SetSessionModeResponse,
  SetSessionModeResponseFromIndex
>;
type ignoredSetSessionConfigOptionRequestExported = AssertAssignable<
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionRequestFromIndex
>;
type ignoredSetSessionConfigOptionResponseExported = AssertAssignable<
  SetSessionConfigOptionResponse,
  SetSessionConfigOptionResponseFromIndex
>;
type ignoredCancelNotificationExported = AssertAssignable<
  CancelNotification,
  CancelNotificationFromIndex
>;
type ignoredRequestPermissionRequestExported = AssertAssignable<
  RequestPermissionRequest,
  RequestPermissionRequestFromIndex
>;
type ignoredRequestPermissionResponseExported = AssertAssignable<
  RequestPermissionResponse,
  RequestPermissionResponseFromIndex
>;
type ignoredReadTextFileRequestExported = AssertAssignable<
  ReadTextFileRequest,
  ReadTextFileRequestFromIndex
>;
type ignoredReadTextFileResponseExported = AssertAssignable<
  ReadTextFileResponse,
  ReadTextFileResponseFromIndex
>;
type ignoredWriteTextFileRequestExported = AssertAssignable<
  WriteTextFileRequest,
  WriteTextFileRequestFromIndex
>;
type ignoredWriteTextFileResponseExported = AssertAssignable<
  WriteTextFileResponse,
  WriteTextFileResponseFromIndex
>;
type ignoredCreateTerminalRequestExported = AssertAssignable<
  CreateTerminalRequest,
  CreateTerminalRequestFromIndex
>;
type ignoredCreateTerminalResponseExported = AssertAssignable<
  CreateTerminalResponse,
  CreateTerminalResponseFromIndex
>;
type ignoredTerminalOutputRequestExported = AssertAssignable<
  TerminalOutputRequest,
  TerminalOutputRequestFromIndex
>;
type ignoredTerminalOutputResponseExported = AssertAssignable<
  TerminalOutputResponse,
  TerminalOutputResponseFromIndex
>;
type ignoredWaitForTerminalExitRequestExported = AssertAssignable<
  WaitForTerminalExitRequest,
  WaitForTerminalExitRequestFromIndex
>;
type ignoredWaitForTerminalExitResponseExported = AssertAssignable<
  WaitForTerminalExitResponse,
  WaitForTerminalExitResponseFromIndex
>;
type ignoredKillTerminalCommandRequestExported = AssertAssignable<
  KillTerminalCommandRequest,
  KillTerminalCommandRequestFromIndex
>;
type ignoredKillTerminalCommandResponseExported = AssertAssignable<
  KillTerminalCommandResponse,
  KillTerminalCommandResponseFromIndex
>;
type ignoredReleaseTerminalRequestExported = AssertAssignable<
  ReleaseTerminalRequest,
  ReleaseTerminalRequestFromIndex
>;
type ignoredReleaseTerminalResponseExported = AssertAssignable<
  ReleaseTerminalResponse,
  ReleaseTerminalResponseFromIndex
>;
type ignoredExtMethodRequestExported = AssertAssignable<
  ExtMethodRequest,
  ExtMethodRequestFromIndex
>;
type ignoredExtNotificationExported = AssertAssignable<
  ExtNotification,
  ExtNotificationFromIndex
>;

// @ts-expect-error Unknown session update discriminator
const ignoredUnknownSessionUpdate: SessionUpdate = { sessionUpdate: "unknown" };

// @ts-expect-error tool_call requires toolCallId and title
const ignoredInvalidToolCall: ToolCall = { sessionUpdate: "tool_call" };

// @ts-expect-error usage_update requires used and size
const ignoredInvalidUsageUpdate: UsageUpdate = { sessionUpdate: "usage_update", used: 1 };

// @ts-expect-error legacy tool kind values are no longer valid
const ignoredLegacyToolKind: ToolKind = "edit";

// @ts-expect-error ToolCallLocation now uses lineNumber instead of line
const ignoredLegacyToolCallLine: ToolCallLocation = { path: "/repo/file.ts", line: 3 };

const ignoredLegacyToolCallContent: ToolCallContent = {
  // @ts-expect-error legacy tool content wrapper is no longer valid
  type: "content",
  content: { type: "text", text: "legacy" },
};

// @ts-expect-error stop reason values are restricted to completed/end_turn/cancelled/max_tokens
const ignoredInvalidStopReason: StopReason = "tool_use";
