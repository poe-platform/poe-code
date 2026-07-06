import { createFsFromVolume, Volume } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentTraceFileSystem,
  NormalizedTrace,
  TraceReader,
  TraceReference
} from "@poe-code/agent-traces";

const mocks = vi.hoisted(() => ({
  traceReaders: [] as TraceReader[],
  estimateTokens: vi.fn((text: string) => (text.length === 0 ? 0 : text.length))
}));

vi.mock("@poe-code/agent-traces", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-traces")>();
  return {
    ...actual,
    traceReaders: mocks.traceReaders
  };
});

vi.mock("tokenfill", () => ({
  estimateTokens: mocks.estimateTokens
}));

import {
  detectTraceFile,
  loadSubagentSummaries,
  loadTrace,
  loadTraceFromFile,
  listTraces
} from "./index.js";

function createTrace(overrides: Partial<NormalizedTrace> = {}): NormalizedTrace {
  return {
    source: "codex",
    id: "trace",
    turns: [],
    ...overrides
  };
}

function createReader(overrides: Partial<TraceReader> & Pick<TraceReader, "id">): TraceReader {
  return {
    defaultRoots: () => [],
    discover: vi.fn(async () => []),
    read: vi.fn(async (reference: TraceReference) =>
      createTrace({ source: reference.source, id: reference.id, path: reference.path })
    ),
    ...overrides
  };
}

const fs = {} as AgentTraceFileSystem;

describe("listTraces", () => {
  beforeEach(() => {
    mocks.traceReaders.length = 0;
    mocks.estimateTokens.mockClear();
  });

  it("merges reader results, sorts newest first, and applies the default and explicit limits", async () => {
    mocks.traceReaders.push(
      createReader({
        id: "claude",
        discover: vi.fn(async () =>
          Array.from({ length: 51 }, (_, index) => ({
            source: "claude" as const,
            id: `old-${index}`,
            updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index))
          }))
        )
      }),
      createReader({
        id: "codex",
        discover: vi.fn(async () => [
          {
            source: "codex" as const,
            id: "newest",
            updatedAt: new Date("2026-07-01T12:00:00.000Z")
          }
        ])
      })
    );

    const defaultLimited = await listTraces({ cwd: "/repo", homeDir: "/home/me", fs });
    const explicitlyLimited = await listTraces({ cwd: "/repo", homeDir: "/home/me", fs, limit: 2 });

    expect(defaultLimited).toHaveLength(50);
    expect(defaultLimited[0]?.id).toBe("newest");
    expect(explicitlyLimited.map((reference) => reference.id)).toEqual(["newest", "old-50"]);
  });

  it("filters sources before discovery", async () => {
    const claude = createReader({ id: "claude" });
    const codex = createReader({ id: "codex" });
    mocks.traceReaders.push(claude, codex);

    await listTraces({ cwd: "/repo", homeDir: "/home/me", fs, sources: ["codex"] });

    expect(claude.discover).not.toHaveBeenCalled();
    expect(codex.discover).toHaveBeenCalledOnce();
  });

  it("skips a reader that throws", async () => {
    mocks.traceReaders.push(
      createReader({
        id: "claude",
        discover: vi.fn(async () => {
          throw new Error("missing sqlite");
        })
      }),
      createReader({
        id: "poe-code",
        discover: vi.fn(async () => [{ source: "poe-code", id: "ok" }])
      })
    );

    await expect(listTraces({ cwd: "/repo", homeDir: "/home/me", fs })).resolves.toEqual([
      { source: "poe-code", id: "ok" }
    ]);
  });
});

describe("loadTrace", () => {
  beforeEach(() => {
    mocks.traceReaders.length = 0;
    mocks.estimateTokens.mockReset();
    mocks.estimateTokens.mockImplementation((text: string) => text.length);
  });

  it("uses reported context when trace usage exists", async () => {
    mocks.traceReaders.push(
      createReader({
        id: "codex",
        read: vi.fn(async () =>
          createTrace({
            source: "codex",
            id: "reported",
            usage: {
              inputTokens: 20,
              outputTokens: 5,
              contextTokens: 25,
              source: "reported"
            },
            contextWindow: 100,
            turns: [{ role: "human", text: "ignored" }]
          })
        )
      })
    );

    const view = await loadTrace({ source: "codex", id: "reported" }, { fs });

    expect(view.context).toEqual({ tokens: 25, window: 100, percent: 25, source: "reported" });
    expect(mocks.estimateTokens).toHaveBeenCalledWith("ignored");
  });

  it("estimates context and uses model window mapping", async () => {
    mocks.traceReaders.push(
      createReader({
        id: "claude",
        read: vi.fn(async () =>
          createTrace({
            source: "claude",
            id: "estimated",
            model: "claude-opus-4",
            turns: [
              { role: "human", text: "hello" },
              { role: "assistant", text: "world!" }
            ]
          })
        )
      })
    );

    const view = await loadTrace({ source: "claude", id: "estimated" }, { fs });

    expect(view.context).toEqual({
      tokens: 11,
      window: 200000,
      percent: 0,
      source: "estimated"
    });
    expect(mocks.estimateTokens).toHaveBeenCalledWith("hello");
    expect(mocks.estimateTokens).toHaveBeenCalledWith("world!");
  });

  it("falls back to the default context window", async () => {
    mocks.traceReaders.push(
      createReader({
        id: "poe-code",
        read: vi.fn(async () =>
          createTrace({
            source: "poe-code",
            id: "default-window",
            model: "unknown-model",
            turns: [{ role: "human", text: "abc" }]
          })
        )
      })
    );

    const view = await loadTrace({ source: "poe-code", id: "default-window" }, { fs });

    expect(view.context.window).toBe(200000);
    expect(view.context.source).toBe("estimated");
  });
});

