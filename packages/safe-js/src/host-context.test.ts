import { expect, it, vi } from "vitest";
import { AsyncLocalStorage } from "#safe-js-platform";
import { captureHostContext } from "./host-context.js";

vi.mock("#safe-js-platform", async importOriginal => ({
  ...await importOriginal<typeof import("#safe-js-platform")>(),
  AsyncLocalStorage: (await import("./platform/context.js")).StackContext
}));

it("restores independently captured host scopes after interleaved awaits", async () => {
  const context = new AsyncLocalStorage<string>();
  const first = context.run("first", captureHostContext);
  const second = context.run("second", captureHostContext);
  const values = await Promise.all([first, second].map(async resume => {
    await Promise.resolve();
    const value = resume(() => context.getStore());
    expect(context.getStore()).toBeUndefined();
    await Promise.resolve();
    expect(resume(() => context.getStore())).toBe(value);
    return value;
  }));
  expect(values).toEqual(["first", "second"]);
});

it("restores the caller after a captured continuation throws", () => {
  const context = new AsyncLocalStorage<string>();
  const resume = context.run("captured", captureHostContext);
  context.run("caller", () => {
    expect(() => resume(() => {
      expect(context.getStore()).toBe("captured");
      throw new Error("callback failed");
    })).toThrow("callback failed");
    expect(context.getStore()).toBe("caller");
  });
});

it("does not revive a disabled context or inherit later stores", () => {
  const context = new AsyncLocalStorage<string>();
  const resume = context.run("captured", captureHostContext);
  const later = new AsyncLocalStorage<string>();
  context.disable();
  later.run("later", () => resume(() => {
    expect(context.getStore()).toBeUndefined();
    expect(later.getStore()).toBeUndefined();
  }));
});
