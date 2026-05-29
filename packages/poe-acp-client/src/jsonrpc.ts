import type {
  AcpMeta,
  AgentMessageChunk,
  AgentThoughtChunk,
  Annotations,
  AudioContent,
  AvailableCommand,
  AvailableCommandInput,
  BlobResourceContents,
  ConfigOptionUpdate,
  ContentBlock,
  CurrentModeUpdate,
  EmbeddedResource,
  ImageContent,
  Plan,
  PlanEntry,
  ResourceLink,
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  SessionInfoUpdate,
  SessionNotification,
  SessionUpdate,
  SessionUpdateNotification,
  TextContent,
  TextResourceContents,
  ToolCall,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolCallUpdate,
  ToolKind,
  UsageUpdate,
  UserMessageChunk,
} from "./types.js";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalMeta(value: unknown): value is AcpMeta | undefined {
  return value === undefined || value === null || isObjectRecord(value);
}

function hasValidMeta(value: Record<string, unknown>): boolean {
  return isOptionalMeta(value._meta);
}

function isRole(value: unknown): value is "assistant" | "user" {
  return value === "assistant" || value === "user";
}

function isAnnotations(value: unknown): value is Annotations {
  if (!isObjectRecord(value) || !hasValidMeta(value)) {
    return false;
  }

  if (
    value.audience !== undefined &&
    value.audience !== null &&
    (!Array.isArray(value.audience) || !value.audience.every(isRole))
  ) {
    return false;
  }

  if (
    value.lastModified !== undefined &&
    value.lastModified !== null &&
    typeof value.lastModified !== "string"
  ) {
    return false;
  }

  if (
    value.priority !== undefined &&
    value.priority !== null &&
    typeof value.priority !== "number"
  ) {
    return false;
  }

  return true;
}

function hasValidOptionalAnnotations(value: Record<string, unknown>): boolean {
  return (
    value.annotations === undefined ||
    value.annotations === null ||
    isAnnotations(value.annotations)
  );
}

function isTextContent(value: unknown): value is TextContent {
  return (
    isObjectRecord(value) &&
    hasValidMeta(value) &&
    hasValidOptionalAnnotations(value) &&
    value.type === "text" &&
    typeof value.text === "string"
  );
}

function isImageContent(value: unknown): value is ImageContent {
  if (
    !isObjectRecord(value) ||
    !hasValidMeta(value) ||
    !hasValidOptionalAnnotations(value) ||
    value.type !== "image" ||
    typeof value.data !== "string" ||
    typeof value.mimeType !== "string"
  ) {
    return false;
  }

  return (
    value.uri === undefined || value.uri === null || typeof value.uri === "string"
  );
}

function isAudioContent(value: unknown): value is AudioContent {
  return (
    isObjectRecord(value) &&
    hasValidMeta(value) &&
    hasValidOptionalAnnotations(value) &&
    value.type === "audio" &&
    typeof value.data === "string" &&
    typeof value.mimeType === "string"
  );
}

function isResourceLink(value: unknown): value is ResourceLink {
  if (
    !isObjectRecord(value) ||
    !hasValidMeta(value) ||
    !hasValidOptionalAnnotations(value) ||
    value.type !== "resource_link" ||
    typeof value.name !== "string" ||
    typeof value.uri !== "string"
  ) {
    return false;
  }

  if (
    value.description !== undefined &&
    value.description !== null &&
    typeof value.description !== "string"
  ) {
    return false;
  }

  if (
    value.mimeType !== undefined &&
    value.mimeType !== null &&
    typeof value.mimeType !== "string"
  ) {
    return false;
  }

  if (
    value.size !== undefined &&
    value.size !== null &&
    typeof value.size !== "number"
  ) {
    return false;
  }

  if (
    value.title !== undefined &&
    value.title !== null &&
    typeof value.title !== "string"
  ) {
    return false;
  }

  return true;
}

function isTextResourceContents(value: unknown): value is TextResourceContents {
  if (!isObjectRecord(value) || !hasValidMeta(value)) {
    return false;
  }

  if (typeof value.text !== "string" || typeof value.uri !== "string") {
    return false;
  }

  return (
    value.mimeType === undefined ||
    value.mimeType === null ||
    typeof value.mimeType === "string"
  );
}

