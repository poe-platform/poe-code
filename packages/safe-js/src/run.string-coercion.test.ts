import { describe, expect, it, vi } from "vitest";

import {
  declareHostOperation,
  deepCopyFromSandbox,
  dump,
  registerPendingHostCallPolicy,
  restore,
  run
} from "./index.js";

describe("String hooks across host digest and completed replay", () => {
  it("keeps host capabilities opaque without invoking them during conversion or capture", async () => {
    let calls = 0;
    function capability() {
      calls++;
      return "string-coercion-host-body-must-stay-private";
    }
    const source = "return [String(capability), String([capability]), String(String)];";
    const bindings = { capability };
    const expected = [
      "function capability() { [native code] }",
      "function capability() { [native code] }",
      "function String() { [native code] }"
    ];
    const original = await run(source, { bindings });
    expect(original.ok).toBe(true);
    if (!original.ok) throw original.error;
    expect(deepCopyFromSandbox(original.returnValue)).toEqual(expected);
    expect(calls).toBe(0);
    for (let replay = 0; replay < 2; replay++) {
      const snapshot = JSON.parse(await dump(original));
      expect(calls).toBe(0);
      const result = await run(source, { bindings, snapshot: restore(snapshot, { source }) });
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(deepCopyFromSandbox(result.returnValue)).toEqual(expected);
      expect(calls).toBe(0);
    }
  });

  it.each([
    ["stringCoercionNamedOnly", false, "read-side-effect"],
    ["stringCoercionDeclaredOverride", true, "re-issue"]
  ] as const)(
    "preserves named host policy through active hook %s",
    async (operation, declared, policy) => {
      registerPendingHostCallPolicy({
        moduleId: "<bindings>",
        operation,
        policy: "read-side-effect"
      });
      const read = vi.fn(() => "owned");
      const bindings = { [operation]: declared ? declareHostOperation(read, "re-issue") : read };
      const source = `const value = { toString: ${operation} }; return String(value);`;
      const original = await run(source, { bindings });
      expect(original.ok).toBe(true);
      if (!original.ok) throw original.error;
      expect(original.returnValue).toBe("owned");
      expect(read).toHaveBeenCalledTimes(1);
      const snapshot = JSON.parse(await dump(original));
      expect(snapshot.replay.calls).toHaveLength(1);
      expect(snapshot.replay.calls[0]).toMatchObject({ moduleId: "<bindings>", operation, policy });
      expect(read).toHaveBeenCalledTimes(1);
      for (let replay = 0; replay < 2; replay++) {
        const result = await run(source, { bindings, snapshot: restore(snapshot, { source }) });
        expect(result.ok).toBe(true);
        if (!result.ok) throw result.error;
        expect(result.returnValue).toBe("owned");
        expect(read).toHaveBeenCalledTimes(1);
      }
    }
  );

  it("journals synchronous host work inside a guest hook exactly once", async () => {
    const source = "const value = { toString() { return read(); } }; return String(value);";
    const read = vi.fn(() => "owned");
    const bindings = { read: declareHostOperation(read, "read-side-effect") };
    const original = await run(source, { bindings });
    expect(original.ok).toBe(true);
    if (!original.ok) throw original.error;
    expect(original.returnValue).toBe(new Function("read", source)(() => "owned"));
    const snapshot = JSON.parse(await dump(original));
    for (let replay = 0; replay < 2; replay++) {
      const result = await run(source, { bindings, snapshot: restore(snapshot, { source }) });
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.returnValue).toBe("owned");
      expect(read).toHaveBeenCalledTimes(1);
    }
  });

  it("does not bypass host cancellation inside a guest hook", async () => {
    const controller = new AbortController();
    const after = vi.fn(() => "wrong");
    await expect(
      run("const value = { toString() { stop(); return after(); } }; return String(value);", {
        signal: controller.signal,
        bindings: { stop: () => controller.abort(), after }
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(after).not.toHaveBeenCalled();
  });

  it.each(["{}", 'new TypeError("before")', "[1, 2]"])(
    "preserves receiver, hook aliases, counts and replay for %s",
    async (initial) => {
      const source = `const events = [];
let calls = 0;
const value = ${initial};
value.toString = function () { calls++; events.push(this === value); return "owned"; };
const input = { value, alias: value, hook: value.toString };
input.observe = () => calls;
const text = String(value);
const observation = await host(input);
return [text, calls, events, observation, value === input.alias];`;
      const observe = async (input: unknown) => {
        if (typeof input !== "object" || input === null) throw new Error("Expected record");
        const value: unknown = Object.getOwnPropertyDescriptor(input, "value")?.value;
        if (typeof value !== "object" || value === null) throw new Error("Expected value");
        const count: unknown = Object.getOwnPropertyDescriptor(input, "observe")?.value;
        if (typeof count !== "function") throw new Error("Expected observer");
        return [
          await count(),
          value === Object.getOwnPropertyDescriptor(input, "alias")?.value,
          Object.getOwnPropertyDescriptor(value, "toString")?.value ===
            Object.getOwnPropertyDescriptor(input, "hook")?.value
        ];
      };
      const nativeHost = vi.fn(observe);
      const native: unknown = await new Function("host", `return (async () => {${source}})();`)(
        nativeHost
      );
      expect(native).toEqual(["owned", 1, [true], [1, true, true], true]);
      const host = vi.fn(observe);
      const bindings = { host: declareHostOperation(host, "read-side-effect") };
      const original = await run(source, { bindings });
      expect(original.ok).toBe(true);
      if (!original.ok) throw original.error;
      expect(deepCopyFromSandbox(original.returnValue)).toEqual(native);
      const snapshot = JSON.parse(await dump(original));
      for (let replay = 0; replay < 2; replay++) {
        const result = await run(source, { bindings, snapshot: restore(snapshot, { source }) });
        expect(result.ok).toBe(true);
        if (!result.ok) throw result.error;
        expect(deepCopyFromSandbox(result.returnValue)).toEqual(native);
        expect(host).toHaveBeenCalledTimes(1);
      }
      expect(nativeHost).toHaveBeenCalledTimes(1);
    }
  );
});
