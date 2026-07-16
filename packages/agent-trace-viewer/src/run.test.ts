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
            title:
              "Investigate an extremely long trace title that should not spill past the table edge",
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
    expect(
      rendered
        .split("\n")
        .filter((line) => line.length > 0)
        .every((line) => line.length <= 80)
    ).toBe(true);
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

  it("truncates reference titles in JSON mode the way the rendered list does", async () => {
    mocks.traceReaders.push(
      createReader({
        id: "claude",
        discover: vi.fn(async () => [
          {
            source: "claude" as const,
            id: "trace-1",
            title: `Answer using only the provided memory pages.\n${"prompt ".repeat(20)}`,
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

    const [reference] = JSON.parse(output.value);
    expect(reference.title).toBe("Answer using only the provided memory pages.\nprompt prompt …");
    expect([...reference.title]).toHaveLength(60);
  });

  it("keeps full reference titles in JSON mode when fullTitles is set", async () => {
    const title = `Answer using only the provided memory pages.\n${"prompt ".repeat(20)}`;
    mocks.traceReaders.push(
      createReader({
        id: "claude",
        discover: vi.fn(async () => [
          {
            source: "claude" as const,
            id: "trace-1",
            title,
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
      fullTitles: true,
      output
    });

    expect(JSON.parse(output.value)[0].title).toBe(title);
  });

  it("does not cap discovered references when no limit is provided", async () => {
    mocks.traceReaders.push(
      createReader({
        id: "codex",
        discover: vi.fn(async () =>
          Array.from({ length: 51 }, (_, index) => ({
            source: "codex" as const,
            id: `trace-${index}`,
            updatedAt: new Date(`2026-07-01T10:${String(index).padStart(2, "0")}:00.000Z`)
          }))
        )
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

    expect(JSON.parse(output.value)).toHaveLength(51);
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
            children: [
              { source: "codex", id: "child", title: "Child trace", agentType: "Explore" }
            ],
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

  it("writes HTML for a path with htmlOut and does not print terminal detail", async () => {
    mocks.traceReaders.push(
      createReader({
        id: "claude",
        read: vi.fn(async (reference: TraceReference) =>
          createTrace({
            source: "claude",
            id: reference.id,
            path: reference.path,
            title: "HTML parent",
            turns: [{ role: "human", text: "hello html" }]
          })
        )
      })
    );
    const volume = Volume.fromJSON({
      "/tmp/trace.jsonl": `${JSON.stringify({ sessionId: "abc" })}\n`
    });
    const fs = createFsFromVolume(volume).promises as AgentTraceFileSystem;
    const output = new MemoryOutput();

    await runTraceViewer({
      cwd: "/repo",
      homeDir: "/home/me",
      fs,
      path: "/tmp/trace.jsonl",
      htmlOut: "/tmp/out.html",
      output
    });

    expect(stripAnsi(output.value)).toContain("Wrote /tmp/out.html");
    expect(stripAnsi(output.value)).not.toContain("human › hello html");
    const html = await fs.readFile("/tmp/out.html", "utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("HTML parent");
  });

  it("opens HTML for a path with open and does not print terminal detail", async () => {
    mocks.traceReaders.push(
      createReader({
        id: "claude",
        read: vi.fn(async (reference: TraceReference) =>
          createTrace({
            source: "claude",
            id: reference.id,
            path: reference.path,
            title: "Open parent",
            turns: [{ role: "human", text: "hello open" }]
          })
        )
      })
    );
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/tmp/trace.jsonl": `${JSON.stringify({ sessionId: "abc" })}\n`
      })
    ).promises as AgentTraceFileSystem;
    const output = new MemoryOutput();
    const openExternal = vi.fn(async () => undefined);

    await runTraceViewer({
      cwd: "/repo",
      homeDir: "/home/me",
      fs,
      path: "/tmp/trace.jsonl",
      open: true,
      htmlOut: "/tmp/opened.html",
      openExternal,
      output
    });

    expect(stripAnsi(output.value)).toContain("Opened /tmp/opened.html");
    expect(openExternal).toHaveBeenCalledOnce();
    expect(String(openExternal.mock.calls[0]?.[0])).toContain("opened.html");
    expect(stripAnsi(output.value)).not.toContain("human › hello open");
  });

  it("keeps the HTML file and reports Wrote when browser open fails", async () => {
    mocks.traceReaders.push(
      createReader({
        id: "claude",
        read: vi.fn(async (reference: TraceReference) =>
          createTrace({
            source: "claude",
            id: reference.id,
            path: reference.path,
            title: "Open fails",
            turns: [{ role: "human", text: "hello" }]
          })
        )
      })
    );
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/tmp/trace.jsonl": `${JSON.stringify({ sessionId: "abc" })}\n`
      })
    ).promises as AgentTraceFileSystem;
    const output = new MemoryOutput();
    const openExternal = vi.fn(async () => {
      throw new Error("Browser launcher exited with code 1");
    });

    await expect(
      runTraceViewer({
        cwd: "/repo",
        homeDir: "/home/me",
        fs,
        path: "/tmp/trace.jsonl",
        open: true,
        htmlOut: "/tmp/fail-open.html",
        openExternal,
        output
      })
    ).rejects.toThrow("Browser launcher exited with code 1");

    expect(stripAnsi(output.value)).toContain("Wrote /tmp/fail-open.html");
    await expect(fs.readFile("/tmp/fail-open.html", "utf8")).resolves.toContain("<!doctype html>");
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

  it("wires o to open the selected trace as HTML in the browser", async () => {
    mocks.traceReaders.push(
      createReader({
        id: "claude",
        discover: vi.fn(async () => [
          {
            source: "claude",
            id: "session",
            path: "/tmp/session.jsonl",
            title: "Browser open",
            updatedAt: new Date("2026-07-01T10:00:00.000Z")
          }
        ]),
        read: vi.fn(async (reference: TraceReference) =>
          createTrace({
            source: "claude",
            id: reference.id,
            path: reference.path,
            title: "Browser open",
            turns: [{ role: "human", text: "from explorer" }]
          })
        )
      })
    );
    const fs = createFsFromVolume(new Volume()).promises as AgentTraceFileSystem;
    const openExternal = vi.fn(async () => undefined);
    const stdinIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });

    try {
      await runTraceViewer({
        cwd: "/repo",
        homeDir: "/home/me",
        fs,
        openExternal,
        tmpDir: "/tmp-html",
        output: new MemoryOutput()
      });

      const config = mocks.runExplorer.mock.calls[0]?.[0] as ExplorerConfig<void> | undefined;
      expect(config).toBeDefined();
      const openHtml = config!.actions.find((action) => action.id === "open-html");
      expect(openHtml?.key).toBe("o");
      expect(openHtml?.label).toBe("Open in browser");

      const rows = await config!.rows();
      const toast = vi.fn();
      await openHtml!.handler({
        row: rows[0]!,
        selected: [rows[0]!],
        signal: new AbortController().signal,
        toast,
        openModal: vi.fn(),
        closeModal: vi.fn(),
        refresh: vi.fn(),
        exit: vi.fn(),
        suspendAnd: vi.fn(async (fn) => fn())
      } as unknown as ActionContext<void>);

      expect(openExternal).toHaveBeenCalledOnce();
      expect(toast).toHaveBeenCalledWith("Opened in browser", "success");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: stdinIsTTY });
    }
  });

  it("wires Enter to open the selected trace detail in a modal", async () => {
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

      const openModal = vi.fn();
      const exit = vi.fn();
      await open!.handler({
        row: rows[0]!,
        rows: [rows[0]!],
        filter: "",
        refresh: vi.fn(async () => undefined),
        suspendAnd: vi.fn(async (fn) => fn()),
        openModal,
        toast: vi.fn(),
        confirm: vi.fn(async () => true),
        exit
      } satisfies ActionContext<void>);

      expect(exit).not.toHaveBeenCalled();
      expect(openModal).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Trace one",
          content: expect.stringContaining("Opened trace")
        })
      );
      expect(stripAnsi(openModal.mock.calls[0]?.[0].content ?? "")).toContain("assistant ✦ opened");
      expect(output.value).toBe("");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: originalIsTTY
      });
    }
  });

  it("reuses the preview detail cache when opening a trace modal", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true
    });
    try {
      const read = vi.fn(async (reference: TraceReference) =>
        createTrace({
          source: reference.source,
          id: reference.id,
          title: "Cached trace",
          turns: [{ role: "assistant", text: "cached" }]
        })
      );
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
          read
        })
      );

      await runTraceViewer({
        cwd: "/repo",
        homeDir: "/home/me",
        fs: {} as AgentTraceFileSystem
      });

      const config = mocks.runExplorer.mock.calls[0]?.[0] as ExplorerConfig<void> | undefined;
      expect(config).toBeDefined();
      const rows = await config!.rows();
      const detail = await config!.detail.items(rows[0]!, {
        row: rows[0]!,
        width: 80,
        height: 20,
        signal: new AbortController().signal
      });
      const previewContent =
        detail[0]?.renderedContent ??
        detail[0]?.render({
          row: rows[0]!,
          width: 80,
          height: 20,
          signal: new AbortController().signal
        });
      expect(String(previewContent)).toContain("Cached trace");
      read.mockClear();

      const open = config!.actions.find((action) => action.id === "open");
      const openModal = vi.fn();
      await open!.handler({
        row: rows[0]!,
        rows: [rows[0]!],
        filter: "",
        refresh: vi.fn(async () => undefined),
        suspendAnd: vi.fn(async (fn) => fn()),
        openModal,
        toast: vi.fn(),
        confirm: vi.fn(async () => true),
        exit: vi.fn()
      } satisfies ActionContext<void>);

      expect(read).not.toHaveBeenCalled();
      expect(openModal).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Cached trace")
        })
      );
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: originalIsTTY
      });
    }
  });

  it("groups interactive rows into source folders", async () => {
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
              id: "codex-one",
              title: "Newer Codex trace",
              cwd: "/repo",
              updatedAt: new Date("2026-07-01T10:00:00.000Z")
            },
            {
              source: "codex",
              id: "codex-two",
              title: "Older Codex trace",
              cwd: "/repo",
              updatedAt: new Date("2026-07-01T08:00:00.000Z")
            }
          ])
        }),
        createReader({
          id: "poe-code",
          discover: vi.fn(async () => [
            {
              source: "poe-code",
              id: "spawn-one",
              title: "codex",
              path: "/home/me/.poe-code/spawn-logs/trace.jsonl",
              updatedAt: new Date("2026-07-01T11:00:00.000Z")
            }
          ])
        })
      );

      await runTraceViewer({
        cwd: "/repo",
        homeDir: "/home/me",
        fs: {} as AgentTraceFileSystem
      });

      const config = mocks.runExplorer.mock.calls[0]?.[0] as ExplorerConfig<void> | undefined;
      expect(config).toBeDefined();
      const rows = await config!.rows();

      expect(rows.map((row) => ({ title: row.title, group: row.group }))).toEqual([
        { title: "codex", group: "poe-code / spawn-logs" },
        { title: "Newer Codex trace", group: "codex / repo" },
        { title: "Older Codex trace", group: "codex / repo" }
      ]);
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
        openModal: vi.fn(),
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
