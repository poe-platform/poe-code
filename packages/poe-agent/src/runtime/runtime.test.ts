import { describe, expect, it, vi } from "vitest";
import { runAcpCore, type AcpModel, type AcpModelResponse } from "./acp-core.js";
import { AgentHost, createInMemorySpawnSession } from "./agent-host.js";
import { createResolvedAgentConfig, resolvePluginSetupOrder, toRuntimePlugins } from "./config.js";
import mcpPlugin from "../plugins/poe-agent-plugin-mcp.js";
import { DuplicateToolError, PluginSetupError, PromptTransformError } from "./errors.js";
import {
  AbortError,
  HookRegistry,
  applyHookDecision,
  applyInputDecision,
  applyToolCallDecision,
  applyToolResultDecision,
  createNotificationHookContext,
  createPostCompactionHookContext,
  createPostIterationHookContext,
  createPreCompactionHookContext,
  createPostToolUseHookContext,
  createPreIterationHookContext,
  createPreToolUseHookContext,
  createSessionStartHookContext,
  createStopHookContext,
  createUserPromptSubmitHookContext
} from "./hooks.js";
import { PromptRegistry } from "./prompts.js";
import { createRunContext } from "./run-context.js";
import { toAcpModelResponse, type LegacyAcpModelResponse } from "../testing/model-response.js";
import { InvalidToolNameError } from "./tool-names.js";
import { normalizeTool, ToolRegistry } from "./tools.js";
import type { AcpEvent, AcpHost, ChatMessage, Tool, ToolContext, ToolEvent } from "./types.js";

// --- shared helpers (acp-core + agent-host) ---

function createModel(
  responses: Array<LegacyAcpModelResponse | AcpModelResponse | Error>
): AcpModel {
  const queue = [...responses];

  return {
    complete: vi.fn(async () => {
      const next = queue.shift();
      if (!next) {
        throw new Error("Unexpected model call");
      }

      if (next instanceof Error) {
        throw next;
      }

      return toAcpModelResponse(next);
    })
  };
}

async function collectEvents(events: AsyncIterable<AcpEvent>): Promise<AcpEvent[]> {
  const collected: AcpEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

function createIterationComplete(result = "summary note") {
  return vi.fn(async () => result);
}

function createIterationRunHook() {
  return vi.fn(async () => ({ type: "continue" as const }));
}

// --- errors ---

describe("runtime errors", () => {
  it("creates DuplicateToolError with the colliding tool name", () => {
    const error = new DuplicateToolError("search_web");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DuplicateToolError");
    expect(error.message).toContain("search_web");
    expect(error.toolName).toBe("search_web");
  });

  it("creates PluginSetupError and wraps the original error", () => {
    const cause = new Error("boom");
    const error = new PluginSetupError("audit-plugin", cause);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PluginSetupError");
    expect(error.message).toContain("audit-plugin");
    expect(error.pluginName).toBe("audit-plugin");
    expect(error.cause).toBe(cause);
  });

  it("preserves non-Error causes in PluginSetupError", () => {
    const cause = { reason: "misconfigured" };
    const error = new PluginSetupError("audit-plugin", cause);

    expect(error.cause).toBe(cause);
  });

  it("creates PromptTransformError and wraps the original error", () => {
    const cause = new Error("invalid prompt");
    const error = new PromptTransformError("sanitize-plugin", cause);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PromptTransformError");
    expect(error.message).toContain("sanitize-plugin");
    expect(error.pluginName).toBe("sanitize-plugin");
    expect(error.cause).toBe(cause);
  });

  it("preserves primitive causes in PromptTransformError", () => {
    const cause = "invalid-token";
    const error = new PromptTransformError("sanitize-plugin", cause);

    expect(error.cause).toBe(cause);
  });
});

// --- config ---

describe("runtime/config", () => {
  it("creates frozen config snapshots with cloned arrays", () => {
    const input = {
      model: "gpt-5",
      plugins: [
        {
          name: "plugin-a",
          tools: [{ name: "tool_a", call: () => "ok" }]
        }
      ]
    };

    const resolved = createResolvedAgentConfig(input);

    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.plugins)).toBe(true);
    expect("mcpServers" in resolved).toBe(false);

    input.plugins.push({ name: "plugin-b" });

    expect(resolved.plugins).toHaveLength(1);
  });

  it("resolves dependencies in topological order", () => {
    const ordered = resolvePluginSetupOrder([
      {
        name: "beta",
        dependencies: ["alpha"]
      },
      {
        name: "alpha"
      },
      {
        name: "gamma",
        dependencies: ["beta"]
      }
    ]);

    expect(ordered.map((plugin) => plugin.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("resolves dependencies even when plugin names contain extra whitespace", () => {
    const ordered = resolvePluginSetupOrder([
      {
        name: " beta ",
        dependencies: ["alpha"]
      },
      {
        name: " alpha "
      }
    ]);

    expect(ordered.map((plugin) => plugin.name)).toEqual([" alpha ", " beta "]);
  });

  it("throws for plugin dependency cycles", () => {
    expect(() =>
      resolvePluginSetupOrder([
        {
          name: "alpha",
          dependencies: ["beta"]
        },
        {
          name: "beta",
          dependencies: ["alpha"]
        }
      ])
    ).toThrow('Circular plugin dependencies detected: "alpha" -> "beta" -> "alpha".');
  });

  it("keeps MCP in the plugin list instead of a separate config bucket", () => {
    const runtimePlugins = toRuntimePlugins(
      createResolvedAgentConfig({
        plugins: [
          { name: "alpha" },
          mcpPlugin({ name: "repo", command: "node", args: ["server.js"] })
        ]
      })
    );

    expect(runtimePlugins.map((plugin) => plugin.name)).toEqual(["alpha", "mcp:repo"]);
  });
});

// --- run-context ---

function createErrorLogger() {
  return {
    error: vi.fn<(message: string, error?: unknown) => void>()
  };
}

describe("RunContext", () => {
  it("creates fresh mutable state for each context", () => {
    const first = createRunContext({ activeSkills: [" repo ", "repo", ""] });
    const second = createRunContext();

    first.messages.push({ role: "user", content: "first" });

    expect(first).not.toBe(second);
    expect(first.messages).toEqual([{ role: "user", content: "first" }]);
    expect(second.messages).toEqual([]);
    expect(first.tools).not.toBe(second.tools);
    expect(first.prompts).not.toBe(second.prompts);
    expect(first.hooks).not.toBe(second.hooks);
    expect(first.abortController).not.toBe(second.abortController);
    expect(first.activeSkills).toEqual(["repo"]);
    expect(second.activeSkills).toEqual([]);
  });

  it("tracks child runs and removes them when settled", async () => {
    const context = createRunContext();
    const childRun = context.trackChildRun(Promise.resolve("done"));

    expect(context.getChildRunCount()).toBe(1);
    await expect(childRun).resolves.toBe("done");
    expect(context.getChildRunCount()).toBe(0);
  });

  it("removes rejected child runs when they settle", async () => {
    const context = createRunContext();
    const childRun = context.trackChildRun(Promise.reject(new Error("child failed")));

    expect(context.getChildRunCount()).toBe(1);
    await expect(childRun).rejects.toThrow("child failed");
    expect(context.getChildRunCount()).toBe(0);
  });

  it("disposes hooks in reverse registration order", async () => {
    const context = createRunContext();
    const callOrder: string[] = [];

    context.registerDisposeHook(() => {
      callOrder.push("first");
    });
    context.registerDisposeHook(() => {
      callOrder.push("second");
    });

    await context.dispose();

    expect(callOrder).toEqual(["second", "first"]);
  });

  it("logs each dispose failure, continues, and throws AggregateError", async () => {
    const logger = createErrorLogger();
    const context = createRunContext({ logger });

    context.registerDisposeHook(async () => {
      throw new Error("first failure");
    });
    context.registerDisposeHook(() => {
      throw new Error("second failure");
    });

    await expect(context.dispose()).rejects.toEqual(
      expect.objectContaining({
        name: "AggregateError",
        errors: [expect.any(Error), expect.any(Error)]
      })
    );

    expect(logger.error).toHaveBeenCalledTimes(2);
    expect((logger.error.mock.calls[0] ?? [])[0]).toContain("Dispose hook failed");
    expect((logger.error.mock.calls[1] ?? [])[0]).toContain("Dispose hook failed");
  });

  it("is idempotent and does not re-run disposal hooks", async () => {
    const context = createRunContext();
    const disposeHook = vi.fn();

    context.registerDisposeHook(disposeHook);

    await context.dispose();
    await context.dispose();

    expect(disposeHook).toHaveBeenCalledTimes(1);
  });

  it("retries only disposal hooks that failed previously", async () => {
    const context = createRunContext();
    const successfulHook = vi.fn(async () => undefined);
    const retriedHook = vi.fn()
      .mockRejectedValueOnce(new Error("cleanup temporarily failed"))
      .mockResolvedValueOnce(undefined);

    context.registerDisposeHook(successfulHook);
    context.registerDisposeHook(retriedHook);

    await expect(context.dispose()).rejects.toThrow("RunContext disposal failed.");
    await expect(context.dispose()).resolves.toBeUndefined();

    expect(retriedHook).toHaveBeenCalledTimes(2);
    expect(successfulHook).toHaveBeenCalledTimes(1);
  });

  it("is safe when dispose is called concurrently", async () => {
    const context = createRunContext();
    const order: string[] = [];
    let release = () => undefined;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });

    context.registerDisposeHook(async () => {
      order.push("start");
      await blocker;
      order.push("finish");
    });

    const firstDispose = context.dispose();
    const secondDispose = context.dispose();

    release();

    await Promise.all([firstDispose, secondDispose]);

    expect(order).toEqual(["start", "finish"]);
  });
});

// --- prompts ---

describe("PromptRegistry", () => {
  it("builds initial context from user and base system prompts", async () => {
    const registry = new PromptRegistry();

    await expect(registry.compile("Fix tests", "Base system")).resolves.toEqual({
      baseSystemPrompt: "Base system",
      system: "Base system",
      userPrompt: "Fix tests"
    });
  });

  it("builds initial context with user prompt only when base prompt is missing", async () => {
    const registry = new PromptRegistry();

    await expect(registry.compile("Fix tests")).resolves.toEqual({
      userPrompt: "Fix tests"
    });
  });

  it("chains transforms in registration order", async () => {
    const registry = new PromptRegistry();
    const callOrder: string[] = [];

    registry.addTransform((ctx) => {
      callOrder.push("first");
      return {
        ...ctx,
        metadata: { order: ["first"] },
        system: `${ctx.system ?? ""}\nfirst`.trim()
      };
    });

    registry.addTransform(async (ctx) => {
      callOrder.push("second");
      return {
        ...ctx,
        metadata: { order: [...((ctx.metadata?.order as string[] | undefined) ?? []), "second"] },
        system: `${ctx.system ?? ""}\nsecond`.trim()
      };
    });

    const compiled = await registry.compile("User task", "Base");

    expect(callOrder).toEqual(["first", "second"]);
    expect(compiled.system).toBe("Base\nfirst\nsecond");
    expect(compiled.metadata).toEqual({ order: ["first", "second"] });
  });

  it("awaits async transforms sequentially", async () => {
    const registry = new PromptRegistry();
    const callOrder: string[] = [];

    registry.addTransform(async (ctx) => {
      await Promise.resolve();
      callOrder.push("first");
      return {
        ...ctx,
        system: "first"
      };
    });

    registry.addTransform(async (ctx) => {
      callOrder.push("second");
      return {
        ...ctx,
        system: `${ctx.system ?? ""}\nsecond`.trim()
      };
    });

    const compiled = await registry.compile("User task");

    expect(callOrder).toEqual(["first", "second"]);
    expect(compiled.system).toBe("first\nsecond");
  });

  it("keeps userPrompt explicit through the entire transform pipeline", async () => {
    const registry = new PromptRegistry();
    const seenUserPrompts: string[] = [];

    registry.addTransform((ctx) => {
      seenUserPrompts.push(ctx.userPrompt);
      return {
        ...ctx,
        userPrompt: `${ctx.userPrompt} merged`,
        system: `${ctx.system ?? ""}\n${ctx.userPrompt}`.trim()
      };
    });

    registry.addTransform((ctx) => {
      seenUserPrompts.push(ctx.userPrompt);
      return {
        ...ctx,
        metadata: { transformed: true }
      };
    });

    const compiled = await registry.compile("Keep me explicit", "Base");

    expect(seenUserPrompts).toEqual(["Keep me explicit", "Keep me explicit"]);
    expect(compiled.userPrompt).toBe("Keep me explicit");
    expect(compiled.system).toBe("Base\nKeep me explicit");
  });

  it("restores explicit userPrompt even when a transform mutates context in place", async () => {
    const registry = new PromptRegistry();
    const seenUserPrompts: string[] = [];

    registry.addTransform((ctx) => {
      ctx.userPrompt = "mutated";
      return ctx;
    });

    registry.addTransform((ctx) => {
      seenUserPrompts.push(ctx.userPrompt);
      return {
        ...ctx
      };
    });

    const compiled = await registry.compile("original", "Base");

    expect(seenUserPrompts).toEqual(["original"]);
    expect(compiled.userPrompt).toBe("original");
  });

  it("does not leak state across multiple compile calls", async () => {
    const registry = new PromptRegistry();

    registry.addTransform((ctx) => ({
      ...ctx,
      metadata: {
        invocations: ((ctx.metadata?.invocations as number | undefined) ?? 0) + 1
      }
    }));

    const first = await registry.compile("one", "Base");
    const second = await registry.compile("two", "Base");

    expect(first).toEqual({
      baseSystemPrompt: "Base",
      system: "Base",
      userPrompt: "one",
      metadata: { invocations: 1 }
    });

    expect(second).toEqual({
      baseSystemPrompt: "Base",
      system: "Base",
      userPrompt: "two",
      metadata: { invocations: 1 }
    });
  });
});

// --- tools ---

function createToolContext(): ToolContext {
  return {
    fork: async () => ({ output: "", messages: [] }),
    spawn: async () => ({ output: "", messages: [] }),
    signal: new AbortController().signal
  };
}

describe("normalizeTool", () => {
  it("rejects empty tool names after normalization", () => {
    expect(() =>
      normalizeTool({
        name: "   ",
        call: () => "ok"
      })
    ).toThrowError(InvalidToolNameError);
  });

  it("wraps sync call() as an async generator", async () => {
    const tool: Tool = {
      name: "sync-tool",
      call: () => ({ ok: true })
    };

    const normalized = normalizeTool(tool);
    const result = await normalized.invoke({}, createToolContext()).next();

    expect(result).toEqual({ done: true, value: { ok: true } });
    expect(normalized.visibility).toBe("model");
  });

  it("wraps async call() as an async generator", async () => {
    const tool: Tool = {
      name: "async-tool",
      call: async () => ({ ok: "async" })
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
      call
    });

    const invocation = normalized.invoke({}, createToolContext());

    await expect(invocation.next()).resolves.toEqual({
      done: false,
      value: { type: "progress", message: "step-1" }
    });
    await expect(invocation.next()).resolves.toEqual({
      done: true,
      value: { done: true }
    });
  });

  it("surfaces synchronous call() errors on invoke()", async () => {
    const tool: Tool = {
      name: "sync-throw",
      call: () => {
        throw new Error("sync failure");
      }
    };

    const normalized = normalizeTool(tool);
    await expect(normalized.invoke({}, createToolContext()).next()).rejects.toThrow("sync failure");
  });

  it("surfaces rejected async call() errors on invoke()", async () => {
    const tool: Tool = {
      name: "async-throw",
      call: async () => {
        throw new Error("async failure");
      }
    };

    const normalized = normalizeTool(tool);
    await expect(normalized.invoke({}, createToolContext()).next()).rejects.toThrow(
      "async failure"
    );
  });
});

