import path from "node:path";
import type { SessionUpdate } from "@poe-code/poe-acp-client";
import type { AcpEvent } from "./types.js";

export function mapAcpEventToSessionUpdates(event: AcpEvent): SessionUpdate[] {
  if (event.type === "message.delta") {
    if (event.content.length === 0) return [];
    return [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: event.content } }];
  }

  if (event.type === "tool.intent") {
    return [
      {
        sessionUpdate: "tool_call",
        toolCallId: event.intentId,
        title: event.tool,
        kind: "execute",
        status: "pending",
        rawInput: event.args,
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: event.intentId,
        kind: "execute",
        status: "in_progress",
      },
    ];
  }

  if (event.type === "tool.result") {
    return [
      {
        sessionUpdate: "tool_call_update",
        toolCallId: event.intentId,
        kind: "execute",
        status: "completed",
        rawOutput: event.result,
      },
    ];
  }

  if (event.type === "tool.error") {
    return [
      {
        sessionUpdate: "tool_call_update",
        toolCallId: event.intentId,
        kind: "execute",
        status: "failed",
        rawOutput: event.error,
      },
    ];
  }

  if (event.type === "usage") {
    const { inputTokens, outputTokens, cachedTokens, cacheCreationTokens } = event.usage;
    const nonCachedInput = Math.max(0, inputTokens - cachedTokens);
    return [
      {
        sessionUpdate: "usage_update",
        used: nonCachedInput,
        size: inputTokens,
        _meta: { inputTokens, outputTokens, cachedTokens, cacheCreationTokens },
      },
    ];
  }

  return [];
}

export interface TranscriptWriter {
  write(event: AcpEvent): Promise<void>;
  close(): Promise<void>;
  readonly filePath: string;
}

export interface TranscriptFsApi {
  mkdir(dir: string, options: { recursive: true }): Promise<void>;
  appendFile(path: string, contents: string): Promise<void>;
}

export interface CreateTranscriptWriterOptions {
  logPath?: string;
  logDir?: string;
  logFileName?: string;
  fs: TranscriptFsApi;
  pathJoin?: (...parts: string[]) => string;
}

export function createTranscriptWriter(
  options: CreateTranscriptWriterOptions,
): TranscriptWriter {
  const join = options.pathJoin ?? path.join;
  const filePath = resolveTranscriptFilePath(options, join);
  let dirEnsured: Promise<void> | undefined;
  let disabled = false;
  const logDir = path.dirname(filePath);

  const ensureDir = (): Promise<void> => {
    if (!dirEnsured) {
      dirEnsured = options.fs.mkdir(logDir, { recursive: true });
    }
    return dirEnsured;
  };

  return {
    filePath,
    async write(event: AcpEvent): Promise<void> {
      if (disabled) return;

      const updates = mapAcpEventToSessionUpdates(event);
      if (updates.length === 0) return;

      try {
        await ensureDir();
        const payload = updates.map(update => `${JSON.stringify(update)}\n`).join("");
        await options.fs.appendFile(filePath, payload);
      } catch {
        disabled = true;
      }
    },
    async close(): Promise<void> {
      // No persistent handle: appendFile opens/closes each write. Nothing to do.
    },
  };
}

function resolveTranscriptFilePath(
  options: CreateTranscriptWriterOptions,
  join: (...parts: string[]) => string,
): string {
  if (options.logPath) {
    return options.logPath;
  }

  if (options.logDir && options.logFileName) {
    return join(options.logDir, options.logFileName);
  }

  throw new Error("createTranscriptWriter requires logPath or logDir + logFileName.");
}
