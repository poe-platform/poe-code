import type { AcpEvent } from "../acp/types.js";
import { truncate } from "./utils.js";

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => asObject(part)?.text)
    .filter((text): text is string => typeof text === "string")
    .join("");
}

function toolInfo(event: Record<string, unknown>): {
  kind: string;
  title: string;
  path: string;
} {
  const toolCall = asObject(event.tool_call) ?? asObject(event.toolCall) ?? {};
  const [toolName = "tool", rawTool = {}] = Object.entries(toolCall)[0] ?? [];
  const tool = asObject(rawTool) ?? {};
  const args = asObject(tool.args) ?? asObject(tool.arguments) ?? tool;
  const path = typeof args.path === "string" ? args.path : "";
  const kinds: Record<string, string> = {
    editToolCall: "edit",
    readToolCall: "read",
    shellToolCall: "exec",
    bashToolCall: "exec"
  };
  return { kind: kinds[toolName] ?? "other", title: path || toolName, path };
}

export async function* adaptCursor(lines: AsyncIterable<string>): AsyncGenerator<AcpEvent> {
  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch (error) {
      yield {
        event: "error",
        message: `[adaptCursor] Malformed JSON line: ${truncate(line, 200)}`,
        stack: error instanceof Error ? error.stack : undefined
      };
      continue;
    }
    const type = event.type;
    if ((type === "system" || type === "init") && typeof event.session_id === "string") {
      yield { event: "session_start", threadId: event.session_id };
      continue;
    }
    if (type === "thinking") {
      const text = typeof event.delta === "string" ? event.delta : textContent(event.content);
      if (text) yield { event: "reasoning", text };
      continue;
    }
    if (type === "assistant") {
      const text = textContent(event.content ?? asObject(event.message)?.content);
      if (text) yield { event: "agent_message", text };
      continue;
    }
    if (type === "tool_call") {
      const info = toolInfo(event);
      const id = typeof event.call_id === "string" ? event.call_id : undefined;
      if (event.subtype === "started") {
        yield { event: "tool_start", kind: info.kind, title: info.title, id };
      } else if (event.subtype === "completed") {
        yield { event: "tool_complete", kind: info.kind, path: info.path, id };
      }
      continue;
    }
    if (type === "result") {
      const usageValue = asObject(event.usage) ?? {};
      const inputTokens = typeof usageValue.inputTokens === "number" ? usageValue.inputTokens : 0;
      const outputTokens = typeof usageValue.outputTokens === "number" ? usageValue.outputTokens : 0;
      const cachedTokens = typeof usageValue.cacheReadTokens === "number" ? usageValue.cacheReadTokens : undefined;
      const usage = { inputTokens, outputTokens, ...(cachedTokens === undefined ? {} : { cachedTokens }) };
      if (event.is_error === true) {
        yield { event: "error", message: typeof event.result === "string" ? event.result : "Cursor agent failed." };
      }
      yield {
        event: "usage",
        ...usage,
        _meta: typeof usageValue.cacheWriteTokens === "number"
          ? { cacheWriteTokens: usageValue.cacheWriteTokens }
          : undefined
      };
      yield {
        event: "spawn_result",
        exitCode: event.is_error === true ? 1 : 0,
        threadId: typeof event.session_id === "string" ? event.session_id : undefined,
        usage
      };
      continue;
    }
    if (typeof type === "string") yield { event: type, ...event };
  }
}
