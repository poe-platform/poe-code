import { createFsFromVolume, Volume } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isUserError } from "@poe-code/user-error";
import type {
  AgentTraceFileSystem,
  NormalizedTrace,
  TraceReader,
  TraceReference
} from "@poe-code/agent-traces";

const mocks = vi.hoisted(() => ({
  traceReaders: [] as TraceReader[],
  countTokens: vi.fn((text: string) => (text.length === 0 ? 0 : text.length))
}));

vi.mock("@poe-code/agent-traces", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-traces")>();
  return {
    ...actual,
    traceReaders: mocks.traceReaders
  };
});

vi.mock("tokenfill", () => ({
  countTokens: mocks.countTokens
}));

import {
  detectTraceFile,
  loadSubagentSummaries,
  loadTrace,
  loadTraceFromFile,
  loadTraceTree,
  listTraces,
  openTraceHtml,
  renderTraceHtml,
  writeTraceHtml
} from "./index.js";

describe("package exports", () => {
  it("exports HTML open helpers and loadTraceTree", () => {
    expect(loadTraceTree).toBeTypeOf("function");
    expect(renderTraceHtml).toBeTypeOf("function");
    expect(writeTraceHtml).toBeTypeOf("function");
    expect(openTraceHtml).toBeTypeOf("function");
  });
});

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
    mocks.countTokens.mockClear();
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
        discover: vi.fn<TraceReader["discover"]>(async () => [{ source: "poe-code", id: "ok" }])
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
    mocks.countTokens.mockReset();
    mocks.countTokens.mockImplementation((text: string) => text.length);
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
    expect(mocks.countTokens).toHaveBeenCalledWith("ignored");
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
    expect(mocks.countTokens).toHaveBeenCalledWith("hello");
    expect(mocks.countTokens).toHaveBeenCalledWith("world!");
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

  it("caches token breakdowns per file and reuses them while the file is unchanged", async () => {
    const volumeFs = createFsFromVolume(Volume.fromJSON({ "/traces/one.jsonl": "contents" }))
      .promises as unknown as AgentTraceFileSystem;
    mocks.traceReaders.push(
      createReader({
        id: "claude",
        read: vi.fn(async () =>
          createTrace({
            source: "claude",
            id: "one",
            path: "/traces/one.jsonl",
            turns: [{ role: "human", text: "count me" }]
          })
        )
      })
    );
    const options = { fs: volumeFs, cacheDir: "/cache" };
    const reference = { source: "claude" as const, id: "one", path: "/traces/one.jsonl" };

    const first = await loadTrace(reference, options);
    const callsAfterFirst = mocks.countTokens.mock.calls.length;
    const second = await loadTrace(reference, options);

    expect(first.breakdown).toEqual(second.breakdown);
    expect(mocks.countTokens.mock.calls.length).toBe(callsAfterFirst);
  });

  it("recomputes the breakdown when the trace file changes", async () => {
    const volume = Volume.fromJSON({ "/traces/one.jsonl": "contents" });
    const volumeFs = createFsFromVolume(volume).promises as unknown as AgentTraceFileSystem;
    mocks.traceReaders.push(
      createReader({
        id: "claude",
        read: vi.fn(async () =>
          createTrace({
            source: "claude",
            id: "one",
            path: "/traces/one.jsonl",
            turns: [{ role: "human", text: "count me" }]
          })
        )
      })
    );
    const options = { fs: volumeFs, cacheDir: "/cache" };
    const reference = { source: "claude" as const, id: "one", path: "/traces/one.jsonl" };

    await loadTrace(reference, options);
    const callsAfterFirst = mocks.countTokens.mock.calls.length;
    volume.writeFileSync("/traces/one.jsonl", "contents grew longer");
    await loadTrace(reference, options);

    expect(mocks.countTokens.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("defers exact counting: returns an estimate, then caches exact counts in the background", async ({ onTestFinished }) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const volumeFs = createFsFromVolume(Volume.fromJSON({ "/traces/one.jsonl": "contents" }))
      .promises as unknown as AgentTraceFileSystem;
    mocks.traceReaders.push(
      createReader({
        id: "claude",
        read: vi.fn(async () =>
          createTrace({
            source: "claude",
            id: "one",
            path: "/traces/one.jsonl",
            turns: [{ role: "human", text: "count me" }]
          })
        )
      })
    );
    const reference = { source: "claude" as const, id: "one", path: "/traces/one.jsonl" };
    let resolveExact!: (value: unknown) => void;
    const exactDone = new Promise((resolve) => {
      resolveExact = resolve;
    });

    const deferred = await loadTrace(reference, {
      fs: volumeFs,
      cacheDir: "/cache",
      deferExactTokens: true,
      onExactBreakdown: resolveExact
    });
    expect(deferred.breakdown.source).toBe("estimated");
    expect(mocks.countTokens).toHaveBeenCalledExactlyOnceWith("count me");
    expect(vi.getTimerCount()).toBe(1);

    await vi.runOnlyPendingTimersAsync();
    await exactDone;
    expect(mocks.countTokens).toHaveBeenCalledTimes(2);
    const callsBeforeSecond = mocks.countTokens.mock.calls.length;
    const second = await loadTrace(reference, { fs: volumeFs, cacheDir: "/cache" });

    expect(second.breakdown.source).toBe("exact");
    expect(mocks.countTokens.mock.calls.length).toBe(callsBeforeSecond);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not cache a breakdown computed from an aborted load", async () => {
    const volumeFs = createFsFromVolume(Volume.fromJSON({ "/traces/one.jsonl": "contents" }))
      .promises as unknown as AgentTraceFileSystem;
    mocks.traceReaders.push(
      createReader({
        id: "claude",
        read: vi.fn(async () =>
          createTrace({
            source: "claude",
            id: "one",
            path: "/traces/one.jsonl",
            turns: [{ role: "human", text: "count me" }]
          })
        )
      })
    );
    const controller = new AbortController();
    controller.abort();
    const reference = { source: "claude" as const, id: "one", path: "/traces/one.jsonl" };

    await loadTrace(reference, { fs: volumeFs, cacheDir: "/cache", signal: controller.signal });
    const callsAfterAborted = mocks.countTokens.mock.calls.length;
    await loadTrace(reference, { fs: volumeFs, cacheDir: "/cache" });

    expect(mocks.countTokens.mock.calls.length).toBeGreaterThan(callsAfterAborted);
  });
});

