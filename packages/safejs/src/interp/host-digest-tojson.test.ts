import { describe, expect, it, vi } from "vitest";
import { declareHostOperation, deepCopyFromSandbox, dump, restore, run } from "@poe-code/safejs";

const cases = [
  { name: "record", leaf: "{ value: 7 }", input: "leaf", nested: false },
  { name: "named array", leaf: "[7]", input: "leaf", nested: false },
  { name: "indexed record", leaf: "{ value: 7 }", input: "[leaf]", nested: true },
  { name: "nested record", leaf: "{ value: 7 }", input: "{ leaf }", nested: true }
] as const;

function sourceFor(leaf: string, input: string): string {
  return `let calls = 0;
const events = [];
const leaf = ${leaf};
leaf.toJSON = () => { calls++; events.push("toJSON"); return 7; };
const input = ${input};
input.alias = leaf.toJSON;
input.observe = () => { events.push("host"); return calls; };
events.push("before-host");
const result = await host(input);
events.push("after-host");
return [calls, events, result];`;
}

function ownValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") throw new Error("Expected host object");
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function ownFunction(value: unknown, key: string): () => unknown {
  const callable = ownValue(value, key);
  if (typeof callable !== "function") throw new Error("Expected retained callable own data");
  return callable as () => unknown;
}

describe("host digest serialization hooks", () => {
  for (const fixture of cases) {
    it.each([false, true])(
      `preserves ${fixture.name} callbacks with explicit host invocation %s`,
      async (explicit) => {
        const source = sourceFor(fixture.leaf, fixture.input);
        const observe = async (input: unknown) => {
          const leaf = fixture.nested
            ? ownValue(input, Array.isArray(input) ? "0" : "leaf")
            : input;
          const hook = ownFunction(leaf, "toJSON");
          const countAtHost = await ownFunction(input, "observe")();
          return [
            countAtHost,
            explicit ? await hook() : null,
            hook === ownValue(input, "alias"),
            Object.keys(input as object),
            Object.keys(leaf as object)
          ];
        };
        const nativeHost = vi.fn(observe);
        const native: unknown = await new Function("host", `return (async () => {${source}})();`)(
          nativeHost
        );
        expect(nativeHost).toHaveBeenCalledTimes(1);
        expect(native).toStrictEqual([
          explicit ? 1 : 0,
          explicit
            ? ["before-host", "host", "toJSON", "after-host"]
            : ["before-host", "host", "after-host"],
          [0, explicit ? 7 : null, true, expect.any(Array), expect.any(Array)]
        ]);
        const host = vi.fn(observe);
        const bindings = { host: declareHostOperation(host, "read-side-effect") };
        let result = await run(source, { bindings });
        expect(host).toHaveBeenCalledTimes(1);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("Expected successful host call");
        expect(deepCopyFromSandbox(result.returnValue)).toStrictEqual(native);
        const snapshot = JSON.parse(await dump(result));
        for (let replay = 0; replay < 2; replay++) {
          result = await run(source, { bindings, snapshot: restore(snapshot, { source }) });
          expect(result.ok).toBe(true);
          if (!result.ok) throw new Error("Expected successful completed replay");
          expect(deepCopyFromSandbox(result.returnValue)).toStrictEqual(native);
          expect(host).toHaveBeenCalledTimes(1);
        }
      }
    );
  }

  it("keeps sparse own data, aliases and named cycles without invoking toJSON", async () => {
    const source = `let calls = 0;
const shared = { value: 7 };
const input = new Array(4);
input[1] = undefined;
input[2] = shared;
input.metadata = shared;
input.raw = input;
input.map = 0;
input.toJSON = () => { calls++; return 7; };
input.alias = input.toJSON;
const result = await host(input);
return [calls, result];`;
    const observe = (input: unknown) => {
      if (!Array.isArray(input)) throw new Error("Expected sparse array");
      return [
        input.length,
        Object.keys(input),
        Object.hasOwn(input, "0"),
        Object.hasOwn(input, "1"),
        input[1] === undefined,
        Object.hasOwn(input, "3"),
        input[2] === ownValue(input, "metadata"),
        input === ownValue(input, "raw"),
        ownValue(input, "map"),
        ownFunction(input, "toJSON") === ownValue(input, "alias")
      ];
    };
    const nativeHost = vi.fn(observe);
    const native: unknown = await new Function("host", `return (async () => {${source}})();`)(
      nativeHost
    );
    const host = vi.fn(observe);
    const bindings = { host: declareHostOperation(host, "read-side-effect") };
    const result = await run(source, { bindings });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected successful sparse host call");
    expect(deepCopyFromSandbox(result.returnValue)).toStrictEqual(native);
    expect(native).toStrictEqual([
      0,
      [4, expect.any(Array), false, true, true, false, true, true, 0, true]
    ]);
    const replay = await run(source, {
      bindings,
      snapshot: restore(JSON.parse(await dump(result)), { source })
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error("Expected successful sparse completed replay");
    expect(deepCopyFromSandbox(replay.returnValue)).toStrictEqual(native);
    expect(host).toHaveBeenCalledTimes(1);
  });
});