function isBlobResourceContents(value: unknown): value is BlobResourceContents {
  if (!isObjectRecord(value) || !hasValidMeta(value)) {
    return false;
  }

  if (typeof value.blob !== "string" || typeof value.uri !== "string") {
    return false;
  }

  return (
    value.mimeType === undefined ||
    value.mimeType === null ||
    typeof value.mimeType === "string"
  );
}

function isEmbeddedResource(value: unknown): value is EmbeddedResource {
  if (
    !isObjectRecord(value) ||
    !hasValidMeta(value) ||
    !hasValidOptionalAnnotations(value) ||
    value.type !== "resource"
  ) {
    return false;
  }

  return (
    isTextResourceContents(value.resource) ||
    isBlobResourceContents(value.resource)
  );
}

function isContentBlock(value: unknown): value is ContentBlock {
  return (
    isTextContent(value) ||
    isImageContent(value) ||
    isAudioContent(value) ||
    isResourceLink(value) ||
    isEmbeddedResource(value)
  );
}

function isContentChunk(
  value: unknown
): value is UserMessageChunk | AgentMessageChunk | AgentThoughtChunk {
  if (!isObjectRecord(value) || !hasValidMeta(value)) {
    return false;
  }

  return isContentBlock(value.content);
}

function isToolKind(value: unknown): value is ToolKind {
  return (
    value === "read" ||
    value === "write" ||
    value === "execute" ||
    value === "other"
  );
}

