import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

describe("openMemory", () => {
  beforeAll(async () => {
    await import("./handle.js");
  });

  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("./audit.js");
    vi.doUnmock("./explain.js");
    vi.doUnmock("./ingest.js");
    vi.doUnmock("./pages.js");
    vi.doUnmock("./query.js");
    vi.doUnmock("./search.js");
    vi.doUnmock("./status.js");
    vi.doUnmock("./tokens.js");
    vi.doUnmock("./write.js");
  });

  it("returns an object with the full memory handle API", async () => {
    const { openMemory } = await import("./handle.js");

    const handle = openMemory({ root: "/repo/.poe-code/memory" });

    expect(handle.root).toBe("/repo/.poe-code/memory");
    expect(handle.listPages).toBeTypeOf("function");
    expect(handle.listMemoryFiles).toBeTypeOf("function");
    expect(handle.readPage).toBeTypeOf("function");
    expect(handle.searchMemory).toBeTypeOf("function");
    expect(handle.statusOf).toBeTypeOf("function");
    expect(handle.computeTokenStats).toBeTypeOf("function");
    expect(handle.explainPage).toBeTypeOf("function");
    expect(handle.writePage).toBeTypeOf("function");
    expect(handle.appendToPage).toBeTypeOf("function");
    expect(handle.clearMemory).toBeTypeOf("function");
    expect(handle.query).toBeTypeOf("function");
    expect(handle.ingest).toBeTypeOf("function");
    expect(handle.auditClaims).toBeTypeOf("function");
  });

  it("throws synchronously when the root is not absolute", async () => {
    const { openMemory } = await import("./handle.js");

    expect(() => openMemory({ root: "./relative" })).toThrowError(
      "openMemory: root must be absolute, got ./relative"
    );
  });

  it("exposes the configured root for inspection", async () => {
    const { openMemory } = await import("./handle.js");

    const handle = openMemory({ root: "/repo/.poe-code/memory" });

    expect(handle.root).toBe("/repo/.poe-code/memory");
  });

  it("binds the root into the underlying free functions", async () => {
    const pages = {
      listPages: vi.fn().mockResolvedValue([]),
      listMemoryFiles: vi.fn().mockResolvedValue([]),
      readPage: vi.fn().mockResolvedValue({
        relPath: "pages/a.md",
        frontmatter: {},
        body: "# A\n",
        bytes: 4,
        mtimeMs: 1
      })
    };
    const search = {
      searchMemory: vi.fn().mockResolvedValue([])
    };
    const status = {
      statusOf: vi.fn().mockResolvedValue({
        pageCount: 0,
        totalBytes: 0,
        lastWriteAt: null,
        initialized: true
      })
    };
    const tokens = {
      computeTokenStats: vi.fn().mockResolvedValue({
        memoryTokens: 0,
        sourceTokens: 0,
        reductionRatio: 0,
        missingSources: []
      })
    };
    const explain = {
      explainPage: vi.fn().mockResolvedValue({
        answer: "",
        citations: [],
        tokensUsed: 0,
        budget: 128,
        exitCode: 0,
        inboundPages: [],
        outboundSources: []
      })
    };
    const write = {
      writePage: vi.fn().mockResolvedValue({ created: [], updated: [], deleted: [] }),
      appendToPage: vi.fn().mockResolvedValue({ created: [], updated: [], deleted: [] }),
      clearMemory: vi.fn().mockResolvedValue(undefined)
    };
    const query = {
      queryMemory: vi.fn().mockResolvedValue({
        answer: "",
        citations: [],
        tokensUsed: 0,
        budget: 256,
        exitCode: 0
      })
    };
    const ingest = {
      ingest: vi.fn().mockResolvedValue({
        diff: { created: [], updated: [], deleted: [] },
        exitCode: 0,
        durationMs: 0,
        cacheHit: false,
        tokens: {
          memoryTokens: 0,
          sourceTokens: 0,
          reductionRatio: 0,
          missingSources: []
        }
      })
    };
    const audit = {
      auditClaims: vi.fn().mockResolvedValue([])
    };

    vi.doMock("./pages.js", () => pages);
    vi.doMock("./search.js", () => search);
    vi.doMock("./status.js", () => status);
    vi.doMock("./tokens.js", () => tokens);
    vi.doMock("./explain.js", () => explain);
    vi.doMock("./write.js", () => write);
    vi.doMock("./query.js", () => query);
    vi.doMock("./ingest.js", () => ingest);
    vi.doMock("./audit.js", () => audit);

    const { openMemory } = await import("./handle.js");
    const handle = openMemory({ root: "/repo/.poe-code/memory" });

    await handle.listPages();
    await handle.listMemoryFiles();
    await handle.readPage("pages/a.md");
    await handle.searchMemory("alpha");
    await handle.statusOf();
    await handle.computeTokenStats();
    await handle.explainPage({ relPath: "pages/a.md", budget: 128 });
    await handle.writePage("pages/a.md", "# A\n", { reason: "create page" });
    await handle.appendToPage("pages/a.md", "\nMore\n", { reason: "append detail" });
    await handle.clearMemory();
    await handle.query({ question: "alpha?", budget: 256 });
    await handle.ingest({
      source: { kind: "file", absPath: "/repo/docs/a.md" },
      reason: "capture docs"
    });
    await handle.auditClaims({ repoRoot: "/repo", rejectUntagged: true });

    expect(pages.listPages).toHaveBeenCalledWith("/repo/.poe-code/memory");
    expect(pages.listMemoryFiles).toHaveBeenCalledWith("/repo/.poe-code/memory");
    expect(pages.readPage).toHaveBeenCalledWith("/repo/.poe-code/memory", "pages/a.md");
    expect(search.searchMemory).toHaveBeenCalledWith("/repo/.poe-code/memory", "alpha");
    expect(status.statusOf).toHaveBeenCalledWith("/repo/.poe-code/memory");
    expect(tokens.computeTokenStats).toHaveBeenCalledWith("/repo/.poe-code/memory");
    expect(explain.explainPage).toHaveBeenCalledWith("/repo/.poe-code/memory", {
      relPath: "pages/a.md",
      budget: 128
    });
    expect(write.writePage).toHaveBeenCalledWith("/repo/.poe-code/memory", "pages/a.md", "# A\n", {
      reason: "create page"
    });
    expect(write.appendToPage).toHaveBeenCalledWith(
      "/repo/.poe-code/memory",
      "pages/a.md",
      "\nMore\n",
      { reason: "append detail" }
    );
    expect(write.clearMemory).toHaveBeenCalledWith("/repo/.poe-code/memory");
    expect(query.queryMemory).toHaveBeenCalledWith("/repo/.poe-code/memory", {
      question: "alpha?",
      budget: 256
    });
    expect(ingest.ingest).toHaveBeenCalledWith("/repo/.poe-code/memory", {
      source: { kind: "file", absPath: "/repo/docs/a.md" },
      reason: "capture docs"
    });
    expect(audit.auditClaims).toHaveBeenCalledWith("/repo/.poe-code/memory", "/repo", {
      rejectUntagged: true
    });
  });

  it("isolates writes and reads across two handles with different roots", async () => {
    const { openMemory } = await import("./handle.js");
    const { initMemory } = await import("./init.js");

    await initMemory("/repo-a/.poe-code/memory");
    await initMemory("/repo-b/.poe-code/memory");

    const left = openMemory({ root: "/repo-a/.poe-code/memory" });
    const right = openMemory({ root: "/repo-b/.poe-code/memory" });

    await left.writePage("pages/left.md", "# Left\n", { reason: "create left page" });
    await right.writePage("pages/right.md", "# Right\n", { reason: "create right page" });

    await expect(left.readPage("pages/left.md")).resolves.toMatchObject({ body: "# Left\n" });
    await expect(right.readPage("pages/right.md")).resolves.toMatchObject({ body: "# Right\n" });
    await expect(left.readPage("pages/right.md")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(right.readPage("pages/left.md")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("prefers the per-call agent over the handle default", async () => {
    const query = {
      queryMemory: vi.fn().mockResolvedValue({
        answer: "",
        citations: [],
        tokensUsed: 0,
        budget: 512,
        exitCode: 0
      })
    };

    vi.doMock("./query.js", () => query);

    const { openMemory } = await import("./handle.js");
    const handle = openMemory({ root: "/repo/.poe-code/memory", agent: "handle-agent" });

    await handle.query({ question: "who?", budget: 512, agent: "call-agent" });

    expect(query.queryMemory).toHaveBeenCalledWith("/repo/.poe-code/memory", {
      question: "who?",
      budget: 512,
      agent: "call-agent"
    });
  });

  it("uses the handle default agent when the call does not provide one", async () => {
    const ingest = {
      ingest: vi.fn().mockResolvedValue({
        diff: { created: [], updated: [], deleted: [] },
        exitCode: 0,
        durationMs: 0,
        cacheHit: false,
        tokens: {
          memoryTokens: 0,
          sourceTokens: 0,
          reductionRatio: 0,
          missingSources: []
        }
      })
    };

    vi.doMock("./ingest.js", () => ingest);

    const { openMemory } = await import("./handle.js");
    const handle = openMemory({ root: "/repo/.poe-code/memory", agent: "handle-agent" });

    await handle.ingest({
      source: { kind: "file", absPath: "/repo/docs/source.md" },
      reason: "capture docs"
    });

    expect(ingest.ingest).toHaveBeenCalledWith("/repo/.poe-code/memory", {
      source: { kind: "file", absPath: "/repo/docs/source.md" },
      reason: "capture docs",
      agent: "handle-agent"
    });
  });

  it("leaves agent resolution untouched when neither the handle nor the call sets it", async () => {
    const explain = {
      explainPage: vi.fn().mockResolvedValue({
        answer: "",
        citations: [],
        tokensUsed: 0,
        budget: 1024,
        exitCode: 0,
        inboundPages: [],
        outboundSources: []
      })
    };

    vi.doMock("./explain.js", () => explain);

    const { openMemory } = await import("./handle.js");
    const handle = openMemory({ root: "/repo/.poe-code/memory" });

    await handle.explainPage({ relPath: "pages/a.md", budget: 1024 });

    expect(explain.explainPage).toHaveBeenCalledWith("/repo/.poe-code/memory", {
      relPath: "pages/a.md",
      budget: 1024
    });
  });
});
