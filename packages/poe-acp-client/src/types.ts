export type AcpMeta = Record<string, unknown> | null;

export interface AcpExtensible {
  _meta?: AcpMeta;
}

export type Role = "assistant" | "user";

export interface Annotations extends AcpExtensible {
  audience?: Role[] | null;
  lastModified?: string | null;
  priority?: number | null;
}

export interface TextContent extends AcpExtensible {
  type: "text";
  text: string;
  annotations?: Annotations | null;
}

export interface ImageContent extends AcpExtensible {
  type: "image";
  data: string;
  mimeType: string;
  uri?: string | null;
  annotations?: Annotations | null;
}

export interface AudioContent extends AcpExtensible {
  type: "audio";
  data: string;
  mimeType: string;
  annotations?: Annotations | null;
}

export interface ResourceLink extends AcpExtensible {
  type: "resource_link";
  name: string;
  uri: string;
  description?: string | null;
  mimeType?: string | null;
  size?: number | null;
  title?: string | null;
  annotations?: Annotations | null;
}

export interface TextResourceContents extends AcpExtensible {
  text: string;
  uri: string;
  mimeType?: string | null;
}

export interface BlobResourceContents extends AcpExtensible {
  blob: string;
  uri: string;
  mimeType?: string | null;
}

export type EmbeddedResourceResource = TextResourceContents | BlobResourceContents;

export interface EmbeddedResource extends AcpExtensible {
  type: "resource";
  resource: EmbeddedResourceResource;
  annotations?: Annotations | null;
}

export type ContentBlock =
  | TextContent
  | ImageContent
  | AudioContent
  | ResourceLink
  | EmbeddedResource;

export interface ContentChunk extends AcpExtensible {
  content: ContentBlock;
}

export interface UserMessageChunk extends ContentChunk {
  sessionUpdate: "user_message_chunk";
}

export interface AgentMessageChunk extends ContentChunk {
  sessionUpdate: "agent_message_chunk";
}

export interface AgentThoughtChunk extends ContentChunk {
  sessionUpdate: "agent_thought_chunk";
}

export type ToolKind = "read" | "write" | "execute" | "other";

export type ToolCallStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export interface Diff extends AcpExtensible {
  path: string;
  newText: string;
  oldText?: string | null;
}

export interface Terminal extends AcpExtensible {
  terminalId: string;
}

export interface ToolCallTextContent extends TextContent {
  type: "text";
}

export interface ToolCallDiffContent extends Diff {
  type: "diff";
}

export interface ToolCallImageContent extends ImageContent {
  type: "image";
}

export interface ToolCallResourceLinkContent extends ResourceLink {
  type: "resource_link";
}

export interface ToolCallResourceContent extends EmbeddedResource {
  type: "resource";
}

export interface ToolCallTerminalContent extends Terminal {
  type: "terminal";
}

export type ToolCallContent =
  | ToolCallTextContent
  | ToolCallDiffContent
  | ToolCallImageContent
  | ToolCallResourceLinkContent
  | ToolCallResourceContent
  | ToolCallTerminalContent;

export interface ToolCallLocation extends AcpExtensible {
  path: string;
  lineNumber?: number | null;
}

export interface ToolCall extends AcpExtensible {
  sessionUpdate: "tool_call";
  toolCallId: string;
  title: string;
  content?: ToolCallContent[];
  kind?: ToolKind;
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
  status?: ToolCallStatus;
}

export interface ToolCallUpdate extends AcpExtensible {
  sessionUpdate: "tool_call_update";
  toolCallId: string;
  content?: ToolCallContent[] | null;
  kind?: ToolKind | null;
  locations?: ToolCallLocation[] | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  status?: ToolCallStatus | null;
  title?: string | null;
}

export type PlanEntryPriority = "high" | "medium" | "low";

export type PlanEntryStatus = "pending" | "in_progress" | "completed";

export interface PlanEntry extends AcpExtensible {
  content: string;
  priority: PlanEntryPriority;
  status: PlanEntryStatus;
}

