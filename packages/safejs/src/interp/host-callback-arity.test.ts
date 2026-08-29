import { describe, expect, it, vi } from "vitest";

import {
  declareHostOperation,
  deepCopyFromSandbox,
  deepCopyToSandbox,
  dump,
  restore,
  run
} from "@poe-code/safejs";
import { bounded, deferred } from "../../test/fixtures/final-async-proof.js";

const exactSource =
  "let invoked = 0;\nconst values = [1];\nvalues.map = (first, second = 0) => { invoked++; return first + second; };\nconst result = host(values);\nreturn [result, invoked, values.map.length];";

describe("host-observable guest callback arity", () => {
  it("matches native host-observed map length for the exact clarified source", async () => {
    const nativeLengths: number[] = [];
    const native: unknown = await new Function(
      "host",
      `return (async () => {` + exactSource + `})();`
    )((values: unknown) => {
      const callback = Object.getOwnPropertyDescriptor(values, "map")?.value;
      if (typeof callback !== "function") throw new Error("Expected callable map data");
      nativeLengths.push(callback.length);
      return 1;
    });
    expect(native).toStrictEqual([1, 0, 1]);
    expect(nativeLengths).toStrictEqual([1]);
    const observed: number[] = [];
    const host = vi.fn((values: unknown) => {
      const callback = Object.getOwnPropertyDescriptor(values, "map")?.value;
      if (typeof callback !== "function") throw new Error("Expected exported source callback");
      observed.push(callback.length);
      return 1;
    });
    const result = await run(exactSource, {
      bindings: { host: declareHostOperation(host, "read-side-effect") }
    });
    expect(result).toMatchObject({ ok: true, returnValue: native });
    expect(host).toHaveBeenCalledTimes(1);
    expect(observed).toStrictEqual(nativeLengths);
  });

  describe.each(["ordinary arguments", "array own graph"])("%s", (route) => {
    it.each([
      ["", 0],
      ["first", 1],
      ["first, second, third", 3],
      ["first = ++defaults, second", 0],
      ["first, second = ++defaults, third", 1],
      ["first, second, third = ++defaults", 2],
      ["...rest", 0],
      ["first, ...rest", 1],
      ["first, second = ++defaults, ...rest", 1],
      ["{ first, second }, [third, fourth]", 2],
      ["{ first = 1 }, [second = 2], third", 3],
      ["{ first } = {}, second", 0]
    ])("exports parameter length for (%s)", async (parameters, length) => {
      const source = `let defaults = 0;
let invoked = 0;
function declared(${parameters}) { invoked++; }
const expression = function named(${parameters}) { invoked++; };
const arrow = (${parameters}) => { invoked++; };
const asynchronous = async (${parameters}) => { invoked++; };
const method = ({ method(${parameters}) { invoked++; } }).method;
function* generator(${parameters}) { invoked++; }
const callbacks = [declared, expression, arrow, asynchronous, method, generator];
const guest = callbacks.map(callback => callback.length);
${route === "array own graph" ? "callbacks.map = declared; callbacks.metadata = { alias: declared }; callbacks.raw = callbacks;" : ""}
const observed = await host(${route === "array own graph" ? "callbacks" : "...callbacks"});
return { observed, guest, defaults, invoked };`;
      const inspect = (...args: unknown[]) => {
        const callbacks = route === "array own graph" ? args[0] : args;
        if (!Array.isArray(callbacks)) throw new Error("Expected callback array");
        const lengths: number[] = [];
        for (let index = 0; index < callbacks.length; index++) {
          const callback = Object.getOwnPropertyDescriptor(callbacks, String(index))?.value;
          if (typeof callback !== "function") throw new Error("Expected callback function");
          lengths.push(callback.length);
        }
        if (route === "array own graph") {
          expect(Object.getOwnPropertyDescriptor(callbacks, "map")?.value).toBe(callbacks[0]);
          const metadata: unknown = Object.getOwnPropertyDescriptor(callbacks, "metadata")?.value;
          expect(Object.getOwnPropertyDescriptor(metadata, "alias")?.value).toBe(callbacks[0]);
          expect(Object.getOwnPropertyDescriptor(callbacks, "raw")?.value).toBe(callbacks);
        }
        return lengths;
      };
      const native: unknown = await new Function("host", `return (async () => {${source}})();`)(
        inspect
      );
      expect(native).toStrictEqual({
        observed: Array(6).fill(length),
        guest: Array(6).fill(length),
        defaults: 0,
        invoked: 0
      });
      const host = vi.fn(inspect);
      const result = await run(source, { bindings: { host } });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected callback metadata export");
      expect(structuredClone(deepCopyFromSandbox(result.returnValue))).toStrictEqual(native);
      expect(host).toHaveBeenCalledTimes(1);
    });
  });

  it("exports bound, rebound, rest and async callback lengths", async () => {
    const source = `function target(first, second, third = 1, ...rest) { return first + second + third + rest.length; }
async function asynchronous(first, second, third = 1) { return first + second + third; }
const arrow = (first, second) => first + second;
const bound = target.bind(null, 2);
return host(target, target.bind(null), bound, bound.bind(null, 3), target.bind(null, 1, 2, 3), asynchronous.bind(null, 1), arrow.bind(null, 1));`;
    const inspect = (...callbacks: unknown[]) =>
      callbacks.map((callback) => {
        if (typeof callback !== "function") throw new Error("Expected bound callback");
        return callback.length;
      });
    const native: unknown = await new Function("host", `return (async () => {${source}})();`)(
      inspect
    );
    expect(native).toStrictEqual([2, 2, 1, 0, 0, 1, 1]);
    const host = vi.fn(inspect);
    const result = await run(source, { bindings: { host } });
    expect(result).toMatchObject({ ok: true, returnValue: native });
    expect(host).toHaveBeenCalledTimes(1);
  });

  it("preserves cached aliases, native length descriptors, defaults and callback execution", async () => {
    const source = `let calls = 0;
let defaults = 0;
function target(first, second = ++defaults, ...rest) {
  calls++;
  return [first, second, rest.length, arguments.length];
}
const values = [target, target];
values.map = target;
values.metadata = { alias: target };
values.raw = values;
const observed = await host(values);
return { observed, calls, defaults, guest: target.length };`;
    const inspect = async (values: unknown) => {
      if (!Array.isArray(values)) throw new Error("Expected callback graph");
      const callback: unknown = values[0];
      if (typeof callback !== "function") throw new Error("Expected callable callback");
      const metadata: unknown = Object.getOwnPropertyDescriptor(values, "metadata")?.value;
      return {
        length: callback.length,
        descriptor: Object.getOwnPropertyDescriptor(callback, "length"),
        aliases: [
          callback === values[1],
          callback === Object.getOwnPropertyDescriptor(values, "map")?.value,
          callback === Object.getOwnPropertyDescriptor(metadata, "alias")?.value,
          Object.getOwnPropertyDescriptor(values, "raw")?.value === values
        ],
        results: [await callback(3), await callback(4, 5, 6)]
      };
    };
    const native: unknown = await new Function("host", `return (async () => {${source}})();`)(
      inspect
    );
    expect(native).toStrictEqual({
      observed: {
        length: 1,
        descriptor: { value: 1, writable: false, enumerable: false, configurable: true },
        aliases: [true, true, true, true],
        results: [
          [3, 1, 0, 1],
          [4, 5, 1, 3]
        ]
      },
      calls: 2,
      defaults: 1,
      guest: 1
    });
    const host = vi.fn(inspect);
    const bindings = { host: declareHostOperation(host, "read-side-effect") };
    let result = await run(source, { bindings });
    for (let generation = 0; generation < 3; generation++) {
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected callback execution");
      expect(structuredClone(deepCopyFromSandbox(result.returnValue))).toStrictEqual(native);
      if (generation === 2) break;
      host.mockImplementation(async () => {
        throw new Error("Completed callbacks must not reissue");
      });
      result = await run(source, {
        bindings,
        snapshot: restore(JSON.parse(await dump(result)), { source })
      });
    }
    expect(host).toHaveBeenCalledTimes(1);
  });

  it("preserves arity and aliases on nested callbacks returned through the adapter", async () => {
    const source = `return await host(seed => {
  const target = (first, second, third = 1) => seed + first + second + third;
  return { target, alias: target, bound: target.bind(null, 2) };
});`;
    const inspect = async (callback: unknown) => {
      if (typeof callback !== "function") throw new Error("Expected outer callback");
      const value: unknown = await callback(7);
      const target: unknown = Object.getOwnPropertyDescriptor(value, "target")?.value;
      const bound: unknown = Object.getOwnPropertyDescriptor(value, "bound")?.value;
      if (typeof target !== "function" || typeof bound !== "function")
        throw new Error("Expected nested source callbacks");
      return [
        callback.length,
        target.length,
        bound.length,
        target === Object.getOwnPropertyDescriptor(value, "alias")?.value,
        await target(3, 4),
        await bound(5)
      ];
    };
    const native: unknown = await new Function("host", `return (async () => {${source}})();`)(
      inspect
    );
    expect(native).toStrictEqual([1, 2, 1, true, 15, 15]);
    const result = await run(source, { bindings: { host: inspect } });
    expect(result).toMatchObject({ ok: true, returnValue: native });
  });

  it("exports source and bound metadata after restoring a checkpoint before the host call", async () => {
    const source = `function target(first, second, third = 1) { return [first, second, third]; }
const bound = target.bind(null, 2);
await gate();
return await host(target, bound);`;
    const inspect = async (target: unknown, bound: unknown) => {
      if (typeof target !== "function" || typeof bound !== "function")
        throw new Error("Expected restored callbacks");
      return [target.length, bound.length, await target(3, 4), await bound(5)];
    };
    const native: unknown = await new Function(
      "host",
      "gate",
      `return (async () => {${source}})();`
    )(inspect, async () => undefined);
    expect(native).toStrictEqual([2, 1, [3, 4, 1], [2, 5, 1]]);
    const entered = deferred<void>();
    const gate = deferred<void>();
    const host = vi.fn(inspect);
    const execution = run(source, {
      bindings: {
        host: declareHostOperation(host, "read-side-effect"),
        gate: declareHostOperation(() => {
          entered.release();
          return gate.promise;
        }, "re-issue")
      }
    });
    let serialized: string;
    let initial: Awaited<typeof execution>;
    try {
      await bounded(
        Promise.race([
          entered.promise,
          execution.then(() => {
            throw new Error("Expected pending gate");
          })
        ]),
        "before-host gate"
      );
      serialized = await bounded(dump(execution, { mode: "replay" }), "before-host capture");
    } finally {
      gate.release();
      initial = await bounded(execution, "initial callback export");
    }
    expect(initial).toMatchObject({ ok: true, returnValue: native });
    expect(host).toHaveBeenCalledTimes(1);
    const restoredHost = vi.fn(inspect);
    const result = await run(source, {
      snapshot: restore(JSON.parse(serialized), { source }),
      bindings: {
        host: declareHostOperation(restoredHost, "read-side-effect"),
        gate: declareHostOperation(async () => undefined, "re-issue")
      }
    });
    expect(result).toMatchObject({ ok: true, returnValue: native });
    expect(restoredHost).toHaveBeenCalledTimes(1);
  });

  it("exposes genuine callback arity through fresh replay proof context without weakening provenance", async () => {
    const source = `return await host(async (first, second = 0) => { await gate(); return first + second; });`;
    const nativeLengths: number[] = [];
    const native: unknown = await new Function(
      "host",
      "gate",
      `return (async () => {${source}})();`
    )(
      async (callback: (first: number, second: number) => unknown) => {
        nativeLengths.push(callback.length);
        return callback(3, 4);
      },
      async () => undefined
    );
    expect(native).toBe(7);
    expect(nativeLengths).toStrictEqual([1]);
    const entered = deferred<void>();
    const gate = deferred<void>();
    const observed: number[] = [];
    const host = vi.fn(async (callback: (first: number, second: number) => unknown) => {
      observed.push(callback.length);
      return callback(3, 4);
    });
    const execution = run(source, {
      bindings: {
        host: declareHostOperation(host, "read-side-effect"),
        gate: declareHostOperation(() => {
          entered.release();
          return gate.promise;
        }, "re-issue")
      }
    });
    let serialized: string;
    try {
      await bounded(
        Promise.race([
          entered.promise,
          execution.then(() => {
            throw new Error("Expected pending callback");
          })
        ]),
        "callback gate"
      );
      serialized = await bounded(dump(execution, { mode: "replay" }), "callback proof capture");
    } finally {
      gate.release();
      expect(await bounded(execution, "callback completion")).toMatchObject({
        ok: true,
        returnValue: native
      });
    }
    expect(observed).toStrictEqual(nativeLengths);
    const reissue = vi.fn(() => {
      throw new Error("Proof must not reissue host");
    });
    const nativeFunction = vi.fn(() => 1);
    const proofLengths: number[] = [];
    const result = await run(source, {
      snapshot: restore(JSON.parse(serialized), { source }),
      bindings: {
        host: declareHostOperation(reissue, "read-side-effect"),
        gate: declareHostOperation(async () => undefined, "re-issue")
      },
      hostCallResumeProvider: async (request, context) => {
        if (context === undefined || context.callbacks.size !== 1)
          throw new Error("Expected one proof callback");
        for (const callback of context.callbacks.values()) proofLengths.push(callback.length);
        expect(() => context.toSandboxValue(nativeFunction)).toThrow("function");
        expect(() => deepCopyToSandbox(nativeFunction)).toThrow("function");
        const value = await context.replayed[0].result;
        return {
          ...request,
          callbackDisposition: "joined",
          outcome: { status: "fulfilled", value: context.toSandboxValue(value) }
        };
      }
    });
    expect(result).toMatchObject({ ok: true, returnValue: native });
    expect(proofLengths).toStrictEqual(nativeLengths);
    expect(host).toHaveBeenCalledTimes(1);
    expect(reissue).not.toHaveBeenCalled();
    expect(nativeFunction).not.toHaveBeenCalled();
  });
});