describe("detectTraceFile", () => {
  it("detects poe-code, codex, claude, and pi JSONL first lines", () => {
    expect(detectTraceFile(JSON.stringify({ event: "session_start" }))).toBe("poe-code");
    expect(detectTraceFile(JSON.stringify({ type: "session_meta" }))).toBe("codex");
    expect(detectTraceFile(JSON.stringify({ type: "response_item" }))).toBe("codex");
    expect(detectTraceFile(JSON.stringify({ type: "event_msg" }))).toBe("codex");
    expect(detectTraceFile(JSON.stringify({ sessionId: "abc" }))).toBe("claude");
    expect(detectTraceFile(JSON.stringify({ type: "user" }))).toBe("claude");
    expect(detectTraceFile(JSON.stringify({ type: "assistant" }))).toBe("claude");
    expect(detectTraceFile(JSON.stringify({ type: "system" }))).toBe("claude");
    expect(
      detectTraceFile(
        JSON.stringify({ type: "session", version: 3, id: "session-one", cwd: "/repo" })
      )
    ).toBe("pi");
  });

  it("returns undefined for garbage", () => {
    expect(detectTraceFile("not json")).toBeUndefined();
    expect(detectTraceFile(JSON.stringify({ type: "unknown" }))).toBeUndefined();
  });
});

