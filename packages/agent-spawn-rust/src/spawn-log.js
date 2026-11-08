import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { native } from "./native.js";
import { ensureSafeDefaultSpawnLogDir, getDefaultSpawnLogDir } from "./spawn-log-path.js";
const REDACTED_LOG_CONTENT = "[redacted]";
function resolveStartedAt(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return new Date();
  }
  return value;
}
function isSafeLogFileName(fileName) {
  return (
    fileName.length > 0 &&
    !path.isAbsolute(fileName) &&
    !path.win32.isAbsolute(fileName) &&
    path.basename(fileName) === fileName &&
    path.win32.basename(fileName) === fileName
  );
}
function resolveLogFilePath(ctx) {
  if (ctx.logPath) return ctx.logPath;
  const baseDir = ctx.logDir ?? getDefaultSpawnLogDir();
  if (ctx.logFileName)
    return isSafeLogFileName(ctx.logFileName) ? path.join(baseDir, ctx.logFileName) : undefined;
  const date = resolveStartedAt(ctx.startedAt);
  const parts = [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds()
  ].map(String);
  const uuid = ctx.sessionId.length > 0 && ctx.sessionId !== "unknown" ? "" : randomUUID();
  return path.join(baseDir, native.spawnLogFilename(parts, ctx.agent, ctx.sessionId, uuid));
}
function describeLogFailure(filePath, error) {
  const reason = error instanceof Error ? error.message : String(error);
  return `Spawn log could not be written to ${filePath}: ${reason}`;
}
class SpawnLogWriter {
  fileHandle;
  size;
  tracksSize;
  isDisabled = false;
  filePath;
  ctx;
  logDirPath;
  usesDefaultLogDir;
  includeContent;
  constructor(ctx) {
    this.ctx = ctx;
    // UUID-named run logs have one writer; explicit or session-named paths may be shared.
    this.tracksSize =
      !ctx.logPath &&
      !ctx.logFileName &&
      (ctx.sessionId.length === 0 || ctx.sessionId === "unknown");
    this.filePath = resolveLogFilePath(ctx);
    this.logDirPath = this.filePath ? path.dirname(this.filePath) : "";
    this.usesDefaultLogDir = ctx.logPath === undefined && ctx.logDir === undefined;
    this.includeContent = ctx.logContent === true;
  }
  async writeEvent(event) {
    if (this.isDisabled) {
      return;
    }
    if (!this.filePath) {
      return;
    }
    let previousSize;
    try {
      await this.ensureOpen();
      if (!this.fileHandle) {
        return;
      }
      const eventForLog = prepareEventForLog(event, this.includeContent);
      previousSize =
        this.tracksSize && this.size !== undefined
          ? this.size
          : (await this.fileHandle.stat()).size;
      const line = `${JSON.stringify(eventForLog)}\n`;
      await this.fileHandle.appendFile(line, "utf8");
      if (this.tracksSize) this.size = previousSize + Buffer.byteLength(line, "utf8");
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
  async close() {
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
  async ensureOpen() {
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
function stripRawMeta(event) {
  const meta = event._meta;
  if (!meta || !Object.hasOwn(meta, "raw")) {
    return event;
  }
  const metaWithoutRaw = Object.fromEntries(Object.entries(meta).filter(([key]) => key !== "raw"));
  const eventWithoutRaw = { ...event };
  if (Object.keys(metaWithoutRaw).length > 0) {
    eventWithoutRaw._meta = metaWithoutRaw;
  } else {
    delete eventWithoutRaw._meta;
  }
  return eventWithoutRaw;
}
function prepareEventForLog(event, includeContent) {
  const clean = stripRawMeta(event);
  if (includeContent) return clean;
  const redacted = { ...clean };
  for (const key of native.spawnLogRedactedFields(
    typeof redacted.event === "string" ? redacted.event : ""
  ))
    redactField(redacted, key);
  return redacted;
}
function redactField(event, key) {
  if (Object.hasOwn(event, key)) {
    event[key] = REDACTED_LOG_CONTENT;
  }
}
export const spawnLog = async (ctx, next) => {
  await next();
  const source = ctx.eventStream;
  const writer = new SpawnLogWriter(ctx);
  if (writer.filePath) {
    ctx.logFile = writer.filePath;
  }
  for (const event of ctx.events) await writer.writeEvent(event);
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
