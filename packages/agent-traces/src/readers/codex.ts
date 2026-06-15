import path from "node:path";
import { asRecord, newestDate, parseDate, parseJsonLines } from "../line-json.js";
import type {
  AgentTraceFileSystem,
  NormalizedTrace,
  NormalizedTraceTurn,
  SqliteTraceDatabase,
  SqliteTraceDatabaseFactory,
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

function turnFromRolloutRecord(record: Record<string, unknown>): NormalizedTraceTurn | undefined {
  const payload = asRecord(record.payload);
  if (!payload || typeof payload.type !== "string") {
    return undefined;
  }
  const timestamp = parseDate(record.timestamp);
  if (payload.type === "user_message") {
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
  if (payload.type === "message") {
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

async function readRollout(
  filePath: string,
  fs: AgentTraceFileSystem
): Promise<NormalizedTraceTurn[]> {
  const content = await fs.readFile(filePath, "utf8");
  return parseJsonLines(content)
    .map(asRecord)
    .filter((record): record is Record<string, unknown> => record !== undefined)
    .map(turnFromRolloutRecord)
    .filter((turn): turn is NormalizedTraceTurn => turn !== undefined);
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
    let turns: NormalizedTraceTurn[] = [];
    if (reference.path) {
      try {
        turns = await readRollout(reference.path, options.fs);
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
