import * as fsPromises from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  extractToolCallSummariesFromSessionUpdateStream,
  extractUsageFromSessionUpdateStream,
  type ToolCallSummary,
} from "./stream-helpers.js";
import type { Cost, SessionUpdate, SessionUpdateNotification, UsageUpdate } from "./types.js";

type SessionUpdateStreamItem = SessionUpdateNotification | SessionUpdate;

export type RunExitStatus = "success" | "failed";

export interface RunReportUsage {
  used: number;
  size: number;
  updates: number;
  cost?: Cost | null;
}

export interface RunReportError {
  message: string;
  toolCallId?: string;
}

export interface RunReport {
  runId: string;
  startTime: string;
  endTime: string;
  exitStatus: RunExitStatus;
  toolCalls: ToolCallSummary[];
  usage: RunReportUsage;
  errors: RunReportError[];
}

export interface GenerateRunReportOptions {
  runId?: string;
  startTime?: string | Date;
  endTime?: string | Date;
  exitStatus?: RunExitStatus;
  errors?: string[];
  now?: () => Date;
}

export type RunReportFileSystem = {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(
    path: string,
    data: string,
    options?: { encoding?: BufferEncoding },
  ): Promise<void>;
};

export interface SaveRunReportOptions {
  fs?: RunReportFileSystem;
  homeDir?: string;
  now?: () => Date;
}

export interface SavedRunReportPaths {
  reportsDir: string;
  jsonPath: string;
  summaryPath: string;
}

export async function generateRunReportFromSessionUpdateStream(
  stream: AsyncIterable<SessionUpdateStreamItem> | Iterable<SessionUpdateStreamItem>,
  options: GenerateRunReportOptions = {},
): Promise<RunReport> {
  const now = options.now ?? (() => new Date());

  const bufferedEntries: SessionUpdateStreamItem[] = [];
  let runIdFromStream: string | undefined;

  for await (const entry of stream) {
    bufferedEntries.push(entry);
    if (runIdFromStream) {
      continue;
    }

    if (isSessionUpdateNotification(entry)) {
      const sessionId = toNonEmptyString(entry.params.sessionId);
      if (sessionId) {
        runIdFromStream = sessionId;
      }
    }
  }

  const runId = toNonEmptyString(options.runId) ?? runIdFromStream;
  if (!runId) {
    throw new Error("Run id is required via options.runId or session/update stream items");
  }

  const startTime = normalizeTime(options.startTime, now);
  const endTime = normalizeTime(options.endTime, now);

  const toolCalls = await extractToolCallSummariesFromSessionUpdateStream(bufferedEntries);
  const usageUpdates = await extractUsageFromSessionUpdateStream(bufferedEntries);

  const usage = summarizeUsage(usageUpdates);
  const errors = collectErrors(toolCalls, options.errors);
  const exitStatus = options.exitStatus ?? (errors.length > 0 ? "failed" : "success");

  return {
    runId,
    startTime,
    endTime,
    exitStatus,
    toolCalls,
    usage,
    errors,
  };
}

export function formatRunReportSummary(report: RunReport): string {
  const lines = [
    `Run ID: ${report.runId}`,
    `Start time: ${report.startTime}`,
    `End time: ${report.endTime}`,
    `Duration: ${toDuration(report.startTime, report.endTime)}`,
    `Exit status: ${report.exitStatus}`,
    `Tool count: ${report.toolCalls.length}`,
    `Token usage: ${report.usage.used}/${report.usage.size}`,
    `Error count: ${report.errors.length}`,
  ];

  if (report.usage.cost) {
    lines.push(`Cost: ${report.usage.cost.amount} ${report.usage.cost.currency}`);
  }

  return lines.join("\n");
}

