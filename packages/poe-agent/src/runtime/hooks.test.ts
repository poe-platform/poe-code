import { describe, expect, it, vi } from "vitest";
import {
  AbortError,
  HookRegistry,
  applyHookDecision,
  createPostIterationHookContext,
  createPostToolUseHookContext,
  createPreIterationHookContext,
  createPreToolUseHookContext,
} from "./hooks.js";
import type { ChatMessage } from "./types.js";

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
        },
      },
    });

    registry.add({
      name: "second",
      hooks: {
        preToolUse() {
          calls.push("second");
        },
      },
    });

    const ctx = createPreToolUseHookContext({
      tool: "read_file",
      args: { path: "README.md" },
      intentId: "intent-1",
      messages: [],
      signal: createSignal(),
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
        },
      },
    });

    registry.add({
      name: "second",
      hooks: {
        preToolUse() {
          calls.push("second");
          return { reject: "blocked" };
        },
      },
    });

    const decision = await registry.run(
      "preToolUse",
      createPreToolUseHookContext({
        tool: "run_command",
        args: { command: "rm -rf /" },
        intentId: "intent-2",
        messages: [],
        signal: createSignal(),
      }),
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
        },
      },
    });

    registry.add({
      name: "second",
      hooks: {
        preIteration() {
          return undefined;
        },
      },
    });

    const decision = await registry.run(
      "preIteration",
      createPreIterationHookContext({
        iterationNumber: 1,
        tokenCount: 42,
        messages: [],
        signal: createSignal(),
        fork: async prompt => ({ output: prompt, messages: [] }),
      }),
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
        },
      },
    });

    registry.add({
      name: "second",
      hooks: {
        postIteration() {
          calls.push("second");
          return;
        },
      },
    });

    const decision = await registry.run(
      "postIteration",
      createPostIterationHookContext({
        iterationNumber: 3,
        tokenCount: 9,
        messages: [],
        signal: createSignal(),
        fork: async prompt => ({ output: prompt, messages: [] }),
      }),
    );

    expect(calls).toEqual(["first", "second"]);
    expect(decision).toBe("abort");
  });
});

describe("hook context factories", () => {
  it("creates mutable preToolUse context", () => {
    const args = { path: "README.md" };
    const messages: ChatMessage[] = [{ role: "user", content: "read it" }];

    const ctx = createPreToolUseHookContext({
      tool: "read_file",
      args,
      intentId: "intent-3",
      messages,
      signal: createSignal(),
    });

    ctx.args = { path: "package.json" };
    ctx.messages.push({ role: "assistant", content: "ok" });

    expect(ctx.args).toEqual({ path: "package.json" });
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages).toBe(messages);
  });

  it("creates postToolUse context with result and error", () => {
    const ctx = createPostToolUseHookContext({
      tool: "search",
      args: { q: "hooks" },
      intentId: "intent-4",
      result: { total: 1 },
      error: "partial",
      messages: [],
      signal: createSignal(),
    });

    expect(ctx.result).toEqual({ total: 1 });
    expect(ctx.error).toBe("partial");
  });

  it("creates pre/post iteration contexts with mutable messages and fork", async () => {
    const fork = vi.fn(async (prompt: string) => ({
      output: `summary:${prompt}`,
      messages: [],
    }));
    const messages: ChatMessage[] = [{ role: "user", content: "start" }];

    const preCtx = createPreIterationHookContext({
      iterationNumber: 2,
      tokenCount: 100,
      messages,
      signal: createSignal(),
      fork,
    });

    preCtx.messages.push({ role: "assistant", content: "working" });

    const postCtx = createPostIterationHookContext({
      iterationNumber: preCtx.iterationNumber,
      tokenCount: preCtx.tokenCount,
      messages: preCtx.messages,
      signal: preCtx.signal,
      fork,
    });

    const forkResult = await postCtx.fork("compact");

    expect(postCtx.messages).toHaveLength(2);
    expect(postCtx.messages).toBe(messages);
    expect(forkResult).toEqual({ output: "summary:compact", messages: [] });
    expect(fork).toHaveBeenCalledWith("compact");
  });
});

describe("applyHookDecision", () => {
  it("maps skip to skip on pre hooks and no-op on post hooks", async () => {
    const preResult = await applyHookDecision(
      "preIteration",
      "skip",
      createPreIterationHookContext({
        iterationNumber: 1,
        tokenCount: 1,
        messages: [],
        signal: createSignal(),
        fork: async prompt => ({ output: prompt, messages: [] }),
      }),
    );
    const postResult = await applyHookDecision(
      "postIteration",
      "skip",
      createPostIterationHookContext({
        iterationNumber: 1,
        tokenCount: 1,
        messages: [],
        signal: createSignal(),
        fork: async prompt => ({ output: prompt, messages: [] }),
      }),
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
        messages: [],
        signal: createSignal(),
      }),
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
      fork: async prompt => ({ output: prompt, messages: [] }),
      disposeRun,
    });

    await expect(applyHookDecision("preIteration", "abort", ctx)).rejects.toBeInstanceOf(
      AbortError,
    );
    expect(disposeRun).toHaveBeenCalledTimes(1);
  });

  it("aborts run on reject outside preToolUse and calls disposal", async () => {
    const disposeRun = vi.fn(async () => undefined);

    const ctx = createPostToolUseHookContext({
      tool: "read_file",
      args: { path: "README.md" },
      intentId: "intent-6",
      result: "ok",
      messages: [],
      signal: createSignal(),
      disposeRun,
    });

    await expect(
      applyHookDecision("postToolUse", { reject: "fatal" }, ctx),
    ).rejects.toBeInstanceOf(AbortError);
    expect(disposeRun).toHaveBeenCalledTimes(1);
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
      fork: async prompt => ({ output: prompt, messages: [] }),
      disposeRun,
    });

    await expect(applyHookDecision("preIteration", "abort", ctx)).rejects.toBeInstanceOf(
      AbortError,
    );
    expect(disposeRun).toHaveBeenCalledTimes(1);
  });
});
