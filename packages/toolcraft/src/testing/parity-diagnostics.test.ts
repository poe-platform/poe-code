import { describe, expect, it, vi } from "vitest";
import { S, UserError, defineCommand, defineGroup } from "../index.js";
import { createCommandTestHarness } from "./harness.js";

type Hook = () => never;
interface DiagnosticCase {
  name: string;
  create: (hook: Hook) => unknown;
  expected: string;
}

const values: DiagnosticCase[] = [
  { name: "undefined", create: () => undefined, expected: "undefined" },
  { name: "null", create: () => null, expected: "null" },
  { name: "ordinary string", create: () => "ready", expected: "ready" },
  { name: "ordinary number", create: () => 7, expected: "7" },
  { name: "bigint", create: () => 1n, expected: "1n" },
  { name: "nested bigint", create: () => ({ count: 1n }), expected: "1n" },
  { name: "cycle", create: () => { const cycle: Record<string, unknown> = {}; cycle.self = cycle; return cycle; }, expected: "[Circular]" },
  { name: "JSON hook", create: (hook) => ({ toJSON: hook }), expected: "toJSON" },
  { name: "accessor", create: (hook) => Object.defineProperty({}, "data", { enumerable: true, get: hook }), expected: "[Accessor]" },
  { name: "string tag getter", create: (hook) => Object.defineProperty({ visible: true }, Symbol.toStringTag, { get: hook }), expected: "visible" },
  { name: "custom inspection hook", create: (hook) => ({ visible: true, [Symbol.for("nodejs.util.inspect.custom")]: hook }), expected: "visible" },
  { name: "proxy traps", create: (hook) => new Proxy({}, { get: (_target, key) => key === "then" ? undefined : hook(), getPrototypeOf: hook, ownKeys: hook, getOwnPropertyDescriptor: hook }), expected: "[Proxy]" },
  { name: "function", create: () => function opaqueResult() {}, expected: "[Function]" },
  { name: "symbol", create: () => Symbol("sample"), expected: "Symbol(sample)" },
  { name: "NaN", create: () => NaN, expected: "NaN" },
  { name: "negative zero", create: () => -0, expected: "-0" },
  { name: "infinity", create: () => Infinity, expected: "Infinity" },
  { name: "array hole", create: () => new Array(1), expected: "[Empty]" },
  { name: "repeated noncyclic aliases", create: () => { const shared = { ready: true }; return { first: shared, second: shared }; }, expected: "second" },
  { name: "deep object", create: () => { let nested: unknown = "end"; for (let index = 0; index < 20; index += 1) nested = { nested }; return nested; }, expected: "[Object]" },
  { name: "deep array", create: () => { let nested: unknown = "end"; for (let index = 0; index < 20; index += 1) nested = [nested]; return nested; }, expected: "[Array]" },
  { name: "wide array", create: () => Array.from({ length: 1000 }, (_, index) => index), expected: "…" },
  { name: "wide object", create: () => Object.fromEntries(Array.from({ length: 1000 }, (_value, index) => [`field${index}`, index])), expected: "…" },
  { name: "long string", create: () => "payload".repeat(2000), expected: "…" }
];

class SyntheticFailure extends Error {}
const errors: DiagnosticCase[] = [
  { name: "Error", create: () => new Error("synthetic error"), expected: "Error: synthetic error" },
  { name: "TypeError", create: () => new TypeError("synthetic type"), expected: "TypeError: synthetic type" },
  { name: "subclass", create: () => new SyntheticFailure("synthetic subclass"), expected: "SyntheticFailure: synthetic subclass" },
  { name: "string", create: () => "synthetic string", expected: "synthetic string" },
  { name: "bigint", create: () => 1n, expected: "bigint" },
  { name: "null prototype", create: () => Object.assign(Object.create(null), { message: "synthetic failure" }), expected: "synthetic failure" },
  { name: "string hook", create: (hook) => ({ toString: hook }), expected: "toString" },
  { name: "primitive hook", create: (hook) => ({ message: "synthetic failure", [Symbol.toPrimitive]: hook }), expected: "synthetic failure" },
  { name: "proxy traps", create: (hook) => new Proxy({}, { get: hook, getPrototypeOf: hook, ownKeys: hook }), expected: "[Proxy]" },
  { name: "revoked proxy", create: () => { const proxy = Proxy.revocable({}, {}); proxy.revoke(); return proxy.proxy; }, expected: "[Proxy]" },
  { name: "message getter", create: (hook) => Object.defineProperty(new Error(), "message", { get: hook }), expected: "[Accessor]" },
  { name: "constructor getter", create: (hook) => Object.defineProperty(new Error("synthetic error"), "constructor", { get: hook }), expected: "synthetic error" },
  { name: "prototype proxy", create: (hook) => Object.setPrototypeOf(new Error("synthetic error"), new Proxy(Error.prototype, { get: hook, getPrototypeOf: hook, getOwnPropertyDescriptor: hook })), expected: "synthetic error" },
  { name: "non-string message", create: (hook) => Object.defineProperty(new Error(), "message", { value: { toString: hook } }), expected: "toString" },
  { name: "stack getter", create: (hook) => Object.defineProperty(new Error("synthetic error"), "stack", { get: hook }), expected: "synthetic error" },
  { name: "long Error message", create: () => new Error("message".repeat(2000)), expected: "…" },
  { name: "long thrown string", create: () => "message".repeat(2000), expected: "…" }
];

describe.each([false, true])("parity diagnostics nested=%s", (nested) => {
  it.each([false, true])("preserves full error-message comparison, differing=%s", async (differing) => {
    let calls = 0;
    const command = defineCommand({
      name: "check",
      scope: ["sdk", "mcp", "cli"],
      params: S.Object({}),
      handler: () => { calls += 1; throw new UserError(`${"message".repeat(1000)}${differing ? calls : "same"}`); }
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

  describe.each([
    { name: "successful values", cases: values, throws: false },
    { name: "thrown values", cases: errors, throws: true }
  ])("$name", ({ cases, throws }) => {
    it.each(cases)("reports $name without executing diagnostic hooks", async ({ name, create, expected }) => {
      const hook = vi.fn((): never => { throw new Error("unsafe diagnostic hook"); });
      const value = create(hook);
      let calls = 0;
      const handler = () => { calls += 1; if (throws) throw value; return value; };
      const command = defineCommand({ name: "check", scope: ["sdk"], params: S.Object({}), handler });
      const group = defineGroup({ name: "group", children: [command] });
      const root = defineGroup({ name: "audit", children: [nested ? group : command] });
      const result = await createCommandTestHarness(root).parity(nested ? ["group", "check"] : ["check"]);
      expect(calls).toBe(1);
      expect(hook).not.toHaveBeenCalled();
      expect(result.agree).toBe(false);
      expect(result.sdk.ok).toBe(!throws);
      expect(throws ? result.sdk.error : result.sdk.value).toBe(value);
      expect(result.mcp.ok).toBe(false);
      expect(result.cli.ok).toBe(false);
      expect(result.diff).toContain(expected);
      expect(result.diff).toContain("SurfaceScopeError");
      expect(result.diff!.length).toBeLessThan(6000);
      if (name === "repeated noncyclic aliases") expect(result.diff).not.toContain("[Circular]");
    });
  });
});
