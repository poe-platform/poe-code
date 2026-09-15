type SamplingContent =
  | { type: "tool_use"; id: string }
  | { type: "tool_result"; toolUseId: string }
  | { type: "text" | "image" | "audio" };

export interface SamplingMessage {
  role: "user" | "assistant";
  content: SamplingContent | SamplingContent[];
}

// Field schemas must be validated before checking cross-message invariants.
export function inspectSamplingMessages(
  messages: readonly SamplingMessage[]
): { valid: boolean; usesTools: boolean } {
  let pending: Set<string> | undefined;
  let usesTools = false;
  const seenIds = new Set<string>();
  for (const message of messages) {
    const content = Array.isArray(message.content) ? message.content : [message.content];
    if (pending !== undefined) {
      if (message.role !== "user") return { valid: false, usesTools };
      for (const block of content) {
        if (block.type !== "tool_result" || !pending.delete(block.toolUseId))
          return { valid: false, usesTools };
      }
      if (pending.size > 0) return { valid: false, usesTools };
      pending = undefined;
      continue;
    }
    for (const block of content) {
      if (block.type === "tool_result") return { valid: false, usesTools };
      if (block.type !== "tool_use") continue;
      if (message.role !== "assistant" || seenIds.has(block.id))
        return { valid: false, usesTools };
      seenIds.add(block.id);
      pending ??= new Set<string>();
      pending.add(block.id);
      usesTools = true;
    }
  }
  return { valid: pending === undefined, usesTools };
}
