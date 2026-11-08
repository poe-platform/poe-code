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
