import { describe, expect, it, vi } from "vitest";

import { dump } from "./dump.js";
import { Budget, SandboxError } from "./interp/budget.js";
import { createSandboxClosure, createSandboxPromise } from "./interp/values.js";
import { restore } from "./restore.js";
import { run } from "./run.js";

describe("run", () => {
  it("registers Math globals by default", async () => {
    await expect(run("return Math.max(Math.min(5, -2), Math.abs(-4))")).resolves.toMatchObject({
      ok: true,
      returnValue: 4
    });
  });

  it("registers Object, Array, and coercion globals by default", async () => {
    const result = await run(`return JSON.stringify(Array.of(
      Object.keys(JSON.parse('{"alpha":1,"beta":2}')),
      Object.values(JSON.parse('{"alpha":1,"beta":2}')),
      Object.entries(JSON.parse('{"alpha":1}')),
      Object.fromEntries(JSON.parse('[["left",1],["right",2]]')),
      Object.freeze(JSON.parse('{"locked":true}')),
      Object.assign(JSON.parse('{"start":1}'), JSON.parse('{"extra":2}')),
      Array.isArray(Array.of(1, 2)),
      Array.from(JSON.parse('["a","b"]')),
      Array.from(JSON.parse('["1","2"]'), Number),
      Array.of(1, 2, 3),
      String(123),
      Number('42.5'),
      Boolean(0)
    ))`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(JSON.parse(result.returnValue as string)).toEqual([
      ["alpha", "beta"],
      [1, 2],
      [["alpha", 1]],
      {
        left: 1,
        right: 2
      },
      {
        locked: true
      },
      {
        start: 1,
        extra: 2
      },
      true,
      ["a", "b"],
      [1, 2],
      [1, 2, 3],
      "123",
      42.5,
      false
    ]);
  });

  it("registers subset Promise helpers by default", async () => {
    const result = await run(`return JSON.stringify(Array.of(
      await Promise.resolve('ready'),
      await Promise.all(Array.of(Promise.resolve(1), 2)),
      await Promise.race(Array.of(Promise.resolve('first'))),
      await Promise.allSettled(Array.of(Promise.resolve('ok'), Promise.reject('no'))),
      await Promise.any(Array.of(Promise.reject('left'), Promise.resolve('right')))
    ))`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(JSON.parse(result.returnValue as string)).toEqual([
      "ready",
      [1, 2],
      "first",
      [
        {
          status: "fulfilled",
          value: "ok"
        },
        {
          reason: "no",
          status: "rejected"
        }
      ],
      "right"
    ]);
  });

  it("rejects in-flight awaits and the next host call when aborted", async () => {
    const controller = new AbortController();
    const after = vi.fn(() => "after");
    const result = run(
      `
try {
  await wait();
  return 'missed';
} catch {
  try {
    return after();
  } catch ({ message }) {
    return message;
  }
}
      `,
      {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(new Promise(() => undefined)),
            name: "wait"
          }),
          after: createSandboxClosure({
            call: () => after(),
            name: "after"
          })
        },
        signal: controller.signal
      }
    );

    controller.abort();

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "aborted"
    });
    expect(after).not.toHaveBeenCalled();
  });

  it("supports empty Promise iterables and enforces budgets through run()", async () => {
    const emptyResult = await run(`return JSON.stringify(Array.of(
      await Promise.all(Array.of()),
      await Promise.allSettled(Array.of())
    ))`);

    expect(emptyResult.ok).toBe(true);
    if (!emptyResult.ok) {
      return;
    }

    expect(JSON.parse(emptyResult.returnValue as string)).toEqual([[], []]);

    await expect(
      run("return await Promise.resolve(value)", {
        bindings: {
          value: "ready"
        },
        budget: new Budget({
          stringLength: 4
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        budget: "stringLength",
        current: 5,
        limit: 4
      } satisfies Partial<SandboxError>)
    );
  });

  it("registers Error globals by default", async () => {
    const result = await run(`return JSON.stringify(Array.of(
      Error('boom').name,
      Error('boom').message,
      Error().message,
      Error().stack,
      TypeError(42).name,
      TypeError(42).message,
      Error('boom').stack
    ))`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(JSON.parse(result.returnValue as string)).toEqual([
      "Error",
      "boom",
      "",
      "Error\n    at Error (line 5, column 7)",
      "TypeError",
      "42",
      "Error: boom\n    at Error (line 8, column 7)"
    ]);
  });

  it("intercepts supported string properties and methods", async () => {
    const result = await run(`return JSON.stringify(Array.of(
      'hello'.length,
      'hello'.charAt(1),
      'hello'.charCodeAt(1),
      'hello'.codePointAt(1),
      'hello'.includes('ell'),
      'hello'.startsWith('he'),
      'hello'.endsWith('lo'),
      'banana'.indexOf('an'),
      'banana'.lastIndexOf('an'),
      'banana'.slice(1, 4),
      'banana'.substring(1, 4),
      'banana'.substr(1, 3),
      'a,b,c'.split(','),
      'abba'.replace('b', 'x'),
      'abba'.replaceAll('b', 'x'),
      'HeLLo'.toLowerCase(),
      'HeLLo'.toUpperCase(),
      '  hi  '.trim(),
      '  hi  '.trimStart(),
      '  hi  '.trimEnd(),
      '5'.padStart(3, '0'),
      '5'.padEnd(3, '0'),
      'ha'.repeat(2),
      'a'.concat('b', 'c'),
      JSON.parse('"e\\\\u0301"').normalize()
    ))`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(JSON.parse(result.returnValue as string)).toEqual([
      5,
      "e",
      101,
      101,
      true,
      true,
      true,
      1,
      3,
      "ana",
      "ana",
      "ana",
      ["a", "b", "c"],
      "axba",
      "axxa",
      "hello",
      "HELLO",
      "hi",
      "hi  ",
      "  hi",
      "005",
      "500",
      "haha",
      "abc",
      "\u00E9"
    ]);
  });

  it("matches JavaScript edge behavior for intercepted string methods", async () => {
    const result = await run(`return JSON.stringify(Array.of(
      'banana'.includes('an', 2),
      'banana'.startsWith('na', 2),
      'banana'.endsWith('na', 4),
      'banana'.slice(-3, -1),
      'banana'.substring(4, 1),
      'banana'.substr(-2),
      'a,b,c'.split(undefined),
      'a,b,c'.split(',', 0),
      'abba'.replace('', '-'),
      'aba'.replaceAll('', '-'),
      'x'.padStart(4),
      JSON.parse('"e\\\\u0301"').normalize('NFD')
    ))`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(JSON.parse(result.returnValue as string)).toEqual([
      true,
      true,
      true,
      "an",
      "ana",
      "na",
      ["a,b,c"],
      [],
      "-abba",
      "-a-b-a-",
      "   x",
      "e\u0301"
    ]);
  });

  it("keeps coercion helpers opaque when used as Object sources", async () => {
    const result = await run(`return JSON.stringify(Array.of(
      Object.keys(String),
      Object.values(String),
      Object.entries(String),
      Object.assign(JSON.parse('{}'), String, JSON.parse('{"ok":true}'))
    ))`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(JSON.parse(result.returnValue as string)).toEqual([[], [], [], { ok: true }]);
  });

  it("rejects unsupported regex and function string method arguments at runtime", async () => {
    await expect(run("return 'abba'.replace('a', () => 'b')")).rejects.toThrow(
      "String#replace does not support function replacers or regex search values."
    );
    await expect(
      run("return 'abba'.replaceAll('a', replacer)", {
        bindings: { replacer: createSandboxClosure({ call: () => "b" }) }
      })
    ).rejects.toThrow(
      "String#replaceAll does not support function replacers or regex search values."
    );
    await expect(
      run("return 'a,b'.split(',', limit)", {
        bindings: { limit: createSandboxClosure({ call: () => 1 }) }
      })
    ).rejects.toThrow("String#split does not support function arguments.");
  });

  it("uses deterministic Math.random() when seeded", async () => {
    const first = await run("return Math.random()", {
      randomSeed: 123
    });
    const second = await run("return Math.random()", {
      randomSeed: 123
    });

    expect(first).toMatchObject({
      ok: true,
      returnValue: 0.2837369213812053,
      snapshot: {
        random: {
          seed: 123,
          state: 1_218_640_798
        }
      }
    });
    expect(second).toMatchObject({
      ok: true,
      returnValue: 0.2837369213812053,
      snapshot: {
        random: {
          seed: 123,
          state: 1_218_640_798
        }
      }
    });
  });

  it("replays seeded random progress from a saved snapshot", async () => {
    const source = "return Math.random()";
    const first = await run(source, {
      randomSeed: 123
    });
    const snapshot = dump(first);
    const restored = restore(snapshot, { source });
    const second = await run(source, {
      randomSeed: 999,
      snapshot: restored
    });

    expect(first).toMatchObject({
      ok: true,
      returnValue: 0.2837369213812053
    });
    expect(second).toMatchObject({
      ok: true,
      returnValue: 0.4351300236303359,
      snapshot: {
        random: {
          seed: 123,
          state: 1_868_869_221
        }
      }
    });
  });

  it("does not serialize random state for host randomness", async () => {
    const result = await run("return Math.random()");

    expect(result.ok).toBe(true);
    expect(result.snapshot.random).toBeUndefined();
  });
});
