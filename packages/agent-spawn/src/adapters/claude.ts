import type { AcpEvent } from "../acp/types.js";
import { truncate, isNonEmptyString, extractThreadId } from "./utils.js";

export const TOOL_KIND_MAP: Record<string, string> = {
  Read: "read",
  Write: "edit",
  Edit: "edit",
  NotebookEdit: "edit",
  Bash: "exec",
  Glob: "search",
  Grep: "search",
  Task: "think"
};

type ClaudeEvent = {
  type?: unknown;
  message?: unknown;
  thread_id?: unknown;
  threadId?: unknown;
  threadID?: unknown;
  session_id?: unknown;
  sessionId?: unknown;
  sessionID?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
  num_input_tokens?: unknown;
  num_output_tokens?: unknown;
  cost_usd?: unknown;
  usage?: unknown;
};

type ClaudeMessage = {
  content?: unknown;
};

type ClaudeContentBlock = {
  type?: unknown;
  text?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  content?: unknown;
};

const TITLE_KEYS: Record<string, string[]> = {
  Bash: ["command"],
  Read: ["file_path"],
  Write: ["file_path"],
  Edit: ["file_path"],
  NotebookEdit: ["notebook_path"],
  Glob: ["pattern"],
  Grep: ["pattern"],
  Task: ["description", "prompt"]
};

function extractTitle(name: string, input: unknown): string {
  const keys = TITLE_KEYS[name];
  if (keys && input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === "string" && value.length > 0) {
        return truncate(value, 80);
      }
    }
  }
  return name;
}

export async function* adaptClaude(
  lines: AsyncIterable<string>
): AsyncGenerator<AcpEvent> {
  const toolKindsById = new Map<string, string>();
  let emittedSessionStart = false;

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Claude Code can emit non-JSON informational lines (especially in verbose mode).
    // Ignore lines that don't look like JSON to avoid polluting output with adapter errors.
    const firstChar = line[0];
    if (firstChar !== "{" && firstChar !== "[") {
      continue;
    }

    let event: ClaudeEvent;
    try {
      event = JSON.parse(line) as ClaudeEvent;
    } catch (error) {
      const stack = error instanceof Error ? error.stack : undefined;
      yield {
        event: "error",
        message: `[adaptClaude] Malformed JSON line: ${truncate(line, 200)}`,
        stack
      };
      continue;
    }

    const eventType = event.type;
    if (!isNonEmptyString(eventType)) continue;

    if (!emittedSessionStart) {
      const threadId = extractThreadId(event);
      emittedSessionStart = true;
      yield { event: "session_start", threadId };
    }

    if (eventType === "result") {
      const denials = (event as { permission_denials?: unknown }).permission_denials;
      if (Array.isArray(denials)) {
        for (const denial of denials) {
          const entry = denial as { tool_name?: unknown; tool_input?: unknown };
          if (!isNonEmptyString(entry.tool_name)) continue;
          yield {
            event: "permission_rejected",
            title: extractTitle(entry.tool_name, entry.tool_input)
          };
        }
      }

      const usage = (event.usage ?? {}) as {
        input_tokens?: unknown;
        output_tokens?: unknown;
        cost_usd?: unknown;
      };

      const inputTokens =
        typeof usage.input_tokens === "number"
          ? usage.input_tokens
          : typeof event.input_tokens === "number"
            ? event.input_tokens
            : typeof event.num_input_tokens === "number"
              ? event.num_input_tokens
             : 0;
      const outputTokens =
        typeof usage.output_tokens === "number"
          ? usage.output_tokens
          : typeof event.output_tokens === "number"
            ? event.output_tokens
            : typeof event.num_output_tokens === "number"
              ? event.num_output_tokens
            : 0;
      const costUsd =
        typeof usage.cost_usd === "number"
          ? usage.cost_usd
          : typeof event.cost_usd === "number"
            ? event.cost_usd
            : undefined;

      yield { event: "usage", inputTokens, outputTokens, costUsd };
      continue;
    }

    if (eventType !== "assistant" && eventType !== "user") continue;

    const message = (event.message ?? null) as ClaudeMessage | null;
    if (!message || typeof message !== "object") continue;

    const content = (message.content ?? null) as unknown;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      const item = block as ClaudeContentBlock;
      if (!item || typeof item !== "object") continue;

      const blockType = item.type;
      if (!isNonEmptyString(blockType)) continue;

      if (eventType === "assistant") {
        if (blockType === "text" && isNonEmptyString(item.text)) {
          yield {
            event: "agent_message",
            text: item.text
          };
          continue;
        }

        if (blockType === "tool_use" && isNonEmptyString(item.id) && isNonEmptyString(item.name)) {
          const kind = TOOL_KIND_MAP[item.name] ?? "other";
          toolKindsById.set(item.id, kind);

          yield {
            event: "tool_start",
            id: item.id,
            kind,
            title: extractTitle(item.name, item.input),
            input: item.input
          };
        }

        continue;
      }

      if (eventType === "user") {
        if (!isNonEmptyString(item.tool_use_id)) continue;
        if (blockType !== "tool_result") continue;

        const kind = toolKindsById.get(item.tool_use_id);
        toolKindsById.delete(item.tool_use_id);

        let path: string;
        if (typeof item.content === "string") {
          path = item.content;
        } else {
          try {
            path = JSON.stringify(item.content);
          } catch {
            path = String(item.content);
          }
        }

        yield {
          event: "tool_complete",
          id: item.tool_use_id,
          kind,
          path
        };
      }
    }
  }
}
