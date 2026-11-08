import { toToolMessageContent } from "./tool-results.js";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./poe-agent-rust.node");
export function buildMessages(entries, headId) {
  const branch = headId === null ? entries : collectBranch(entries, headId);
  const toolCalls = new Map();
  const messages = [];
  for (const entry of branch) {
    const kind = native.sessionEntryKind(entry);
    if (kind === 1) {
      messages.push({ role: "user", content: entry.text });
      continue;
    }
    if (kind === 2) {
      messages.push({ role: "assistant", content: entry.text });
      continue;
    }
    if (kind === 3) {
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
    if (kind === 4) {
      const toolCall = toolCalls.get(entry.intentId);
      messages.push({
        role: "tool",
        name: toolCall?.tool,
        toolCallId: entry.intentId,
        content:
          entry.error === undefined ? toToolMessageContent(entry.result) : `Error: ${entry.error}`
      });
      continue;
    }
    if (kind === 5) {
      messages.push({
        role: "system",
        name: "compaction",
        content: `Compacted context summary:\n${entry.summary}`
      });
    }
  }
  return messages;
}
export function findHead(entries) {
  return entries.at(-1)?.id ?? null;
}
export function collectBranch(entries, headId) {
  const pool = [];
  const names = entries.map((entry) => {
    pool.push(entry);
    return entry.id;
  });
  return native.sessionCollectBranch(pool, names, headId).map((index) => pool[index]);
}
function stringifyToolArgs(args) {
  if (typeof args === "string") {
    return args;
  }
  return JSON.stringify(args);
}