describe("detectTraceFile", () => {
  it("detects poe-code, codex, and claude JSONL first lines", () => {
    expect(detectTraceFile(JSON.stringify({ event: "session_start" }))).toBe("poe-code");
    expect(detectTraceFile(JSON.stringify({ type: "session_meta" }))).toBe("codex");
    expect(detectTraceFile(JSON.stringify({ type: "response_item" }))).toBe("codex");
    expect(detectTraceFile(JSON.stringify({ type: "event_msg" }))).toBe("codex");
    expect(detectTraceFile(JSON.stringify({ sessionId: "abc" }))).toBe("claude");
    expect(detectTraceFile(JSON.stringify({ type: "user" }))).toBe("claude");
    expect(detectTraceFile(JSON.stringify({ type: "assistant" }))).toBe("claude");
    expect(detectTraceFile(JSON.stringify({ type: "system" }))).toBe("claude");
  });

  it("returns undefined for garbage", () => {
    expect(detectTraceFile("not json")).toBeUndefined();
    expect(detectTraceFile(JSON.stringify({ type: "unknown" }))).toBeUndefined();
  });
});

describe("loadTraceFromFile", () => {
  beforeEach(() => {
    mocks.traceReaders.length = 0;
    mocks.estimateTokens.mockReset();
    mocks.estimateTokens.mockImplementation((text: string) => text.length);
  });

  it("detects the source from the first line and delegates to loadTrace", async () => {
    const read = vi.fn(async (reference: TraceReference) =>
      createTrace({
        source: reference.source,
        id: reference.id,
        path: reference.path,
        turns: [{ role: "human", text: "abc" }]
      })
    );
    mocks.traceReaders.push(createReader({ id: "codex", read }));
    const memFs = createFsFromVolume(
      Volume.fromJSON({
        "/tmp/trace.jsonl": `${JSON.stringify({ type: "session_meta" })}\n${JSON.stringify({
          type: "event_msg"
        })}`
      })
    ).promises as AgentTraceFileSystem;

    const view = await loadTraceFromFile("/tmp/trace.jsonl", { fs: memFs });

    expect(read).toHaveBeenCalledWith(
      { source: "codex", id: "/tmp/trace.jsonl", path: "/tmp/trace.jsonl" },
      { fs: memFs }
    );
    expect(view.source).toBe("codex");
  });
});

describe("loadSubagentSummaries", () => {
  beforeEach(() => {
    mocks.traceReaders.length = 0;
    mocks.estimateTokens.mockReset();
    mocks.estimateTokens.mockImplementation((text: string) => text.length);
  });

  it("loads children lazily, skips failures, and leaves the parent context unaffected", async () => {
    const read = vi.fn(async (reference: TraceReference) => {
      if (reference.id === "parent") {
        return createTrace({
          source: reference.source,
          id: reference.id,
          turns: [{ role: "human", text: "parent" }]
        });
      }
      if (reference.id === "child-one") {
        return createTrace({
          source: reference.source,
          id: reference.id,
          usage: { inputTokens: 7, outputTokens: 3, contextTokens: 10, source: "reported" },
          contextWindow: 100,
          turns: [{ role: "assistant", text: "reported child" }]
        });
      }
      if (reference.id === "child-two") {
        return createTrace({
          source: reference.source,
          id: reference.id,
          model: "claude-sonnet",
          turns: [
            { role: "human", text: "abc" },
            { role: "assistant", text: "de" }
          ]
        });
      }
      throw new Error("missing child");
    });
    mocks.traceReaders.push(createReader({ id: "claude", read }));

    const parent = await loadTrace(
      {
        source: "claude",
        id: "parent",
        path: "/parent.jsonl"
      },
      { fs }
    );
    parent.children = [
      { source: "claude", id: "child-one", path: "/child-one.jsonl" },
      { source: "claude", id: "child-two", path: "/child-two.jsonl" },
      { source: "claude", id: "child-bad", path: "/child-bad.jsonl" }
    ];
    parent.context = { tokens: 5, window: 200000, percent: 0, source: "estimated" };

    const summaries = await loadSubagentSummaries(parent, { fs });

    expect(summaries).toEqual([
      {
        reference: { source: "claude", id: "child-one", path: "/child-one.jsonl" },
        context: { tokens: 10, window: 100, percent: 10, source: "reported" },
        turnCount: 1
      },
      {
        reference: { source: "claude", id: "child-two", path: "/child-two.jsonl" },
        context: { tokens: 5, window: 200000, percent: 0, source: "estimated" },
        turnCount: 2
      }
    ]);
    expect(parent.context.tokens).toBe(5);
  });

  it("returns an empty summary list when there are no children", async () => {
    await expect(
      loadSubagentSummaries(createTrace({ turns: [{ role: "human", text: "parent" }] }), { fs })
    ).resolves.toEqual([]);
  });
});