describe("ToolRegistry", () => {
  it("registers and resolves tools by exact name", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "search_web",
      call: () => "ok"
    });

    expect(registry.get("search_web")?.name).toBe("search_web");
    expect(registry.getAll().map((tool) => tool.name)).toEqual(["search_web"]);
  });

  it("throws DuplicateToolError on name collision", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "search_web",
      call: () => "first"
    });

    expect(() => {
      registry.register({
        name: "search_web",
        call: () => "second"
      });
    }).toThrowError(DuplicateToolError);
  });

  it("computes model-visible tools from visibility and active tool selectors", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "always-visible",
      call: () => "model"
    });
    registry.register({
      name: "repo_search",
      visibility: "skill",
      call: () => "skill"
    });
    registry.register({
      name: "internal_audit",
      visibility: "internal",
      call: () => "internal"
    });

    expect(registry.getActiveTools().map((tool) => tool.name)).toEqual(["always-visible"]);
    expect(registry.getActiveTools(["repo_search"]).map((tool) => tool.name)).toEqual([
      "always-visible",
      "repo_search"
    ]);
    expect(registry.getActiveTools(["repo_search"]).map((tool) => tool.name)).toEqual([
      "always-visible",
      "repo_search"
    ]);

    expect(registry.get("internal_audit")?.visibility).toBe("internal");
    expect(registry.getActiveTools(["internal_audit"]).map((tool) => tool.name)).toEqual([
      "always-visible"
    ]);
  });

  it("matches exact tool selectors", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "git_status",
      visibility: "skill",
      call: () => "ok"
    });

    expect(registry.getActiveTools(["git_status"]).map((tool) => tool.name)).toEqual([
      "git_status"
    ]);
  });

  it("matches MCP-style underscore namespace selectors", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "repo_search",
      visibility: "skill",
      call: () => "ok"
    });
    registry.register({
      name: "repo_status",
      visibility: "skill",
      call: () => "ok"
    });
    registry.register({
      name: "repo2_search",
      visibility: "skill",
      call: () => "ok"
    });

    expect(registry.getActiveTools(["repo"]).map((tool) => tool.name)).toEqual([
      "repo_search",
      "repo_status"
    ]);
    expect(registry.getActiveTools(["repo.*"]).map((tool) => tool.name)).toEqual([
      "repo_search",
      "repo_status"
    ]);
  });

  it("normalizes active tool selectors before matching", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "repo_search",
      visibility: "skill",
      call: () => "ok"
    });

    expect(registry.getActiveTools(["  repo_search  ", "repo_search", ""])).toEqual([
      registry.get("repo_search")
    ]);
    expect(registry.getActiveTools(["  repo_search  ", "repo_search"])).toEqual([
      registry.get("repo_search")
    ]);
  });

  it("keeps MCP tool namespace prefixes to avoid collisions", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "status",
      call: () => "local"
    });
    registry.register({
      name: "mcp-server_status",
      call: () => "remote"
    });

    expect(registry.getAll().map((tool) => tool.name)).toEqual(["status", "mcp-server_status"]);
    expect(registry.get("mcp-server_status")).toBeDefined();
  });
});

// --- hooks ---

function createSignal(): AbortSignal {
  return new AbortController().signal;
}

