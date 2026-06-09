import * as fsPromises from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
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
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  writeFile(
    path: string,
    data: string,
    options?: { encoding?: BufferEncoding; flag?: string },
  ): Promise<void>;
  rm(path: string, options?: { force?: boolean }): Promise<void>;
  rename?(oldPath: string, newPath: string): Promise<void>;
  realpath?(path: string): Promise<string>;
};

export interface SaveRunReportOptions {
  fs?: RunReportFileSystem;
  homeDir?: string;
  includeRawContent?: boolean;
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
    `Run ID: ${escapeSummaryValue(report.runId)}`,
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
  await assertReportsDirectoryContained(reportsDir, options.homeDir ?? homedir(), fs);

  const timestamp = toTimestampForFileName(now());
  const safeRunId = toSafeFileSegment(report.runId);
  const baseFileName = `${timestamp}-${safeRunId}`;

  const jsonPath = join(reportsDir, `${baseFileName}.json`);
  const summaryPath = join(reportsDir, `${baseFileName}.txt`);
  const savedReport = options.includeRawContent === true ? report : redactRunReport(report);

  await writeReportFile(fs, jsonPath, JSON.stringify(savedReport, null, 2));
  try {
    await writeReportFile(fs, summaryPath, formatRunReportSummary(savedReport));
  } catch (error) {
    await fs.rm(jsonPath);
    throw error;
  }

  return {
    reportsDir,
    jsonPath,
    summaryPath,
  };
}

async function writeReportFile(
  fs: RunReportFileSystem,
  targetPath: string,
  content: string,
): Promise<void> {
  if (fs.rename === undefined) {
    await fs.writeFile(targetPath, content, { encoding: "utf8" });
    return;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const tempPath = join(
      dirname(targetPath),
      `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    let tempCreated = false;
    try {
      await fs.writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
      tempCreated = true;
      await fs.rename(tempPath, targetPath);
      tempCreated = false;
      return;
    } catch (error) {
      const alreadyExists = isAlreadyExists(error);
      if (alreadyExists && !tempCreated) {
        continue;
      }
      if (tempCreated || !alreadyExists) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  throw new Error(`Unable to create temporary run report file for ${targetPath}.`);
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}

function redactRunReport(report: RunReport): RunReport {
  const rawOutputToolCallIds = new Set(
    report.toolCalls
      .filter((toolCall) => toolCall.rawOutput !== undefined)
      .map((toolCall) => toolCall.toolCallId),
  );

  return {
    ...report,
    toolCalls: report.toolCalls.map(redactToolCallSummary),
    errors: report.errors.map((error) =>
      error.toolCallId === undefined || !rawOutputToolCallIds.has(error.toolCallId)
        ? { ...error }
        : {
            ...error,
            message: "[redacted]",
          }
    ),
  };
}

function redactToolCallSummary(toolCall: ToolCallSummary): ToolCallSummary {
  return {
    ...toolCall,
    ...(toolCall.rawInput === undefined ? {} : { rawInput: "[redacted]" }),
    ...(toolCall.rawOutput === undefined ? {} : { rawOutput: "[redacted]" }),
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

  const safeOutput = output.length > 0 ? output : "run";
  if (safeOutput === value) {
    return safeOutput;
  }

  const fingerprint = createHash("sha256").update(value).digest("hex").slice(0, 10);
  return `${safeOutput}-${fingerprint}`;
}

async function assertReportsDirectoryContained(
  reportsDir: string,
  homeDir: string,
  fs: RunReportFileSystem,
): Promise<void> {
  if (fs.realpath === undefined) {
    return;
  }

  const [canonicalHome, canonicalReports] = await Promise.all([
    fs.realpath(homeDir),
    fs.realpath(reportsDir),
  ]);
  const relativeReportsPath = relative(canonicalHome, canonicalReports);
  if (
    relativeReportsPath === ".." ||
    relativeReportsPath.startsWith(`..${sep}`) ||
    isAbsolute(relativeReportsPath)
  ) {
    throw new Error("The reports directory must remain inside home state.");
  }
}

function escapeSummaryValue(value: string): string {
  return value.replaceAll("\r", "\\r").replaceAll("\n", "\\n");
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
