import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFsFromVolume, Volume } from "memfs";
import { stripAnsi } from "toolcraft-design";
import type { ActionContext, ExplorerConfig } from "toolcraft-design";
import type {
  AgentTraceFileSystem,
  NormalizedTrace,
  TraceReader,
  TraceReference
} from "@poe-code/agent-traces";

const mocks = vi.hoisted(() => ({
  traceReaders: [] as TraceReader[],
  countTokens: vi.fn((text: string) => (text.length === 0 ? 0 : text.length)),
  runExplorer: vi.fn(async () => null)
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

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    runExplorer: mocks.runExplorer
  };
});

import { runTraceViewer } from "./run.js";

class MemoryOutput {
  value = "";

  write(chunk: string | Uint8Array): boolean {
    this.value += String(chunk);
    return true;
  }
}

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

describe("runTraceViewer", () => {
  beforeEach(() => {
    mocks.traceReaders.length = 0;
    mocks.countTokens.mockReset();
    mocks.countTokens.mockImplementation((text: string) => text.length);
    mocks.runExplorer.mockClear();
  });

  it("prints a friendly empty state in non-interactive mode", async () => {
    mocks.traceReaders.push(createReader({ id: "codex" }));
    const output = new MemoryOutput();

    await runTraceViewer({
      cwd: "/repo",
      homeDir: "/home/me",
      fs: {} as AgentTraceFileSystem,
      assumeYes: true,
      output
    });

    expect(output.value).toBe("No traces found\n");
  });

  it("prints a table in non-interactive mode", async () => {
    mocks.traceReaders.push(
      createReader({
        id: "codex",
        discover: vi.fn(async () => [
          {
            source: "codex",
            id: "trace-1",
            title: "Trace one",
            updatedAt: new Date("2026-07-01T10:00:00.000Z"),
            cwd: "/repo"
          }
        ])
      })
    );
    const output = new MemoryOutput();

    await runTraceViewer({
      cwd: "/repo",
      homeDir: "/home/me",
      fs: {} as AgentTraceFileSystem,
      assumeYes: true,
      output
    });

    const rendered = stripAnsi(output.value);
    expect(rendered).toContain("Source");
    expect(rendered).toContain("codex");
    expect(rendered).toContain("Trace one");
    expect(rendered).toContain("repo");
  });

  it("compacts multiline titles before rendering table rows", async () => {
    mocks.traceReaders.push(
      createReader({
        id: "codex",
        discover: vi.fn(async () => [
          {
            source: "codex",
            id: "trace-1",
            title: "First line\n\nSecond line\tthird",
            updatedAt: new Date("2026-07-01T10:00:00.000Z")
          }
        ])
      })
    );
    const output = new MemoryOutput();

    await runTraceViewer({
      cwd: "/repo",
      homeDir: "/home/me",
      fs: {} as AgentTraceFileSystem,
      assumeYes: true,
      output
    });

    const rendered = stripAnsi(output.value);
    expect(rendered).toContain("First line Second line third");
    expect(rendered).not.toContain("First line\n\nSecond line");
  });

  it("keeps the non-interactive trace list within 80 columns", async () => {
    mocks.traceReaders.push(
      createReader({
        id: "claude",
        discover: vi.fn(async () => [
          {
            source: "claude",
            id: "trace-1",
            title: "Investigate an extremely long trace title that should not spill past the table edge",
            updatedAt: new Date("2026-07-01T10:00:00.000Z"),
            cwd: "/Users/kjopek/Workspace/poe-code-with-a-very-long-directory-name"
          }
        ])
      })
    );
    const output = new MemoryOutput();

    await runTraceViewer({
      cwd: "/repo",
      homeDir: "/home/me",
      fs: {} as AgentTraceFileSystem,
      assumeYes: true,
      output
    });

    const rendered = stripAnsi(output.value);
    expect(rendered.split("\n").filter((line) => line.length > 0).every((line) => line.length <= 80))
      .toBe(true);
    expect(rendered).toContain("Investigate an extremely long…");
    expect(rendered).toContain("poe-code-w…");
  });

  it("prints JSON trace references in non-interactive JSON mode", async () => {
    mocks.traceReaders.push(
      createReader({
        id: "claude",
        discover: vi.fn(async () => [
          {
            source: "claude",
            id: "trace-1",
            updatedAt: new Date("2026-07-01T10:00:00.000Z")
          }
        ])
      })
    );
    const output = new MemoryOutput();

    await runTraceViewer({
      cwd: "/repo",
      homeDir: "/home/me",
      fs: {} as AgentTraceFileSystem,
      json: true,
      output
    });

    expect(JSON.parse(output.value)).toEqual([
      {
        source: "claude",
        id: "trace-1",
        updatedAt: "2026-07-01T10:00:00.000Z"
      }
    ]);
  });

  it("loads a trace file and prints detail with subagent summaries", async () => {
    const read = vi.fn(async (reference: TraceReference) =>
      reference.id === "child"
        ? createTrace({
            source: "codex",
            id: "child",
            title: "Child trace",
            turns: [{ role: "assistant", text: "child" }],
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              contextTokens: 15,
              source: "reported"
            }
          })
        : createTrace({
            source: "codex",
            id: reference.id,
            path: reference.path,
            title: "Parent trace",
            children: [{ source: "codex", id: "child", title: "Child trace", agentType: "Explore" }],
            turns: [{ role: "human", text: "hello" }]
          })
    );
    mocks.traceReaders.push(createReader({ id: "codex", read }));
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/tmp/trace.jsonl": `${JSON.stringify({ type: "session_meta" })}\n`
      })
    ).promises as AgentTraceFileSystem;
    const output = new MemoryOutput();

    await runTraceViewer({
      cwd: "/repo",
      homeDir: "/home/me",
      fs,
      path: "/tmp/trace.jsonl",
      output
    });

    const rendered = stripAnsi(output.value);
    expect(rendered).toContain("Parent trace");
    expect(rendered).toContain("Subagents");
    expect(rendered).toContain("Explore");
    expect(rendered).toContain("human › hello");
  });

  it("prints trace detail JSON with ISO dates and subagents", async () => {
    const read = vi.fn(async (reference: TraceReference) =>
      reference.id === "child"
        ? createTrace({
            source: "claude",
            id: "child",
            turns: [{ role: "assistant", text: "child" }],
            createdAt: new Date("2026-07-01T09:00:00.000Z"),
            updatedAt: new Date("2026-07-01T09:05:00.000Z")
          })
        : createTrace({
            source: "claude",
            id: reference.id,
            path: reference.path,
            title: "Parent",
            createdAt: new Date("2026-07-01T08:00:00.000Z"),
            updatedAt: new Date("2026-07-01T08:05:00.000Z"),
            children: [{ source: "claude", id: "child", title: "Child" }],
            turns: [{ role: "human", text: "parent" }]
          })
    );
    mocks.traceReaders.push(createReader({ id: "claude", read }));
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/tmp/trace.jsonl": `${JSON.stringify({ sessionId: "abc" })}\n`
      })
    ).promises as AgentTraceFileSystem;
    const output = new MemoryOutput();

    await runTraceViewer({
      cwd: "/repo",
      homeDir: "/home/me",
      fs,
      path: "/tmp/trace.jsonl",
      json: true,
      output
    });

    const json = JSON.parse(output.value);
    expect(json.createdAt).toBe("2026-07-01T08:00:00.000Z");
    expect(json.subagents).toHaveLength(1);
    expect(json.subagents[0].reference.title).toBe("Child");
  });

  it("wires Enter to print the selected trace detail from the interactive explorer", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true
    });
    try {
      mocks.traceReaders.push(
        createReader({
          id: "codex",
          discover: vi.fn(async () => [
            {
              source: "codex",
              id: "trace-1",
              title: "Trace one",
              updatedAt: new Date("2026-07-01T10:00:00.000Z")
            }
          ]),
          read: vi.fn(async (reference: TraceReference) =>
            createTrace({
              source: reference.source,
              id: reference.id,
              title: "Opened trace",
              turns: [{ role: "assistant", text: "opened" }]
            })
          )
        })
      );
      const output = new MemoryOutput();

      await runTraceViewer({
        cwd: "/repo",
        homeDir: "/home/me",
        fs: {} as AgentTraceFileSystem,
        output
      });

      const config = mocks.runExplorer.mock.calls[0]?.[0] as ExplorerConfig<void> | undefined;
      expect(config).toBeDefined();
      const rows = await config!.rows();
      const open = config!.actions.find((action) => action.id === "open");
      expect(open?.primary).toBe(true);
      expect(open?.label).toBe("Open detail");

      let afterExit: Promise<void> = Promise.resolve();
      await open!.handler({
        row: rows[0]!,
        rows: [rows[0]!],
        filter: "",
        refresh: vi.fn(async () => undefined),
        suspendAnd: vi.fn(async (fn) => fn()),
        toast: vi.fn(),
        confirm: vi.fn(async () => true),
        exit: vi.fn((after?: () => void | Promise<void>) => {
          afterExit = Promise.resolve(after?.());
        })
      } satisfies ActionContext<void>);
      await afterExit;

      const rendered = stripAnsi(output.value);
      expect(rendered).toContain("Opened trace");
      expect(rendered).toContain("assistant ✦ opened");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: originalIsTTY
      });
    }
  });

  it("wires s to replace the parent explorer with the subagent explorer", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true
    });
    try {
      mocks.traceReaders.push(
        createReader({
          id: "claude",
          discover: vi.fn(async () => [
            {
              source: "claude",
              id: "parent",
              title: "Parent trace",
              updatedAt: new Date("2026-07-01T10:00:00.000Z")
            }
          ]),
          read: vi.fn(async (reference: TraceReference) =>
            reference.id === "child"
              ? createTrace({
                  source: "claude",
                  id: "child",
                  title: "Child trace",
                  turns: [{ role: "assistant", text: "child" }]
                })
              : createTrace({
                  source: "claude",
                  id: "parent",
                  title: "Parent trace",
                  children: [{ source: "claude", id: "child", title: "Child trace" }],
                  turns: [{ role: "assistant", text: "parent" }]
                })
          )
        })
      );
      const output = new MemoryOutput();

      await runTraceViewer({
        cwd: "/repo",
        homeDir: "/home/me",
        fs: {} as AgentTraceFileSystem,
        output
      });

      const config = mocks.runExplorer.mock.calls[0]?.[0] as ExplorerConfig<void> | undefined;
      expect(config).toBeDefined();
      const rows = await config!.rows();
      await config!.detail!.items!(rows[0]!, {
        signal: new AbortController().signal
      });

      const subagents = config!.actions.find((action) => action.id === "subagents");
      expect(subagents).toBeDefined();

      let afterExit: Promise<void> = Promise.resolve();
      const suspendAnd = vi.fn(async (fn: () => Promise<void>) => fn());
      await subagents!.handler({
        row: rows[0]!,
        rows: [rows[0]!],
        filter: "",
        refresh: vi.fn(async () => undefined),
        suspendAnd,
        toast: vi.fn(),
        confirm: vi.fn(async () => true),
        exit: vi.fn((after?: () => void | Promise<void>) => {
          afterExit = Promise.resolve(after?.());
        })
      } satisfies ActionContext<void>);
      await afterExit;

      expect(suspendAnd).not.toHaveBeenCalled();
      const childConfig = mocks.runExplorer.mock.calls[1]?.[0] as ExplorerConfig<void> | undefined;
      expect(childConfig?.title).toBe("Parent trace subagents");
      const childRows = await childConfig!.rows();
      expect(childRows[0]?.title).toBe("Child trace");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: originalIsTTY
      });
    }
  });
});