describe("HookRegistry", () => {
  it("runs hooks in registration order for the same event", async () => {
    const registry = new HookRegistry();
    const calls: string[] = [];

    registry.add({
      name: "first",
      hooks: {
        preToolUse() {
          calls.push("first");
        }
      }
    });

    registry.add({
      name: "second",
      hooks: {
        preToolUse() {
          calls.push("second");
        }
      }
    });

    const ctx = createPreToolUseHookContext({
      tool: "read_file",
      args: { path: "README.md" },
      intentId: "intent-1",
      session: new Map(),
      messages: [],
      signal: createSignal()
    });

    const decision = await registry.run("preToolUse", ctx);

    expect(calls).toEqual(["first", "second"]);
    expect(decision).toBeUndefined();
  });

  it("returns the first non-continue decision and still runs remaining hooks", async () => {
    const registry = new HookRegistry();
    const calls: string[] = [];

    registry.add({
      name: "first",
      hooks: {
        preToolUse() {
          calls.push("first");
          return "skip";
        }
      }
    });

    registry.add({
      name: "second",
      hooks: {
        preToolUse() {
          calls.push("second");
          return { reject: "blocked" };
        }
      }
    });

    const decision = await registry.run(
      "preToolUse",
      createPreToolUseHookContext({
        tool: "run_command",
        args: { command: "rm -rf /" },
        intentId: "intent-2",
        session: new Map(),
        messages: [],
        signal: createSignal()
      })
    );

    expect(calls).toEqual(["first", "second"]);
    expect(decision).toBe("skip");
  });

  it("treats undefined decisions as continue", async () => {
    const registry = new HookRegistry();

    registry.add({
      name: "first",
      hooks: {
        preIteration() {
          return;
        }
      }
    });

    registry.add({
      name: "second",
      hooks: {
        preIteration() {
          return undefined;
        }
      }
    });

    const decision = await registry.run(
      "preIteration",
      createPreIterationHookContext({
        iterationNumber: 1,
        tokenCount: 42,
        messages: [],
        signal: createSignal(),
        fork: async (prompt) => ({ output: prompt, messages: [] }),
        complete: createIterationComplete(),
        runHook: createIterationRunHook()
      })
    );

    expect(decision).toBeUndefined();
  });

  it("continues running hooks after an abort decision and keeps first decision", async () => {
    const registry = new HookRegistry();
    const calls: string[] = [];

    registry.add({
      name: "first",
      hooks: {
        postIteration() {
          calls.push("first");
          return "abort";
        }
      }
    });

    registry.add({
      name: "second",
      hooks: {
        postIteration() {
          calls.push("second");
          return;
        }
      }
    });

    const decision = await registry.run(
      "postIteration",
      createPostIterationHookContext({
        iterationNumber: 3,
        tokenCount: 9,
        messages: [],
        signal: createSignal(),
        fork: async (prompt) => ({ output: prompt, messages: [] }),
        complete: createIterationComplete(),
        runHook: createIterationRunHook()
      })
    );

    expect(calls).toEqual(["first", "second"]);
    expect(decision).toBe("abort");
  });

  it("supports session, compaction, notification, and stop hooks", async () => {
    const registry = new HookRegistry();
    const calls: string[] = [];

    registry.add({
      name: "lifecycle",
      hooks: {
        sessionStart() {
          calls.push("sessionStart");
        },
        userPromptSubmit() {
          calls.push("userPromptSubmit");
        },
        preCompaction() {
          calls.push("preCompaction");
        },
        postCompaction() {
          calls.push("postCompaction");
        },
        notification() {
          calls.push("notification");
          return "skip";
        },
        stop() {
          calls.push("stop");
        }
      }
    });

    expect(
      await registry.run(
        "sessionStart",
        createSessionStartHookContext({
          session: new Map(),
          messages: [],
          signal: createSignal()
        })
      )
    ).toBeUndefined();

    expect(
      await registry.run(
        "userPromptSubmit",
        createUserPromptSubmitHookContext({
          prompt: "hello",
          messages: [{ role: "user", content: "hello" }],
          signal: createSignal()
        })
      )
    ).toBeUndefined();

    expect(
      await registry.run(
        "preCompaction",
        createPreCompactionHookContext({
          tokenCount: 42,
          force: false,
          messages: [],
          signal: createSignal()
        })
      )
    ).toBeUndefined();

    expect(
      await registry.run(
        "postCompaction",
        createPostCompactionHookContext({
          tokenCount: 12,
          summary: "summary",
          droppedMessages: [{ role: "assistant", content: "dropped" }],
          messages: [{ role: "system", content: "summary" }],
          signal: createSignal()
        })
      )
    ).toBeUndefined();

    expect(
      await registry.run(
        "notification",
        createNotificationHookContext({
          event: "tool.progress",
          message: "working",
          data: { intentId: "intent-1" },
          messages: [],
          signal: createSignal()
        })
      )
    ).toBe("skip");

    expect(
      await registry.run(
        "stop",
        createStopHookContext({
          status: "completed",
          output: "done",
          toolCalls: [],
          messages: [{ role: "assistant", content: "done" }],
          signal: createSignal()
        })
      )
    ).toBeUndefined();

    expect(calls).toEqual([
      "sessionStart",
      "userPromptSubmit",
      "preCompaction",
      "postCompaction",
      "notification",
      "stop"
    ]);
  });
});

describe("hook context factories", () => {
  it("creates mutable preToolUse context", () => {
    const args = { path: "README.md" };
    const messages: ChatMessage[] = [{ role: "user", content: "read it" }];
    const session = new Map<string, unknown>([["mode", "read"]]);

    const ctx = createPreToolUseHookContext({
      tool: "read_file",
      args,
      intentId: "intent-3",
      session,
      messages,
      signal: createSignal()
    });

    ctx.args = { path: "package.json" };
    ctx.messages.push({ role: "assistant", content: "ok" });

    expect(ctx.args).toEqual({ path: "package.json" });
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages).toBe(messages);
    expect(ctx.session).toBe(session);
  });

  it("creates postToolUse context with result and error", () => {
    const session = new Map<string, unknown>([["mode", "edit"]]);
    const ctx = createPostToolUseHookContext({
      tool: "search",
      args: { q: "hooks" },
      intentId: "intent-4",
      result: { total: 1 },
      error: "partial",
      session,
      messages: [],
      signal: createSignal()
    });

    expect(ctx.result).toEqual({ total: 1 });
    expect(ctx.error).toBe("partial");
    expect(ctx.session).toBe(session);
  });

  it("creates pre/post iteration contexts with mutable messages, fork, completion, and hook access", async () => {
    const fork = vi.fn(async (prompt: string) => ({
      output: `summary:${prompt}`,
      messages: []
    }));
    const complete = vi.fn(async () => "summary note");
    const runHook = vi.fn(async () => ({ type: "skip" as const }));
    const messages: ChatMessage[] = [{ role: "user", content: "start" }];

    const preCtx = createPreIterationHookContext({
      iterationNumber: 2,
      tokenCount: 100,
      messages,
      signal: createSignal(),
      fork,
      complete,
      runHook
    });

    preCtx.messages.push({ role: "assistant", content: "working" });

    const postCtx = createPostIterationHookContext({
      iterationNumber: preCtx.iterationNumber,
      tokenCount: preCtx.tokenCount,
      messages: preCtx.messages,
      signal: preCtx.signal,
      fork,
      complete,
      runHook
    });

    const forkResult = await postCtx.fork("compact");
    const completeResult = await postCtx.complete([{ role: "user", content: "compact" }]);
    const hookResult = await postCtx.runHook(
      "notification",
      createNotificationHookContext({
        event: "background-output",
        messages: postCtx.messages,
        signal: postCtx.signal
      })
    );

    expect(postCtx.messages).toHaveLength(2);
    expect(postCtx.messages).toBe(messages);
    expect(forkResult).toEqual({ output: "summary:compact", messages: [] });
    expect(completeResult).toBe("summary note");
    expect(hookResult).toEqual({ type: "skip" });
    expect(fork).toHaveBeenCalledWith("compact");
    expect(complete).toHaveBeenCalledWith([{ role: "user", content: "compact" }]);
    expect(runHook).toHaveBeenCalledWith(
      "notification",
      expect.objectContaining({
        event: "background-output",
        messages
      })
    );
  });

  it("creates session, prompt, compaction, notification, and stop contexts", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "draft" }];
    const toolCalls = [
      {
        intentId: "intent-1",
        tool: "read_file",
        args: { path: "README.md" },
        status: "success" as const,
        result: "ok"
      }
    ];
    const droppedMessages: ChatMessage[] = [{ role: "assistant", content: "older reply" }];

    const sessionStart = createSessionStartHookContext({
      session: new Map(),
      messages,
      signal: createSignal()
    });
    sessionStart.messages.push({ role: "assistant", content: "seeded" });

    const userPromptSubmit = createUserPromptSubmitHookContext({
      prompt: "draft",
      messages,
      signal: createSignal()
    });
    userPromptSubmit.prompt = "rewritten";

    const preCompaction = createPreCompactionHookContext({
      tokenCount: 120,
      force: false,
      messages,
      signal: createSignal()
    });
    preCompaction.force = true;

    const postCompaction = createPostCompactionHookContext({
      tokenCount: 40,
      summary: "summary note",
      droppedMessages,
      messages,
      signal: createSignal()
    });

    const notification = createNotificationHookContext({
      event: "tool.progress",
      message: "working",
      data: { handle: "bg-1" },
      messages,
      signal: createSignal()
    });

    const stop = createStopHookContext({
      status: "completed",
      output: "done",
      toolCalls,
      messages,
      signal: createSignal()
    });

    expect(sessionStart.messages).toBe(messages);
    expect(sessionStart.messages).toHaveLength(2);
    expect(userPromptSubmit.prompt).toBe("rewritten");
    expect(preCompaction.force).toBe(true);
    expect(postCompaction.summary).toBe("summary note");
    expect(postCompaction.droppedMessages).toBe(droppedMessages);
    expect(notification).toEqual({
      event: "tool.progress",
      message: "working",
      data: { handle: "bg-1" },
      messages,
      signal: notification.signal
    });
    expect(stop.status).toBe("completed");
    expect(stop.output).toBe("done");
    expect(stop.toolCalls).toEqual(toolCalls);
  });
});