export async function saveRunReport(
  report: RunReport,
  options: SaveRunReportOptions = {},
): Promise<SavedRunReportPaths> {
  const fs = options.fs ?? fsPromises;
  const now = options.now ?? (() => new Date());

  const reportsDir = join(options.homeDir ?? homedir(), ".poe-code", "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const timestamp = toTimestampForFileName(now());
  const safeRunId = toSafeFileSegment(report.runId);
  const baseFileName = `${timestamp}-${safeRunId}`;

  const jsonPath = join(reportsDir, `${baseFileName}.json`);
  const summaryPath = join(reportsDir, `${baseFileName}.txt`);

  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), { encoding: "utf8" });
  await fs.writeFile(summaryPath, formatRunReportSummary(report), { encoding: "utf8" });

  return {
    reportsDir,
    jsonPath,
    summaryPath,
  };
}

function isSessionUpdateNotification(entry: SessionUpdateStreamItem): entry is SessionUpdateNotification {
  return (
    typeof (entry as SessionUpdateNotification).jsonrpc === "string" &&
    (entry as SessionUpdateNotification).method === "session/update"
  );
}

function normalizeTime(value: string | Date | undefined, now: () => Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return now().toISOString();
}

function summarizeUsage(updates: readonly UsageUpdate[]): RunReportUsage {
  let used = 0;
  let size = 0;
  let cost: Cost | null | undefined;

  for (const update of updates) {
    used += update.used;
    size += update.size;

    if (update.cost !== undefined) {
      cost = update.cost;
    }
  }

  const usage: RunReportUsage = {
    used,
    size,
    updates: updates.length,
  };

  if (cost !== undefined) {
    usage.cost = cost;
  }

  return usage;
}

function collectErrors(
  toolCalls: readonly ToolCallSummary[],
  additionalErrors: readonly string[] | undefined,
): RunReportError[] {
  const errors: RunReportError[] = [];

  for (const toolCall of toolCalls) {
    if (toolCall.status !== "failed") {
      continue;
    }

    errors.push({
      toolCallId: toolCall.toolCallId,
      message: toErrorMessage(toolCall),
    });
  }

  if (additionalErrors) {
    for (const message of additionalErrors) {
      const text = toNonEmptyString(message);
      if (text) {
        errors.push({ message: text });
      }
    }
  }

  return errors;
}

function toErrorMessage(toolCall: ToolCallSummary): string {
  if (typeof toolCall.rawOutput === "string" && toolCall.rawOutput.length > 0) {
    return toolCall.rawOutput;
  }

  if (toolCall.rawOutput instanceof Error && toolCall.rawOutput.message.length > 0) {
    return toolCall.rawOutput.message;
  }

  if (toolCall.rawOutput !== undefined && toolCall.rawOutput !== null) {
    const encoded = trySerialize(toolCall.rawOutput);
    if (encoded) {
      return encoded;
    }
  }

  return `${toolCall.title} failed`;
}

function trySerialize(value: unknown): string | undefined {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === "string" && serialized.length > 0) {
      return serialized;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function toDuration(startTime: string, endTime: string): string {
  const startMs = Date.parse(startTime);
  const endMs = Date.parse(endTime);

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return "unknown";
  }

  const seconds = (endMs - startMs) / 1000;
  return `${Number(seconds.toFixed(3))}s`;
}

function toSafeFileSegment(value: string): string {
  let output = "";

  for (const char of value) {
    if (isAsciiLetterOrDigit(char) || char === "-" || char === "_") {
      output += char;
      continue;
    }

    output += "-";
  }

  return output.length > 0 ? output : "run";
}

function isAsciiLetterOrDigit(value: string): boolean {
  const code = value.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function toTimestampForFileName(value: Date): string {
  return [
    String(value.getUTCFullYear()),
    pad(value.getUTCMonth() + 1, 2),
    pad(value.getUTCDate(), 2),
  ].join("")
    + "-"
    + [
      pad(value.getUTCHours(), 2),
      pad(value.getUTCMinutes(), 2),
      pad(value.getUTCSeconds(), 2),
    ].join("")
    + "-"
    + pad(value.getUTCMilliseconds(), 3);
}

function pad(value: number, size: number): string {
  const text = String(value);
  if (text.length >= size) {
    return text;
  }

  return `${"0".repeat(size - text.length)}${text}`;
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value;
}
