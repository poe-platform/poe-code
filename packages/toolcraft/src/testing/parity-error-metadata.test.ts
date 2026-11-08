import { describe, expect, it, vi } from "vitest";
import { S, UserError, defineCommand, defineGroup } from "../index.js";
import { createCommandTestHarness } from "./harness.js";

function inheritMessage(error: Error, message: unknown): Error {
  Reflect.deleteProperty(error, "message");
  Object.setPrototypeOf(error, Object.create(Object.getPrototypeOf(error), {
    message: { value: message }
  }));
  return error;
}

class NativeFailure extends DOMException {}

const cases: Array<{
  name: string;
  create: (hook: () => never) => unknown;
  expected: string;
}> = [
  { name: "inherited Error message", create: () => inheritMessage(new Error(), "inherited failure"), expected: "Error: inherited failure" },
  { name: "inherited UserError constructor and message", create: () => inheritMessage(new UserError("removed"), "inherited user failure"), expected: "UserError: inherited user failure" },
  { name: "DOMException", create: () => new DOMException("native failure", "InvalidStateError"), expected: "DOMException: native failure" },
  { name: "DOMException subclass", create: () => new NativeFailure("subclass failure", "AbortError"), expected: "NativeFailure: subclass failure" },
  { name: "empty DOMException", create: () => new DOMException(), expected: "DOMException: " },
  { name: "DOMException own data", create: () => Object.defineProperty(new DOMException("internal"), "message", { value: "own data" }), expected: "DOMException: own data" },
  { name: "DOMException own accessor", create: (hook) => Object.defineProperty(new DOMException("internal"), "message", { get: hook }), expected: "DOMException: [Accessor]" },
  { name: "Error own accessor", create: (hook) => Object.defineProperty(new Error(), "message", { get: hook }), expected: "Error: [Accessor]" },
  { name: "Error inherited accessor", create: (hook) => Object.setPrototypeOf(new Error(), Object.create(Error.prototype, { message: { get: hook } })), expected: "Error: [Accessor]" },
  { name: "DOMException inherited accessor", create: (hook) => Object.setPrototypeOf(new DOMException("internal"), Object.create(DOMException.prototype, { message: { get: hook } })), expected: "DOMException: [Accessor]" },
  { name: "fake DOMException prototype", create: (hook) => Object.create(DOMException.prototype, { message: { enumerable: true, get: hook } }), expected: "[Accessor]" },
  { name: "native Error with a DOMException prototype", create: () => Object.setPrototypeOf(new Error(), DOMException.prototype), expected: "DOMException: [Accessor]" },
  { name: "inherited opaque data", create: (hook) => inheritMessage(new Error(), { visible: true, toString: hook }), expected: "visible" },
  { name: "constructor naming policy", create: () => Object.assign(new Error("unchanged"), { name: "DisplayAlias" }), expected: "Error: unchanged" },
  { name: "long inherited message", create: () => inheritMessage(new Error(), "message".repeat(2000)), expected: "…" },
  { name: "long DOMException message", create: () => new DOMException("message".repeat(2000)), expected: "…" }
];

describe.each([false, true])("parity error metadata nested=%s", (nested) => {
  it.each(cases)("preserves $name without invoking user hooks", async ({ create, expected }) => {
    const hook = vi.fn((): never => { throw new Error("user hook ran"); });
    const error = create(hook);
    let calls = 0;
    const command = defineCommand({
      name: "check",
      scope: ["sdk"],
      params: S.Object({}),
      handler: () => { calls += 1; throw error; }
    });
    const group = defineGroup({ name: "group", children: [command] });
    const root = defineGroup({ name: "audit", children: [nested ? group : command] });

    const result = await createCommandTestHarness(root).parity(nested ? ["group", "check"] : ["check"]);

    expect(calls).toBe(1);
    expect(result.sdk.error).toBe(error);
    expect(result.agree).toBe(false);
    expect(result.diff).toContain(expected);
    expect(result.diff!.length).toBeLessThan(12500);
    expect(hook).not.toHaveBeenCalled();
  });

  it.each([false, true])("compares full inherited messages across adapters, differing=%s", async (differing) => {
    let calls = 0;
    const command = defineCommand({
      name: "check",
      scope: ["sdk", "mcp", "cli"],
      params: S.Object({}),
      handler: () => {
        calls += 1;
        throw inheritMessage(new UserError("removed"), `${"message".repeat(1000)}${differing ? calls : "same"}`);
      }
    });
    const group = defineGroup({ name: "group", children: [command] });
    const root = defineGroup({ name: "audit", children: [nested ? group : command] });

    const result = await createCommandTestHarness(root).parity(nested ? ["group", "check"] : ["check"]);

    expect(calls).toBe(3);
    expect(result.agree).toBe(!differing);
    if (differing) {
      expect(result.diff).toContain("…");
      expect(result.diff!.length).toBeLessThan(12500);
    }
  });
});
