import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/session-tree.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport(
  "../../poe-agent/src/runtime/session/session-tree.ts",
  import.meta.url
);
test("session branches retain entry references, duplicate identity and lazy parent reads", () => {
  for (const api of [original, own]) {
    const trace = [],
      root = { kind: "user", id: "root", parentId: null, text: "input" },
      stale = { kind: "assistant", id: "dup", parentId: "root", text: "old" },
      live = {
        kind: "assistant",
        id: "dup",
        get parentId() {
          trace.push("parent");
          return "root";
        },
        text: "new"
      },
      dead = {
        kind: "assistant",
        id: "dead",
        get parentId() {
          throw Error("must not read sibling parent");
        },
        text: "dead"
      };
    const branch = api.collectBranch([root, stale, dead, live], "dup");
    assert.deepEqual(branch, [root, live]);
    assert.equal(branch[1], live);
    assert.deepEqual(trace, ["parent"]);
    assert.deepEqual(api.collectBranch([root], "missing"), []);
    assert.equal(api.findHead([]), null);
    assert.equal(api.findHead([root, live]), "dup");
  }
});
test("session message reconstruction matches source property effects and opaque results", () => {
  const reason = Symbol("args");
  for (const api of [original, own]) {
    const image = { type: "image", mimeType: "image/png", data: "AA==" },
      parts = [image],
      args = {
        toJSON() {
          return { path: "p\ud800" };
        }
      };
    const entries = [
      { kind: "tool_call", id: "call", parentId: null, intentId: "i", tool: "read", args },
      { kind: "tool_result", id: "result", parentId: "call", intentId: "i", result: parts },
      { kind: "compaction", id: "compact", parentId: "result", summary: "summary" },
      { kind: "ignored", id: "ignored", parentId: "compact" }
    ];
    const messages = api.buildMessages(entries, null);
    assert.equal(messages[1].content, parts);
    assert.deepEqual(messages, [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "i",
            type: "function",
            function: { name: "read", arguments: '{"path":"p\\ud800"}' }
          }
        ]
      },
      { role: "tool", name: "read", toolCallId: "i", content: parts },
      { role: "system", name: "compaction", content: "Compacted context summary:\nsummary" }
    ]);
    assert.throws(
      () =>
        api.buildMessages(
          [
            {
              kind: "tool_call",
              intentId: "i",
              tool: "read",
              get args() {
                throw reason;
              }
            }
          ],
          null
        ),
      (error) => error === reason
    );
    let reads = 0;
    const changing = {
      get kind() {
        return ["other", "other", "tool_call"][reads++] ?? "other";
      },
      intentId: "i",
      tool: "read",
      args: "raw"
    };
    assert.equal(api.buildMessages([changing], null)[0].tool_calls[0].function.arguments, "raw");
    assert.equal(reads, 3);
  }
});
test("own cyclic branches reject instead of retaining an unbounded history", () => {
  assert.throws(
    () =>
      own.collectBranch(
        [
          { id: "a", parentId: "b" },
          { id: "b", parentId: "a" }
        ],
        "a"
      ),
    (error) => error.message.includes("cycle")
  );
});
test("history getter failures retain identity and invalid native input never panics", async () => {
  for (const api of [original, own]) {
    for (const reason of [undefined, null, false, Symbol("history getter")]) {
      assert.throws(
        () =>
          api.collectBranch(
            [
              {
                id: "a",
                get parentId() {
                  throw reason;
                }
              }
            ],
            "a"
          ),
        (error) => error === reason
      );
      assert.throws(
        () =>
          api.buildMessages(
            [
              {
                get kind() {
                  throw reason;
                }
              }
            ],
            null
          ),
        (error) => error === reason
      );
    }
  }
  const { createRequire } = await import("node:module"),
    native = createRequire(import.meta.url)("../dist/poe-agent-rust.node");
  assert.throws(
    () => native.sessionCollectBranch([], ["a"], "a"),
    (error) => error.message.includes("input lengths")
  );
});