describe("applyHookDecision", () => {
  it("applies typed preToolUse decisions", async () => {
    const ctx = createPreToolUseHookContext({
      tool: "run_command",
      args: { command: "rm -rf /" },
      intentId: "intent-typed",
      session: new Map(),
      messages: [],
      signal: createSignal()
    });

    await expect(applyToolCallDecision(undefined, ctx)).resolves.toEqual({ type: "continue" });
    await expect(applyToolCallDecision("skip", ctx)).resolves.toEqual({ type: "skip" });
    await expect(applyToolCallDecision({ block: true, reason: "blocked" }, ctx)).resolves.toEqual({
      type: "tool_error",
      error: "blocked"
    });
    await expect(
      applyToolCallDecision({ rewrite: { args: { command: "ls" } } }, ctx)
    ).resolves.toEqual({
      type: "rewrite",
      args: { command: "ls" }
    });
  });

  it("warns once and maps legacy preToolUse reject to a recoverable tool error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ctx = createPreToolUseHookContext({
      tool: "run_command",
      args: { command: "rm -rf /" },
      intentId: "intent-legacy",
      session: new Map(),
      messages: [],
      signal: createSignal()
    });

    await expect(applyToolCallDecision({ reject: "denied" }, ctx)).resolves.toEqual({
      type: "tool_error",
      error: "denied"
    });
    await applyToolCallDecision({ reject: "denied again" }, ctx);

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("applies typed postToolUse and input decisions", async () => {
    const toolCtx = createPostToolUseHookContext({
      tool: "read_file",
      args: { path: "README.md" },
      intentId: "intent-result",
      result: "secret",
      session: new Map(),
      messages: [],
      signal: createSignal()
    });
    const inputCtx = createUserPromptSubmitHookContext({
      prompt: "original",
      messages: [],
      signal: createSignal()
    });

    await expect(
      applyToolResultDecision({ replace: { content: "redacted" } }, toolCtx)
    ).resolves.toEqual({
      type: "replace",
      patch: { content: "redacted" }
    });
    await expect(
      applyInputDecision({ action: "transform", prompt: "rewritten" }, inputCtx)
    ).resolves.toEqual({ type: "continue" });
    expect(inputCtx.prompt).toBe("rewritten");
    await expect(
      applyInputDecision({ action: "handled", response: "handled reply" }, inputCtx)
    ).resolves.toEqual({ type: "handled", response: "handled reply" });
  });

  it("maps skip to skip on pre hooks and no-op on post hooks", async () => {
    const preResult = await applyHookDecision(
      "preIteration",
      "skip",
      createPreIterationHookContext({
        iterationNumber: 1,
        tokenCount: 1,
        messages: [],
        signal: createSignal(),
        fork: async (prompt) => ({ output: prompt, messages: [] }),
        complete: createIterationComplete(),
        runHook: createIterationRunHook()
      })
    );
    const postResult = await applyHookDecision(
      "postIteration",
      "skip",
      createPostIterationHookContext({
        iterationNumber: 1,
        tokenCount: 1,
        messages: [],
        signal: createSignal(),
        fork: async (prompt) => ({ output: prompt, messages: [] }),
        complete: createIterationComplete(),
        runHook: createIterationRunHook()
      })
    );

    expect(preResult).toEqual({ type: "skip" });
    expect(postResult).toEqual({ type: "continue" });
  });

  it("maps reject on preToolUse into a recoverable tool error", async () => {
    const result = await applyHookDecision(
      "preToolUse",
      { reject: "denied" },
      createPreToolUseHookContext({
        tool: "run_command",
        args: { command: "rm -rf /" },
        intentId: "intent-5",
        session: new Map(),
        messages: [],
        signal: createSignal()
      })
    );

    expect(result).toEqual({ type: "tool_error", error: "denied" });
  });

  it("aborts run on abort decision and calls disposal", async () => {
    const disposeRun = vi.fn(async () => undefined);

    const ctx = createPreIterationHookContext({
      iterationNumber: 3,
      tokenCount: 7,
      messages: [],
      signal: createSignal(),
      fork: async (prompt) => ({ output: prompt, messages: [] }),
      complete: createIterationComplete(),
      runHook: createIterationRunHook(),
      disposeRun
    });

    await expect(applyHookDecision("preIteration", "abort", ctx)).rejects.toBeInstanceOf(
      AbortError
    );
    expect(disposeRun).toHaveBeenCalledTimes(1);
  });

  it("ignores legacy reject outside preToolUse", async () => {
    const disposeRun = vi.fn(async () => undefined);

    const ctx = createPostToolUseHookContext({
      tool: "read_file",
      args: { path: "README.md" },
      intentId: "intent-6",
      result: "ok",
      session: new Map(),
      messages: [],
      signal: createSignal(),
      disposeRun
    });

    await expect(
      applyHookDecision("postToolUse", { reject: "fatal" } as never, ctx)
    ).resolves.toEqual({ type: "continue" });
    expect(disposeRun).not.toHaveBeenCalled();
  });

  it("still throws AbortError when disposal fails during abort", async () => {
    const disposeRun = vi.fn(async () => {
      throw new Error("dispose failed");
    });

    const ctx = createPreIterationHookContext({
      iterationNumber: 4,
      tokenCount: 13,
      messages: [],
      signal: createSignal(),
      fork: async (prompt) => ({ output: prompt, messages: [] }),
      complete: createIterationComplete(),
      runHook: createIterationRunHook(),
      disposeRun
    });

    await expect(applyHookDecision("preIteration", "abort", ctx)).rejects.toBeInstanceOf(
      AbortError
    );
    expect(disposeRun).toHaveBeenCalledTimes(1);
  });

  it("maps skip to skip for notification and preCompaction hooks", async () => {
    const notificationResult = await applyHookDecision(
      "notification",
      "skip",
      createNotificationHookContext({
        event: "tool.progress",
        message: "working",
        messages: [],
        signal: createSignal()
      })
    );
    const preCompactionResult = await applyHookDecision(
      "preCompaction",
      "skip",
      createPreCompactionHookContext({
        tokenCount: 10,
        force: false,
        messages: [],
        signal: createSignal()
      })
    );

    expect(notificationResult).toEqual({ type: "skip" });
    expect(preCompactionResult).toEqual({ type: "skip" });
  });
});

// --- agent-host ---

function createNeverModel(): AcpModel {
  return {
    complete: vi.fn(async () => {
      throw new Error("Unexpected model call");
    })
  };
}

describe("AgentHost.handle", () => {
  it("returns unknown tool error when tool is missing", async () => {
    const runContext = createRunContext();
    const host = new AgentHost({
      runContext,
      model: createNeverModel(),
      createSpawnSession: () => {
        throw new Error("spawn not configured");
      }
    });

    const result = await host.handle({
      intentId: "intent-1",
      tool: "missing_tool",
      args: {}
    });

    expect(result).toEqual({
      status: "error",
      result: "Unknown tool: missing_tool"
    });
  });

  it("consumes async generator tools, emits yielded events, and returns success", async () => {
    const runContext = createRunContext();
    const emitted: AcpEvent[] = [];

    runContext.tools.register({
      name: "demo",
      call: async function* () {
        yield { type: "progress", message: "working" };
        yield { type: "message.delta", content: "chunk" };
        return { ok: true };
      }
    });

    const host = new AgentHost({
      runContext,
      model: createNeverModel(),
      emit(event) {
        emitted.push(event);
      },
      createSpawnSession: () => {
        throw new Error("spawn not configured");
      }
    });

    const result = await host.handle({
      intentId: "intent-2",
      tool: "demo",
      args: {}
    });

    expect(result).toEqual({
      status: "success",
      result: { ok: true }
    });
    expect(emitted).toEqual([
      { type: "progress", message: "working" },
      { type: "message.delta", content: "chunk" }
    ]);
  });

  it("dispatches notification hooks when a tool emits a notification", async () => {
    const runContext = createRunContext();
    const notifications: Array<{ event: string; message?: string; data?: unknown }> = [];

    runContext.hooks.add({
      name: "notification-listener",
      hooks: {
        notification(ctx) {
          notifications.push({
            event: ctx.event,
            message: ctx.message,
            data: ctx.data
          });
        }
      }
    });

    runContext.tools.register({
      name: "demo",
      async call(args, ctx) {
        await ctx.notify?.({
          event: "tool.progress",
          message: "working",
          data: args
        });

        return "done";
      }
    });

    const host = new AgentHost({
      runContext,
      model: createNeverModel(),
      createSpawnSession: () => {
        throw new Error("spawn not configured");
      }
    });

    const result = await host.handle({
      intentId: "intent-notify",
      tool: "demo",
      args: { step: 1 }
    });

    expect(result).toEqual({
      status: "success",
      result: "done"
    });
    expect(notifications).toEqual([
      {
        event: "tool.progress",
        message: "working",
        data: { step: 1 }
      }
    ]);
  });

  it("returns tool errors when invocation fails", async () => {
    const runContext = createRunContext();
    runContext.tools.register({
      name: "broken",
      call: () => {
        throw new Error("boom");
      }
    });

    const host = new AgentHost({
      runContext,
      model: createNeverModel(),
      createSpawnSession: () => {
        throw new Error("spawn not configured");
      }
    });

    const result = await host.handle({
      intentId: "intent-3",
      tool: "broken",
      args: {}
    });

    expect(result).toEqual({
      status: "error",
      result: "boom"
    });
  });

  it("returns tool errors when async generator throws while streaming", async () => {
    const runContext = createRunContext();
    const emitted: AcpEvent[] = [];

    runContext.tools.register({
      name: "broken-stream",
      call: async function* () {
        yield { type: "progress", message: "started" };
        throw new Error("stream exploded");
      }
    });

    const host = new AgentHost({
      runContext,
      model: createNeverModel(),
      emit(event) {
        emitted.push(event);
      },
      createSpawnSession: () => {
        throw new Error("spawn not configured");
      }
    });

    const result = await host.handle({
      intentId: "intent-4",
      tool: "broken-stream",
      args: {}
    });

    expect(result).toEqual({
      status: "error",
      result: "stream exploded"
    });
    expect(emitted).toEqual([{ type: "progress", message: "started" }]);
  });

  it("calls async generator return() when aborted during tool execution", async () => {
    const runContext = createRunContext();
    let settleNext:
      | ((value: IteratorResult<{ type: "progress"; message: string }, string>) => void)
      | undefined;
    const pendingNext = new Promise<IteratorResult<{ type: "progress"; message: string }, string>>(
      (resolve) => {
        settleNext = resolve;
      }
    );

    const invocation = {
      next: vi
        .fn<() => Promise<IteratorResult<{ type: "progress"; message: string }, string>>>()
        .mockResolvedValueOnce({
          done: false,
          value: { type: "progress", message: "started" }
        })
        .mockReturnValueOnce(pendingNext),
      return: vi.fn(async () => {
        settleNext?.({
          done: true,
          value: "aborted"
        });
        return {
          done: true,
          value: "aborted"
        };
      }),
      throw: vi.fn(async (error: unknown) => {
        throw error;
      }),
      [Symbol.asyncIterator]() {
        return invocation;
      }
    };

    runContext.tools.register({
      name: "streaming",
      call: () => invocation
    });

    const host = new AgentHost({
      runContext,
      model: createNeverModel(),
      createSpawnSession: () => {
        throw new Error("spawn not configured");
      }
    });

    const handlePromise = host.handle({
      intentId: "intent-5",
      tool: "streaming",
      args: {}
    });

    await vi.waitFor(() => {
      expect(invocation.next).toHaveBeenCalledTimes(2);
    });

    runContext.abortController.abort(new Error("stop"));

    const result = await handlePromise;
    expect(result).toEqual({
      status: "success",
      result: "aborted"
    });
    expect(invocation.return).toHaveBeenCalledTimes(1);
  });
});

