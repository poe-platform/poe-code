import path from "node:path";
import { mapConcurrent } from "../index-store/concurrency.js";
import { readHead } from "../index-store/head.js";
import { asRecord, newestDate, parseDate, parseJsonLines } from "../line-json.js";
import type {
  AgentTraceFileSystem,
  NormalizedTrace,
  NormalizedTraceTurn,
  TraceHeadMetadata,
  TraceReader,
  TraceReference,
  TraceScanDirectory,
  TraceUsage
} from "../types.js";

interface PoeCodeLogFileName {
  timestamp?: Date;
  agent: string;
  sessionId: string;
}

const HEAD_SCAN_MAX_LINES = 50;
const REDACTED_LOG_CONTENT = "[redacted]";

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function listJsonlFiles(fs: AgentTraceFileSystem, directory: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
  return names
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => path.join(directory, name));
}

function fixedWidthNumber(value: string, width: number): number | undefined {
  if (value.length !== width) {
    return undefined;
  }
  let result = 0;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 48 || code > 57) {
      return undefined;
    }
    result = result * 10 + (code - 48);
  }
  return result;
}

function timestampFromFileNameParts(
  day: string,
  time: string,
  milliseconds: string
): Date | undefined {
  if (day.length !== 8 || time.length !== 6 || milliseconds.length !== 3) {
    return undefined;
  }
  const year = fixedWidthNumber(day.slice(0, 4), 4);
  const month = fixedWidthNumber(day.slice(4, 6), 2);
  const date = fixedWidthNumber(day.slice(6, 8), 2);
  const hour = fixedWidthNumber(time.slice(0, 2), 2);
  const minute = fixedWidthNumber(time.slice(2, 4), 2);
  const second = fixedWidthNumber(time.slice(4, 6), 2);
  const ms = fixedWidthNumber(milliseconds, 3);

  if (
    year === undefined ||
    month === undefined ||
    date === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined ||
    ms === undefined
  ) {
    return undefined;
  }

  const parsed = new Date(Date.UTC(year, month - 1, date, hour, minute, second, ms));
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== date ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second ||
    parsed.getUTCMilliseconds() !== ms
  ) {
    return undefined;
  }
  return parsed;
}

function isHexPart(value: string, width: number): boolean {
  if (value.length !== width) {
    return false;
  }
  for (const char of value) {
    const code = char.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isLowerHex = code >= 97 && code <= 102;
    const isUpperHex = code >= 65 && code <= 70;
    if (!isDigit && !isLowerHex && !isUpperHex) {
      return false;
    }
  }
  return true;
}

function sessionStartIndex(parts: string[]): number {
  const uuidPartWidths = [8, 4, 4, 4, 12];
  const uuidStart = parts.length - uuidPartWidths.length;
  if (
    uuidStart > 3 &&
    uuidPartWidths.every((width, index) => isHexPart(parts[uuidStart + index] ?? "", width))
  ) {
    return uuidStart;
  }
  return 4;
}

function parseLogFileName(filePath: string): PoeCodeLogFileName | undefined {
  const name = path.basename(filePath);
  if (!name.endsWith(".jsonl")) {
    return undefined;
  }
  const stem = name.slice(0, -".jsonl".length);
  const parts = stem.split("-");
  if (parts.length < 5) {
    return undefined;
  }

  const sessionIndex = sessionStartIndex(parts);
  const agent = parts.slice(3, sessionIndex).join("-");
  const sessionId = parts.slice(sessionIndex).join("-");
  if (agent.length === 0 || sessionId.length === 0) {
    return undefined;
  }

  return {
    timestamp: timestampFromFileNameParts(parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""),
    agent,
    sessionId
  };
}

/** Spawn logs carry no prompt record, so the first agent message is the closest identifying content. */
function titleFromLogContent(content: string): string | undefined {
  let lineStart = 0;
  for (let line = 0; line < HEAD_SCAN_MAX_LINES && lineStart < content.length; line += 1) {
    const lineEnd = content.indexOf("\n", lineStart);
    const rawLine = lineEnd === -1 ? content.slice(lineStart) : content.slice(lineStart, lineEnd);
    lineStart = lineEnd === -1 ? content.length : lineEnd + 1;

    const record = asRecord(parseJsonLines(rawLine)[0]);
    if (record?.event !== "agent_message" || typeof record.text !== "string") {
      continue;
    }
    const text = record.text.trim();
    if (text.length > 0 && text !== REDACTED_LOG_CONTENT) {
      return text;
    }
  }
  return undefined;
}

async function updatedAtForFile(
  fs: AgentTraceFileSystem,
  filePath: string,
  fallback: Date | undefined
): Promise<Date | undefined> {
  try {
    const stats = await fs.stat(filePath);
    return stats.mtime ?? fallback;
  } catch (error) {
    if (isMissingFile(error)) {
      return fallback;
    }
    throw error;
  }
}

