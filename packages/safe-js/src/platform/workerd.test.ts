import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

let createHostCallbackContext: typeof import("./workerd.js").createHostCallbackContext;
beforeAll(async () => {
  vi.stubGlobal("AsyncLocalStorage", AsyncLocalStorage);
  vi.resetModules();
  ({ createHostCallbackContext } = await import("./workerd.js"));
});
afterAll(() => vi.unstubAllGlobals());

it("isolates concurrent callback contexts across awaits", async () => {
  const context = createHostCallbackContext();
  let resume!: () => void;
  const barrier = new Promise<void>(resolve => { resume = resolve; });
  const first = context.run(true, async () => {
    expect(context.getStore()).toBe(true);
    await barrier;
    expect(context.getStore()).toBe(true);
  });
  await context.run(false, async () => {
    expect(context.getStore()).toBe(false);
    await Promise.resolve();
    expect(context.getStore()).toBe(false);
    resume();
  });
  await first;
  expect(context.getStore()).toBeUndefined();
  context.disable();
});

it("retires an in-flight context and refuses subsequent callback admission", async () => {
  const context = createHostCallbackContext();
  let resume!: () => void;
  const barrier = new Promise<void>(resolve => { resume = resolve; });
  const pending = context.run(true, async () => {
    expect(context.getStore()).toBe(true);
    await barrier;
    expect(context.getStore()).toBeUndefined();
    let admitted = false;
    expect(() => context.run(true, () => { admitted = true; })).toThrow(expect.objectContaining({ code: "reentry" }));
    expect(admitted).toBe(false);
  });
  context.disable();
  context.disable();
  resume();
  await pending;
  expect(context.getStore()).toBeUndefined();
});

it("retiring one execution leaves another execution live", async () => {
  const first = createHostCallbackContext();
  const second = createHostCallbackContext();
  await second.run(true, async () => {
    first.run(false, () => {
      expect(first.getStore()).toBe(false);
      expect(second.getStore()).toBe(true);
      first.disable();
    });
    await Promise.resolve();
    expect(first.getStore()).toBeUndefined();
    expect(second.getStore()).toBe(true);
  });
  second.disable();
});

it("restores the outer context after nested callbacks throw a falsey reason", () => {
  const context = createHostCallbackContext();
  context.run(true, () => {
    let caught: unknown = "not thrown";
    try {
      context.run(false, () => {
        expect(context.getStore()).toBe(false);
        throw undefined;
      });
    } catch (reason) {
      caught = reason;
    }
    expect(caught).toBeUndefined();
    expect(context.getStore()).toBe(true);
  });
  expect(context.getStore()).toBeUndefined();
  context.disable();
});

it("falls back to stack-scoped context without a native host API", async () => {
  vi.stubGlobal("AsyncLocalStorage", undefined);
  vi.resetModules();
  const platform = await import("./workerd.js");
  const context = platform.createHostCallbackContext();
  context.run(true, () => {
    expect(context.getStore()).toBe(true);
    context.run(false, () => expect(context.getStore()).toBe(false));
    expect(context.getStore()).toBe(true);
  });
  await Promise.resolve();
  expect(context.getStore()).toBeUndefined();
  context.disable();
  expect(() => context.run(true, () => undefined)).toThrow(expect.objectContaining({ code: "reentry" }));
});
