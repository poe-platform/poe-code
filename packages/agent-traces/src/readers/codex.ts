import path from "node:path";
import { asRecord, newestDate, parseDate, parseJsonLines } from "../line-json.js";
import type {
  AgentTraceFileSystem,
  NormalizedTrace,
  NormalizedTraceTurn,
  SqliteTraceDatabase,
  SqliteTraceDatabaseFactory,
  TraceUsage,
  TraceReader,
  TraceReference
} from "../types.js";

interface CodexThreadRow {
  id: string;
  rollout_path?: string;
  created_at?: number;
  updated_at?: number;
  created_at_ms?: number | null;
  updated_at_ms?: number | null;
  source?: string;
  model?: string;
  cwd?: string;
  title?: string;
  first_user_message?: string;
}

interface RolloutReadResult {
  turns: NormalizedTraceTurn[];
  usage?: TraceUsage;
  contextWindow?: number;
}

interface CodexRolloutState {
  toolNamesByCallId: Map<string, string>;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function importNodeSqlite(): Promise<typeof import("node:sqlite")> {
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (args[0] === "ExperimentalWarning" && String(warning).includes("SQLite")) {
      return;
    }
    return (emitWarning as (warning: string | Error, ...args: unknown[]) => void)(warning, ...args);
  }) as typeof process.emitWarning;
  try {
    return await import("node:sqlite");
  } finally {
    process.emitWarning = emitWarning;
  }
}

async function defaultSqliteFactory(databasePath: string): Promise<SqliteTraceDatabase> {
  const sqlite = await importNodeSqlite();
  const db = new sqlite.DatabaseSync(databasePath, { readOnly: true });
  return {
    all(sql: string, params: unknown[]): unknown[] {
      const sqlParams = params as Array<string | number | bigint | null | Uint8Array>;
      return db.prepare(sql).all(...sqlParams);
    },
    close(): void {
      db.close();
    }
  };
}

function dateFromRow(seconds: unknown, milliseconds: unknown): Date | undefined {
  if (typeof milliseconds === "number" && Number.isFinite(milliseconds)) {
    return parseDate(milliseconds);
  }
  return parseDate(seconds);
}

function rowFromUnknown(value: unknown): CodexThreadRow | undefined {
  const record = asRecord(value);
  if (!record || typeof record.id !== "string") {
    return undefined;
  }
  return {
    id: record.id,
    ...(typeof record.rollout_path === "string" ? { rollout_path: record.rollout_path } : {}),
    ...(typeof record.created_at === "number" ? { created_at: record.created_at } : {}),
    ...(typeof record.updated_at === "number" ? { updated_at: record.updated_at } : {}),
    ...("created_at_ms" in record && typeof record.created_at_ms === "number"
      ? { created_at_ms: record.created_at_ms }
      : {}),
    ...("updated_at_ms" in record && typeof record.updated_at_ms === "number"
      ? { updated_at_ms: record.updated_at_ms }
      : {}),
    ...(typeof record.source === "string" ? { source: record.source } : {}),
    ...(typeof record.model === "string" ? { model: record.model } : {}),
    ...(typeof record.cwd === "string" ? { cwd: record.cwd } : {}),
    ...(typeof record.title === "string" ? { title: record.title } : {}),
    ...(typeof record.first_user_message === "string"
      ? { first_user_message: record.first_user_message }
      : {})
  };
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return "";
  }
  const parts: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const type = typeof record.type === "string" ? record.type : undefined;
    if (type !== undefined && type !== "input_text" && type !== "output_text" && type !== "text") {
      continue;
    }
    if (typeof record.text === "string") {
      parts.push(record.text);
    }
  }
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n");
}

function textFromUserMessage(payload: Record<string, unknown>): string {
  if (typeof payload.message === "string") {
    return payload.message.trim();
  }
  const textElements = textFromContent(payload.text_elements);
  if (textElements.length > 0) {
    return textElements;
  }
  return textFromContent(payload.message);
}

