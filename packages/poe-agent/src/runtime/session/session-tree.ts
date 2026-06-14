import { toToolMessageContent } from "../tool-results.js";
import type { ChatMessage } from "../types.js";
import type { SessionEntry } from "./entry-types.js";

export function buildMessages(entries: SessionEntry[], headId: string | null): ChatMessage[] {
  const branch = headId === null ? entries : collectBranch(entries, headId);
  const toolCalls = new Map<string, Extract<SessionEntry, { kind: "tool_call" }>>();
  const messages: ChatMessage[] = [];

  for (const entry of branch) {
    if (entry.kind === "user") {
      messages.push({ role: "user", content: entry.text });
      continue;
    }

    if (entry.kind === "assistant") {
      messages.push({ role: "assistant", content: entry.text });
      continue;
    }

    if (entry.kind === "tool_call") {
      toolCalls.set(entry.intentId, entry);
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: entry.intentId,
            type: "function",
            function: {
              name: entry.tool,
              arguments: stringifyToolArgs(entry.args)
            }
          }
        ]
      });
      continue;
    }

    if (entry.kind === "tool_result") {
      const toolCall = toolCalls.get(entry.intentId);
      messages.push({
        role: "tool",
        name: toolCall?.tool,
        toolCallId: entry.intentId,
        content:
          entry.error === undefined
            ? toToolMessageContent(entry.result)
            : `Error: ${entry.error}`
      });
      continue;
    }

    if (entry.kind === "compaction") {
      messages.push({
        role: "system",
        name: "compaction",
        content: `Compacted context summary:\n${entry.summary}`
      });
    }
  }

  return messages;
}

export function findHead(entries: SessionEntry[]): string | null {
  return entries.at(-1)?.id ?? null;
}

export function collectBranch(entries: SessionEntry[], headId: string): SessionEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const branch: SessionEntry[] = [];
  let currentId: string | null = headId;

  while (currentId !== null) {
    const entry = byId.get(currentId);
    if (!entry) {
      break;
    }

    branch.push(entry);
    currentId = entry.parentId;
  }

  return branch.reverse();
}

function stringifyToolArgs(args: unknown): string {
  if (typeof args === "string") {
    return args;
  }

  return JSON.stringify(args);
}
