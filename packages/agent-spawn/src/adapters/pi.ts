import type { AcpEvent } from "../acp/types.js";
import { isNonEmptyString, truncate } from "./utils.js";

type TrackedTool = {
  kind: string;
  title: string;
};

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toolKind(toolName: string): string {
  const normalized = toolName.toLowerCase();
  if (normalized === "bash" || normalized === "shell") return "exec";
  if (normalized === "read") return "read";
  if (normalized === "edit" || normalized === "write") return "edit";
  if (normalized === "grep" || normalized === "find" || normalized === "ls") return "search";
  return "other";
}

function toolTitle(toolName: string, args: unknown): string {
  const values = asObject(args);
  if (!values) return toolName;
  const title = values.command ?? values.path ?? values.file_path;
  return isNonEmptyString(title) ? truncate(title, 80) : toolName;
}

function resultText(result: unknown): string {
  if (result === undefined || result === null) return "";
  if (typeof result === "string") return result;
  if (typeof result === "number" || typeof result === "boolean" || typeof result === "bigint") {
    return String(result);
  }

  const objectResult = asObject(result);
  if (!objectResult) return "";

  const content = objectResult.content;
  if (!Array.isArray(content)) return "";

  return content
    .map((item) => {
      const part = asObject(item);
      return part && isNonEmptyString(part.text) ? part.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function toolCompletePath(
  toolName: string,
  args: unknown,
  result: unknown,
  tracked: TrackedTool | undefined
): string {
  const preferred = tracked?.title ?? toolTitle(toolName, args);
  if (preferred !== toolName) return preferred;
  const text = resultText(result);
  return text.length > 0 ? truncate(text, 80) : toolName;
}

function readUsage(usage: unknown): {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  costUsd?: number;
} | undefined {
  const values = asObject(usage);
  if (!values) return undefined;

  const cost = asObject(values.cost);
  return {
    inputTokens: typeof values.input === "number" ? values.input : 0,
    outputTokens: typeof values.output === "number" ? values.output : 0,
    ...(typeof values.cacheRead === "number" ? { cachedTokens: values.cacheRead } : {}),
    ...(cost && typeof cost.total === "number" ? { costUsd: cost.total } : {})
  };
}

export async function* adaptPi(lines: AsyncIterable<string>): AsyncGenerator<AcpEvent> {
  const tools = new Map<string, TrackedTool>();
  let threadId: string | undefined;
  let sawError = false;
  let lastUsage:
    | {
        inputTokens: number;
        outputTokens: number;
        cachedTokens?: number;
        costUsd?: number;
      }
    | undefined;

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      event = parsed as Record<string, unknown>;
    } catch (error) {
      sawError = true;
      yield {
        event: "error",
        message: `[adaptPi] Malformed JSON line: ${truncate(line, 200)}`,
        stack: error instanceof Error ? error.stack : undefined
      };
      continue;
    }

    const type = event.type;
    if (!isNonEmptyString(type)) continue;

    if (type === "session") {
      if (!isNonEmptyString(event.id)) continue;
      if (!threadId) {
        threadId = event.id;
        yield { event: "session_start", threadId: event.id };
      }
      continue;
    }

    if (type === "message_update") {
      const update = asObject(event.assistantMessageEvent);
      if (!update) continue;
      if (update.type === "text_delta" && isNonEmptyString(update.delta)) {
        yield { event: "agent_message", text: update.delta };
      } else if (update.type === "thinking_delta" && isNonEmptyString(update.delta)) {
        yield { event: "reasoning", text: update.delta };
      } else if (update.type === "error") {
        sawError = true;
        yield {
          event: "error",
          message: isNonEmptyString(update.reason) ? update.reason : "Pi agent error"
        };
      }
      continue;
    }

    if (type === "message_end") {
      const message = asObject(event.message);
      if (!message || message.role !== "assistant") continue;
      const usage = readUsage(message.usage);
      if (!usage) continue;
      lastUsage = usage;
      yield { event: "usage", ...usage };
      continue;
    }

    if (type === "tool_execution_start") {
      if (!isNonEmptyString(event.toolCallId) || !isNonEmptyString(event.toolName)) continue;
      const kind = toolKind(event.toolName);
      const title = toolTitle(event.toolName, event.args);
      tools.set(event.toolCallId, { kind, title });
      yield {
        event: "tool_start",
        id: event.toolCallId,
        kind,
        title,
        input: event.args
      };
      continue;
    }

    if (type === "tool_execution_end") {
      if (!isNonEmptyString(event.toolCallId) || !isNonEmptyString(event.toolName)) continue;
      const tracked = tools.get(event.toolCallId);
      tools.delete(event.toolCallId);
      yield {
        event: "tool_complete",
        id: event.toolCallId,
        kind: tracked?.kind ?? toolKind(event.toolName),
        path: toolCompletePath(event.toolName, event.args, event.result, tracked),
        ...(event.isError === true ? { _meta: { failed: true } } : {})
      };
      continue;
    }

    if (type === "agent_end") {
      yield {
        event: "spawn_result",
        exitCode: sawError || event.willRetry === true ? 1 : 0,
        ...(threadId ? { threadId } : {}),
        ...(lastUsage ? { usage: lastUsage } : {})
      };
    }
  }
}
