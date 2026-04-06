import type { AcpEvent } from "../acp/types.js";
import { truncate, isNonEmptyString, extractThreadId } from "./utils.js";

type CodexEvent = {
  type?: unknown;
  thread_id?: unknown;
  threadId?: unknown;
  threadID?: unknown;
  session_id?: unknown;
  sessionId?: unknown;
  sessionID?: unknown;
  usage?: unknown;
  item?: unknown;
  error?: unknown;
  message?: unknown;
  reason?: unknown;
};

type CodexItem = {
  id?: unknown;
  type?: unknown;
  command?: unknown;
  path?: unknown;
  text?: unknown;
  content?: unknown;
  summary?: unknown;
  server?: unknown;
  tool?: unknown;
  arguments?: unknown;
  result?: unknown;
};

export async function* adaptCodex(
  lines: AsyncIterable<string>
): AsyncGenerator<AcpEvent> {
  const toolTitleById = new Map<string, string>();
  const toolKindById = new Map<string, string>();

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let event: CodexEvent;
    try {
      event = JSON.parse(line) as CodexEvent;
    } catch (error) {
      const stack = error instanceof Error ? error.stack : undefined;
      yield {
        event: "error",
        message: `[adaptCodex] Malformed JSON line: ${truncate(line, 200)}`,
        stack
      };
      continue;
    }

    const eventType = event.type;
    if (!isNonEmptyString(eventType)) continue;

    if (eventType === "thread.started") {
      const maybeThreadId = extractThreadId(event);
      yield { event: "session_start", threadId: maybeThreadId };
      continue;
    }

    if (eventType === "turn.started") {
      continue;
    }

    if (eventType === "turn.completed") {
      const usage = (event.usage ?? {}) as {
        input_tokens?: unknown;
        output_tokens?: unknown;
        cached_input_tokens?: unknown;
      };

      const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
      const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
      const cachedTokens =
        typeof usage.cached_input_tokens === "number" ? usage.cached_input_tokens : 0;

      yield { event: "usage", inputTokens, outputTokens, cachedTokens };
      continue;
    }

    if (eventType === "turn.failed") {
      const message = extractErrorMessage(event) ?? "Turn failed";
      yield { event: "error", message };
      continue;
    }

    const item = (event.item ?? null) as CodexItem | null;
    if (!item || typeof item !== "object") continue;

    const itemType = item.type;
    if (!isNonEmptyString(itemType)) continue;

    if (eventType === "item.started") {
      if (!isNonEmptyString(item.id)) continue;

      let kind: string | undefined;
      let title: string | undefined;

      if (itemType === "command_execution") {
        kind = "exec";
        title = truncate(isNonEmptyString(item.command) ? item.command : "", 80);
      } else if (itemType === "file_edit") {
        kind = "edit";
        title = isNonEmptyString(item.path) ? item.path : "";
      } else if (itemType === "thinking") {
        kind = "think";
        title = "thinking...";
      } else if (itemType === "mcp_tool_call") {
        const server = isNonEmptyString(item.server) ? item.server : "unknown";
        const tool = isNonEmptyString(item.tool) ? item.tool : "unknown";
        kind = "other";
        title = `${server}.${tool}`;
      }

      if (kind && title !== undefined) {
        toolTitleById.set(item.id, title);
        toolKindById.set(item.id, kind);
        yield { event: "tool_start", id: item.id, kind, title };
      }
      continue;
    }

    if (eventType === "item.completed") {
      if (itemType === "agent_message") {
        if (!isNonEmptyString(item.text)) continue;
        yield { event: "agent_message", text: item.text };
        continue;
      }

      if (itemType === "reasoning") {
        const text = isNonEmptyString(item.text)
          ? item.text
          : isNonEmptyString(item.content)
            ? item.content
            : isNonEmptyString(item.summary)
              ? item.summary
              : undefined;
        if (!text) continue;
        yield { event: "reasoning", text };
        continue;
      }

      if (!isNonEmptyString(item.id)) continue;

      if (itemType === "command_execution" || itemType === "file_edit" || itemType === "mcp_tool_call") {
        const kindFromStart = toolKindById.get(item.id);
        const kind =
          kindFromStart ??
          (itemType === "command_execution"
            ? "exec"
            : itemType === "file_edit"
              ? "edit"
              : "other");

        const titleFromEvent = isNonEmptyString(item.path)
          ? item.path
          : itemType === "mcp_tool_call"
            ? `${isNonEmptyString(item.server) ? item.server : "unknown"}.${isNonEmptyString(item.tool) ? item.tool : "unknown"}`
            : undefined;
        const path = titleFromEvent ?? toolTitleById.get(item.id) ?? "";

        toolTitleById.delete(item.id);
        toolKindById.delete(item.id);

        yield { event: "tool_complete", id: item.id, kind, path };
      }
    }
  }
}

function extractErrorMessage(event: CodexEvent): string | undefined {
  if (isNonEmptyString(event.message)) return event.message;

  const error = event.error;
  if (isNonEmptyString(error)) return error;
  if (typeof error === "object" && error !== null) {
    const errorObj = error as { message?: unknown };
    if (isNonEmptyString(errorObj.message)) return errorObj.message;
  }

  if (isNonEmptyString(event.reason)) return event.reason;
  return undefined;
}