export interface Plan extends AcpExtensible {
  sessionUpdate: "plan";
  entries: PlanEntry[];
}

export interface UnstructuredCommandInput extends AcpExtensible {
  hint: string;
}

export type AvailableCommandInput = UnstructuredCommandInput;

export interface AvailableCommand extends AcpExtensible {
  name: string;
  description: string;
  input?: AvailableCommandInput | null;
}

export interface AvailableCommandsUpdate extends AcpExtensible {
  sessionUpdate: "available_commands_update";
  availableCommands: AvailableCommand[];
}

export type SessionModeId = string;

export interface CurrentModeUpdate extends AcpExtensible {
  sessionUpdate: "current_mode_update";
  currentModeId: SessionModeId;
}

export type SessionConfigId = string;
export type SessionConfigGroupId = string;
export type SessionConfigValueId = string;

export type SessionConfigOptionCategory =
  | "mode"
  | "model"
  | "thought_level"
  | string;

export interface SessionConfigSelectOption extends AcpExtensible {
  value: SessionConfigValueId;
  name: string;
  description?: string | null;
}

export interface SessionConfigSelectGroup extends AcpExtensible {
  group: SessionConfigGroupId;
  name: string;
  options: SessionConfigSelectOption[];
}

export type SessionConfigSelectOptions =
  | SessionConfigSelectOption[]
  | SessionConfigSelectGroup[];

export interface SessionConfigSelect {
  currentValue: SessionConfigValueId;
  options: SessionConfigSelectOptions;
}

export interface SessionConfigOption extends AcpExtensible, SessionConfigSelect {
  type: "select";
  id: SessionConfigId;
  name: string;
  category?: SessionConfigOptionCategory | null;
  description?: string | null;
}

export interface ConfigOptionUpdate extends AcpExtensible {
  sessionUpdate: "config_option_update";
  configOptions: SessionConfigOption[];
}

export interface SessionInfoUpdate extends AcpExtensible {
  sessionUpdate: "session_info_update";
  title?: string | null;
  updatedAt?: string | null;
}

export interface Cost {
  amount: number;
  currency: string;
}

export interface UsageUpdate extends AcpExtensible {
  sessionUpdate: "usage_update";
  used: number;
  size: number;
  cost?: Cost | null;
}

export type StableSessionUpdate =
  | UserMessageChunk
  | AgentMessageChunk
  | AgentThoughtChunk
  | ToolCall
  | ToolCallUpdate
  | Plan
  | AvailableCommandsUpdate
  | CurrentModeUpdate
  | ConfigOptionUpdate;

export type UnstableSessionUpdate = SessionInfoUpdate | UsageUpdate;

export type SessionUpdate = StableSessionUpdate | UnstableSessionUpdate;

export type SessionUpdateKind = SessionUpdate["sessionUpdate"];

export type SessionId = string;

export interface SessionNotification extends AcpExtensible {
  sessionId: SessionId;
  update: SessionUpdate;
}

export interface SessionUpdateNotification {
  jsonrpc: "2.0";
  method: "session/update";
  params: SessionNotification;
}

export type ProtocolVersion = number;

export type RequestId = null | number | string;

export type StopReason = "completed" | "cancelled" | "max_tokens" | "end_turn";

export interface Implementation extends AcpExtensible {
  name: string;
  version: string;
  title?: string | null;
}

export interface AuthMethod extends AcpExtensible {
  id: string;
  name: string;
  description?: string | null;
}

export interface FileSystemCapability extends AcpExtensible {
  readTextFile?: boolean;
  writeTextFile?: boolean;
}

export interface ClientCapabilities extends AcpExtensible {
  fs?: FileSystemCapability;
  terminal?: boolean;
}

export interface McpCapabilities extends AcpExtensible {
  http?: boolean;
  sse?: boolean;
}

