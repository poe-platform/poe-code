import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { collectHumanPrompts } from "../collect.js";
import { piTraceReader } from "./pi.js";

describe("piTraceReader", () => {
  it("discovers workspace sessions and normalizes messages, tools, errors, and usage", async () => {
    const tracePath =
      "/home/me/.pi/agent/sessions/--repo--/2026-07-08T03-07-36-369Z_session-one.jsonl";
    const fs = createFsFromVolume(
      Volume.fromJSON({
        [tracePath]: [
          JSON.stringify({
            type: "session",
            version: 3,
            id: "session-one",
            timestamp: "2026-07-08T03:07:36.369Z",
            cwd: "/repo"
          }),
          JSON.stringify({
            type: "model_change",
            id: "model-one",
            parentId: null,
            timestamp: "2026-07-08T03:07:36.390Z",
            provider: "xai",
            modelId: "grok-4.5"
          }),
          JSON.stringify({
            type: "message",
            id: "user-one",
            parentId: "model-one",
            timestamp: "2026-07-08T03:08:56.284Z",
            message: {
              role: "user",
              content: [{ type: "text", text: "Find what closed iTerm." }],
              timestamp: 1
            }
          }),
          JSON.stringify({
            type: "message",
            id: "assistant-one",
            parentId: "user-one",
            timestamp: "2026-07-08T03:09:01.747Z",
            message: {
              role: "assistant",
              content: [
                { type: "thinking", thinking: "Inspect terminal commands." },
                { type: "text", text: "I will inspect the traces." },
                {
                  type: "toolCall",
                  id: "call-one",
                  name: "bash",
                  arguments: { command: "rg -i iterm ." }
                }
              ],
              provider: "xai",
              model: "grok-4.5",
              usage: {
                input: 100,
                output: 20,
                cacheRead: 30,
                cacheWrite: 4,
                reasoning: 5,
                totalTokens: 150
              },
              stopReason: "toolUse"
            }
          }),
          JSON.stringify({
            type: "message",
            id: "tool-one",
            parentId: "assistant-one",
            timestamp: "2026-07-08T03:09:05.425Z",
            message: {
              role: "toolResult",
              toolCallId: "call-one",
              toolName: "bash",
              content: [{ type: "text", text: "no matches" }],
              isError: false
            }
          }),
          JSON.stringify({
            type: "message",
            id: "assistant-error",
            parentId: "tool-one",
            timestamp: "2026-07-08T03:09:06.425Z",
            message: {
              role: "assistant",
              content: [],
              model: "grok-4.5",
              usage: {
                input: 120,
                output: 0,
                cacheRead: 30,
                cacheWrite: 0,
                totalTokens: 150
              },
              stopReason: "error",
              errorMessage: "403 Content violates usage guidelines"
            }
          })
        ].join("\n"),
        "/home/me/.pi/agent/sessions/--other--/other.jsonl": JSON.stringify({
          type: "session",
          id: "other",
          timestamp: "2026-07-08T04:00:00.000Z",
          cwd: "/other"
        })
      })
    ).promises;

    const references = await piTraceReader.discover({
      cwd: "/repo",
      homeDir: "/home/me",
      fs
    });

    expect(references).toEqual([
      expect.objectContaining({
        source: "pi",
        id: "session-one",
        path: tracePath,
        cwd: "/repo",
        title: "Find what closed iTerm."
      })
    ]);

    const trace = await piTraceReader.read(references[0]!, { fs });

    expect(trace).toMatchObject({
      source: "pi",
      id: "session-one",
      path: tracePath,
      cwd: "/repo",
      title: "Find what closed iTerm.",
      model: "grok-4.5",
      createdAt: new Date("2026-07-08T03:07:36.369Z"),
      updatedAt: new Date("2026-07-08T03:09:06.425Z"),
      usage: {
        inputTokens: 120,
        outputTokens: 0,
        cachedTokens: 30,
        cacheCreationTokens: 0,
        contextTokens: 150,
        source: "reported"
      }
    });
    expect(trace.turns).toEqual([
      expect.objectContaining({
        id: "user-one",
        role: "human",
        text: "Find what closed iTerm.",
        sourceKind: "user_message"
      }),
      expect.objectContaining({
        id: "assistant-one",
        role: "assistant",
        text: "Inspect terminal commands.",
        sourceKind: "reasoning"
      }),
      expect.objectContaining({
        id: "assistant-one",
        role: "assistant",
        text: "I will inspect the traces.",
        sourceKind: "assistant_message"
      }),
      expect.objectContaining({
        id: "assistant-one",
        role: "tool",
        text: '{"command":"rg -i iterm ."}',
        sourceKind: "tool_use",
        toolName: "bash"
      }),
      expect.objectContaining({
        id: "tool-one",
        role: "tool",
        text: "no matches",
        sourceKind: "tool_result",
        toolName: "bash"
      }),
      expect.objectContaining({
        id: "assistant-error",
        role: "assistant",
        text: "403 Content violates usage guidelines",
        sourceKind: "error"
      })
    ]);
  });

  it("collects only Pi user text as human prompts", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.pi/agent/sessions/--repo--/trace.jsonl": [
          JSON.stringify({ type: "session", id: "session-one", cwd: "/repo" }),
          JSON.stringify({
            type: "message",
            id: "user-one",
            message: { role: "user", content: [{ type: "text", text: "Real prompt" }] }
          }),
          JSON.stringify({
            type: "message",
            id: "assistant-one",
            message: {
              role: "assistant",
              content: [
                { type: "thinking", thinking: "private" },
                { type: "toolCall", id: "call-one", name: "read", arguments: { path: "." } }
              ]
            }
          })
        ].join("\n")
      })
    ).promises;

    const records = await collectHumanPrompts({
      sources: ["pi"],
      cwd: "/repo",
      homeDir: "/home/me",
      fs
    });

    expect(records.map((record) => record.text)).toEqual(["Real prompt"]);
  });
});