function textFromAgentMessage(payload: Record<string, unknown>): string {
  if (typeof payload.message === "string") {
    return payload.message.trim();
  }
  if (typeof payload.text === "string") {
    return payload.text.trim();
  }
  const content = textFromContent(payload.content);
  if (content.length > 0) {
    return content;
  }
  return textFromContent(payload.message);
}

function textFromReasoning(payload: Record<string, unknown>): string {
  if (typeof payload.text === "string") {
    return payload.text.trim();
  }
  const content = textFromContent(payload.content);
  if (content.length > 0) {
    return content;
  }
  return textFromContent(payload.summary);
}

function textFromBaseInstructions(payload: Record<string, unknown>): string {
  const baseInstructions = asRecord(payload.base_instructions);
  return typeof baseInstructions?.text === "string" ? baseInstructions.text : "";
}

function stringifyJson(value: unknown): string {
  const text = JSON.stringify(value);
  return typeof text === "string" ? text : "";
}

function callIdFromPayload(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.call_id === "string" && payload.call_id.length > 0) {
    return payload.call_id;
  }
  return typeof payload.id === "string" && payload.id.length > 0 ? payload.id : undefined;
}

function callArgumentText(payload: Record<string, unknown>): string {
  if (typeof payload.arguments === "string") {
    return payload.arguments;
  }
  return "arguments" in payload ? stringifyJson(payload.arguments) : "";
}

function callOutputText(payload: Record<string, unknown>): string {
  return typeof payload.output === "string" ? payload.output : "";
}

function rememberToolName(payload: Record<string, unknown>, state: CodexRolloutState): void {
  if (typeof payload.name !== "string") {
    return;
  }
  const callId = callIdFromPayload(payload);
  if (callId) {
    state.toolNamesByCallId.set(callId, payload.name);
  }
  if (
    typeof payload.id === "string" &&
    typeof payload.call_id === "string" &&
    payload.id !== payload.call_id
  ) {
    state.toolNamesByCallId.set(payload.id, payload.name);
  }
}

function contentTextsFromMcpResult(result: unknown): string {
  const resultRecord = asRecord(result);
  const ok = asRecord(resultRecord?.Ok);
  return textFromContent(ok?.content);
}