export interface PromptCapabilities extends AcpExtensible {
  image?: boolean;
  audio?: boolean;
  embeddedContext?: boolean;
}

export type SessionCapabilities = AcpExtensible;

export interface AgentCapabilities extends AcpExtensible {
  loadSession?: boolean;
  mcpCapabilities?: McpCapabilities;
  promptCapabilities?: PromptCapabilities;
  sessionCapabilities?: SessionCapabilities;
}

export interface SessionMode extends AcpExtensible {
  id: SessionModeId;
  name: string;
  description?: string | null;
}

export interface SessionModeState extends AcpExtensible {
  availableModes: SessionMode[];
  currentModeId: SessionModeId;
}

export interface HttpHeader extends AcpExtensible {
  name: string;
  value: string;
}

export interface EnvVariable extends AcpExtensible {
  name: string;
  value: string;
}

export interface McpServerStdio extends AcpExtensible {
  name: string;
  command: string;
  args: string[];
  env: EnvVariable[];
}

export interface McpServerHttp extends AcpExtensible {
  type: "http";
  name: string;
  url: string;
  headers: HttpHeader[];
}

export interface McpServerSse extends AcpExtensible {
  type: "sse";
  name: string;
  url: string;
  headers: HttpHeader[];
}

export type McpServer = McpServerStdio | McpServerHttp | McpServerSse;

export type PermissionOptionId = string;

export type PermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

export interface PermissionOption extends AcpExtensible {
  optionId: PermissionOptionId;
  kind: PermissionOptionKind;
  name: string;
}

export interface RequestPermissionCancelledOutcome extends AcpExtensible {
  outcome: "cancelled";
}

export interface RequestPermissionSelectedOutcome extends AcpExtensible {
  outcome: "selected";
  optionId: PermissionOptionId;
}

export type RequestPermissionOutcome =
  | RequestPermissionCancelledOutcome
  | RequestPermissionSelectedOutcome;

export interface TerminalExitStatus extends AcpExtensible {
  exitCode?: number | null;
  signal?: string | null;
}

export const ACP_ERROR_CODE_PARSE = -32700;
export const ACP_ERROR_CODE_INVALID_REQUEST = -32600;
export const ACP_ERROR_CODE_METHOD_NOT_FOUND = -32601;
export const ACP_ERROR_CODE_INVALID_PARAMS = -32602;
export const ACP_ERROR_CODE_INTERNAL = -32603;
export const ACP_ERROR_CODE_AUTH_REQUIRED = -32000;
export const ACP_ERROR_CODE_RESOURCE_NOT_FOUND = -32002;

export type StandardAcpErrorCode =
  | typeof ACP_ERROR_CODE_PARSE
  | typeof ACP_ERROR_CODE_INVALID_REQUEST
  | typeof ACP_ERROR_CODE_METHOD_NOT_FOUND
  | typeof ACP_ERROR_CODE_INVALID_PARAMS
  | typeof ACP_ERROR_CODE_INTERNAL
  | typeof ACP_ERROR_CODE_AUTH_REQUIRED
  | typeof ACP_ERROR_CODE_RESOURCE_NOT_FOUND;

export type AcpErrorCode = StandardAcpErrorCode | number;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAcpErrorCode(value: unknown): value is AcpErrorCode {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= -2_147_483_648 &&
    value <= 2_147_483_647
  );
}

export class AcpError extends Error {
  readonly code: AcpErrorCode;
  readonly data?: unknown;

  constructor(code: AcpErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = "AcpError";
    this.code = code;
    if (data !== undefined) {
      this.data = data;
    }
  }
}

export function isAcpError(value: unknown): value is AcpError {
  if (value instanceof AcpError) {
    return true;
  }

  if (!isObjectRecord(value)) {
    return false;
  }

  if (!isAcpErrorCode(value.code) || typeof value.message !== "string") {
    return false;
  }

  return value.data === undefined || Object.prototype.hasOwnProperty.call(value, "data");
}