function isToolCallStatus(value: unknown): value is ToolCallStatus {
  return (
    value === "pending" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function isDiffToolCallContent(value: unknown): value is ToolCallContent {
  if (!isObjectRecord(value) || !hasValidMeta(value) || value.type !== "diff") {
    return false;
  }

  if (typeof value.path !== "string" || typeof value.newText !== "string") {
    return false;
  }

  return (
    value.oldText === undefined ||
    value.oldText === null ||
    typeof value.oldText === "string"
  );
}

function isTerminalToolCallContent(value: unknown): value is ToolCallContent {
  return (
    isObjectRecord(value) &&
    hasValidMeta(value) &&
    value.type === "terminal" &&
    typeof value.terminalId === "string"
  );
}

function isToolCallContent(value: unknown): value is ToolCallContent {
  return (
    isTextContent(value) ||
    isDiffToolCallContent(value) ||
    isImageContent(value) ||
    isResourceLink(value) ||
    isEmbeddedResource(value) ||
    isTerminalToolCallContent(value)
  );
}

function isToolCallLocation(value: unknown): value is ToolCallLocation {
  if (!isObjectRecord(value) || !hasValidMeta(value) || typeof value.path !== "string") {
    return false;
  }

  if (value.line !== undefined) {
    return false;
  }

  return (
    value.lineNumber === undefined ||
    value.lineNumber === null ||
    (typeof value.lineNumber === "number" && Number.isInteger(value.lineNumber) && value.lineNumber >= 0)
  );
}

function isToolCall(value: unknown): value is ToolCall {
  if (
    !isObjectRecord(value) ||
    !hasValidMeta(value) ||
    value.sessionUpdate !== "tool_call" ||
    typeof value.toolCallId !== "string" ||
    typeof value.title !== "string"
  ) {
    return false;
  }

  if (value.kind !== undefined && !isToolKind(value.kind)) {
    return false;
  }

  if (value.status !== undefined && !isToolCallStatus(value.status)) {
    return false;
  }

  if (
    value.content !== undefined &&
    (!Array.isArray(value.content) || !value.content.every(isToolCallContent))
  ) {
    return false;
  }

  if (
    value.locations !== undefined &&
    (!Array.isArray(value.locations) || !value.locations.every(isToolCallLocation))
  ) {
    return false;
  }

  return true;
}

function isToolCallUpdate(value: unknown): value is ToolCallUpdate {
  if (
    !isObjectRecord(value) ||
    !hasValidMeta(value) ||
    value.sessionUpdate !== "tool_call_update" ||
    typeof value.toolCallId !== "string"
  ) {
    return false;
  }

  if (value.kind !== undefined && value.kind !== null && !isToolKind(value.kind)) {
    return false;
  }

  if (
    value.status !== undefined &&
    value.status !== null &&
    !isToolCallStatus(value.status)
  ) {
    return false;
  }

  if (
    value.content !== undefined &&
    value.content !== null &&
    (!Array.isArray(value.content) || !value.content.every(isToolCallContent))
  ) {
    return false;
  }

  if (
    value.locations !== undefined &&
    value.locations !== null &&
    (!Array.isArray(value.locations) || !value.locations.every(isToolCallLocation))
  ) {
    return false;
  }

  if (
    value.title !== undefined &&
    value.title !== null &&
    typeof value.title !== "string"
  ) {
    return false;
  }

  return true;
}

function isPlanEntryPriority(value: unknown): value is PlanEntry["priority"] {
  return value === "high" || value === "medium" || value === "low";
}

function isPlanEntryStatus(value: unknown): value is PlanEntry["status"] {
  return value === "pending" || value === "in_progress" || value === "completed";
}

function isPlanEntry(value: unknown): value is PlanEntry {
  if (!isObjectRecord(value) || !hasValidMeta(value)) {
    return false;
  }

  return (
    typeof value.content === "string" &&
    isPlanEntryPriority(value.priority) &&
    isPlanEntryStatus(value.status)
  );
}

function isPlan(value: unknown): value is Plan {
  return (
    isObjectRecord(value) &&
    hasValidMeta(value) &&
    value.sessionUpdate === "plan" &&
    Array.isArray(value.entries) &&
    value.entries.every(isPlanEntry)
  );
}

function isAvailableCommandInput(
  value: unknown
): value is AvailableCommandInput {
  return (
    isObjectRecord(value) &&
    hasValidMeta(value) &&
    typeof value.hint === "string"
  );
}

function isAvailableCommand(value: unknown): value is AvailableCommand {
  if (!isObjectRecord(value) || !hasValidMeta(value)) {
    return false;
  }

  if (typeof value.name !== "string" || typeof value.description !== "string") {
    return false;
  }

  if (
    value.input !== undefined &&
    value.input !== null &&
    !isAvailableCommandInput(value.input)
  ) {
    return false;
  }

  return true;
}

function isAvailableCommandsUpdate(value: unknown): boolean {
  return (
    isObjectRecord(value) &&
    hasValidMeta(value) &&
    value.sessionUpdate === "available_commands_update" &&
    Array.isArray(value.availableCommands) &&
    value.availableCommands.every(isAvailableCommand)
  );
}

function isCurrentModeUpdate(value: unknown): value is CurrentModeUpdate {
  return (
    isObjectRecord(value) &&
    hasValidMeta(value) &&
    value.sessionUpdate === "current_mode_update" &&
    typeof value.currentModeId === "string"
  );
}

function isSessionConfigSelectOption(
  value: unknown
): value is SessionConfigSelectOption {
  if (!isObjectRecord(value) || !hasValidMeta(value)) {
    return false;
  }

  if (typeof value.value !== "string" || typeof value.name !== "string") {
    return false;
  }

  return (
    value.description === undefined ||
    value.description === null ||
    typeof value.description === "string"
  );
}

function isSessionConfigSelectGroup(
  value: unknown
): value is SessionConfigSelectGroup {
  return (
    isObjectRecord(value) &&
    hasValidMeta(value) &&
    typeof value.group === "string" &&
    typeof value.name === "string" &&
    Array.isArray(value.options) &&
    value.options.every(isSessionConfigSelectOption)
  );
}

function isSessionConfigSelectOptions(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }

  return (
    value.every(isSessionConfigSelectOption) ||
    value.every(isSessionConfigSelectGroup)
  );
}

function isSessionConfigOption(value: unknown): value is SessionConfigOption {
  if (!isObjectRecord(value) || !hasValidMeta(value)) {
    return false;
  }

  if (
    value.type !== "select" ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.currentValue !== "string" ||
    !isSessionConfigSelectOptions(value.options)
  ) {
    return false;
  }

  if (
    value.description !== undefined &&
    value.description !== null &&
    typeof value.description !== "string"
  ) {
    return false;
  }

  if (
    value.category !== undefined &&
    value.category !== null &&
    typeof value.category !== "string"
  ) {
    return false;
  }

  return true;
}

function isConfigOptionUpdate(value: unknown): value is ConfigOptionUpdate {
  return (
    isObjectRecord(value) &&
    hasValidMeta(value) &&
    value.sessionUpdate === "config_option_update" &&
    Array.isArray(value.configOptions) &&
    value.configOptions.every(isSessionConfigOption)
  );
}

function isSessionInfoUpdate(value: unknown): value is SessionInfoUpdate {
  if (
    !isObjectRecord(value) ||
    !hasValidMeta(value) ||
    value.sessionUpdate !== "session_info_update"
  ) {
    return false;
  }

  if (
    value.title !== undefined &&
    value.title !== null &&
    typeof value.title !== "string"
  ) {
    return false;
  }

  if (
    value.updatedAt !== undefined &&
    value.updatedAt !== null &&
    typeof value.updatedAt !== "string"
  ) {
    return false;
  }

  return true;
}

function isUsageUpdate(value: unknown): value is UsageUpdate {
  if (
    !isObjectRecord(value) ||
    !hasValidMeta(value) ||
    value.sessionUpdate !== "usage_update"
  ) {
    return false;
  }

  if (
    typeof value.used !== "number" ||
    !Number.isInteger(value.used) ||
    value.used < 0 ||
    typeof value.size !== "number" ||
    !Number.isInteger(value.size) ||
    value.size < 0
  ) {
    return false;
  }

  if (value.cost !== undefined && value.cost !== null) {
    if (!isObjectRecord(value.cost)) {
      return false;
    }

    if (
      typeof value.cost.amount !== "number" ||
      !Number.isFinite(value.cost.amount) ||
      typeof value.cost.currency !== "string"
    ) {
      return false;
    }
  }

  return true;
}

function isSessionUpdate(value: unknown): value is SessionUpdate {
  if (!isObjectRecord(value) || typeof value.sessionUpdate !== "string") {
    return false;
  }

  switch (value.sessionUpdate) {
    case "user_message_chunk":
    case "agent_message_chunk":
    case "agent_thought_chunk":
      return isContentChunk(value);
    case "tool_call":
      return isToolCall(value);
    case "tool_call_update":
      return isToolCallUpdate(value);
    case "plan":
      return isPlan(value);
    case "available_commands_update":
      return isAvailableCommandsUpdate(value);
    case "current_mode_update":
      return isCurrentModeUpdate(value);
    case "config_option_update":
      return isConfigOptionUpdate(value);
    case "session_info_update":
      return isSessionInfoUpdate(value);
    case "usage_update":
      return isUsageUpdate(value);
    default:
      return false;
  }
}

export function isSessionNotification(value: unknown): value is SessionNotification {
  if (!isObjectRecord(value) || !hasValidMeta(value)) {
    return false;
  }

  return typeof value.sessionId === "string" && isSessionUpdate(value.update);
}

function isSessionUpdateNotification(
  value: unknown
): value is SessionUpdateNotification {
  return (
    isObjectRecord(value) &&
    value.jsonrpc === "2.0" &&
    value.method === "session/update" &&
    isSessionNotification(value.params)
  );
}

export function formatSessionUpdate(
  sessionId: string,
  update: SessionUpdate,
  meta?: AcpMeta
): string {
  if (
    update.sessionUpdate === "usage_update" &&
    update.cost != null &&
    !Number.isFinite(update.cost.amount)
  ) {
    throw new Error("usage_update cost amount must be finite");
  }

  const params: SessionNotification = {
    sessionId,
    update,
  };

  if (meta !== undefined) {
    params._meta = meta;
  }

  const notification: SessionUpdateNotification = {
    jsonrpc: "2.0",
    method: "session/update",
    params,
  };

  return JSON.stringify(notification);
}

export function parseSessionUpdate(
  notificationLine: string
): SessionUpdateNotification | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(notificationLine);
  } catch {
    return null;
  }

  if (!isSessionUpdateNotification(parsed)) {
    return null;
  }

  return parsed;
}
