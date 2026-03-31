import { describe, expect, it } from "bun:test";
import { DuplicateToolError } from "./errors.js";
import { normalizeTool, ToolRegistry } from "./tools.js";
import type { Tool, ToolContext, ToolEvent } from "./types.js";

function createToolContext(): ToolContext {
  return {
    fork: async () => ({ output: "", messages: [] }),
    spawn: async () => ({ output: "", messages: [] }),
    signal: new AbortController().signal,
  };
}

describe("normalizeTool", () => {
  it("rejects empty tool names after normalization", () => {
    expect(() =>
      normalizeTool({
        name: "   ",
        call: () => "ok",
      }),
    ).toThrow("Tool name must be a non-empty string.");
  });

  it("wraps sync call() as an async generator", async () => {
    const tool: Tool = {
      name: "sync-tool",
      call: () => ({ ok: true }),
    };

    const normalized = normalizeTool(tool);
    const result = await normalized.invoke({}, createToolContext()).next();

    expect(result).toEqual({ done: true, value: { ok: true } });
    expect(normalized.visibility).toBe("model");
  });

  it("wraps async call() as an async generator", async () => {
    const tool: Tool = {
      name: "async-tool",
      call: async () => ({ ok: "async" }),
    };

    const normalized = normalizeTool(tool);
    const result = await normalized.invoke({}, createToolContext()).next();

    expect(result).toEqual({ done: true, value: { ok: "async" } });
  });

  it("uses async generator call() directly", async () => {
    async function* call(): AsyncGenerator<ToolEvent, unknown, void> {
      yield { type: "progress", message: "step-1" };
      return { done: true };
    }

    const normalized = normalizeTool({
      name: "streaming-tool",
      call,
    });

    const invocation = normalized.invoke({}, createToolContext());

    await expect(invocation.next()).resolves.toEqual({
      done: false,
      value: { type: "progress", message: "step-1" },
    });
    await expect(invocation.next()).resolves.toEqual({
      done: true,
      value: { done: true },
    });
  });

  it("surfaces synchronous call() errors on invoke()", async () => {
    const tool: Tool = {
      name: "sync-throw",
      call: () => {
        throw new Error("sync failure");
      },
    };

    const normalized = normalizeTool(tool);
    await expect(normalized.invoke({}, createToolContext()).next()).rejects.toThrow("sync failure");
  });

  it("surfaces rejected async call() errors on invoke()", async () => {
    const tool: Tool = {
      name: "async-throw",
      call: async () => {
        throw new Error("async failure");
      },
    };

    const normalized = normalizeTool(tool);
    await expect(normalized.invoke({}, createToolContext()).next()).rejects.toThrow("async failure");
  });
});

describe("ToolRegistry", () => {
  it("registers and resolves tools by normalized name", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "  search.web  ",
      call: () => "ok",
    });

    expect(registry.get("search.web")?.name).toBe("search.web");
    expect(registry.getAll().map(tool => tool.name)).toEqual(["search.web"]);
  });

  it("throws DuplicateToolError on name collision", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "search.web",
      call: () => "first",
    });

    expect(() => {
      registry.register({
        name: " search.web ",
        call: () => "second",
      });
    }).toThrowError(DuplicateToolError);
  });

  it("computes model-visible tools from visibility and active skills", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "always-visible",
      call: () => "model",
    });
    registry.register({
      name: "repo.search",
      visibility: "skill",
      call: () => "skill",
    });
    registry.register({
      name: "internal.audit",
      visibility: "internal",
      call: () => "internal",
    });

    expect(registry.getActiveTools().map(tool => tool.name)).toEqual(["always-visible"]);
    expect(registry.getActiveTools(["repo"]).map(tool => tool.name)).toEqual([
      "always-visible",
      "repo.search",
    ]);
    expect(registry.getActiveTools(["repo.search"]).map(tool => tool.name)).toEqual([
      "always-visible",
      "repo.search",
    ]);

    expect(registry.get("internal.audit")?.visibility).toBe("internal");
    expect(registry.getActiveTools(["internal"]).map(tool => tool.name)).toEqual(["always-visible"]);
  });

  it("matches namespace wildcard selectors", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "git.status",
      visibility: "skill",
      call: () => "ok",
    });

    expect(registry.getActiveTools(["git.*"]).map(tool => tool.name)).toEqual(["git.status"]);
  });

  it("normalizes active skill names before matching", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "repo.search",
      visibility: "skill",
      call: () => "ok",
    });

    expect(registry.getActiveTools(["  repo  ", "repo", ""])).toEqual([registry.get("repo.search")]);
    expect(registry.getActiveTools(["  repo.*  ", "repo.*"])).toEqual([registry.get("repo.search")]);
  });

  it("keeps MCP tool namespace prefixes to avoid collisions", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "status",
      call: () => "local",
    });
    registry.register({
      name: "mcp-server.status",
      call: () => "remote",
    });

    expect(registry.getAll().map(tool => tool.name)).toEqual(["status", "mcp-server.status"]);
    expect(registry.get("mcp-server.status")).toBeDefined();
  });
});
