import { describe, expect, it } from "vitest";

import { parse, type ParseResult } from "../parse.js";
import { parseModule } from "../parse/parser.js";
import { Budget } from "./budget.js";
import { createCollectionGlobals } from "./globals/collections.js";
import { createConsoleJsonGlobals } from "./globals/console-json.js";
import { createErrorGlobals } from "./globals/error.js";
import { createMathGlobals } from "./globals/math.js";
import { createMiscGlobals } from "./globals/misc.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";
import { createRegexGlobals } from "./globals/regex.js";
import { wrapCallerInjectedBindings } from "./host-bridge.js";
import { interpret } from "./interpreter.js";
import { createPromiseGlobals } from "./promise.js";
import type { InterpreterValue } from "./values.js";

describe("JavaScript conformance matrix", () => {
  describe("equality and coercion", () => {
    const cases: Array<[string, string, unknown]> = [
      ["NaN equality", "return [NaN !== NaN, Object.is(NaN, NaN)]", [true, true]],
      [
        "signed zero",
        "return [0 === -0, Object.is(0, -0), 1 / -0 === -Infinity]",
        [true, false, true]
      ],
      ["array and boolean coercion", "return [] == ![]", true],
      [
        "empty whitespace strings coerce to zero",
        'return ["" == 0, " " == 0, "\\t\\n" == 0]',
        [true, true, true]
      ],
      [
        "null only loosely equals undefined",
        "return [null == undefined, null == 0]",
        [true, false]
      ],
      ["array primitive coercion", "return [[0] == false, [null] == 0]", [true, true]],
      ["typeof oddities", "return [typeof null, typeof NaN]", ["object", "number"]],
      [
        "addition coercion",
        "return [true + true, null + 1, Number.isNaN(undefined + 1)]",
        [2, 1, true]
      ],
      ["banana coercion", 'return "b" + "a" + +"a" + "a"', "baNaNa"],
      ["chained comparisons", "return [1 < 2 < 3, 3 > 2 > 1]", [true, false]],
      ["string comparison", 'return ["10" < "9", 10 < 9]', [true, false]],
      ["array addition", "return [1, 2, 3] + [4, 5, 6]", "1,2,34,5,6"]
    ];

    it.each(cases)("matches host JS for %s", async (_name, source, expected) => {
      await expect(run(source)).resolves.toEqual(expected);
    });
  });

  describe("numbers", () => {
    const cases: Array<[string, string, unknown]> = [
      [
        "floating point addition",
        "return [0.1 + 0.2, 0.1 + 0.2 !== 0.3]",
        [0.30000000000000004, true]
      ],
      ["toFixed rounding", "return (1.005).toFixed(2)", "1.00"],
      ["unsafe integer rounding", "return 9999999999999999 === 1e16", true],
      [
        "Infinity arithmetic",
        "return [Number.isNaN(Infinity - Infinity), Number.isNaN(Infinity * 0)]",
        [true, true]
      ],
      ["remainder signs", "return [-5 % 3, 5 % -3, 5.5 % 2]", [-2, 2, 1.5]],
      ["exponentiation associativity", "return 2 ** 3 ** 2", 512],
      ["bitwise conversion", "return [~5, -1 >>> 0, 1 << 32]", [-6, 4294967295, 1]],
      ["number radix strings", "return [(255).toString(16), (0.5).toString(2)]", ["ff", "0.1"]],
      [
        "Number conversion",
        'return [Number("0b101"), parseInt("0b101"), Number(""), Number([5]), Number.isNaN(Number([1, 2])), Number(null), Number.isNaN(Number(undefined))]',
        [5, 0, 0, 5, true, 0, true]
      ],
      [
        "numeric parsers",
        'return [parseInt("10px"), parseInt("0.5"), parseFloat("1e3")]',
        [10, 0, 1000]
      ]
    ];

    it.each(cases)("matches host JS for %s", async (_name, source, expected) => {
      await expect(run(source)).resolves.toEqual(expected);
    });

    it("rejects an unparenthesized unary expression left of exponentiation", () => {
      expect(() => parse("return -2 ** 2")).toThrow(
        "Unary expressions cannot be used as the left-hand side of '**' without parentheses"
      );
    });
  });

  describe("arrays and holes", () => {
    it("sorts lexicographically by default", async () => {
      await expect(run("return [10, 1, 2].sort()")).resolves.toEqual([1, 10, 2]);
    });

    it("preserves holes in map and skips them in forEach", async () => {
      await expect(
        run(
          "const seen = []; const mapped = [1,,3].map((x) => x * 2); [1,,3].forEach((x) => seen.push(x)); return [mapped.length, Object.keys(mapped), mapped[0], mapped[2], seen]"
        )
      ).resolves.toEqual([3, ["0", "2"], 2, 6, [1, 3]]);
    });

    it("counts elisions in array length", async () => {
      await expect(run("return [,,].length")).resolves.toBe(2);
    });

    it("throws reducing an empty array without an initial value", async () => {
      await expectSandboxError(run("return [].reduce((a, b) => a + b)"), "TypeError");
      await expect(run("return [7].reduce((a, b) => a + b)")).resolves.toBe(7);
    });

    it("uses strict equality for indexOf and SameValueZero for includes", async () => {
      await expect(run("return [[1, 2, 3].indexOf(NaN), [NaN].includes(NaN)]")).resolves.toEqual([
        -1,
        true
      ]);
    });

    it("supports negative at, slice, and splice indices", async () => {
      await expect(
        run(
          'const values = [1, 2, 3, 4]; const removed = values.splice(-2, 1); return ["a".at(-1), [1, 2, 3].at(-1), [1, 2, 3, 4].slice(-2), removed, values]'
        )
      ).resolves.toEqual(["a", 3, [3, 4], [3], [1, 2, 4]]);
    });

    it("truncates length and delete creates a hole", async () => {
      await expect(
        run(
          "const values = [1, 2, 3]; values.length = 1; delete values[0]; return [values.length, Object.keys(values), values[0]]"
        )
      ).resolves.toEqual([1, [], undefined]);
    });

    it("flattens nested arrays to Infinity depth", async () => {
      await expect(run("return [1, [2, [3]]].flat(Infinity)")).resolves.toEqual([1, 2, 3]);
    });

    it("renders null, undefined, and holes as empty join fields", async () => {
      await expect(run("return [1, null, undefined,, 5].join()")).resolves.toBe("1,,,,5");
    });

    it("uses the comparator sign rather than exact minus or plus one", async () => {
      await expect(run("return [3, 1, 2].sort((a, b) => (a - b) / 10)")).resolves.toEqual([
        1, 2, 3
      ]);
    });
  });

  describe("strings and Unicode", () => {
    it("distinguishes UTF-16 length from code-point iteration", async () => {
      await expect(
        run('return ["😀".length, [..."😀"].length, "😀".codePointAt(0)]')
      ).resolves.toEqual([2, 1, 128512]);
    });

    it("iterates an astral character once", async () => {
      await expect(
        run('const output = []; for (const value of "😀") output.push(value); return output')
      ).resolves.toEqual(["😀"]);
    });

    it("returns empty string and NaN for out-of-range character access", async () => {
      await expect(
        run('return ["abc".charAt(5), Number.isNaN("abc".charCodeAt(5))]')
      ).resolves.toEqual(["", true]);
    });

    it("expands replacement special tokens", async () => {
      await expect(
        run(
          'return ["abc".replace("b", "$&$&"), "abc".replace("b", "$$"), "abc".replace("b", "$`"), "abc".replace("b", "$\'")]'
        )
      ).resolves.toEqual(["abbc", "a$c", "aac", "acc"]);
    });

    it("repeats zero times and rejects negative counts", async () => {
      await expect(run('return "x".repeat(0)')).resolves.toBe("");
      await expectSandboxError(run('return "x".repeat(-1)'), "RangeError");
    });

    it("honors split limits", async () => {
      await expect(run('return "a-b-c".split("-", 2)')).resolves.toEqual(["a", "b"]);
    });
  });

  describe("scope, hoisting, TDZ, and closures", () => {
    it("throws for let and const access in the TDZ", async () => {
      await expectSandboxError(run("return value; let value = 1"), "ReferenceError");
      await expectSandboxError(run("return value; const value = 1"), "ReferenceError");
      await expectSandboxError(run("return typeof value; let value = 1"), "ReferenceError");
      await expect(run("return typeof undeclared")).resolves.toBe("undefined");
    });

    it("hoists var to undefined and outside its block", async () => {
      await expect(
        run("const before = value; if (true) { var value = 2; } return [before, value]")
      ).resolves.toEqual([undefined, 2]);
    });

    it("captures final var loop state and per-iteration let state", async () => {
      await expect(
        run(
          "const byVar = []; for (var i = 0; i < 3; i++) byVar.push(() => i); const byLet = []; for (let j = 0; j < 3; j++) byLet.push(() => j); return [byVar.map((fn) => fn()), byLet.map((fn) => fn())]"
        )
      ).resolves.toEqual([
        [3, 3, 3],
        [0, 1, 2]
      ]);
    });

    it("hoists function declarations", async () => {
      await expect(run("return value(); function value() { return 7; }")).resolves.toBe(7);
    });

    it("rejects const reassignment", async () => {
      await expectSandboxError(run("const value = 1; value = 2"), "TypeError");
    });

    it("enforces default parameter TDZ", async () => {
      await expectSandboxError(
        run("function value(a = b, b = 1) { return a; } return value()"),
        "ReferenceError"
      );
    });
  });

  describe("this and new", () => {
    it("uses lexical this for arrows and undefined for extracted strict methods", async () => {
      await expect(
        run(
          "const object = { value: 4, method() { const arrow = () => this.value; return arrow(); } }; const extracted = object.method; let bare; try { bare = extracted(); } catch (error) { bare = error instanceof TypeError; } return [object.method(), bare]"
        )
      ).resolves.toEqual([4, true]);
    });

    it("uses returned objects from constructors but ignores returned primitives", async () => {
      await expect(
        run(
          "function ObjectResult() { this.value = 1; return { value: 2 }; } function PrimitiveResult() { this.value = 3; return 4; } return [new ObjectResult().value, new PrimitiveResult().value]"
        )
      ).resolves.toEqual([2, 3]);
    });

    it("rejects constructing an arrow", async () => {
      await expectSandboxError(run("const value = () => {}; return new value()"), "TypeError");
    });

    it("does not inherit this into plain nested functions", async () => {
      await expect(
        run(
          "const object = { method() { function nested() { return this; } return nested(); } }; return object.method() === undefined"
        )
      ).resolves.toBe(true);
    });
  });

  describe("control flow", () => {
    it("lets finally completion supersede try completion", async () => {
      await expect(
        run("function value() { try { return 1; } finally { return 2; } } return value()")
      ).resolves.toBe(2);
      await expect(
        run(
          "let ran = false; function value() { try { return 1; } finally { ran = true; } } const result = value(); return [result, ran]"
        )
      ).resolves.toEqual([1, true]);
      await expect(
        run(
          'function value() { try { return 1; } finally { throw "later"; } } try { value(); } catch (error) { return error; }'
        )
      ).resolves.toBe("later");
    });

    it("falls through switch cases and can match a leading default last", async () => {
      await expect(
        run(
          "const output = []; switch (2) { case 1: output.push(1); case 2: output.push(2); case 3: output.push(3); break; case 4: output.push(4); } switch (9) { default: output.push('default'); case 9: output.push(9); break; } return output"
        )
      ).resolves.toEqual([2, 3, 9]);
    });

    it("continues a labeled outer loop", async () => {
      await expect(
        run(
          "const output = []; outer: for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { if (j === 1) continue outer; output.push([i, j]); } } return output"
        )
      ).resolves.toEqual([
        [0, 0],
        [1, 0],
        [2, 0]
      ]);
    });
  });

  describe("async and promises", () => {
    it("runs promise reactions after sync code", async () => {
      await expect(
        run(
          "const output = []; Promise.resolve().then(() => output.push('microtask')); output.push('sync'); await Promise.resolve(); return output"
        )
      ).resolves.toEqual(["sync", "microtask"]);
    });

    it("awaits non-promises and thenables", async () => {
      await expect(
        run("const thenable = { then(resolve) { resolve(8); } }; return [await 7, await thenable]")
      ).resolves.toEqual([7, 8]);
    });

    it("implements Promise combinator outcomes", async () => {
      await expect(
        run(
          "const all = await Promise.all([Promise.resolve(2), 1]); const race = await Promise.race([Promise.resolve('first'), Promise.resolve('second')]); const any = await Promise.any([Promise.reject('no'), Promise.resolve('yes')]); const settled = await Promise.allSettled([Promise.resolve(3), Promise.reject('bad')]); return [all, race, any, settled]"
        )
      ).resolves.toEqual([
        [2, 1],
        "first",
        "yes",
        [
          { status: "fulfilled", value: 3 },
          { status: "rejected", reason: "bad" }
        ]
      ]);
    });

    it("passes values and reasons through finally and rejects when finally throws", async () => {
      await expect(
        run(
          "const value = await Promise.resolve(3).finally(() => 9); let reason; try { await Promise.reject('bad').finally(() => 9); } catch (error) { reason = error; } let thrown; try { await Promise.resolve(1).finally(() => { throw 'later'; }); } catch (error) { thrown = error; } return [value, reason, thrown]"
        )
      ).resolves.toEqual([3, "bad", "later"]);
    });
  });

  describe("generators", () => {
    it("sends values into yield expressions", async () => {
      await expect(
        run(
          "function* values() { const input = yield 1; return input; } const iterator = values(); return [iterator.next(), iterator.next(7)]"
        )
      ).resolves.toEqual([
        { value: 1, done: false },
        { value: 7, done: true }
      ]);
    });

    it("delegates yield star and receives generator return values", async () => {
      await expect(
        run(
          "function* inner() { yield 4; return 5; } function* outer() { yield* [1, 2]; yield* 'ab'; const result = yield* inner(); return result; } const iterator = outer(); const output = []; let step; do { step = iterator.next(); output.push(step); } while (!step.done); return output"
        )
      ).resolves.toEqual([
        { value: 1, done: false },
        { value: 2, done: false },
        { value: "a", done: false },
        { value: "b", done: false },
        { value: 4, done: false },
        { value: 5, done: true }
      ]);
    });

    it("runs finally when return closes a generator", async () => {
      await expect(
        run(
          "const output = []; function* values() { try { yield 1; } finally { output.push('finally'); } } const iterator = values(); iterator.next(); const result = iterator.return(9); return [result, output]"
        )
      ).resolves.toEqual([{ value: 9, done: true }, ["finally"]]);
    });

    it("allows generator bodies to catch thrown-in values", async () => {
      await expect(
        run(
          "function* values() { try { yield 1; } catch (error) { return error; } } const iterator = values(); iterator.next(); return iterator.throw('caught')"
        )
      ).resolves.toEqual({ value: "caught", done: true });
    });
  });

  describe("Map, Set, and JSON", () => {
    it("uses SameValueZero keys and object identity", async () => {
      await expect(
        run(
          "const first = {}; const second = {}; const map = new Map([[NaN, 1], [first, 2], [second, 3]]); const set = new Set([-0]); const iterated = set.values().next().value; return [map.get(NaN), map.get(first), map.get(second), set.has(0), Object.is(iterated, 0)]"
        )
      ).resolves.toEqual([1, 2, 3, true, true]);
    });

    it("matches JSON.stringify omissions and number normalization", async () => {
      await expect(
        run(
          "return [JSON.stringify(undefined), JSON.stringify({ a: undefined, b: () => 1, c: 1 }), JSON.stringify([undefined, () => 1]), JSON.stringify(NaN), JSON.stringify(Infinity), JSON.stringify(-0)]"
        )
      ).resolves.toEqual([undefined, '{"c":1}', "[null,null]", "null", "null", "0"]);
    });

    it("rejects circular JSON structures", async () => {
      await expectSandboxError(
        run("const value = {}; value.self = value; return JSON.stringify(value)"),
        "TypeError"
      );
    });

    it("honors toJSON", async () => {
      await expect(
        run("return JSON.stringify({ value: 1, toJSON() { return { replaced: 2 }; } })")
      ).resolves.toBe('{"replaced":2}');
    });
  });

  describe("destructuring", () => {
    it("destructures property names in for-in heads", async () => {
      await expect(run("const keys=[];for(const [first,second] in {ab:1,cd:2})keys.push(first+second);return keys"))
        .resolves.toEqual(["ab", "cd"]);
    });

    it("only applies defaults to undefined and permits earlier default bindings", async () => {
      await expect(
        run(
          "const { a = 1 } = { a: null }; const { a: first = 1, b = first + 1 } = {}; return [a, first, b]"
        )
      ).resolves.toEqual([null, 1, 2]);
    });

    it("evaluates assignment destructuring right-hand side before writes", async () => {
      await expect(run("let a = 1; let b = 2; [a, b] = [b, a]; return [a, b]")).resolves.toEqual([
        2, 1
      ]);
    });
  });

  it("binds function arguments without invoking the target early", async () => {
    await expect(
      run(
        "let calls = 0; const target = (first, second) => { calls++; return first + second; }; const bound = target.bind(null, 20); const before = calls; return [before, bound(22), calls];"
      )
    ).resolves.toEqual([0, 42, 1]);
  });

  describe("collection iterator representation", () => {
    it("returns iterator objects from Map and Set iteration methods", async () => {
      await expect(
        run(
          "const map = new Map([[1, 2]]); const set = new Set([3]); return [Array.isArray(map.keys()), Array.isArray(map.values()), Array.isArray(map.entries()), Array.isArray(set.keys()), Array.isArray(set.values()), Array.isArray(set.entries())]"
        )
      ).resolves.toEqual([false, false, false, false, false, false]);
    });
  });

  describe("documented deviations", () => {
    it("provides ordinary Object inspection through the Array prototype graph", async () => {
      await expect(run("return [({}).toString(), [].hasOwnProperty === Object.prototype.hasOwnProperty]")).resolves.toEqual([
        "[object Object]",
        true
      ]);
    });

    it("rejects await inside generators", () => {
      expect(() => parse("function* values() { await 1; }")).toThrow(
        "generators cannot await; use a regular async function"
      );
    });

    it("rejects host RegExp bindings", () => {
      const budget = new Budget();
      expect(() => wrapCallerInjectedBindings({ pattern: /x/ }, { budget })).toThrow(TypeError);
    });
  });
});

async function run(source: string): Promise<InterpreterValue | undefined> {
  const budget = new Budget();
  const result = await interpret(parseScript(source), {
    bindings: {
      ...createConsoleJsonGlobals({ budget }),
      ...createCollectionGlobals({ budget }),
      ...createErrorGlobals({ budget }),
      ...createMathGlobals(),
      ...createObjectArrayGlobals({ budget }),
      ...createMiscGlobals({ budget }),
      ...createPromiseGlobals({ budget }),
      ...createRegexGlobals({ budget })
    },
    budget
  });

  if (!result.ok) {
    throw result.error;
  }

  return result.returnValue;
}

function parseScript(source: string): ParseResult {
  try {
    return parse(source);
  } catch {
    const module = parseModule(source);
    return {
      type: "BlockStatement",
      body: module.body,
      span: module.span
    };
  }
}

async function expectSandboxError(
  result: Promise<unknown>,
  name: "RangeError" | "ReferenceError" | "TypeError"
): Promise<void> {
  await expect(result).rejects.toMatchObject({ name });
}
