import { describe, expect, it } from "vitest";
import { run } from "../core.js";
import { getSandboxIterator } from "./iteration.js";

describe("iterator acquisition", () => {
  it.each([false, 0, "", Symbol("result"), null, undefined])(
    "rejects a primitive iterator result %s before requesting next",
    (value) => {
      const source = { [Symbol.iterator]: () => value };
      const nativeAcquire = new Function("source", "const [] = source;");
      expect(() => nativeAcquire(source)).toThrow(TypeError);
      expect(() => getSandboxIterator(source as never)).toThrow(TypeError);
    }
  );

  it.each(["false", "0", "''", "{}"])(
    "does not treat non-callable iterator %s as array-like fallback",
    async (method) => {
      const source = `const value={0:'entry',length:1,[Symbol.iterator]:${method}};try{return Array.from(value)}catch(error){return error.name}`;
      const expected = new Function(source)();
      expect(expected).toBe("TypeError");
      expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
    }
  );

  it.each(["null", "undefined"])("allows absent iterator %s to fall back", async (method) => {
    const source = `return Array.from({0:'entry',length:1,[Symbol.iterator]:${method}});`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
  });

  it("caches next on acquisition without requiring it to be callable yet", () => {
    let reads = 0;
    const source = {
      [Symbol.iterator]: () => ({
        get next() {
          reads++;
          return 7;
        }
      })
    };
    const iterator = getSandboxIterator(source as never)!;
    expect(reads).toBe(1);
    expect(() => iterator.next()).toThrow(TypeError);
    expect(reads).toBe(1);
  });
});