export interface InitializeRequest extends AcpExtensible {
  protocolVersion: ProtocolVersion;
  clientCapabilities?: ClientCapabilities;
  clientInfo?: Implementation | null;
}

export interface InitializeResponse extends AcpExtensible {
  protocolVersion: ProtocolVersion;
  agentCapabilities?: AgentCapabilities;
  agentInfo?: Implementation | null;
  authMethods?: AuthMethod[];
}

export interface AuthenticateRequest extends AcpExtensible {
  methodId: string;
}

export type AuthenticateResponse = AcpExtensible;

export interface NewSessionRequest extends AcpExtensible {
  cwd: string;
  mcpServers: McpServer[];
}

export interface NewSessionResponse extends AcpExtensible {
  sessionId: SessionId;
  configOptions?: SessionConfigOption[] | null;
  modes?: SessionModeState | null;
}

export interface LoadSessionRequest extends AcpExtensible {
  sessionId: SessionId;
  cwd: string;
  mcpServers: McpServer[];
}

export interface LoadSessionResponse extends AcpExtensible {
  configOptions?: SessionConfigOption[] | null;
  modes?: SessionModeState | null;
}

export interface PromptRequest extends AcpExtensible {
  sessionId: SessionId;
  prompt: ContentBlock[];
}

export interface PromptResponse extends AcpExtensible {
  stopReason: StopReason;
}

export interface SetSessionModeRequest extends AcpExtensible {
  sessionId: SessionId;
  modeId: SessionModeId;
}

export type SetSessionModeResponse = AcpExtensible;

export interface SetSessionConfigOptionRequest extends AcpExtensible {
  sessionId: SessionId;
  configId: SessionConfigId;
  value: SessionConfigValueId;
}

export interface SetSessionConfigOptionResponse extends AcpExtensible {
  configOptions: SessionConfigOption[];
}

export interface CancelNotification extends AcpExtensible {
  sessionId: SessionId;
}

export interface RequestPermissionRequest extends AcpExtensible {
  sessionId: SessionId;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
}

export interface RequestPermissionResponse extends AcpExtensible {
  outcome: RequestPermissionOutcome;
}

export interface ReadTextFileRequest extends AcpExtensible {
  sessionId: SessionId;
  path: string;
  line?: number | null;
  limit?: number | null;
}

export interface ReadTextFileResponse extends AcpExtensible {
  content: string;
}

export interface WriteTextFileRequest extends AcpExtensible {
  sessionId: SessionId;
  path: string;
  content: string;
}

export type WriteTextFileResponse = AcpExtensible;

export interface CreateTerminalRequest extends AcpExtensible {
  sessionId: SessionId;
  command: string;
  args?: string[];
  cwd?: string | null;
  env?: EnvVariable[];
  outputByteLimit?: number | null;
}

export interface CreateTerminalResponse extends AcpExtensible {
  terminalId: string;
}

export interface TerminalOutputRequest extends AcpExtensible {
  sessionId: SessionId;
  terminalId: string;
}

export interface TerminalOutputResponse extends AcpExtensible {
  output: string;
  truncated: boolean;
  exitStatus?: TerminalExitStatus | null;
}

export interface WaitForTerminalExitRequest extends AcpExtensible {
  sessionId: SessionId;
  terminalId: string;
}

export interface WaitForTerminalExitResponse extends AcpExtensible {
  exitCode?: number | null;
  signal?: string | null;
}

export interface KillTerminalCommandRequest extends AcpExtensible {
  sessionId: SessionId;
  terminalId: string;
}

export type KillTerminalCommandResponse = AcpExtensible;

export interface ReleaseTerminalRequest extends AcpExtensible {
  sessionId: SessionId;
  terminalId: string;
}

export type ReleaseTerminalResponse = AcpExtensible;

export interface ExtMethodRequest extends AcpExtensible {
  method: `_${string}`;
  params?: unknown;
}

export interface ExtNotification extends AcpExtensible {
  method: `_${string}`;
  params?: unknown;
}