describe("AgentHost.fork", () => {
  it("forks with cloned run state and emits fork lifecycle events", async () => {
    const runContext = createRunContext({ activeSkills: ["repo"] });
    runContext.messages.push({ role: "user", content: "existing context" });
    runContext.prompts.addTransform((ctx) => ({
      ...ctx,
      system: `fork-system:${ctx.userPrompt}`
    }));
    runContext.tools.register({
      name: "echo",
      call: () => "echo-result"
    });

    const model = createModel([
      {
        message: {
          content: "",
          toolCalls: [{ id: "tool-echo", tool: "echo", args: {} }]
        }
      },
      {
        message: {
          content: "fork done",
          toolCalls: []
        }
      }
    ]);

    const emitted: AcpEvent[] = [];
    const host = new AgentHost({
      runContext,
      model,
      emit(event) {
        emitted.push(event);
      },
      createSpawnSession: () => {
        throw new Error("spawn not configured");
      }
    });

    const result = await host.fork({
      forkId: "fork-1",
      prompt: "child task",
      context: {
        messages: [...runContext.messages],
        toolCalls: []
      }
    });

    expect(result.output).toBe("fork done");
    expect(result.messages).toEqual(
      expect.arrayContaining([
        { role: "user", content: "existing context" },
        { role: "user", content: "child task" }
      ])
    );
    expect(runContext.messages).toEqual([{ role: "user", content: "existing context" }]);

    const firstModelCall = (model.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(firstModelCall?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "echo"
        })
      ])
    );
    expect(firstModelCall?.messages).toEqual(
      expect.arrayContaining([{ role: "system", content: "fork-system:child task" }])
    );

    expect(emitted.map((event) => event.type)).toEqual(["fork.start", "fork.complete"]);
  });

  it("aborting the parent run aborts the forked child run", async () => {
    const runContext = createRunContext();
    const model: AcpModel = {
      complete: vi.fn(async ({ signal }) => {
        if (!signal.aborted) {
          await new Promise<void>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                resolve();
              },
              { once: true }
            );
          });
        }

        throw new Error("child aborted");
      })
    };

    const emitted: AcpEvent[] = [];
    const host = new AgentHost({
      runContext,
      model,
      emit(event) {
        emitted.push(event);
      },
      createSpawnSession: () => {
        throw new Error("spawn not configured");
      }
    });

    const forkRun = host.fork({
      forkId: "fork-abort",
      prompt: "will abort",
      context: {
        messages: [],
        toolCalls: []
      }
    });

    await vi.waitFor(() => {
      expect(model.complete).toHaveBeenCalledTimes(1);
    });

    const forkRejection = expect(forkRun).rejects.toThrow("child aborted");
    runContext.abortController.abort(new Error("stop parent"));

    await forkRejection;
    expect(emitted.map((event) => event.type)).toEqual(["fork.start", "fork.error"]);
  });

  it("emits fork lifecycle events once when invoked from the model loop", async () => {
    const runContext = createRunContext();
    const model = createModel([
      {
        message: {
          content: "child response",
          toolCalls: []
        }
      },
      {
        message: {
          content: "parent response",
          toolCalls: []
        }
      }
    ]);

    runContext.hooks.add({
      name: "fork-once",
      hooks: {
        async preIteration(ctx) {
          const latestMessage = ctx.messages[ctx.messages.length - 1];
          if (latestMessage?.role === "user" && latestMessage.content === "parent prompt") {
            await ctx.fork("child prompt");
          }
        }
      }
    });

    const events = await collectEvents(
      runAcpCore({
        prompt: "parent prompt",
        runContext,
        host: new AgentHost({
          runContext,
          model,
          createSpawnSession: () => {
            throw new Error("spawn not configured");
          }
        }),
        model
      })
    );

    expect(events.filter((event) => event.type === "fork.start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "fork.complete")).toHaveLength(1);
  });

  it("does not duplicate fork lifecycle events when host emit is wired", async () => {
    const runContext = createRunContext();
    const emitted: AcpEvent[] = [];
    const model = createModel([
      {
        message: {
          content: "child response",
          toolCalls: []
        }
      },
      {
        message: {
          content: "parent response",
          toolCalls: []
        }
      }
    ]);

    runContext.hooks.add({
      name: "fork-once",
      hooks: {
        async preIteration(ctx) {
          const latestMessage = ctx.messages[ctx.messages.length - 1];
          if (latestMessage?.role === "user" && latestMessage.content === "parent prompt") {
            await ctx.fork("child prompt");
          }
        }
      }
    });

    await collectEvents(
      runAcpCore({
        prompt: "parent prompt",
        runContext,
        host: new AgentHost({
          runContext,
          model,
          emit(event) {
            emitted.push(event);
          },
          createSpawnSession: () => {
            throw new Error("spawn not configured");
          }
        }),
        model
      })
    );

    expect(emitted.filter((event) => event.type === "fork.start")).toHaveLength(1);
    expect(emitted.filter((event) => event.type === "fork.complete")).toHaveLength(1);
  });

  it("passes the run-level max-iterations limit to forked runs", async () => {
    const runContext = createRunContext();
    const model = createModel([
      {
        message: {
          content: "",
          toolCalls: [
            {
              id: "tool-1",
              tool: "always_call_tool",
              args: { iteration: 1 }
            }
          ]
        }
      }
    ]);

    runContext.hooks.add({
      name: "fork-once",
      hooks: {
        async preIteration(ctx) {
          const latestMessage = ctx.messages[ctx.messages.length - 1];
          if (latestMessage?.role === "user" && latestMessage.content === "parent prompt") {
            await ctx.fork("child prompt");
          }
        }
      }
    });

    const events = await collectEvents(
      runAcpCore({
        prompt: "parent prompt",
        runContext,
        host: new AgentHost({
          runContext,
          model,
          maxIterations: 1,
          createSpawnSession: () => {
            throw new Error("spawn not configured");
          }
        }),
        model,
        maxIterations: 1
      })
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(events.filter((event) => event.type === "fork.start")).toHaveLength(1);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error.name).toBe("AbortError");
      expect(terminal.error.message).toContain("Maximum tool call iterations reached");
    }
  });
});

