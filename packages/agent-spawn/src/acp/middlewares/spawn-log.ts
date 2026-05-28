import path from "node:path";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import { ensureSafeDefaultSpawnLogDir, getDefaultSpawnLogDir } from "../spawn-log-path.js";
import type { AcpEvent } from "../types.js";
import type { AcpMiddleware, SpawnContext } from "../middleware.js";

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

function resolveLogFilePath(ctx: SpawnContext): string {
  if (ctx.logPath) {
    return ctx.logPath;
  }
  const baseDir = ctx.logDir ?? getDefaultSpawnLogDir();
  if (ctx.logFileName) {
    return path.join(baseDir, ctx.logFileName);
  }
  const startedAt = resolveStartedAt(ctx.startedAt);
  const { day, time, milliseconds } = formatTimestamp(startedAt);
  const fileName = `${day}-${time}-${milliseconds}-${normalizeAgent(ctx.agent)}.jsonl`;
  return path.join(baseDir, fileName);
}

class SpawnLogWriter {
  private fileHandle: FileHandle | undefined;

  private isDisabled = false;

  readonly filePath: string;

  private readonly logDirPath: string;

  private readonly usesDefaultLogDir: boolean;

  constructor(ctx: SpawnContext) {
    this.filePath = resolveLogFilePath(ctx);
    this.logDirPath = path.dirname(this.filePath);
    this.usesDefaultLogDir = ctx.logPath === undefined && ctx.logDir === undefined;
  }

  async writeEvent(event: AcpEvent): Promise<void> {
    if (this.isDisabled) {
      return;
    }

    try {
      await this.ensureOpen();
      if (!this.fileHandle) {
        return;
      }

      const meta = (event as { _meta?: Record<string, unknown> })._meta;
      const toLog = meta?.raw ?? event;
      await this.fileHandle.appendFile(`${JSON.stringify(toLog)}\n`, "utf8");
    } catch {
      this.isDisabled = true;
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
    if (this.fileHandle || this.isDisabled) {
      return;
    }

    try {
      if (this.usesDefaultLogDir) {
        await ensureSafeDefaultSpawnLogDir(true);
      } else {
        await mkdir(this.logDirPath, { recursive: true });
      }
      this.fileHandle = await open(this.filePath, "a");
    } catch {
      this.isDisabled = true;
    }
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
  ctx.logFile = writer.filePath;

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