function mcpToolCallEndTurn(
  payload: Record<string, unknown>,
  timestamp: Date | undefined
): NormalizedTraceTurn | undefined {
  const invocation = asRecord(payload.invocation);
  if (!invocation) {
    return undefined;
  }
  const toolName = typeof invocation.tool === "string" ? invocation.tool : undefined;
  const mcpServer = typeof invocation.server === "string" ? invocation.server : undefined;
  const argumentText = "arguments" in invocation ? stringifyJson(invocation.arguments) : "";
  const resultText = contentTextsFromMcpResult(payload.result);
  const text = [argumentText, resultText]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n");

  if (text.length === 0) {
    return undefined;
  }

  return {
    role: "tool",
    text,
    ...(timestamp ? { timestamp } : {}),
    sourceKind: "tool_result",
    ...(toolName ? { toolName } : {}),
    ...(mcpServer ? { mcpServer } : {})
  };
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function usageFromTokenCountPayload(payload: Record<string, unknown>): {
  usage: TraceUsage;
  contextWindow?: number;
} {
  const info = asRecord(payload.info);
  const lastTokenUsage = asRecord(info?.last_token_usage);
  const inputTokens = tokenCount(lastTokenUsage?.input_tokens) ?? 0;
  const outputTokens = tokenCount(lastTokenUsage?.output_tokens) ?? 0;
  const cachedTokens = tokenCount(lastTokenUsage?.cached_input_tokens);
  const contextWindow = tokenCount(info?.model_context_window);

  return {
    usage: {
      source: "reported",
      inputTokens,
      outputTokens,
      ...(cachedTokens !== undefined ? { cachedTokens } : {}),
      contextTokens: tokenCount(lastTokenUsage?.total_tokens) ?? 0
    },
    ...(contextWindow !== undefined ? { contextWindow } : {})
  };
}

function turnFromRolloutRecord(
  record: Record<string, unknown>,
  state: CodexRolloutState
): NormalizedTraceTurn | undefined {
  const payload = asRecord(record.payload);
  if (!payload) {
    return undefined;
  }
  const payloadType =
    typeof payload.type === "string"
      ? payload.type
      : typeof record.type === "string"
        ? record.type
        : undefined;
  const timestamp = parseDate(record.timestamp) ?? parseDate(payload.timestamp);
  if (payloadType === "session_meta") {
    const text = textFromBaseInstructions(payload);
    return text.length === 0
      ? undefined
      : {
          role: "system",
          text,
          ...(timestamp ? { timestamp } : {}),
          sourceKind: "base_instructions"
        };
  }
  if (payloadType === "reasoning") {
    const text = textFromReasoning(payload);
    return text.length === 0
      ? undefined
      : {
          role: "assistant",
          text,
          ...(timestamp ? { timestamp } : {}),
          sourceKind: "reasoning"
        };
  }
  if (payloadType === "agent_message") {
    const text = textFromAgentMessage(payload);
    return text.length === 0
      ? undefined
      : {
          role: "assistant",
          text,
          ...(timestamp ? { timestamp } : {}),
          sourceKind: "agent_message"
        };
  }
  if (payloadType === "function_call" || payloadType === "custom_tool_call") {
    rememberToolName(payload, state);
    const toolName = typeof payload.name === "string" ? payload.name : undefined;
    return {
      role: "tool",
      text: callArgumentText(payload),
      ...(timestamp ? { timestamp } : {}),
      sourceKind: "tool_use",
      ...(toolName ? { toolName } : {})
    };
  }
  if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
    const callId = callIdFromPayload(payload);
    const toolName = callId ? state.toolNamesByCallId.get(callId) : undefined;
    return {
      role: "tool",
      text: callOutputText(payload),
      ...(timestamp ? { timestamp } : {}),
      sourceKind: "tool_result",
      ...(toolName ? { toolName } : {})
    };
  }
  if (payloadType === "mcp_tool_call_end") {
    return mcpToolCallEndTurn(payload, timestamp);
  }
  if (payloadType === "user_message") {
    const text = textFromUserMessage(payload);
    return text.length === 0
      ? undefined
      : {
          role: "human",
          text,
          ...(timestamp ? { timestamp } : {}),
          sourceKind: "user_message"
        };
  }
  if (payloadType === "message") {
    const text = textFromContent(payload.content);
    if (text.length === 0) {
      return undefined;
    }
    const role =
      payload.role === "user" ? "human" : payload.role === "assistant" ? "assistant" : "tool";
    return {
      role,
      text,
      ...(timestamp ? { timestamp } : {}),
      sourceKind: "message"
    };
  }
  return undefined;
}

async function readRollout(filePath: string, fs: AgentTraceFileSystem): Promise<RolloutReadResult> {
  const content = await fs.readFile(filePath, "utf8");
  const records = parseJsonLines(content)
    .map(asRecord)
    .filter((record): record is Record<string, unknown> => record !== undefined);
  const turns: NormalizedTraceTurn[] = [];
  let tokenCountPayload: { usage: TraceUsage; contextWindow?: number } | undefined;
  const state: CodexRolloutState = {
    toolNamesByCallId: new Map()
  };

  for (const record of records) {
    const payload = asRecord(record.payload);
    if (payload?.type === "token_count") {
      tokenCountPayload = usageFromTokenCountPayload(payload);
    }
    const turn = turnFromRolloutRecord(record, state);
    if (turn) {
      turns.push(turn);
    }
  }

  return {
    turns,
    ...(tokenCountPayload?.usage ? { usage: tokenCountPayload.usage } : {}),
    ...(tokenCountPayload?.contextWindow !== undefined
      ? { contextWindow: tokenCountPayload.contextWindow }
      : {})
  };
}