describe("AgentHost.spawn", () => {
  it("runs spawn via in-memory ACP client without propagating parent abort signal", async () => {
    const runContext = createRunContext();
    runContext.abortController.abort(new Error("parent aborted"));

    const sendMessage = vi.fn(async (prompt: string) => ({
      role: "assistant" as const,
      content: `spawned:${prompt}`
    }));
    const disposeSession = vi.fn(async () => undefined);
    const createSession = vi.fn(async () => ({
      sendMessage,
      dispose: disposeSession
    }));

    const host = new AgentHost({
      runContext,
      model: createNeverModel(),
      createSpawnSession: () =>
        createInMemorySpawnSession({
          model: "test-model",
          cwd: "/tmp/poe-agent",
          mode: "read",
          createSession
        })
    });

    const result = await host.spawn("hello child");

    expect(result).toEqual({
      output: "spawned:hello child",
      messages: [{ role: "assistant", content: "spawned:hello child" }]
    });
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        cwd: "/tmp/poe-agent",
        mode: "read"
      })
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toBe("hello child");
    expect(sendMessage.mock.calls[0]?.[1]).toBeUndefined();
    expect(disposeSession).toHaveBeenCalledTimes(1);
  });

  it("disposes spawned client and throws when prompt stop reason is not completed", async () => {
    const runContext = createRunContext();
    const dispose = vi.fn(async () => undefined);

    const host = new AgentHost({
      runContext,
      model: createNeverModel(),
      createSpawnSession: () => ({
        cwd: "/tmp/spawn",
        mcpServers: [],
        client: {
          initialize: vi.fn(async () => undefined),
          newSession: vi.fn(async () => ({ sessionId: "spawn-session" })),
          prompt: vi.fn(() => ({
            response: Promise.resolve({ stopReason: "cancelled" as const }),
            async *[Symbol.asyncIterator]() {
              yield* [];
              return;
            }
          })),
          dispose
        }
      })
    });

    await expect(host.spawn("hello child")).rejects.toThrow(
      "Spawned session ended with stop reason: cancelled"
    );
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes spawned client when prompt iteration fails", async () => {
    const runContext = createRunContext();
    const dispose = vi.fn(async () => undefined);
    const host = new AgentHost({
      runContext,
      model: createNeverModel(),
      createSpawnSession: () => ({
        cwd: "/tmp/spawn",
        mcpServers: [],
        client: {
          initialize: vi.fn(async () => undefined),
          newSession: vi.fn(async () => ({ sessionId: "spawn-session" })),
          prompt: vi.fn(() => ({
            response: Promise.resolve({ stopReason: "completed" as const }),
            async *[Symbol.asyncIterator]() {
              yield* [];
              throw new Error("stream broken");
            }
          })),
          dispose
        }
      })
    });

    await expect(host.spawn("hello child")).rejects.toThrow("stream broken");
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

// --- acp-core ---

function createHost(): AcpHost {
  return {
    handle: vi.fn(async (intent) => ({ status: "success", result: { ok: true, intent } })),
    fork: vi.fn(async (request) => ({ output: request.prompt, messages: [] })),
    spawn: vi.fn(async (prompt) => ({ output: prompt, messages: [] }))
  };
}

function createTokenBudget(max: number) {
  let total = 0;

  return {
    name: "token-budget",
    hooks: {
      postIteration(ctx: { tokenCount: number }) {
        total += ctx.tokenCount;
        if (total > max) {
          return "abort" as const;
        }
      }
    }
  };
}

describe("runAcpCore", () => {
  it("aborts when the run-level max-iterations limit is exceeded", async () => {
    const runContext = createRunContext();
    const model = createModel([
      {
        message: {
          content: "",
          toolCalls: [
            {
              id: "tool-1",
              tool: "always_call_tool",
              args: { iteration: 1 }
            }
          ]
        }
      }
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Always call a tool",
        runContext,
        host: createHost(),
        model,
        maxIterations: 1
      })
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "session.error"
    ]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error.name).toBe("AbortError");
      expect(terminal.error.message).toContain("Maximum tool call iterations reached");
    }
  });

  it("runs sessionStart and userPromptSubmit before the first model call", async () => {
    const runContext = createRunContext();
    const hookOrder: string[] = [];

    runContext.prompts.addTransform((ctx) => ({
      ...ctx,
      system: `prompt:${ctx.userPrompt}`
    }));
    runContext.hooks.add({
      name: "lifecycle",
      hooks: {
        sessionStart(ctx) {
          hookOrder.push("sessionStart");
          ctx.messages.push({ role: "assistant", content: "seeded context" });
        },
        userPromptSubmit(ctx) {
          hookOrder.push(`userPromptSubmit:${ctx.prompt}`);
          ctx.prompt = "rewritten prompt";
        }
      }
    });

    const model = createModel([
      {
        message: {
          content: "done",
          toolCalls: []
        }
      }
    ]);

    await collectEvents(
      runAcpCore({
        prompt: "original prompt",
        runContext,
        host: createHost(),
        model
      })
    );

    expect(hookOrder).toEqual(["sessionStart", "userPromptSubmit:original prompt"]);
    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.messages).toEqual([
      {
        role: "system",
        content: "prompt:rewritten prompt"
      },
      {
        role: "assistant",
        content: "seeded context"
      },
      {
        role: "user",
        content: "rewritten prompt"
      }
    ]);
  });

  it("emits intent/result events, applies hooks, and completes when the model returns final text", async () => {
    const runContext = createRunContext();
    const hookOrder: string[] = [];

    runContext.hooks.add({
      name: "hooks",
      hooks: {
        preToolUse() {
          hookOrder.push("pre-tool");
        },
        postToolUse() {
          hookOrder.push("post-tool");
        }
      }
    });

    const host = createHost();
    const model = createModel([
      {
        message: {
          content: "",
          toolCalls: [
            {
              id: "tool-1",
              tool: "read_file",
              args: { path: "README.md" }
            }
          ]
        }
      },
      {
        deltas: ["Done"],
        message: {
          content: "Done",
          toolCalls: []
        }
      }
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Read the README",
        runContext,
        host,
        model
      })
    );

    expect(events.map((event) => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "message.delta",
      "session.complete"
    ]);

    expect((host.handle as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toEqual({
      intentId: "tool-1",
      tool: "read_file",
      args: { path: "README.md" }
    });

    expect(hookOrder).toEqual(["pre-tool", "post-tool"]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.complete");
    if (terminal?.type === "session.complete") {
      expect(terminal.result.output).toBe("Done");
      expect(terminal.result.toolCalls).toEqual([
        {
          intentId: "tool-1",
          tool: "read_file",
          args: { path: "README.md" },
          status: "success",
          result: {
            ok: true,
            intent: {
              intentId: "tool-1",
              tool: "read_file",
              args: { path: "README.md" }
            }
          }
        }
      ]);
    }
  });

  it("serializes tool request messages with stable key order for snapshot playback", async () => {
    const runContext = createRunContext();
    const host = createHost();
    const model = createModel([
      {
        message: {
          content: "",
          toolCalls: [
            {
              id: "tool-1",
              tool: "read_file",
              args: { path: "README.md" }
            }
          ]
        }
      },
      {
        message: {
          content: "Done",
          toolCalls: []
        }
      }
    ]);

    await collectEvents(
      runAcpCore({
        prompt: "Read the README",
        runContext,
        host,
        model
      })
    );

    const secondRequest = (model.complete as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as
      | { model: string; messages: unknown[] }
      | undefined;
    expect(secondRequest).toBeDefined();
    const snapshotHashInput = JSON.stringify({
      model: secondRequest?.model,
      messages: secondRequest?.messages
    });
    expect(snapshotHashInput).toContain(
      '"role":"tool","tool_call_id":"tool-1","name":"read_file","content":"'
    );
  });

  it("threads multimodal tool results into follow-up model requests", async () => {
    const runContext = createRunContext();
    const host: AcpHost = {
      handle: vi.fn(async () => ({
        status: "success",
        result: [
          { type: "text", text: "Screenshot captured" },
          { type: "image", mimeType: "image/png", data: "YmFzZTY0LWltYWdl" },
          {
            type: "error",
            code: "parse_error",
            message: "Retry with valid JSON",
            retriable: true
          }
        ]
      })),
      fork: vi.fn(async (request) => ({ output: request.prompt, messages: [] })),
      spawn: vi.fn(async (prompt) => ({ output: prompt, messages: [] }))
    };
    const model = createModel([
      {
        message: {
          content: "",
          toolCalls: [
            {
              id: "tool-1",
              tool: "read_file",
              args: { path: "diagram.png" }
            }
          ]
        }
      },
      {
        message: {
          content: "Done",
          toolCalls: []
        }
      }
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Read the diagram",
        runContext,
        host,
        model
      })
    );

    const secondRequest = (model.complete as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as
      | { messages?: Array<Record<string, unknown>> }
      | undefined;
    const toolMessage = secondRequest?.messages?.find((message) => message.role === "tool");

    expect(toolMessage).toEqual({
      role: "tool",
      tool_call_id: "tool-1",
      name: "read_file",
      content: [
        { type: "text", text: "Screenshot captured" },
        { type: "image", mimeType: "image/png", data: "YmFzZTY0LWltYWdl" },
        {
          type: "error",
          code: "parse_error",
          message: "Retry with valid JSON",
          retriable: true
        }
      ]
    });

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.complete");
    if (terminal?.type === "session.complete") {
      expect(terminal.result.toolCalls).toEqual([
        {
          intentId: "tool-1",
          tool: "read_file",
          args: { path: "diagram.png" },
          status: "success",
          result: [
            { type: "text", text: "Screenshot captured" },
            { type: "image", mimeType: "image/png", data: "YmFzZTY0LWltYWdl" },
            {
              type: "error",
              code: "parse_error",
              message: "Retry with valid JSON",
              retriable: true
            }
          ]
        }
      ]);
    }
  });

  it("preserves raw model tool argument JSON when echoing assistant tool calls", async () => {
    const runContext = createRunContext();
    const host = createHost();
    const rawArguments = '{"command": "create", "path": "/workspace/test-document.txt"}';
    const model = createModel([
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "edit_file",
                arguments: rawArguments
              }
            }
          ]
        }
      },
      {
        message: {
          content: "Done",
          toolCalls: []
        }
      }
    ]);

    await collectEvents(
      runAcpCore({
        prompt: "Create a file",
        runContext,
        host,
        model
      })
    );

    expect(host.handle).toHaveBeenCalledWith({
      intentId: "call-1",
      tool: "edit_file",
      args: {
        command: "create",
        path: "/workspace/test-document.txt"
      }
    });

    const secondRequest = (model.complete as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as
      | {
          messages?: Array<{
            role?: string;
            tool_calls?: Array<{ function?: { arguments?: string } }>;
          }>;
        }
      | undefined;
    const assistantMessage = secondRequest?.messages?.find(
      (message) => message.role === "assistant"
    );
    expect(assistantMessage?.tool_calls?.[0]?.function?.arguments).toBe(rawArguments);
  });

  it("preserves reasoning fields in follow-up model requests", async () => {
    const runContext = createRunContext();
    const host = createHost();
    const model = createModel([
      {
        message: {
          content: "",
          reasoning_content: "Need to create file first",
          reasoning: "Need to create file first",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "edit_file",
                arguments: '{"command": "create", "path": "/workspace/test-document.txt"}'
              }
            }
          ]
        }
      },
      {
        message: {
          content: "Done",
          toolCalls: []
        }
      }
    ]);

    await collectEvents(
      runAcpCore({
        prompt: "Create a file",
        runContext,
        host,
        model
      })
    );

    const secondRequest = (model.complete as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as
      | { messages?: Array<Record<string, unknown>> }
      | undefined;
    const assistantMessage = secondRequest?.messages?.find(
      (message) => message.role === "assistant"
    );
    expect(assistantMessage?.reasoning_content).toBe("Need to create file first");
    expect(assistantMessage?.reasoning).toBe("Need to create file first");
  });

  it("maps preToolUse reject into tool.error, skips host execution, and lets the run recover", async () => {
    const runContext = createRunContext();
    runContext.hooks.add({
      name: "guardrail",
      hooks: {
        preToolUse() {
          return { reject: "blocked" };
        }
      }
    });

    const host = createHost();
    const model = createModel([
      {
        message: {
          content: "",
          toolCalls: [
            {
              id: "tool-2",
              tool: "run_command",
              args: { command: "rm -rf /" }
            }
          ]
        }
      },
      {
        message: {
          content: "Recovered",
          toolCalls: []
        }
      }
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Do dangerous thing",
        runContext,
        host,
        model
      })
    );

    expect(events.map((event) => event.type)).toEqual([
      "tool.error",
      "message.delta",
      "session.complete"
    ]);

    expect(host.handle).not.toHaveBeenCalled();

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.complete");
    if (terminal?.type === "session.complete") {
      expect(terminal.result.toolCalls).toEqual([
        {
          intentId: "tool-2",
          tool: "run_command",
          args: { command: "rm -rf /" },
          status: "error",
          error: "blocked"
        }
      ]);
    }
  });

  it("rewrites tool call args before host execution", async () => {
    const runContext = createRunContext();
    runContext.hooks.add({
      name: "rewriter",
      hooks: {
        preToolUse() {
          return { rewrite: { args: { command: "ls -la" } } };
        }
      }
    });

    const host = createHost();
    host.handle = vi.fn(async () => ({
      status: "success",
      result: "rewritten"
    }));
    const model = createModel([
      {
        message: {
          content: "",
          toolCalls: [{ id: "tool-1", tool: "run_command", args: { command: "pwd" } }]
        }
      },
      {
        message: { content: "Done", toolCalls: [] }
      }
    ]);

    await collectEvents(runAcpCore({ prompt: "run", runContext, host, model }));

    expect(host.handle).toHaveBeenCalledWith({
      intentId: "tool-1",
      tool: "run_command",
      args: { command: "ls -la" }
    });
  });

  it("replaces tool results before the next model request", async () => {
    const runContext = createRunContext();
    runContext.hooks.add({
      name: "redactor",
      hooks: {
        postToolUse() {
          return { replace: { content: "redacted content" } };
        }
      }
    });

    const host = createHost();
    host.handle = vi.fn(async () => ({
      status: "success",
      result: "secret content"
    }));
    let callNumber = 0;
    const model: AcpModel = {
      complete: vi.fn(async (request) => {
        callNumber += 1;
        if (callNumber === 1) {
          return toAcpModelResponse({
            message: {
              content: "",
              toolCalls: [{ id: "tool-1", tool: "read_file", args: { path: "README.md" } }]
            }
          });
        }

        expect(request.messages.at(-1)).toEqual({
          role: "tool",
          content: "redacted content",
          name: "read_file",
          tool_call_id: "tool-1"
        });
        return toAcpModelResponse({ message: { content: "Done", toolCalls: [] } });
      })
    };

    await collectEvents(runAcpCore({ prompt: "read", runContext, host, model }));

    expect(host.handle).toHaveBeenCalledTimes(1);
  });

  it("lets userPromptSubmit handle a turn without calling the model", async () => {
    const runContext = createRunContext();
    runContext.hooks.add({
      name: "handler",
      hooks: {
        userPromptSubmit() {
          return { action: "handled", response: "Handled by plugin" };
        }
      }
    });
    const host = createHost();
    const model = createNeverModel();

    const events = await collectEvents(
      runAcpCore({
        prompt: "hello",
        runContext,
        host,
        model
      })
    );

    expect(events.map((event) => event.type)).toEqual(["message.delta", "session.complete"]);
    expect(model.complete).not.toHaveBeenCalled();
  });

  it("applies guardrails, lets the model recover with a safe command, and executes allowed commands", async () => {
    const runContext = createRunContext();

    const isForbidden = (args: unknown): boolean => {
      if (typeof args !== "object" || args === null || Array.isArray(args)) {
        return false;
      }

      const command = (args as { command?: unknown }).command;
      return typeof command === "string" && command.includes("rm -rf");
    };

    runContext.hooks.add({
      name: "guardrails",
      hooks: {
        preToolUse(ctx) {
          if (ctx.tool === "run_command" && isForbidden(ctx.args)) {
            return { reject: "Blocked forbidden command" };
          }
        }
      }
    });

    const host = createHost();
    host.handle = vi.fn(async (intent) => ({
      status: "success",
      result: `executed:${(intent.args as { command?: string }).command ?? ""}`
    }));

    let callNumber = 0;
    const model: AcpModel = {
      complete: vi.fn(async (request) => {
        callNumber += 1;

        if (callNumber === 1) {
          return toAcpModelResponse({
            message: {
              content: "",
              toolCalls: [
                {
                  id: "blocked-command",
                  tool: "run_command",
                  args: { command: "rm -rf /tmp/demo" }
                }
              ]
            }
          });
        }

        if (callNumber === 2) {
          expect(request.messages.at(-1)).toEqual({
            role: "tool",
            content: "Error: Blocked forbidden command",
            name: "run_command",
            tool_call_id: "blocked-command"
          });

          return toAcpModelResponse({
            message: {
              content: "",
              toolCalls: [
                {
                  id: "safe-command",
                  tool: "run_command",
                  args: { command: "ls -la" }
                }
              ]
            }
          });
        }

        if (callNumber === 3) {
          expect(request.messages.at(-1)).toEqual({
            role: "tool",
            content: "executed:ls -la",
            name: "run_command",
            tool_call_id: "safe-command"
          });

          return toAcpModelResponse({
            message: {
              content: "Recovered",
              toolCalls: []
            }
          });
        }

        throw new Error("Unexpected model call");
      })
    };

    const events = await collectEvents(
      runAcpCore({
        prompt: "Run shell commands",
        runContext,
        host,
        model
      })
    );

    expect(events.map((event) => event.type)).toEqual([
      "tool.error",
      "tool.intent",
      "tool.result",
      "message.delta",
      "session.complete"
    ]);

    expect(host.handle).toHaveBeenCalledTimes(1);
    expect(host.handle).toHaveBeenCalledWith({
      intentId: "safe-command",
      tool: "run_command",
      args: { command: "ls -la" }
    });

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.complete");
    if (terminal?.type === "session.complete") {
      expect(terminal.result.toolCalls).toEqual([
        {
          intentId: "blocked-command",
          tool: "run_command",
          args: { command: "rm -rf /tmp/demo" },
          status: "error",
          error: "Blocked forbidden command"
        },
        {
          intentId: "safe-command",
          tool: "run_command",
          args: { command: "ls -la" },
          status: "success",
          result: "executed:ls -la"
        }
      ]);
    }
  });

  it("rejects forbidden commands while executing allowed commands from the same model response", async () => {
    const runContext = createRunContext();

    const isForbidden = (args: unknown): boolean => {
      if (typeof args !== "object" || args === null || Array.isArray(args)) {
        return false;
      }

      const command = (args as { command?: unknown }).command;
      return typeof command === "string" && command.includes("rm -rf");
    };

    runContext.hooks.add({
      name: "guardrails",
      hooks: {
        preToolUse(ctx) {
          if (ctx.tool === "run_command" && isForbidden(ctx.args)) {
            return { reject: "Blocked forbidden command" };
          }
        }
      }
    });

    const host = createHost();
    host.handle = vi.fn(async (intent) => ({
      status: "success",
      result: `executed:${(intent.args as { command?: string }).command ?? ""}`
    }));

    let callNumber = 0;
    const model: AcpModel = {
      complete: vi.fn(async (request) => {
        callNumber += 1;

        if (callNumber === 1) {
          return toAcpModelResponse({
            message: {
              content: "",
              toolCalls: [
                {
                  id: "blocked-command",
                  tool: "run_command",
                  args: { command: "rm -rf /tmp/demo" }
                },
                {
                  id: "safe-command",
                  tool: "run_command",
                  args: { command: "ls -la" }
                }
              ]
            }
          });
        }

        if (callNumber === 2) {
          const toolMessages = request.messages.filter((message) => message.role === "tool");
          expect(toolMessages).toEqual([
            {
              role: "tool",
              content: "Error: Blocked forbidden command",
              name: "run_command",
              tool_call_id: "blocked-command"
            },
            {
              role: "tool",
              content: "executed:ls -la",
              name: "run_command",
              tool_call_id: "safe-command"
            }
          ]);

          return toAcpModelResponse({
            message: {
              content: "done",
              toolCalls: []
            }
          });
        }

        throw new Error("Unexpected model call");
      })
    };

    const events = await collectEvents(
      runAcpCore({
        prompt: "Run shell commands",
        runContext,
        host,
        model
      })
    );

    expect(events.map((event) => event.type)).toEqual([
      "tool.error",
      "tool.intent",
      "tool.result",
      "message.delta",
      "session.complete"
    ]);

    expect(host.handle).toHaveBeenCalledTimes(1);
    expect(host.handle).toHaveBeenCalledWith({
      intentId: "safe-command",
      tool: "run_command",
      args: { command: "ls -la" }
    });
  });

  it("aborts when postIteration token budget is exceeded and emits AbortError", async () => {
    const runContext = createRunContext();
    runContext.hooks.add(createTokenBudget(20));

    const disposeRun = vi.fn(async () => undefined);

    const host = createHost();
    host.handle = vi.fn(async () => ({ status: "success", result: "" }));

    const events = await collectEvents(
      runAcpCore({
        prompt: "0123456789",
        runContext,
        host,
        model: createModel([
          {
            message: {
              content: "",
              toolCalls: [
                {
                  id: "tool-budget-1",
                  tool: "read_file",
                  args: { path: "README.md" }
                }
              ]
            }
          },
          {
            message: {
              content: "final",
              toolCalls: []
            }
          }
        ]),
        disposeRun
      })
    );

    expect(events.map((event) => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "message.delta",
      "session.error"
    ]);
    expect(disposeRun).toHaveBeenCalled();

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error.name).toBe("AbortError");
    }
  });

  it("retries transient completion disposal failures on the error path", async () => {
    const disposeRun = vi.fn()
      .mockRejectedValueOnce(new Error("transient dispose failure"))
      .mockResolvedValueOnce(undefined);

    const events = await collectEvents(
      runAcpCore({
        prompt: "ok",
        runContext: createRunContext(),
        host: createHost(),
        model: createModel([{ message: { content: "done", toolCalls: [] } }]),
        disposeRun
      })
    );

    expect(events.at(-1)?.type).toBe("session.error");
    expect(disposeRun).toHaveBeenCalledTimes(2);
  });

  it("completes normally when postIteration token budget is not exceeded", async () => {
    const runContext = createRunContext();
    runContext.hooks.add(createTokenBudget(40));

    const host = createHost();
    host.handle = vi.fn(async () => ({ status: "success", result: "" }));

    const events = await collectEvents(
      runAcpCore({
        prompt: "0123456789",
        runContext,
        host,
        model: createModel([
          {
            message: {
              content: "",
              toolCalls: [
                {
                  id: "tool-budget-2",
                  tool: "read_file",
                  args: { path: "README.md" }
                }
              ]
            }
          },
          {
            message: {
              content: "within budget",
              toolCalls: []
            }
          }
        ])
      })
    );

    expect(events.map((event) => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "message.delta",
      "session.complete"
    ]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.complete");
    if (terminal?.type === "session.complete") {
      expect(terminal.result.output).toBe("within budget");
    }
  });

  it("does not abort when postIteration token budget equals the threshold", async () => {
    const runContext = createRunContext();
    runContext.hooks.add(createTokenBudget(8));

    const events = await collectEvents(
      runAcpCore({
        prompt: "abcd",
        runContext,
        host: createHost(),
        model: createModel([
          {
            message: {
              content: "efgh",
              toolCalls: []
            }
          }
        ])
      })
    );

    expect(events.map((event) => event.type)).toEqual(["message.delta", "session.complete"]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.complete");
    if (terminal?.type === "session.complete") {
      expect(terminal.result.output).toBe("efgh");
    }
  });

  it("supports preIteration skip and still reaches completion", async () => {
    const runContext = createRunContext();
    let calls = 0;

    runContext.hooks.add({
      name: "skip-once",
      hooks: {
        preIteration() {
          calls += 1;
          if (calls === 1) {
            return "skip";
          }
        }
      }
    });

    const model = createModel([
      {
        message: {
          content: "ok",
          toolCalls: []
        }
      }
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Say ok",
        runContext,
        host: createHost(),
        model
      })
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual(["message.delta", "session.complete"]);
  });

  it("runs stop hooks before completing and exposes the final result", async () => {
    const runContext = createRunContext();
    const stopCalls: Array<{ status: string; output?: string; messageCount: number }> = [];

    runContext.hooks.add({
      name: "stop",
      hooks: {
        stop(ctx) {
          stopCalls.push({
            status: ctx.status,
            output: ctx.output,
            messageCount: ctx.messages.length
          });
        }
      }
    });

    const events = await collectEvents(
      runAcpCore({
        prompt: "Hello",
        runContext,
        host: createHost(),
        model: createModel([
          {
            message: {
              content: "done",
              toolCalls: []
            }
          }
        ])
      })
    );

    expect(stopCalls).toEqual([
      {
        status: "completed",
        output: "done",
        messageCount: 2
      }
    ]);
    expect(events.map((event) => event.type)).toEqual(["message.delta", "session.complete"]);
  });

  it("lets stop hooks veto finalization", async () => {
    const runContext = createRunContext();

    runContext.hooks.add({
      name: "stop",
      hooks: {
        stop() {
          return "abort";
        }
      }
    });

    const events = await collectEvents(
      runAcpCore({
        prompt: "Hello",
        runContext,
        host: createHost(),
        model: createModel([
          {
            message: {
              content: "done",
              toolCalls: []
            }
          }
        ])
      })
    );

    expect(events.map((event) => event.type)).toEqual(["message.delta", "session.error"]);
    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error).toBeInstanceOf(AbortError);
      expect(terminal.error.message).toContain("stop");
    }
  });

  it("emits exactly one terminal session.error event when aborted before execution", async () => {
    const runContext = createRunContext();
    const controller = new AbortController();
    controller.abort();

    const model = createModel([
      {
        message: {
          content: "should not run",
          toolCalls: []
        }
      }
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Hello",
        runContext,
        host: createHost(),
        model,
        signal: controller.signal
      })
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("session.error");
    if (events[0]?.type === "session.error") {
      expect(events[0].error.name).toBe("AbortError");
    }
  });

  it("emits exactly one terminal session.error event for model failures", async () => {
    const runContext = createRunContext();
    const events = await collectEvents(
      runAcpCore({
        prompt: "Hello",
        runContext,
        host: createHost(),
        model: createModel([new Error("model failed")])
      })
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("session.error");
    if (events[0]?.type === "session.error") {
      expect(events[0].error.message).toContain("model failed");
    }
  });

  it("emits session.error when the host fails while handling an intent", async () => {
    const runContext = createRunContext();
    const host = createHost();
    host.handle = vi.fn(async () => {
      throw new Error("host offline");
    });

    const model = createModel([
      {
        message: {
          content: "",
          toolCalls: [
            {
              id: "tool-host-fail",
              tool: "read_file",
              args: { path: "README.md" }
            }
          ]
        }
      }
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Read the README",
        runContext,
        host,
        model
      })
    );

    expect(events.map((event) => event.type)).toEqual(["tool.intent", "session.error"]);
    expect(events.filter((event) => event.type === "session.error")).toHaveLength(1);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error.message).toContain("host offline");
    }
  });

  it("aborts while waiting for host ack and emits one terminal error", async () => {
    const runContext = createRunContext();
    const controller = new AbortController();
    let releaseHost: (() => void) | undefined;

    const host = createHost();
    host.handle = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseHost = () => resolve({ status: "success", result: "late" });
        })
    );

    const model = createModel([
      {
        message: {
          content: "",
          toolCalls: [
            {
              id: "tool-waiting",
              tool: "read_file",
              args: { path: "README.md" }
            }
          ]
        }
      }
    ]);

    const eventsPromise = collectEvents(
      runAcpCore({
        prompt: "Read the README",
        runContext,
        host,
        model,
        signal: controller.signal
      })
    );

    await vi.waitFor(() => {
      expect(host.handle).toHaveBeenCalledTimes(1);
    });

    controller.abort(new Error("stop now"));

    const events = await eventsPromise;

    expect(events.filter((event) => event.type === "session.error")).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual(["tool.intent", "session.error"]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error.name).toBe("AbortError");
    }

    releaseHost?.();
  });

  it("stores streamed deltas in assistant history when message content is missing", async () => {
    const runContext = createRunContext();
    const model = createModel([
      {
        deltas: ["Hello", " ", "stream"],
        message: {
          toolCalls: []
        }
      }
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Say hello",
        runContext,
        host: createHost(),
        model
      })
    );

    expect(events.map((event) => event.type)).toEqual([
      "message.delta",
      "message.delta",
      "message.delta",
      "session.complete"
    ]);

    expect(runContext.messages).toEqual([
      { role: "user", content: "Say hello" },
      { role: "assistant", content: "Hello stream" }
    ]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.complete");
    if (terminal?.type === "session.complete") {
      expect(terminal.result.output).toBe("Hello stream");
    }
  });

  it("returns the final model output even when it is an empty string", async () => {
    const runContext = createRunContext();
    const model = createModel([
      {
        message: {
          content: "thinking",
          toolCalls: [
            {
              id: "tool-3",
              tool: "read_file",
              args: { path: "README.md" }
            }
          ]
        }
      },
      {
        message: {
          content: "",
          toolCalls: []
        }
      }
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Read and stay quiet",
        runContext,
        host: createHost(),
        model
      })
    );

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.complete");
    if (terminal?.type === "session.complete") {
      expect(terminal.result.output).toBe("");
    }
  });

  it("emits session.error when the model delta stream throws", async () => {
    const runContext = createRunContext();
    const model = createModel([
      {
        deltas: (async function* () {
          yield "partial";
          throw new Error("stream failed");
        })(),
        message: {
          toolCalls: []
        }
      }
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Stream then fail",
        runContext,
        host: createHost(),
        model
      })
    );

    expect(events.map((event) => event.type)).toEqual(["message.delta", "session.error"]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error.message).toContain("stream failed");
    }
  });
});
