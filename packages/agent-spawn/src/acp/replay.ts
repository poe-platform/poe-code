import path from "node:path";
import type { Dirent } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { SessionUpdate } from "@poe-code/poe-acp-client";
import { mapLegacyEventToSessionUpdates } from "@poe-code/poe-acp-client";
import { hasOwnErrorCode } from "../error-codes.js";
import { renderSessionUpdateStream } from "./renderer.js";
import { ensureSafeDefaultSpawnLogDir } from "./spawn-log-path.js";
import type { AcpEvent } from "./types.js";

const DEFAULT_LOG_LIMIT = 80;
const JSONL_EXTENSION = ".jsonl";

export interface LogEntry {
  path: string;
  filename: string;
  agent?: string;
  timestamp?: Date;
}

export interface MalformedSpawnLogRecord {
  filePath: string;
  lineNumber: number;
  message: string;
}

export interface ReadSpawnLogOptions {
  strict?: boolean;
  onMalformedRecord?: (record: MalformedSpawnLogRecord) => void;
}

interface ListSpawnLogsOptions {
  agent?: string;
  limit?: number;
}

function isDigitString(value: string, length: number): boolean {
  if (value.length !== length) return false;
  for (const char of value) {
    if (char < "0" || char > "9") return false;
  }
  return true;
}

function parseTimestamp(day: string, time: string, milliseconds: string): Date | undefined {
  if (!isDigitString(day, 8) || !isDigitString(time, 6) || !isDigitString(milliseconds, 3)) {
    return undefined;
  }

  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(4, 6));
  const date = Number(day.slice(6, 8));
  const hours = Number(time.slice(0, 2));
  const minutes = Number(time.slice(2, 4));
  const seconds = Number(time.slice(4, 6));
  const millis = Number(milliseconds);

  const timestamp = new Date(Date.UTC(year, month - 1, date, hours, minutes, seconds, millis));

  if (
    Number.isNaN(timestamp.getTime()) ||
    timestamp.getUTCFullYear() !== year ||
    timestamp.getUTCMonth() !== month - 1 ||
    timestamp.getUTCDate() !== date ||
    timestamp.getUTCHours() !== hours ||
    timestamp.getUTCMinutes() !== minutes ||
    timestamp.getUTCSeconds() !== seconds ||
    timestamp.getUTCMilliseconds() !== millis
  ) {
    return undefined;
  }

  return timestamp;
}

function parseLogFilename(filename: string): { agent?: string; timestamp?: Date } {
  if (!filename.endsWith(JSONL_EXTENSION)) return {};

  const baseName = filename.slice(0, -JSONL_EXTENSION.length);
  const parts = baseName.split("-");

  if (parts.length < 4) return {};

  const timestamp = parseTimestamp(parts[0], parts[1], parts[2]);
  const agent = parts.slice(3).join("-");

  return {
    agent: agent.length > 0 ? agent : undefined,
    timestamp
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) {
    return DEFAULT_LOG_LIMIT;
  }
  return Math.floor(limit);
}

function isSessionUpdate(parsed: unknown): parsed is SessionUpdate {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    "sessionUpdate" in parsed &&
    typeof (parsed as Record<string, unknown>).sessionUpdate === "string"
  );
}

function isLegacyEvent(parsed: unknown): parsed is AcpEvent {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    "event" in parsed &&
    typeof (parsed as Record<string, unknown>).event === "string"
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return String(error);
}

function formatMalformedRecord(record: MalformedSpawnLogRecord): string {
  return `${record.filePath}:${record.lineNumber}: ${record.message}`;
}

function warnMalformedRecord(record: MalformedSpawnLogRecord): void {
  process.stderr.write(`Skipping malformed spawn log record at ${formatMalformedRecord(record)}\n`);
}

export async function* readSpawnLog(
  filePath: string,
  options: ReadSpawnLogOptions = {}
): AsyncIterable<SessionUpdate> {
  const fileHandle = await open(filePath, "r");
  const stream = fileHandle.createReadStream({ encoding: "utf8" });
  const reader = createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  try {
    let lineNumber = 0;
    for await (const line of reader) {
      lineNumber++;
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch (error) {
        const record: MalformedSpawnLogRecord = {
          filePath,
          lineNumber,
          message: getErrorMessage(error)
        };
        if (options.strict === true) {
          throw new Error(`Malformed spawn log record at ${formatMalformedRecord(record)}`);
        }
        (options.onMalformedRecord ?? warnMalformedRecord)(record);
        continue;
      }

      if (isSessionUpdate(parsed)) {
        yield parsed;
        continue;
      }

      if (isLegacyEvent(parsed)) {
        for (const update of mapLegacyEventToSessionUpdates(parsed as { event: string } & Record<string, unknown>)) {
          yield update;
        }
      }
    }
  } finally {
    reader.close();
    if (!stream.destroyed) {
      stream.destroy();
    }
    await fileHandle.close().catch(() => {});
  }
}

export async function listSpawnLogs(options: ListSpawnLogsOptions = {}): Promise<LogEntry[]> {
  const limit = normalizeLimit(options.limit);
  let logDir: string;

  try {
    logDir = await ensureSafeDefaultSpawnLogDir(false);
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) return [];
    throw error;
  }

  let entries: Dirent[];
  try {
    entries = await readdir(logDir, { withFileTypes: true });
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) return [];
    throw error;
  }

  const logs: LogEntry[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(JSONL_EXTENSION)) continue;

    const logEntry: LogEntry = {
      path: path.join(logDir, entry.name),
      filename: entry.name,
      ...parseLogFilename(entry.name)
    };

    if (options.agent && logEntry.agent !== options.agent) continue;

    logs.push(logEntry);
  }

  logs.sort((a, b) => (a.filename < b.filename ? 1 : a.filename > b.filename ? -1 : 0));
  return logs.slice(0, limit);
}

export async function findLatestLog(agent?: string): Promise<string | undefined> {
  const entries = await listSpawnLogs({ agent, limit: Number.MAX_SAFE_INTEGER });
  const timestamped = entries
    .filter((entry) => entry.timestamp !== undefined)
    .sort(compareLogTimestampsDescending);
  return (timestamped[0] ?? entries[0])?.path;
}

function compareLogTimestampsDescending(a: LogEntry, b: LogEntry): number {
  const diff = b.timestamp!.getTime() - a.timestamp!.getTime();
  if (diff !== 0) {
    return diff;
  }

  return a.filename < b.filename ? 1 : a.filename > b.filename ? -1 : 0;
}

export async function pickRandomLog(agent?: string): Promise<string | undefined> {
  const entries = await listSpawnLogs({ agent });
  if (entries.length === 0) return undefined;
  return entries[Math.floor(Math.random() * entries.length)]?.path;
}

export async function replaySpawnLog(
  filePath: string,
  options: ReadSpawnLogOptions = {}
): Promise<void> {
  await renderSessionUpdateStream(readSpawnLog(filePath, options));
}