function referenceFromRow(row: CodexThreadRow): TraceReference {
  const createdAt = dateFromRow(row.created_at, row.created_at_ms);
  const updatedAt = dateFromRow(row.updated_at, row.updated_at_ms);
  return {
    source: "codex",
    id: row.id,
    ...(row.rollout_path ? { path: row.rollout_path } : {}),
    ...(row.cwd ? { cwd: row.cwd } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(row.title ? { title: row.title } : {}),
    metadata: {
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(row.first_user_message ? { firstUserMessage: row.first_user_message } : {}),
      ...(row.model ? { model: row.model } : {}),
      ...(row.source ? { source: row.source } : {})
    }
  };
}

function fallbackTurn(reference: TraceReference): NormalizedTraceTurn[] {
  const firstUserMessage = reference.metadata?.firstUserMessage;
  if (typeof firstUserMessage !== "string" || firstUserMessage.trim().length === 0) {
    return [];
  }
  const createdAt = reference.metadata?.createdAt;
  return [
    {
      role: "human",
      text: firstUserMessage.trim(),
      ...(createdAt instanceof Date ? { timestamp: createdAt } : {}),
      sourceKind: "first_user_message"
    }
  ];
}

export const codexTraceReader: TraceReader = {
  id: "codex",
  defaultRoots(homeDir: string): string[] {
    return [path.join(homeDir, ".codex", "state_5.sqlite")];
  },
  async discover(options): Promise<TraceReference[]> {
    const databasePath = path.join(options.homeDir, ".codex", "state_5.sqlite");
    const sqlite: SqliteTraceDatabaseFactory = options.sqlite ?? defaultSqliteFactory;
    let db: SqliteTraceDatabase;
    try {
      db = await sqlite(databasePath);
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }
      throw error;
    }

    try {
      const sinceSeconds = options.since ? Math.floor(options.since.getTime() / 1_000) : null;
      const sql = [
        "SELECT id, rollout_path, created_at, updated_at, created_at_ms, updated_at_ms, source, model, cwd, title, first_user_message",
        "FROM threads",
        options.allWorkspaces || !options.cwd
          ? sinceSeconds === null
            ? ""
            : "WHERE updated_at >= ? OR updated_at_ms >= ?"
          : "WHERE cwd = ? AND (? IS NULL OR updated_at >= ? OR updated_at_ms >= ?)",
        "ORDER BY updated_at DESC"
      ]
        .filter((part) => part.length > 0)
        .join(" ");
      const params =
        options.allWorkspaces || !options.cwd
          ? sinceSeconds === null
            ? []
            : [sinceSeconds, sinceSeconds * 1_000]
          : [
              options.cwd,
              sinceSeconds,
              sinceSeconds,
              sinceSeconds === null ? null : sinceSeconds * 1_000
            ];
      const rows = (await db.all(sql, params))
        .map(rowFromUnknown)
        .filter((row): row is CodexThreadRow => row !== undefined);
      return rows.map(referenceFromRow);
    } finally {
      await db.close();
    }
  },
  async read(reference, options): Promise<NormalizedTrace> {
    const createdAt = reference.metadata?.createdAt;
    const updatedAt = reference.metadata?.updatedAt;
    const model = reference.metadata?.model;
    let turns: NormalizedTraceTurn[] = [];
    let usage: TraceUsage | undefined;
    let contextWindow: number | undefined;
    if (reference.path) {
      try {
        const rollout = await readRollout(reference.path, options.fs);
        turns = rollout.turns;
        usage = rollout.usage;
        contextWindow = rollout.contextWindow;
      } catch (error) {
        if (!isMissingFile(error)) {
          throw error;
        }
      }
    }
    if (turns.length === 0) {
      turns = fallbackTurn(reference);
    }
    const turnUpdatedAt = turns.reduce<Date | undefined>(
      (latest, turn) => newestDate(latest, turn.timestamp),
      undefined
    );
    return {
      source: "codex",
      id: reference.id,
      ...(reference.path ? { path: reference.path } : {}),
      ...(reference.cwd ? { cwd: reference.cwd } : {}),
      ...(reference.title ? { title: reference.title } : {}),
      ...(typeof model === "string" ? { model } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(usage ? { usage } : {}),
      ...(createdAt instanceof Date ? { createdAt } : {}),
      ...(updatedAt instanceof Date
        ? { updatedAt }
        : turnUpdatedAt
          ? { updatedAt: turnUpdatedAt }
          : {}),
      turns
    };
  }
};
