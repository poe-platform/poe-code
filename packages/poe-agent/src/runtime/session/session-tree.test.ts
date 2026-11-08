import { describe, expect, it } from "vitest";
import type { SessionEntry } from "./entry-types.js";
import { buildMessages, collectBranch, findHead } from "./session-tree.js";

function entry(entry: Omit<SessionEntry, "createdAt">): SessionEntry {
  return {
    ...entry,
    createdAt: "2026-06-13T00:00:00.000Z"
  } as SessionEntry;
}

describe("session tree", () => {
  it("rebuilds a linear conversation", () => {
    const entries: SessionEntry[] = [
      entry({ kind: "user", id: "u1", parentId: null, text: "hello" }),
      entry({ kind: "assistant", id: "a1", parentId: "u1", text: "hi" })
    ];

    expect(buildMessages(entries, "a1")).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" }
    ]);
    expect(findHead(entries)).toBe("a1");
  });

  it("follows parent links and ignores dead sibling branches", () => {
    const entries: SessionEntry[] = [
      entry({ kind: "user", id: "u1", parentId: null, text: "start" }),
      entry({ kind: "assistant", id: "dead", parentId: "u1", text: "old answer" }),
      entry({ kind: "assistant", id: "live", parentId: "u1", text: "new answer" })
    ];

    expect(collectBranch(entries, "live").map((item) => item.id)).toEqual(["u1", "live"]);
    expect(buildMessages(entries, "live")).toEqual([
      { role: "user", content: "start" },
      { role: "assistant", content: "new answer" }
    ]);
  });

  it("renders tool call and result entries as chat messages", () => {
    const entries: SessionEntry[] = [
      entry({ kind: "user", id: "u1", parentId: null, text: "read it" }),
      entry({
        kind: "tool_call",
        id: "tc1",
        parentId: "u1",
        tool: "read_file",
        args: { path: "README.md" },
        intentId: "call-1"
      }),
      entry({
        kind: "tool_result",
        id: "tr1",
        parentId: "tc1",
        intentId: "call-1",
        result: "content"
      })
    ];

    expect(buildMessages(entries, "tr1")).toEqual([
      { role: "user", content: "read it" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "read_file", arguments: "{\"path\":\"README.md\"}" }
          }
        ]
      },
      {
        role: "tool",
        name: "read_file",
        toolCallId: "call-1",
        content: "content"
      }
    ]);
  });
});
