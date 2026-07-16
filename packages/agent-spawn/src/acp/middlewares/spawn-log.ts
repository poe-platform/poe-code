import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import { ensureSafeDefaultSpawnLogDir, getDefaultSpawnLogDir } from "../spawn-log-path.js";
import type { AcpEvent } from "../types.js";
import type { AcpMiddleware, SpawnContext } from "../middleware.js";

const REDACTED_LOG_CONTENT = "[redacted]";

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function formatTimestamp(date: Date): { day: string; time: string; milliseconds: string } {
  const day = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCDate(), 2)}`;
  const time = `${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}${pad(date.getUTCSeconds(), 2)}`;
  const milliseconds = pad(date.getUTCMilliseconds(), 3);
  return { day, time, milliseconds };
}

function normalizeAgent(agent: string): string {
  let normalized = "";
  for (const char of agent) {
    const code = char.charCodeAt(0);
    const isLower = code >= 97 && code <= 122;
    const isUpper = code >= 65 && code <= 90;
    const isDigit = code >= 48 && code <= 57;

    if (isLower || isUpper || isDigit || char === "-" || char === "_") {
      normalized += char;
    } else {
      normalized += "-";
    }
  }

  return normalized.length > 0 ? normalized : "agent";
}

function resolveStartedAt(value: Date | undefined): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return new Date();
  }

  return value;
}

function isSafeLogFileName(fileName: string): boolean {
  return (
    fileName.length > 0 &&
    !path.isAbsolute(fileName) &&
    !path.win32.isAbsolute(fileName) &&
    path.basename(fileName) === fileName &&
    path.win32.basename(fileName) === fileName
  );
}

function resolveLogFilePath(ctx: SpawnContext): string | undefined {
  if (ctx.logPath) {
    return ctx.logPath;
  }
  const baseDir = ctx.logDir ?? getDefaultSpawnLogDir();
  if (ctx.logFileName) {
    if (!isSafeLogFileName(ctx.logFileName)) {
      return undefined;
    }
    return path.join(baseDir, ctx.logFileName);
  }
  const startedAt = resolveStartedAt(ctx.startedAt);
  const { day, time, milliseconds } = formatTimestamp(startedAt);
  const sessionSuffix =
    ctx.sessionId.length > 0 && ctx.sessionId !== "unknown"
      ? `-${normalizeAgent(ctx.sessionId)}`
      : `-${randomUUID()}`;
  const fileName = `${day}-${time}-${milliseconds}-${normalizeAgent(ctx.agent)}${sessionSuffix}.jsonl`;
  return path.join(baseDir, fileName);
}

function describeLogFailure(filePath: string, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `Spawn log could not be written to ${filePath}: ${reason}`;
}

class SpawnLogWriter {
  private fileHandle: FileHandle | undefined;

  private isDisabled = false;

  readonly filePath: string | undefined;

  private readonly ctx: SpawnContext;

  private readonly logDirPath: string;

  private readonly usesDefaultLogDir: boolean;

  private readonly includeContent: boolean;

  constructor(ctx: SpawnContext) {
    this.ctx = ctx;
    this.filePath = resolveLogFilePath(ctx);
    this.logDirPath = this.filePath ? path.dirname(this.filePath) : "";
    this.usesDefaultLogDir = ctx.logPath === undefined && ctx.logDir === undefined;
    this.includeContent = ctx.logContent === true;
  }

  async writeEvent(event: AcpEvent): Promise<void> {
    if (this.isDisabled) {
      return;
    }

    if (!this.filePath) {
      return;
    }

    let previousSize: number | undefined;
    try {
      await this.ensureOpen();
      if (!this.fileHandle) {
        return;
      }

      const eventForLog = prepareEventForLog(event, this.includeContent);
      previousSize = (await this.fileHandle.stat()).size;
      await this.fileHandle.appendFile(`${JSON.stringify(eventForLog)}\n`, "utf8");
    } catch (error) {
      this.isDisabled = true;
      this.ctx.logError ??= describeLogFailure(this.filePath, error);
      if (this.fileHandle && previousSize !== undefined) {
        try {
          await this.fileHandle.truncate(previousSize);
        } catch (error) {
          await this.close();
          throw new Error("failed to restore ACP spawn log after append failure", { cause: error });
        }
      }
      await this.close();
    }
  }

  async close(): Promise<void> {
    if (!this.fileHandle) {
      return;
    }

    try {
      await this.fileHandle.close();
    } catch {
      // Ignore close errors to avoid disrupting event processing.
    } finally {
      this.fileHandle = undefined;
    }
  }

  private async ensureOpen(): Promise<void> {
    const filePath = this.filePath;
    if (this.fileHandle || this.isDisabled || !filePath) {
      return;
    }

    try {
      if (this.usesDefaultLogDir) {
        await ensureSafeDefaultSpawnLogDir(true);
      } else {
        await mkdir(this.logDirPath, { recursive: true });
      }
      this.fileHandle = await open(filePath, "a");
    } catch (error) {
      this.isDisabled = true;
      this.ctx.logError ??= describeLogFailure(filePath, error);
      if (this.ctx.logFile === filePath) {
        delete this.ctx.logFile;
      }
    }
  }
}

function stripRawMeta(event: AcpEvent): AcpEvent {
  const meta = event._meta;
  if (!meta || !Object.hasOwn(meta, "raw")) {
    return event;
  }

  const metaWithoutRaw = Object.fromEntries(
    Object.entries(meta).filter(([key]) => key !== "raw")
  );
  const eventWithoutRaw = { ...event };
  if (Object.keys(metaWithoutRaw).length > 0) {
    eventWithoutRaw._meta = metaWithoutRaw;
  } else {
    delete eventWithoutRaw._meta;
  }
  return eventWithoutRaw;
}

function prepareEventForLog(event: AcpEvent, includeContent: boolean): AcpEvent {
  const eventWithoutRaw = stripRawMeta(event);
  if (includeContent) {
    return eventWithoutRaw;
  }

  const redacted = { ...eventWithoutRaw } as Record<string, unknown>;

  if (redacted.event === "agent_message" || redacted.event === "reasoning") {
    redactField(redacted, "text");
  }

  if (redacted.event === "tool_start") {
    redactField(redacted, "title");
    redactField(redacted, "input");
  }

  if (redacted.event === "tool_complete") {
    redactField(redacted, "path");
  }

  return redacted as AcpEvent;
}

function redactField(event: Record<string, unknown>, key: string): void {
  if (Object.hasOwn(event, key)) {
    event[key] = REDACTED_LOG_CONTENT;
  }
}

async function writePreloadedEvents(writer: SpawnLogWriter, events: AcpEvent[]): Promise<void> {
  for (const event of events) {
    await writer.writeEvent(event);
  }
}

export const spawnLog: AcpMiddleware = async (ctx, next) => {
  await next();

  const source = ctx.eventStream;
  const writer = new SpawnLogWriter(ctx);
  if (writer.filePath) {
    ctx.logFile = writer.filePath;
  }

  await writePreloadedEvents(writer, ctx.events);

  if (!source) {
    await writer.close();
    return;
  }

  ctx.eventStream = (async function* () {
    try {
      for await (const event of source) {
        await writer.writeEvent(event);
        yield event;
      }
    } finally {
      await writer.close();
    }
  })();
};
