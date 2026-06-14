export type SessionEntry =
  | {
      kind: "user";
      id: string;
      parentId: string | null;
      createdAt: string;
      text: string;
    }
  | {
      kind: "assistant";
      id: string;
      parentId: string | null;
      createdAt: string;
      text: string;
    }
  | {
      kind: "tool_call";
      id: string;
      parentId: string | null;
      createdAt: string;
      tool: string;
      args: unknown;
      intentId: string;
    }
  | {
      kind: "tool_result";
      id: string;
      parentId: string | null;
      createdAt: string;
      intentId: string;
      result?: unknown;
      error?: string;
    }
  | {
      kind: "compaction";
      id: string;
      parentId: string | null;
      createdAt: string;
      summary: string;
      droppedIds: string[];
      readFiles: string[];
      modifiedFiles: string[];
    }
  | {
      kind: "branch_summary";
      id: string;
      parentId: string | null;
      createdAt: string;
      fromEntryId: string;
      summary: string;
    }
  | {
      kind: "fork_marker";
      id: string;
      parentId: string | null;
      createdAt: string;
      fromEntryId: string;
    };

export function isSessionEntry(value: unknown): value is SessionEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const entry = value as Record<string, unknown>;
  if (
    typeof entry.id !== "string" ||
    (entry.parentId !== null && typeof entry.parentId !== "string") ||
    typeof entry.createdAt !== "string"
  ) {
    return false;
  }

  switch (entry.kind) {
    case "user":
    case "assistant":
      return typeof entry.text === "string";
    case "tool_call":
      return typeof entry.tool === "string" && typeof entry.intentId === "string";
    case "tool_result":
      return typeof entry.intentId === "string";
    case "compaction":
      return (
        typeof entry.summary === "string" &&
        Array.isArray(entry.droppedIds) &&
        Array.isArray(entry.readFiles) &&
        Array.isArray(entry.modifiedFiles)
      );
    case "branch_summary":
      return typeof entry.fromEntryId === "string" && typeof entry.summary === "string";
    case "fork_marker":
      return typeof entry.fromEntryId === "string";
    default:
      return false;
  }
}