function timestampFromRecord(record: Record<string, unknown>): Date | undefined {
  const meta = asRecord(record._meta);
  return parseDate(meta?.ts);
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function usageFromRecord(value: unknown): TraceUsage | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const inputTokens = tokenCount(record.inputTokens);
  const outputTokens = tokenCount(record.outputTokens);
  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }
  const cachedTokens = tokenCount(record.cachedTokens);
  const cacheCreationTokens = tokenCount(record.cacheCreationTokens);
  return {
    inputTokens,
    outputTokens,
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
    contextTokens: inputTokens + outputTokens,
    source: "reported"
  };
}

function textTurn(
  record: Record<string, unknown>,
  role: NormalizedTraceTurn["role"],
  textKey: "message" | "path" | "text" | "title",
  sourceKind?: string
): NormalizedTraceTurn | undefined {
  const text = typeof record[textKey] === "string" ? record[textKey] : undefined;
  if (text === undefined) {
    return undefined;
  }
  const timestamp = timestampFromRecord(record);
  return {
    ...(typeof record.id === "string" && record.id.length > 0 ? { id: record.id } : {}),
    role,
    text,
    ...(timestamp ? { timestamp } : {}),
    ...(sourceKind ? { sourceKind } : {}),
    ...(typeof record.kind === "string" && record.kind.length > 0 ? { toolName: record.kind } : {})
  };
}

function turnFromRecord(record: Record<string, unknown>): NormalizedTraceTurn | undefined {
  switch (record.event) {
    case "agent_message":
      return textTurn(record, "assistant", "text");
    case "reasoning":
      return textTurn(record, "assistant", "text", "reasoning");
    case "tool_start":
      return textTurn(record, "tool", "title", "tool_use");
    case "tool_complete":
      return textTurn(record, "tool", "path", "tool_result");
    case "error":
      return textTurn(record, "system", "message");
    default:
      return undefined;
  }
}

const DISCOVER_CONCURRENCY = 32;

export const poeCodeTraceReader: TraceReader = {
  id: "poe-code",
  defaultRoots(homeDir: string): string[] {
    return [path.join(homeDir, ".poe-code", "spawn-logs")];
  },
  async discover(options): Promise<TraceReference[]> {
    const root = path.join(options.homeDir, ".poe-code", "spawn-logs");
    const files = await listJsonlFiles(options.fs, root);
    const discovered = await mapConcurrent(
      files,
      DISCOVER_CONCURRENCY,
      async (filePath): Promise<TraceReference | undefined> => {
        const parsed = parseLogFileName(filePath);
        if (!parsed) {
          return undefined;
        }
        const updatedAt = await updatedAtForFile(options.fs, filePath, parsed.timestamp);
        if (options.since && updatedAt && updatedAt < options.since) {
          return undefined;
        }
        const head = await readHead(options.fs, filePath);
        return {
          source: "poe-code",
          id: parsed.sessionId,
          path: filePath,
          ...(updatedAt ? { updatedAt } : {}),
          title: titleFromLogContent(head) ?? parsed.agent
        };
      }
    );
    return discovered.filter((reference): reference is TraceReference => reference !== undefined);
  },
  async *scan(options): AsyncIterable<TraceScanDirectory> {
    const root = path.join(options.homeDir, ".poe-code", "spawn-logs");
    yield { directory: root, files: await listJsonlFiles(options.fs, root) };
  },
  readHeadMetadata(head, filePath): TraceHeadMetadata | undefined {
    const parsed = parseLogFileName(filePath);
    if (!parsed) {
      return undefined;
    }
    return {
      id: parsed.sessionId,
      title: titleFromLogContent(head) ?? parsed.agent,
      ...(parsed.timestamp ? { updatedAt: parsed.timestamp } : {})
    };
  },
  async read(reference, options): Promise<NormalizedTrace> {
    if (!reference.path) {
      throw new Error(`poe-code trace ${reference.id} has no path.`);
    }

    const fileName = parseLogFileName(reference.path);
    const content = await options.fs.readFile(reference.path, "utf8");
    const turns: NormalizedTraceTurn[] = [];
    let lastUsage: TraceUsage | undefined;
    let spawnResultUsage: TraceUsage | undefined;

    for (const value of parseJsonLines(content)) {
      const record = asRecord(value);
      if (!record) {
        continue;
      }

      if (record.event === "usage") {
        const usage = usageFromRecord(record);
        if (usage) {
          lastUsage = usage;
        }
        continue;
      }
      if (record.event === "spawn_result") {
        const usage = usageFromRecord(record.usage);
        if (usage) {
          spawnResultUsage = usage;
        }
        continue;
      }

      const turn = turnFromRecord(record);
      if (turn) {
        turns.push(turn);
      }
    }

    const turnUpdatedAt = turns.reduce<Date | undefined>(
      (latest, turn) => newestDate(latest, turn.timestamp),
      undefined
    );
    const usage = lastUsage ?? spawnResultUsage;
    const model = fileName?.agent ?? reference.title;
    return {
      source: "poe-code",
      id: reference.id,
      path: reference.path,
      ...(reference.title ? { title: reference.title } : {}),
      ...(model ? { model } : {}),
      ...(usage ? { usage } : {}),
      ...(reference.updatedAt
        ? { updatedAt: reference.updatedAt }
        : turnUpdatedAt
          ? { updatedAt: turnUpdatedAt }
          : {}),
      turns
    };
  }
};
