import { describe, expect, it } from "vitest";
import { PromptRegistry } from "./prompts.js";

describe("PromptRegistry", () => {
  it("builds initial context from user and base system prompts", async () => {
    const registry = new PromptRegistry();

    await expect(registry.compile("Fix tests", "Base system")).resolves.toEqual({
      baseSystemPrompt: "Base system",
      system: "Base system",
      userPrompt: "Fix tests",
    });
  });

  it("builds initial context with user prompt only when base prompt is missing", async () => {
    const registry = new PromptRegistry();

    await expect(registry.compile("Fix tests")).resolves.toEqual({
      userPrompt: "Fix tests",
    });
  });

  it("chains transforms in registration order", async () => {
    const registry = new PromptRegistry();
    const callOrder: string[] = [];

    registry.addTransform(ctx => {
      callOrder.push("first");
      return {
        ...ctx,
        metadata: { order: ["first"] },
        system: `${ctx.system ?? ""}\nfirst`.trim(),
      };
    });

    registry.addTransform(async ctx => {
      callOrder.push("second");
      return {
        ...ctx,
        metadata: { order: [...((ctx.metadata?.order as string[] | undefined) ?? []), "second"] },
        system: `${ctx.system ?? ""}\nsecond`.trim(),
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

    registry.addTransform(async ctx => {
      await Promise.resolve();
      callOrder.push("first");
      return {
        ...ctx,
        system: "first",
      };
    });

    registry.addTransform(async ctx => {
      callOrder.push("second");
      return {
        ...ctx,
        system: `${ctx.system ?? ""}\nsecond`.trim(),
      };
    });

    const compiled = await registry.compile("User task");

    expect(callOrder).toEqual(["first", "second"]);
    expect(compiled.system).toBe("first\nsecond");
  });

  it("keeps userPrompt explicit through the entire transform pipeline", async () => {
    const registry = new PromptRegistry();
    const seenUserPrompts: string[] = [];

    registry.addTransform(ctx => {
      seenUserPrompts.push(ctx.userPrompt);
      return {
        ...ctx,
        userPrompt: `${ctx.userPrompt} merged`,
        system: `${ctx.system ?? ""}\n${ctx.userPrompt}`.trim(),
      };
    });

    registry.addTransform(ctx => {
      seenUserPrompts.push(ctx.userPrompt);
      return {
        ...ctx,
        metadata: { transformed: true },
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

    registry.addTransform(ctx => {
      ctx.userPrompt = "mutated";
      return ctx;
    });

    registry.addTransform(ctx => {
      seenUserPrompts.push(ctx.userPrompt);
      return {
        ...ctx,
      };
    });

    const compiled = await registry.compile("original", "Base");

    expect(seenUserPrompts).toEqual(["original"]);
    expect(compiled.userPrompt).toBe("original");
  });

  it("does not leak state across multiple compile calls", async () => {
    const registry = new PromptRegistry();

    registry.addTransform(ctx => ({
      ...ctx,
      metadata: {
        invocations: ((ctx.metadata?.invocations as number | undefined) ?? 0) + 1,
      },
    }));

    const first = await registry.compile("one", "Base");
    const second = await registry.compile("two", "Base");

    expect(first).toEqual({
      baseSystemPrompt: "Base",
      system: "Base",
      userPrompt: "one",
      metadata: { invocations: 1 },
    });

    expect(second).toEqual({
      baseSystemPrompt: "Base",
      system: "Base",
      userPrompt: "two",
      metadata: { invocations: 1 },
    });
  });
});