describe("loadTraceFromFile", () => {
  beforeEach(() => {
    mocks.traceReaders.length = 0;
    mocks.countTokens.mockReset();
    mocks.countTokens.mockImplementation((text: string) => text.length);
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

  it("reports a missing trace file as a user error instead of ENOENT", async () => {
    const memFs = createFsFromVolume(Volume.fromJSON({})).promises as AgentTraceFileSystem;

    const error = await loadTraceFromFile("/tmp/no-such-trace.jsonl", { fs: memFs }).catch(
      (thrown: unknown) => thrown
    );

    expect(isUserError(error)).toBe(true);
    expect((error as Error).message).toContain("Trace file not found");
    expect((error as Error).message).toContain("/tmp/no-such-trace.jsonl");
    expect((error as Error).message).not.toContain("ENOENT");
  });

  it("reports a directory trace path as a user error instead of EISDIR", async () => {
    const memFs = createFsFromVolume(
      Volume.fromJSON({ "/tmp/traces/keep.jsonl": "{}" })
    ).promises as AgentTraceFileSystem;

    const error = await loadTraceFromFile("/tmp/traces", { fs: memFs }).catch(
      (thrown: unknown) => thrown
    );

    expect(isUserError(error)).toBe(true);
    expect((error as Error).message).toContain("is a directory");
    expect((error as Error).message).not.toContain("EISDIR");
  });
});

describe("loadSubagentSummaries", () => {
  beforeEach(() => {
    mocks.traceReaders.length = 0;
    mocks.countTokens.mockReset();
    mocks.countTokens.mockImplementation((text: string) => text.length);
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
      loadSubagentSummaries({
        ...createTrace({ turns: [{ role: "human", text: "parent" }] }),
        context: { tokens: 6, window: 200000, percent: 0, source: "estimated" },
        breakdown: { measuredTokens: 6, categories: [], source: "exact" }
      }, { fs })
    ).resolves.toEqual([]);
  });
});

describe("loadTraceTree", () => {
  beforeEach(() => {
    mocks.traceReaders.length = 0;
    mocks.countTokens.mockReset();
    mocks.countTokens.mockImplementation((text: string) => text.length);
  });

  it("loads children recursively, preserves order, and marks failures", async () => {
    const read = vi.fn(async (reference: TraceReference) => {
      if (reference.id === "child-one") {
        return createTrace({
          source: reference.source,
          id: reference.id,
          path: reference.path,
          title: "Child one",
          children: [{ source: "claude", id: "grand", path: "/grand.jsonl" }],
          turns: [{ role: "assistant", text: "one" }]
        });
      }
      if (reference.id === "grand") {
        return createTrace({
          source: reference.source,
          id: reference.id,
          path: reference.path,
          title: "Grand",
          turns: [{ role: "human", text: "g" }]
        });
      }
      if (reference.id === "child-two") {
        return createTrace({
          source: reference.source,
          id: reference.id,
          path: reference.path,
          title: "Child two",
          turns: [{ role: "human", text: "two" }]
        });
      }
      throw new Error("missing child file");
    });
    mocks.traceReaders.push(createReader({ id: "claude", read }));

    const root = {
      ...createTrace({
        source: "claude",
        id: "parent",
        title: "Parent",
        turns: [{ role: "human", text: "parent" }]
      }),
      context: { tokens: 1, window: 200000, percent: 0, source: "estimated" as const },
      breakdown: { measuredTokens: 1, categories: [], source: "exact" as const },
      children: [
        { source: "claude" as const, id: "child-one", path: "/child-one.jsonl" },
        { source: "claude" as const, id: "child-bad", path: "/child-bad.jsonl" },
        { source: "claude" as const, id: "child-two", path: "/child-two.jsonl" }
      ]
    };

    const tree = await loadTraceTree(root, { fs });

    expect(tree.view.id).toBe("parent");
    expect(tree.children.map((child) => child.view.id)).toEqual([
      "child-one",
      "child-bad",
      "child-two"
    ]);
    expect(tree.children[0]?.children).toHaveLength(1);
    expect(tree.children[0]?.children[0]?.view.id).toBe("grand");
    expect(tree.children[1]?.unavailable?.reason).toContain("missing child file");
    expect(tree.children[2]?.unavailable).toBeUndefined();
  });

  it("detects cycles and respects maxDepth / maxNodes", async () => {
    const read = vi.fn(async (reference: TraceReference) =>
      createTrace({
        source: reference.source,
        id: reference.id,
        path: reference.path,
        children:
          reference.id === "a"
            ? [{ source: "claude", id: "b", path: "/b.jsonl" }]
            : reference.id === "b"
              ? [{ source: "claude", id: "a", path: "/a.jsonl" }]
              : [],
        turns: [{ role: "human", text: reference.id }]
      })
    );
    mocks.traceReaders.push(createReader({ id: "claude", read }));

    const root = {
      ...createTrace({
        source: "claude",
        id: "root",
        path: "/root.jsonl",
        children: [
          { source: "claude" as const, id: "a", path: "/a.jsonl" },
          { source: "claude" as const, id: "c", path: "/c.jsonl" },
          { source: "claude" as const, id: "d", path: "/d.jsonl" }
        ],
        turns: [{ role: "human", text: "root" }]
      }),
      context: { tokens: 0, window: 200000, percent: 0, source: "estimated" as const },
      breakdown: { measuredTokens: 0, categories: [], source: "exact" as const }
    };

    const cyclic = await loadTraceTree(root, { fs, maxDepth: 8, maxNodes: 50 });
    expect(cyclic.children[0]?.view.id).toBe("a");
    expect(cyclic.children[0]?.children[0]?.view.id).toBe("b");
    expect(cyclic.children[0]?.children[0]?.children[0]?.unavailable?.reason).toBe(
      "already included"
    );

    const capped = await loadTraceTree(root, { fs, maxNodes: 2 });
    expect(capped.children).toHaveLength(1);

    const shallow = await loadTraceTree(
      {
        ...root,
        children: [{ source: "claude", id: "a", path: "/a.jsonl" }]
      },
      { fs, maxDepth: 0 }
    );
    expect(shallow.children).toEqual([]);
  });
});
