import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { codexTraceReader } from "./codex.js";
import type { SqliteTraceDatabase } from "../types.js";

describe("codexTraceReader", () => {
  it("discovers Codex threads from SQLite and extracts rollout user prompts", async () => {
    const db: SqliteTraceDatabase = {
      all: vi.fn(() => [
        {
          id: "thread-one",
          rollout_path: "/home/me/.codex/sessions/rollout-one.jsonl",
          created_at: 1781360000,
          updated_at: 1781360300,
          created_at_ms: null,
          updated_at_ms: null,
          source: "vscode",
          model: "gpt-5.5",
          cwd: "/repo",
          title: "Parser work",
          first_user_message: "fallback prompt"
        }
      ]),
      close: vi.fn()
    };
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.codex/sessions/rollout-one.jsonl": [
          JSON.stringify({
            type: "session_meta",
            payload: { id: "thread-one", cwd: "/repo", timestamp: "2026-06-13T12:00:00.000Z" }
          }),
          JSON.stringify({
            type: "response_item",
            timestamp: "2026-06-13T12:00:01.000Z",
            payload: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "Implement gaslight ingest." }]
            }
          }),
          JSON.stringify({
            type: "event_msg",
            timestamp: "2026-06-13T12:01:00.000Z",
            payload: {
              type: "user_message",
              message: "Actually inspect local traces too.",
              text_elements: ["Actually inspect local traces too."]
            }
          }),
          JSON.stringify({
            type: "response_item",
            payload: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "ok" }]
            }
          })
        ].join("\n")
      })
    ).promises;

    const references = await codexTraceReader.discover({
      cwd: "/repo",
      homeDir: "/home/me",
      fs,
      sqlite: async () => db
    });

    expect(db.all).toHaveBeenCalledWith(expect.stringContaining("FROM threads"), [
      "/repo",
      null,
      null,
      null
    ]);
    expect(db.close).toHaveBeenCalledOnce();
    expect(references).toHaveLength(1);

    const trace = await codexTraceReader.read(references[0]!, { fs });

    expect(trace).toMatchObject({
      source: "codex",
      id: "thread-one",
      cwd: "/repo",
      title: "Parser work"
    });
    expect(trace.turns.map((turn) => ({ role: turn.role, text: turn.text }))).toEqual([
      { role: "human", text: "Implement gaslight ingest." },
      { role: "human", text: "Actually inspect local traces too." },
      { role: "assistant", text: "ok" }
    ]);
  });

  it("falls back to first_user_message when rollout is unavailable", async () => {
    const reference = {
      source: "codex" as const,
      id: "thread-two",
      cwd: "/repo",
      title: "Fallback",
      metadata: {
        firstUserMessage: "Use the metadata prompt",
        createdAt: new Date("2026-06-13T12:00:00.000Z")
      }
    };
    const fs = createFsFromVolume(new Volume()).promises;

    await expect(codexTraceReader.read(reference, { fs })).resolves.toMatchObject({
      turns: [
        {
          role: "human",
          text: "Use the metadata prompt",
          timestamp: new Date("2026-06-13T12:00:00.000Z"),
          sourceKind: "first_user_message"
        }
      ]
    });
  });

  it("filters all-workspace discovery by since without cwd parameters", async () => {
    const db: SqliteTraceDatabase = {
      all: vi.fn(() => []),
      close: vi.fn()
    };

    await codexTraceReader.discover({
      cwd: "/repo",
      homeDir: "/home/me",
      allWorkspaces: true,
      since: new Date("2026-06-13T12:00:00.000Z"),
      fs: createFsFromVolume(new Volume()).promises,
      sqlite: async () => db
    });

    expect(db.all).toHaveBeenCalledWith(
      expect.stringContaining("FROM threads"),
      [1781352000, 1781352000000]
    );
  });

  it("throws sqlite errors that inherit ENOENT without owning it", async () => {
    const inheritedMissing = Object.create({ code: "ENOENT" }) as Error;
    Object.assign(inheritedMissing, { message: "sqlite permission denied" });

    await expect(
      codexTraceReader.discover({
        cwd: "/repo",
        homeDir: "/home/me",
        fs: createFsFromVolume(new Volume()).promises,
        sqlite: async () => {
          throw inheritedMissing;
        }
      })
    ).rejects.toBe(inheritedMissing);
  });
});
