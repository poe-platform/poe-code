import type { AcpEvent, PlanEvent } from "../acp/types.js";
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
  status?: unknown;
  exit_code?: unknown;
  changes?: unknown;
  query?: unknown;
  message?: unknown;
  items?: unknown;
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

    if (eventType === "turn.failed" || eventType === "error") {
      const message = extractErrorMessage(event) ?? "Turn failed";
      yield { event: "error", message };
      continue;
    }

    const item = (event.item ?? null) as CodexItem | null;
    if (!item || typeof item !== "object") continue;

    const itemType = item.type;
    if (!isNonEmptyString(itemType)) continue;

    if (itemType === "todo_list" && ["item.started", "item.updated", "item.completed"].includes(eventType)) {
      if (!Array.isArray(item.items) || !item.items.every((entry: unknown) => entry !== null && typeof entry === "object"
        && typeof (entry as { text?: unknown }).text === "string" && typeof (entry as { completed?: unknown }).completed === "boolean")) continue;
      const entries: PlanEvent["entries"] = item.items.map((entry: { text: string; completed: boolean }) => ({
        content: entry.text, status: entry.completed ? "completed" : "pending", priority: "medium"
      }));
      yield { event: "plan", ...(isNonEmptyString(item.id) ? { id: item.id } : {}), entries };
      continue;
    }

    if (isNonEmptyString(item.id) && (eventType === "item.started" || (eventType === "item.completed" && !toolKindById.has(item.id)))) {

      let kind: string | undefined;
      let title: string | undefined;
      let input: unknown;

      if (itemType === "command_execution") {
        kind = "exec";
        title = truncate(isNonEmptyString(item.command) ? item.command : "", 80);
        input = { command: item.command };
      } else if (itemType === "file_edit") {
        kind = "edit";
        title = isNonEmptyString(item.path) ? item.path : "";
      } else if (itemType === "file_change") {
        kind = "edit";
        title = Array.isArray(item.changes)
          ? item.changes.flatMap((change: unknown) => {
              if (!change || typeof change !== "object") return [];
              const file = (change as { path?: unknown }).path;
              return isNonEmptyString(file) ? [file] : [];
            }).join(", ")
          : "files";
      } else if (itemType === "web_search") {
        kind = "search";
        title = isNonEmptyString(item.query) ? item.query : "web";
        input = { query: item.query };
      } else if (itemType === "thinking") {
        kind = "think";
        title = "thinking...";
      } else if (itemType === "mcp_tool_call") {
        const server = isNonEmptyString(item.server) ? item.server : "unknown";
        const tool = isNonEmptyString(item.tool) ? item.tool : "unknown";
        kind = "other";
        title = `${server}.${tool}`;
        input = item.arguments;
      }

      if (kind && title !== undefined) {
        toolTitleById.set(item.id, title);
        toolKindById.set(item.id, kind);
        yield { event: "tool_start", id: item.id, kind, title, ...(input !== undefined ? { input } : {}) };
      }
      if (eventType === "item.started") continue;
    }

    if (eventType === "item.completed") {
      if (itemType === "error" && isNonEmptyString(item.message)) {
        yield { event: "error", message: item.message };
        continue;
      }
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

      if (toolKindById.has(item.id)) {
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

        const status = item.status === "declined" || item.status === "cancelled"
          ? "cancelled"
          : item.status === "failed" || (typeof item.exit_code === "number" && item.exit_code !== 0)
            ? "failed"
            : item.status === "completed" || item.exit_code === 0 ? "completed" : undefined;
        yield { event: "tool_complete", id: item.id, kind, path, ...(status ? { status } : {}) };
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
