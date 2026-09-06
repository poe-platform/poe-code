import { describe, expect, it, vi } from "vitest";

import { parse, parseModule, type ParseResult, type Statement } from "../parse.js";
import { Budget, SandboxError } from "./budget.js";
import { createCollectionGlobals } from "./globals/collections.js";
import { createConsoleJsonGlobals } from "./globals/console-json.js";
import { createErrorGlobals } from "./globals/error.js";
import { createMathGlobals, createSeededRandom } from "./globals/math.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";
import { wrapCallerInjectedBindings } from "./host-bridge.js";
import { interpret, Scope } from "./interpreter.js";
import { createSandboxClosure, createSandboxPromise, isSandboxPromise } from "./values.js";

describe("interpret", () => {
  describe("loop resume breakpoints", () => {
    it("restores a counter loop without repeated or skipped iterations", async () => {
      const program = block(
        parse("const output = []"),
        parse("for (let i = 0; i < 5; i = i + 1) { output.push(i); }"),
        parse('return output.join(",")')
      );
      let breakpointCount = 0;
      let snapshot: Parameters<typeof interpret>[1]["snapshot"];
      const globals = createObjectArrayGlobals({ budget: new Budget() });

      const first = await interpret(program, {
        bindings: globals,
        onYield: (yieldPoint) => {
          if (yieldPoint.kind === "loop-iteration" && (breakpointCount += 1) === 3) {
            snapshot = cloneLoopSnapshot(yieldPoint.snapshot());
          }
        }
      });
      const restored = await interpret(program, {
        bindings: globals,
        snapshot
      });

      expect(first).toMatchObject({ ok: true, returnValue: "0,1,2,3,4" });
      expect(restored).toMatchObject({ ok: true, returnValue: "0,1,2,3,4" });
    });

    it("restores for...of at the current array element", async () => {
      const program = block(
        parse("const output = []"),
        parse("for (const value of [10, 20, 30, 40]) { output.push(value); }"),
        parse("return output")
      );
      let breakpointCount = 0;
      let snapshot: Parameters<typeof interpret>[1]["snapshot"];
      const globals = createObjectArrayGlobals({ budget: new Budget() });

      const first = await interpret(program, {
        bindings: globals,
        onYield: (yieldPoint) => {
          if (yieldPoint.kind === "loop-iteration" && (breakpointCount += 1) === 3) {
            snapshot = cloneLoopSnapshot(yieldPoint.snapshot());
          }
        }
      });
      const restored = await interpret(program, { bindings: globals, snapshot });

      expect(first).toMatchObject({ ok: true, returnValue: [10, 20, 30, 40] });
      expect(restored).toMatchObject({ ok: true, returnValue: [10, 20, 30, 40] });
    });

    it("restores a while loop before the captured body", async () => {
      const program = block(
        parse("let i = 0"),
        parse("const output = []"),
        parse("while (i < 4) { output.push(i); i = i + 1; }"),
        parse("return output")
      );
      let breakpointCount = 0;
      let snapshot: Parameters<typeof interpret>[1]["snapshot"];
      const globals = createObjectArrayGlobals({ budget: new Budget() });

      const first = await interpret(program, {
        bindings: globals,
        onYield: (yieldPoint) => {
          if (yieldPoint.kind === "loop-iteration" && (breakpointCount += 1) === 3) {
            snapshot = cloneLoopSnapshot(yieldPoint.snapshot());
          }
        }
      });
      const restored = await interpret(program, { bindings: globals, snapshot });

      expect(first).toMatchObject({ ok: true, returnValue: [0, 1, 2, 3] });
      expect(restored).toMatchObject({ ok: true, returnValue: [0, 1, 2, 3] });
    });

    it("restores a do...while loop before the captured body", async () => {
      const program = block(
        parse("let i = 0"),
        parse("const output = []"),
        parse("do { output.push(i); i = i + 1; } while (i < 4)"),
        parse("return output")
      );
      let breakpointCount = 0;
      let snapshot: Parameters<typeof interpret>[1]["snapshot"];
      const globals = createObjectArrayGlobals({ budget: new Budget() });

      const first = await interpret(program, {
        bindings: globals,
        onYield: (yieldPoint) => {
          if (yieldPoint.kind === "loop-iteration" && (breakpointCount += 1) === 3) {
            snapshot = cloneLoopSnapshot(yieldPoint.snapshot());
          }
        }
      });
      const restored = await interpret(program, { bindings: globals, snapshot });

      expect(first).toMatchObject({ ok: true, returnValue: [0, 1, 2, 3] });
      expect(restored).toMatchObject({ ok: true, returnValue: [0, 1, 2, 3] });
    });

    it("restores for...in at the current key", async () => {
      const program = block(
        parse("const output = []"),
        parse("for (const key in value) { output.push(key); }"),
        parse("return output")
      );
      let breakpointCount = 0;
      let snapshot: Parameters<typeof interpret>[1]["snapshot"];
      const globals = createObjectArrayGlobals({ budget: new Budget() });

      const first = await interpret(program, {
        bindings: { ...globals, value: { first: 1, second: 2, third: 3 } },
        onYield: (yieldPoint) => {
          if (yieldPoint.kind === "loop-iteration" && (breakpointCount += 1) === 2) {
            snapshot = cloneLoopSnapshot(yieldPoint.snapshot());
          }
        }
      });
      const restored = await interpret(program, {
        bindings: { ...globals, value: { first: 1, second: 2, third: 3 } },
        snapshot
      });

      expect(first).toMatchObject({ ok: true, returnValue: ["first", "second", "third"] });
      expect(restored).toMatchObject({ ok: true, returnValue: ["first", "second", "third"] });
    });

    it("restores for...in from its original key list after deletion", async () => {
      const program = block(
        parse("const output = []"),
        parse("const value = { first: 1, second: 2, third: 3 }"),
        parse(
          "for (const key in value) { output.push(key); if (key === 'first') delete value.first; }"
        ),
        parse("return output")
      );
      let breakpointCount = 0;
      let snapshot: Parameters<typeof interpret>[1]["snapshot"];
      const globals = createObjectArrayGlobals({ budget: new Budget() });

      const first = await interpret(program, {
        bindings: globals,
        onYield: (yieldPoint) => {
          if (yieldPoint.kind === "loop-iteration" && (breakpointCount += 1) === 2) {
            snapshot = cloneLoopSnapshot(yieldPoint.snapshot());
          }
        }
      });
      const restored = await interpret(program, { bindings: globals, snapshot });

      expect(first).toMatchObject({ ok: true, returnValue: ["first", "second", "third"] });
      expect(restored).toMatchObject({ ok: true, returnValue: ["first", "second", "third"] });
    });

    it.each([
      ["Map", "new Map([[1, 'a'], [2, 'b'], [3, 'c']])", ["1a", "2b", "3c"]],
      ["Set", "new Set([1, 2, 3])", [1, 2, 3]]
    ])("restores for...of over a %s", async (_name, expression, expected) => {
      const program = block(
        parse("const output = []"),
        parse(
          expression.startsWith("new Map")
            ? `for (const [key, value] of ${expression}) { output.push(key + value); }`
            : `for (const value of ${expression}) { output.push(value); }`
        ),
        parse("return output")
      );
      let breakpointCount = 0;
      let snapshot: Parameters<typeof interpret>[1]["snapshot"];
      const budget = new Budget();
      const globals = {
        ...createObjectArrayGlobals({ budget }),
        ...createCollectionGlobals({ budget })
      };

      const first = await interpret(program, {
        bindings: globals,
        onYield: (yieldPoint) => {
          if (yieldPoint.kind === "loop-iteration" && (breakpointCount += 1) === 2) {
            snapshot = cloneLoopSnapshot(yieldPoint.snapshot());
          }
        }
      });
      const restored = await interpret(program, { bindings: globals, snapshot });

      expect(first).toMatchObject({ ok: true, returnValue: expected });
      expect(restored).toMatchObject({ ok: true, returnValue: expected });
    });

    it("restores the inner cursor of nested for...of loops", async () => {
      const program = block(
        parse("const output = []"),
        parse(
          "for (const left of ['a', 'b']) { for (const right of [1, 2, 3]) { output.push(left.concat(right)); } }"
        ),
        parse("return output")
      );
      let breakpointCount = 0;
      let snapshot: Parameters<typeof interpret>[1]["snapshot"];
      const globals = createObjectArrayGlobals({ budget: new Budget() });

      const first = await interpret(program, {
        bindings: globals,
        onYield: (yieldPoint) => {
          if (yieldPoint.kind === "loop-iteration" && (breakpointCount += 1) === 6) {
            snapshot = cloneLoopSnapshot(yieldPoint.snapshot());
          }
        }
      });
      const restored = await interpret(program, { bindings: globals, snapshot });

      expect(first).toMatchObject({ ok: true, returnValue: ["a1", "a2", "a3", "b1", "b2", "b3"] });
      expect(restored).toMatchObject({
        ok: true,
        returnValue: ["a1", "a2", "a3", "b1", "b2", "b3"]
      });
    });

    it("restores a generic iterable cursor by consumed position", async () => {
      const program = block(
        parse("const output = []"),
        parse("for (const value of values) { output.push(value); }"),
        parse("return output")
      );
      let breakpointCount = 0;
      let snapshot: Parameters<typeof interpret>[1]["snapshot"];
      const values = {
        [Symbol.iterator]: () => [1, 2, 3, 4][Symbol.iterator]()
      };
      const globals = createObjectArrayGlobals({ budget: new Budget() });

      const first = await interpret(program, {
        bindings: { ...globals, values: values as never },
        onYield: (yieldPoint) => {
          if (yieldPoint.kind === "loop-iteration" && (breakpointCount += 1) === 3) {
            snapshot = cloneLoopSnapshot(yieldPoint.snapshot());
          }
        }
      });
      const restored = await interpret(program, {
        bindings: { ...globals, values: values as never },
        snapshot
      });

      expect(first).toMatchObject({ ok: true, returnValue: [1, 2, 3, 4] });
      expect(restored).toMatchObject({ ok: true, returnValue: [1, 2, 3, 4] });
    });

    it("advances a generic iterable cursor after continue", async () => {
      const program = block(
        parse("const output = []"),
        parse("for (const value of values) { if (value === 2) continue; output.push(value); }"),
        parse("return output")
      );
      let breakpointCount = 0;
      let snapshot: Parameters<typeof interpret>[1]["snapshot"];
      const values = {
        [Symbol.iterator]: () => [1, 2, 3, 4][Symbol.iterator]()
      };
      const globals = createObjectArrayGlobals({ budget: new Budget() });

      const first = await interpret(program, {
        bindings: { ...globals, values: values as never },
        onYield: (yieldPoint) => {
          if (yieldPoint.kind === "loop-iteration" && (breakpointCount += 1) === 3) {
            snapshot = cloneLoopSnapshot(yieldPoint.snapshot());
          }
        }
      });
      const restored = await interpret(program, {
        bindings: { ...globals, values: values as never },
        snapshot
      });

      expect(first).toMatchObject({ ok: true, returnValue: [1, 3, 4] });
      expect(restored).toMatchObject({ ok: true, returnValue: [1, 3, 4] });
    });

    it("restores for...of over a sandbox generator", async () => {
      const program = block(
        parse("const output = []"),
        parse("function* values() { yield 1; yield 2; yield 3; yield 4; }"),
        parse("for (const value of values()) { output.push(value); }"),
        parse("return output")
      );
      let breakpointCount = 0;
      let snapshot: Parameters<typeof interpret>[1]["snapshot"];
      const globals = createObjectArrayGlobals({ budget: new Budget() });

      const first = await interpret(program, {
        bindings: globals,
        onYield: (yieldPoint) => {
          if (yieldPoint.kind === "loop-iteration" && (breakpointCount += 1) === 3) {
            snapshot = cloneLoopSnapshot(yieldPoint.snapshot());
          }
        }
      });
      const restored = await interpret(program, { bindings: globals, snapshot });

      expect(first).toMatchObject({ ok: true, returnValue: [1, 2, 3, 4] });
      expect(restored).toMatchObject({ ok: true, returnValue: [1, 2, 3, 4] });
    });

    it("still halts an infinite loop under a small node budget", async () => {
      await expect(
        interpret(parse("while (true) {}"), { budget: new Budget({ maxSteps: 20 }) })
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    });
  });

  describe("new expressions", () => {
    it("constructs user functions with a fresh this object", async () => {
      await expect(
        interpret(
          block(
            parse("function Person(name) { this.name = name; }"),
            parse("const person = new Person('Ada')"),
            parse("return person")
          )
        )
      ).resolves.toMatchObject({ ok: true, returnValue: { name: "Ada" } });
    });

    it("supports member callees and object return overrides", async () => {
      await expect(
        interpret(
          block(
            parse(
              "const constructors = { Person: function(name) { this.name = 'ignored'; return { name }; } }"
            ),
            parse("return new constructors.Person('Ada')")
          )
        )
      ).resolves.toMatchObject({ ok: true, returnValue: { name: "Ada" } });
    });

    it("ignores primitive constructor returns", async () => {
      await expect(
        interpret(
          block(
            parse("function Person() { this.name = 'Ada'; return 123; }"),
            parse("return new Person()")
          )
        )
      ).resolves.toMatchObject({ ok: true, returnValue: { name: "Ada" } });
    });

    it("creates a fresh this object for every construction and supports spread arguments", async () => {
      await expect(
        interpret(
          block(
            parse("function Pair(left, right) { this.values = [left, right]; }"),
            parse("const first = new Pair(...[1, 2])"),
            parse("const second = new Pair(...[3, 4])"),
            parse("return [first !== second, first.values, second.values]")
          )
        )
      ).resolves.toMatchObject({
        ok: true,
        returnValue: [true, [1, 2], [3, 4]]
      });
    });

    it.each([
      ["arrow", "const value = () => {}"],
      ["async function", "async function value() {}"],
      ["non-function", "const value = 1"]
    ])("rejects %s constructors", async (_name, declaration) => {
      await expect(
        interpret(block(parse(declaration), parse("return new value()")))
      ).rejects.toThrowError("value is not a constructor.");
    });

    it("rejects object method shorthand constructors", async () => {
      await expect(
        interpret(block(parse("const value = { make() {} }"), parse("return new value.make()")))
      ).rejects.toThrowError("make is not a constructor.");
    });

    it("rejects builtin method constructors", async () => {
      await expect(interpret(parse("new [].map()"))).rejects.toThrowError(
        "map is not a constructor."
      );
    });

    it("uses a computed member name in constructor errors", async () => {
      await expect(
        interpret(block(parse("const values = { make: 1 }"), parse("return new values['make']()")))
      ).rejects.toThrowError("make is not a constructor.");
    });

    it("preserves guest constructor prototypes and instanceof identity", async () => {
      await expect(
        interpret(block(parse("function Person() {}"), parse("return Person.prototype.constructor === Person")))
      ).resolves.toMatchObject({ ok: true, returnValue: true });

      await expect(
        interpret(
          block(
            parse("function Person() {}"),
            parse("const person = new Person()"),
            parse("return person instanceof Person")
          )
        )
      ).resolves.toMatchObject({ ok: true, returnValue: true });
    });
  });

  it("evaluates primitive literals and returns stats plus a snapshot", async () => {
    await expect(interpret(parse("'hello'"))).resolves.toEqual({
      ok: true,
      returnValue: "hello",
      snapshot: {
        bindings: {}
      },
      stats: {
        nodeVisits: 1
      }
    });

    await expect(interpret(parse("false"))).resolves.toEqual({
      ok: true,
      returnValue: false,
      snapshot: {
        bindings: {}
      },
      stats: {
        nodeVisits: 1
      }
    });
  });

  it("looks up identifiers from the current scope", async () => {
    await expect(
      interpret(parse("agentName"), {
        bindings: {
          agentName: "planner"
        }
      })
    ).resolves.toEqual({
      ok: true,
      returnValue: "planner",
      snapshot: {
        bindings: {
          agentName: "planner"
        }
      },
      stats: {
        nodeVisits: 1
      }
    });
  });

  it("reports missing identifiers without throwing", async () => {
    await expect(interpret(parse("missing"))).resolves.toMatchObject({
      ok: false,
      error: {
        code: "UNBOUND_IDENTIFIER",
        message: "Identifier 'missing' is not defined.",
        nodeType: "Identifier"
      },
      snapshot: {
        bindings: {}
      },
      stats: {
        nodeVisits: 1
      }
    });
  });

  it.each([
    ["1 + 2", 3],
    ["5 - 3", 2],
    ["4 * 6", 24],
    ["10 / 4", 2.5],
    ["10 % 3", 1],
    ["2 ** 10", 1024],
    ['"a" + "b"', "ab"],
    ['"v" + 1', "v1"],
    ['1 + "v"', "1v"],
    ["2 < 3", true],
    ["3 < 2", false],
    ["3 < 3", false],
    ["2 <= 2", true],
    ["3 <= 2", false],
    ["3 > 2", true],
    ["2 > 3", false],
    ["3 >= 3", true],
    ["2 >= 3", false],
    ["1 === 1", true],
    ['1 === "1"', false],
    ["1 !== 2", true],
    ["1 !== 1", false],
    ["1 == 1", true],
    ['1 == "1"', true],
    ["1 != 2", true],
    ["1 != 1", false],
    ["5 & 3", 1],
    ["5 | 3", 7],
    ["5 ^ 3", 6],
    ["1 << 3", 8],
    ["16 >> 2", 4],
    ["-1 >>> 28", 15],
    ["null + 1", 1]
  ])("evaluates binary expression %s", async (source, expected) => {
    await expect(interpret(parse(source))).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it.each([
    ['1 === "1"', false],
    ["null == undefined", true],
    ["null === undefined", false],
    ["0 == -0", true],
    ["0 === -0", true],
    ["[] == false", true],
    ["[] === false", false],
    ["return ({} == {})", false],
    ['"10" < "9"', true],
    ["10 < 9", false],
    ["null > 0", false],
    ["null >= 0", true],
    ["undefined < 0", false],
    ["undefined > 0", false],
    ["undefined == 0", false],
    ['+""', 0],
    ['+"  "', 0],
    ["+null", 0],
    ["+true", 1],
    ["+false", 0],
    ["+[]", 0],
    ["+[1]", 1],
    ["[] + []", ""],
    ["return ([] + {})", "[object Object]"],
    ['"5" - 2', 3],
    ['"5" + 2', "52"],
    ["1 / 0", Infinity],
    ["-1 / 0", -Infinity],
    ["0xFFFFFFFF | 0", -1]
  ])("evaluates coercion edge %s", async (source, expected) => {
    await expect(interpret(parse(source))).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it.each([
    ['+"abc"', {}],
    ['-"abc"', {}],
    ["+undefined", {}],
    ["+[1, 2]", {}],
    ["0 / 0", {}],
    ["Infinity - Infinity", { Infinity }]
  ])("evaluates %s as NaN", async (source, bindings) => {
    const result = await interpret(parse(source), { bindings });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.returnValue).toBeNaN();
  });

  it.each([
    ["NaN == NaN", false],
    ["NaN === NaN", false]
  ])("evaluates %s with global NaN", async (source, expected) => {
    await expect(interpret(parse(source), { bindings: { NaN } })).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it("preserves signed zero when calling Object.is-compatible sandbox closures", async () => {
    const result = await interpret(parse("Object.is(0, -0)"), {
      bindings: {
        Object: {
          is: createSandboxClosure({
            call: ([left, right]) => Object.is(left, right),
            name: "is"
          })
        }
      }
    });

    expect(result).toMatchObject({
      ok: true,
      returnValue: false
    });
  });

  it("evaluates precedence-sensitive expression edges", async () => {
    await expect(interpret(parse("2 + 3 * 4"))).resolves.toMatchObject({
      ok: true,
      returnValue: 14
    });

    await expect(interpret(parse("2 ** 3 ** 2"))).resolves.toMatchObject({
      ok: true,
      returnValue: 512
    });

    await expect(interpret(parse("void 0"))).resolves.toMatchObject({
      ok: true,
      returnValue: undefined
    });
  });

  it("evaluates undefined plus a number as NaN", async () => {
    const result = await interpret(parse("undefined + 1"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.returnValue).toBeNaN();
  });

  it.each([
    ["{ ...{} }", {}],
    ["{ ...{ a: 1 } }", { a: 1 }],
    ["{ ...{ a: 1 }, b: 2 }", { a: 1, b: 2 }],
    ["{ a: 1, ...{ a: 2 } }", { a: 2 }],
    ["{ ...{ a: 2 }, a: 1 }", { a: 1 }],
    ["{ ...{ a: 1 }, ...{ a: 2 } }", { a: 2 }]
  ])("evaluates object spread literal %s", async (source, expected) => {
    await expect(interpret(parse(`return (${source})`))).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it("spreads array own enumerable indexes in object literals", async () => {
    await expect(interpret(parse("return ({ ...[1] })"))).resolves.toMatchObject({
      ok: true,
      returnValue: {
        0: 1
      }
    });
  });

  it("spreads only an object's own enumerable keys", async () => {
    const prototype = Object.create(null) as Record<string, number>;
    prototype.inherited = 1;
    const source = Object.create(prototype) as Record<string, number>;
    source.own = 2;

    await expect(
      interpret(parse("return ({ ...source })"), {
        bindings: {
          source
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: {
        own: 2
      }
    });
  });

  it.each([
    ["null", "null", {}],
    ["undefined", "undefined", {}],
    ["number", "1", {}],
    ["string", '"ab"', { 0: "a", 1: "b" }]
  ])(
    "evaluates %s object spread literal using Object.assign semantics",
    async (_label, source, expected) => {
      await expect(interpret(parse(`return ({ ...${source} })`))).resolves.toMatchObject({
        ok: true,
        returnValue: expected
      });
    }
  );

  it("charges arrayLength budget for object spread properties", async () => {
    const source = Object.create(null) as Record<string, number>;

    for (let index = 0; index < 10_000; index += 1) {
      source[`key${index}`] = index;
    }

    await expect(
      interpret(parse("return ({ ...source })"), {
        bindings: {
          source
        },
        budget: new Budget({
          arrayLength: 9_999
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SandboxError",
        code: "budgetExceeded",
        budget: "arrayLength",
        current: 10_000,
        limit: 9_999
      } satisfies Partial<SandboxError>)
    );
  });

  it("spreads call arguments in place of positional arguments", async () => {
    const fn = vi.fn((args: readonly unknown[]) => [...args]);

    await expect(
      interpret(parse("return fn(...[1, 2, 3])"), {
        bindings: {
          fn: createSandboxClosure({
            call: fn,
            name: "fn"
          })
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [1, 2, 3]
    });
    expect(fn).toHaveBeenCalledWith([1, 2, 3], expect.any(Object));
  });

  it("spreads array literals from iterable values", async () => {
    await expect(interpret(parse("return ([1, ...[2, 3], 4])"))).resolves.toMatchObject({
      ok: true,
      returnValue: [1, 2, 3, 4]
    });

    await expect(interpret(parse('return ([..."ab"])'))).resolves.toMatchObject({
      ok: true,
      returnValue: ["a", "b"]
    });
  });

  it("clones array spread results without aliasing the source array", async () => {
    await expect(
      interpret(
        block(
          parse("const arr = [1, 2]"),
          parse("const clone = [...arr]"),
          parse("clone.push(3)"),
          parse("return [arr, clone]")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        [1, 2],
        [1, 2, 3]
      ]
    });
  });

  it("rejects null array spread", async () => {
    await expect(interpret(parse("return ([...null])"))).rejects.toThrow(
      "Spread arguments must evaluate to an iterable."
    );
  });

  it("charges arrayLength budget while spreading array literals from iterables", async () => {
    function* values(): Generator<number> {
      yield 1;
      yield 2;
      yield 3;
    }

    await expect(
      interpret(parse("return ([...values])"), {
        bindings: {
          values: values() as never
        },
        budget: new Budget({
          arrayLength: 2
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SandboxError",
        code: "budgetExceeded",
        budget: "arrayLength",
        current: 3,
        limit: 2
      } satisfies Partial<SandboxError>)
    );
  });

  it("spreads call arguments by iteration without reading non-index getters", async () => {
    let getterCalls = 0;
    const values = [1, 2];
    Object.defineProperty(values, "extra", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 3;
      }
    });
    const fn = vi.fn((args: readonly unknown[]) => [...args]);

    await expect(
      interpret(parse("return fn(...values)"), {
        bindings: {
          fn: createSandboxClosure({
            call: fn,
            name: "fn"
          }),
          values
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [1, 2]
    });
    expect(fn).toHaveBeenCalledWith([1, 2], expect.any(Object));
    expect(getterCalls).toBe(0);
  });

  it("preserves call argument order when positional and spread arguments are mixed", async () => {
    await expect(
      interpret(
        block(
          parse("const a = 1"),
          parse("const mid = [2, 3]"),
          parse("const z = 4"),
          parse("return ((...args) => args)(a, ...mid, z)")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [1, 2, 3, 4]
    });
  });

  it("spreads empty call argument arrays like no arguments", async () => {
    const fn = vi.fn((args: readonly unknown[]) => args.length);

    await expect(
      interpret(parse("return fn(...[])"), {
        bindings: {
          fn: createSandboxClosure({
            call: fn,
            name: "fn"
          })
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 0
    });
    expect(fn).toHaveBeenCalledWith([], expect.any(Object));
  });

  it.each([
    ["object", "{}"],
    ["number", "1"],
    ["boolean", "true"],
    ["null", "null"],
    ["undefined", "undefined"]
  ])("rejects %s spread in call arguments", async (_label, source) => {
    await expect(
      interpret(parse(`return fn(...${source})`), {
        bindings: {
          fn: createSandboxClosure({
            call: () => undefined,
            name: "fn"
          })
        }
      })
    ).rejects.toThrow("Spread arguments must evaluate to an iterable.");
  });

  it("aggregates spread call arguments into receiving arrow rest parameters", async () => {
    await expect(
      interpret(parse("return ((first, ...rest) => [first, rest])(...[1, 2, 3, 4])"))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [1, [2, 3, 4]]
    });
  });

  it.each([
    ["remaining arguments", "return ((a, ...rest) => rest)(1, 2, 3)", [2, 3]],
    ["zero remaining arguments", "return ((a, ...rest) => rest)(1)", []]
  ])("collects %s in arrow rest parameters", async (_label, source, expected) => {
    await expect(interpret(parse(source))).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it("charges arrayLength budget for spread call arguments", async () => {
    const values = Array.from({ length: 10_000 }, (_, index) => index);

    await expect(
      interpret(parse("return fn(...values)"), {
        bindings: {
          fn: createSandboxClosure({
            call: () => undefined,
            name: "fn"
          }),
          values
        },
        budget: new Budget({
          arrayLength: 9_999
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SandboxError",
        code: "budgetExceeded",
        budget: "arrayLength",
        current: 10_000,
        limit: 9_999
      } satisfies Partial<SandboxError>)
    );
  });

  it("spreads large arrays into push without leaking the host argument limit", async () => {
    const source = Array.from({ length: 600_000 }, (_, index) => index);
    expect(() => Reflect.apply(Array.prototype.push, [], source)).toThrow(RangeError);

    await expect(
      interpret(
        block(
          parse("const target = []"),
          parse("target.push(...source)"),
          parse("return [target.length, target[0], target[target.length - 1]]")
        ),
        {
          bindings: {
            source
          }
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [source.length, 0, source.length - 1]
    });
  });

  it("assigns a new value to a let binding", async () => {
    await expect(
      interpret(block(parse("let x = 1"), parse("x = 2"), parse("return x")))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 2
    });
  });

  it("evaluates assignment expressions to the assigned value", async () => {
    await expect(
      interpret(block(parse("let x = 1"), parse("return (x = 5) + 1")))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 6
    });
  });

  it("defines dangerous array properties without changing the array prototype", async () => {
    const result = await interpret(
      block(
        parse("const arr = []"),
        parse("arr.__proto__ = { evil: 1 }"),
        parse("arr['constructor'] = 'safe-constructor'"),
        parse("arr.prototype = 'safe-prototype'"),
        parse("return arr")
      )
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) {
      throw new Error("Expected interpretation to succeed.");
    }

    expect(Array.isArray(result.returnValue)).toBe(true);
    expect(Object.getPrototypeOf(result.returnValue)).toBe(Array.prototype);
    expect(Object.getOwnPropertyDescriptor(result.returnValue, "__proto__")).toEqual({
      configurable: true,
      enumerable: true,
      value: { evil: 1 },
      writable: true
    });
    expect(result.returnValue).toHaveProperty("constructor", "safe-constructor");
    expect(result.returnValue).toHaveProperty("prototype", "safe-prototype");
  });

  it("preserves array index and length assignment semantics", async () => {
    await expect(
      interpret(
        block(
          parse("const arr = [1, 2, 3]"),
          parse("arr[4] = 5"),
          parse("arr.length = 2"),
          parse("return [arr.length, arr[0], arr[1], arr[2]]")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [2, 1, 2, undefined]
    });
  });

  it("round-trips non-index array properties", async () => {
    const result = await interpret(
      block(
        parse("const arr = []"),
        parse("arr.label = 'safe'"),
        parse("arr['01'] = 'not-an-index'"),
        parse("return arr")
      )
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) {
      throw new Error("Expected interpretation to succeed.");
    }

    expect(result.returnValue).toHaveProperty("label", "safe");
    expect(result.returnValue).toHaveProperty("01", "not-an-index");
    expect(result.returnValue).toHaveLength(0);
  });

  it.each([
    ["+=", "1", "5", 6],
    ["-=", "10", "4", 6],
    ["*=", "3", "4", 12],
    ["/=", "12", "4", 3],
    ["%=", "13", "5", 3],
    ["**=", "2", "5", 32],
    ["&=", "6", "3", 2],
    ["|=", "4", "3", 7],
    ["^=", "6", "3", 5],
    ["<<=", "3", "2", 12],
    [">>=", "16", "2", 4],
    [">>>=", "-1", "28", 15]
  ])("evaluates compound assignment %s", async (operator, left, right, expected) => {
    await expect(
      interpret(block(parse(`let x = ${left}`), parse(`x ${operator} ${right}`), parse("return x")))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it("concatenates strings for += when either operand is a string", async () => {
    await expect(
      interpret(block(parse('let s = "a"'), parse('s += "b"'), parse("return s")))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "ab"
    });
  });

  it.each([
    ["let x = null", "x ??= 5", 5],
    ["let x = 0", "x ??= 5", 0],
    ["let x = 0", "x ||= 5", 5],
    ["let x = 1", "x &&= 5", 5]
  ])("evaluates logical compound assignment %s; %s", async (declaration, assignment, expected) => {
    await expect(
      interpret(block(parse(declaration), parse(assignment), parse("return x")))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it.each([
    ["let x = 1", "x ||= throwing()", 1],
    ["let x = 0", "x &&= throwing()", 0]
  ])(
    "short-circuits logical compound assignment %s; %s",
    async (declaration, assignment, expected) => {
      const throwing = vi.fn(() => {
        throw new Error("right side should not be evaluated");
      });

      await expect(
        interpret(block(parse(declaration), parse(assignment), parse("return x")), {
          bindings: {
            throwing: createSandboxClosure({
              call: throwing,
              name: "throwing"
            })
          }
        })
      ).resolves.toMatchObject({
        ok: true,
        returnValue: expected
      });
      expect(throwing).not.toHaveBeenCalled();
    }
  );

  it("rejects assignment to a const binding with a clear sandbox error", async () => {
    await expect(interpret(block(parse("const x = 1"), parse("x = 2")))).rejects.toMatchObject({
      message: "Cannot assign to const binding 'x'."
    });
  });

  it.each(["obj.x = 1", "arr[0] = 1"])(
    "reports member assignment to an undeclared base as unbound for %s",
    async (source) => {
      await expect(interpret(parse(source))).resolves.toMatchObject({
        error: {
          code: "UNBOUND_IDENTIFIER"
        },
        ok: false
      });
    }
  );

  it("reports compound assignment to an undeclared identifier as unbound", async () => {
    await expect(interpret(parse("missing += 1"))).rejects.toMatchObject({
      message: "Cannot assign to undeclared binding 'missing'.",
      name: "ReferenceError"
    });
  });

  it.each([
    ["object shorthand", ["const { a, b } = { a: 1, b: 2 }", "return a + b"], 3],
    ["object rename", ["const { a: x } = { a: 1 }", "return x"], 1],
    ["object default missing", ["const { a = 9 } = {}", "return a"], 9],
    ["object default undefined", ["const { a = 9 } = { a: undefined }", "return a"], 9],
    ["object default null", ["const { a = 9 } = { a: null }", "return a"], null],
    ["object rest", ["const { a, ...rest } = { a: 1, b: 2, c: 3 }", "return rest"], { b: 2, c: 3 }],
    ["array elements", ["const [x, y] = [1, 2]", "return x + y"], 3],
    ["array hole", ["const [, b] = [1, 2]", "return b"], 2],
    ["array rest", ["const [x, ...rest] = [1, 2, 3]", "return rest"], [2, 3]],
    ["array rest empty", ["const [x, ...rest] = [1]", "return rest"], []],
    ["array default missing", ["const [a, b = 2] = [1]", "return b"], 2],
    ["array default undefined", ["const [a, b = 2] = [1, undefined]", "return b"], 2],
    ["array default null", ["const [a, b = 2] = [1, null]", "return b"], null],
    ["string iterable array pattern", ['const [a] = "ab"', "return a"], "a"],
    ["object rest empty", ["const { a, ...rest } = { a: 1 }", "return rest"], {}],
    ["default referencing prior binding", ["const { a, b = a + 1 } = { a: 1 }", "return b"], 2],
    ["let object pattern", ["let { a } = { a: 1 }", "a = 2", "return a"], 2],
    ["nested object pattern", ["const { a: { b } } = { a: { b: 7 } }", "return b"], 7]
  ])(
    "evaluates destructuring variable declaration with %s",
    async (_label, statements, expected) => {
      await expect(
        interpret(block(...statements.map((statement) => parse(statement))))
      ).resolves.toMatchObject({
        ok: true,
        returnValue: expected
      });
    }
  );

  it("throws a TypeError-shaped sandbox error for object destructuring from null", async () => {
    await expect(interpret(parse("const { a } = null;"))).rejects.toMatchObject({
      name: "TypeError",
      message: "Object destructuring declarations require a non-null object value."
    });
  });

  it("throws a TypeError-shaped sandbox error for object destructuring from undefined", async () => {
    await expect(interpret(parse("const { a } = undefined;"))).rejects.toMatchObject({
      name: "TypeError",
      message: "Object destructuring declarations require a non-null object value."
    });
  });

  it("throws a TypeError-shaped sandbox error for nested object destructuring from null", async () => {
    await expect(interpret(parse("const { a: { b } } = { a: null };"))).rejects.toMatchObject({
      name: "TypeError",
      message: "Object destructuring declarations require a non-null object value."
    });
  });

  it("throws a TypeError-shaped sandbox error for array destructuring from null", async () => {
    await expect(interpret(parse("const [x] = null;"))).rejects.toMatchObject({
      name: "TypeError",
      message: "Array destructuring requires an iterable."
    });
  });

  it("destructures caller-provided native iterables", async () => {
    await expect(
      interpret(block(parse("const [a, b] = values"), parse("return a + b")), {
        bindings: {
          values: new Set([1, 2]) as never
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 3
    });
  });

  it("evaluates destructuring declaration initializers once", async () => {
    const load = vi.fn(() => ({ a: 1, b: 2 }));

    await expect(
      interpret(block(parse("const { a, b } = load()"), parse("return a + b")), {
        bindings: {
          load: createSandboxClosure({
            call: load,
            name: "load"
          })
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 3
    });
    expect(load).toHaveBeenCalledOnce();
  });

  it("evaluates destructuring declaration defaults only for undefined values", async () => {
    const next = vi.fn(() => 2);

    await expect(
      interpret(
        block(
          parse("const { a = next() } = { a: null }"),
          parse("const { b = next() } = { b: undefined }"),
          parse("const { c = next() } = {}"),
          parse("return [a, b, c]")
        ),
        {
          bindings: {
            next: createSandboxClosure({
              call: next,
              name: "next"
            })
          }
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [null, 2, 2]
    });
    expect(next).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["literal-only template", "`hello`", {}, "hello"],
    ["one interpolation", "`n=${1}`", {}, "n=1"],
    ["multiple interpolations", "`a=${a} b=${b}`", { a: "left", b: 2 }, "a=left b=2"],
    ["number coercion", "`${42}`", {}, "42"],
    ["true coercion", "`${true}`", {}, "true"],
    ["false coercion", "`${false}`", {}, "false"],
    ["null coercion", "`${null}`", {}, "null"],
    ["undefined coercion", "`${undefined}`", {}, "undefined"],
    ["string passthrough", '`${"x"}`', {}, "x"],
    ["nested template", "`${`x:${1}`}`", {}, "x:1"],
    ["empty interpolation", '`${""}`', {}, ""]
  ])("evaluates %s", async (_label, source, bindings, expected) => {
    await expect(interpret(parse(source), { bindings })).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it("propagates throws from template literal interpolations", async () => {
    await expect(interpret(parse('`${(() => { throw "boom"; })()}`'))).rejects.toBe("boom");
  });

  it("throws a sandbox error when template literal concatenation exceeds the allocation budget", async () => {
    await expect(
      interpret(parse('`hello${"!"}`'), {
        budget: new Budget({
          stringLength: 5
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SandboxError",
        code: "budgetExceeded",
        budget: "stringLength",
        current: 6,
        limit: 5
      } satisfies Partial<SandboxError>)
    );
  });

  it("evaluates String.raw tagged templates with raw quasis", async () => {
    await expect(
      interpret(parse("return String.raw`a\\nb`"), {
        bindings: createObjectArrayGlobals({
          budget: new Budget()
        })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "a\\nb"
    });
  });

  it("evaluates String.raw tagged templates with substitutions", async () => {
    await expect(
      interpret(parse("return String.raw`\\n${1}\\t`"), {
        bindings: createObjectArrayGlobals({
          budget: new Budget()
        })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "\\n1\\t"
    });
  });

  it("evaluates String.raw tagged templates with malformed raw escapes", async () => {
    await expect(
      interpret(parse("return String.raw`{\\rtf1\\adeflang1025\\ansi\\ansicpg1252\\uc1`"), {
        bindings: createObjectArrayGlobals({
          budget: new Budget()
        })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "{\\rtf1\\adeflang1025\\ansi\\ansicpg1252\\uc1"
    });

    await expect(
      interpret(parse("return String.raw`/\\1`"), {
        bindings: createObjectArrayGlobals({
          budget: new Budget()
        })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "/\\1"
    });
  });

  it("calls tagged template functions with cooked strings and interpolation values", async () => {
    const calls: unknown[][] = [];

    await expect(
      interpret(parse("return myTag`x=${1} y=${2}`"), {
        bindings: {
          myTag: createSandboxClosure({
            call: (args) => {
              calls.push([...args]);
              return "tagged";
            },
            name: "myTag"
          })
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "tagged"
    });

    expect(calls).toHaveLength(1);
    expect(Array.from(calls[0]?.[0] as string[])).toEqual(["x=", " y=", ""]);
    expect(calls[0]?.slice(1)).toEqual([1, 2]);
  });

  it("exposes strings.raw as a different array that survives the tag call", async () => {
    await expect(
      interpret(
        block(
          parse(
            'const myTag = (strings) => strings.raw !== strings && strings.raw[0] === "a\\\\nb" && strings[0] === "a\\nb"'
          ),
          parse("return myTag`a\\nb`")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: true
    });
  });

  it("throws clearly when a tagged template tag is undefined", async () => {
    await expect(
      interpret(parse("missingTag`value`"), {
        bindings: {
          missingTag: undefined
        }
      })
    ).rejects.toMatchObject({
      name: "TypeError",
      message: "Tagged template tag must be a function."
    });
  });

  it("propagates throws from tagged template tag bodies as thrown completions", async () => {
    await expect(
      interpret(
        block(
          parse('const myTag = () => { throw "tag failed"; }'),
          parse("try { myTag`value`; } catch (error) { return error; }")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "tag failed"
    });
  });

  it("does not call tagged template tags when an interpolation throws", async () => {
    const tag = vi.fn(() => "unused");

    await expect(
      interpret(parse('myTag`${(() => { throw "interpolation failed"; })()}`'), {
        bindings: {
          myTag: createSandboxClosure({
            call: tag,
            name: "myTag"
          })
        }
      })
    ).rejects.toBe("interpolation failed");

    expect(tag).not.toHaveBeenCalled();
  });

  it("evaluates nested tagged templates inside interpolations", async () => {
    await expect(
      interpret(parse("return outer`value=${inner`nested=${1}`}`"), {
        bindings: {
          inner: createSandboxClosure({
            call: ([strings, value]) => `${(strings as string[])[0]}${String(value)}`,
            name: "inner"
          }),
          outer: createSandboxClosure({
            call: ([strings, value]) =>
              `${(strings as string[])[0]}${String(value)}${(strings as string[])[1]}`,
            name: "outer"
          })
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "value=nested=1"
    });
  });

  it("honors stringLength budget for tagged template quasis", async () => {
    await expect(
      interpret(parse("myTag`abcd${1}`"), {
        bindings: {
          myTag: createSandboxClosure({
            call: () => "unused",
            name: "myTag"
          })
        },
        budget: new Budget({
          stringLength: 3
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SandboxError",
        code: "budgetExceeded",
        budget: "stringLength",
        current: 4,
        limit: 3
      } satisfies Partial<SandboxError>)
    );
  });

  it.each([
    ["true && true", true],
    ["true && false", false],
    ["false || true", true],
    ['null ?? "fallback"', "fallback"],
    ['undefined ?? "fallback"', "fallback"],
    ['0 ?? "fallback"', 0],
    ['"" ?? "fallback"', ""],
    ["0 && 1", 0],
    ['"x" || 1', "x"],
    ["null ?? 0 ?? 1", 0]
  ])("evaluates logical expression %s", async (source, expected) => {
    await expect(interpret(parse(source))).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it.each([
    ["false && throwing()", false, 2],
    ["true || throwing()", true, 2],
    ["true || throwing() || throwing()", true, 3]
  ])("short-circuits logical expression %s", async (source, expected, nodeVisits) => {
    const throwing = vi.fn(() => {
      throw new Error("right side should not be evaluated");
    });

    await expect(
      interpret(parse(source), {
        bindings: {
          throwing: createSandboxClosure({
            call: throwing,
            name: "throwing"
          })
        },
        budget: new Budget({
          maxSteps: nodeVisits
        })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: expected,
      stats: {
        nodeVisits
      }
    });
    expect(throwing).not.toHaveBeenCalled();
  });

  it.each([
    ["true ? 1 : 2", 1],
    ["false ? 1 : 2", 2],
    ['0 ? "a" : "b"', "b"],
    ['"" ? "a" : "b"', "b"],
    ['null ? "a" : "b"', "b"],
    ['[] ? "a" : "b"', "a"]
  ])("evaluates conditional expression %s", async (source, expected) => {
    await expect(interpret(parse(source))).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it.each([
    ["true ? 1 : throwing()", 1],
    ["false ? throwing() : 2", 2]
  ])("does not evaluate untaken conditional expression branch %s", async (source, expected) => {
    const throwing = vi.fn(() => {
      throw new Error("untaken branch should not be evaluated");
    });

    await expect(
      interpret(parse(source), {
        bindings: {
          throwing: createSandboxClosure({
            call: throwing,
            name: "throwing"
          })
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
    expect(throwing).not.toHaveBeenCalled();
  });

  it.each([
    [true, true, 1],
    [true, false, 2],
    [false, true, 3],
    [false, false, 3]
  ])("evaluates nested conditional expressions", async (a, b, expected) => {
    await expect(
      interpret(parse("a ? b ? 1 : 2 : 3"), {
        bindings: {
          a,
          b
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it("propagates throws from the chosen conditional expression branch", async () => {
    await expect(interpret(parse('true ? (() => { throw "boom"; })() : 1'))).rejects.toBe("boom");
  });

  it("throws a sandbox error when binary string concatenation exceeds the allocation budget", async () => {
    await expect(
      interpret(parse('"hello" + "!"'), {
        budget: new Budget({
          stringLength: 5
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SandboxError",
        code: "budgetExceeded",
        budget: "stringLength",
        current: 6,
        limit: 5
      } satisfies Partial<SandboxError>)
    );
  });

  it("evaluates unary operators used by numeric expressions", async () => {
    await expect(
      interpret(parse("return Math.abs(-4)"), { bindings: createMathGlobals() })
    ).resolves.toEqual({
      ok: true,
      returnValue: 4,
      snapshot: {
        bindings: {
          Infinity,
          NaN: Number.NaN,
          Math: expect.any(Object)
        }
      },
      stats: {
        nodeVisits: 6
      }
    });
  });

  it("uses valueOf before toString for unary numeric coercion", async () => {
    await expect(
      interpret(
        block(
          parse(`
          const value = {
            valueOf() { return 7; },
            toString() { return "11"; }
          };
        `),
          parse("return +value")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 7
    });
  });

  it("evaluates typeof for undeclared identifiers without resolving them", async () => {
    await expect(interpret(parse("return typeof missing"))).resolves.toMatchObject({
      ok: true,
      returnValue: "undefined"
    });

    await expect(
      interpret(parse("return typeof value"), { bindings: { value: 42 } })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "number"
    });

    await expect(interpret(parse("return missing"))).resolves.toMatchObject({
      ok: false,
      error: {
        code: "UNBOUND_IDENTIFIER"
      }
    });
  });

  it("keeps normal identifier resolution semantics for other typeof operands", async () => {
    await expect(
      interpret(block(parse("return typeof value"), parse("let value = 42")))
    ).rejects.toMatchObject({
      message: "Cannot access 'value' before initialization.",
      name: "ReferenceError"
    });

    await expect(interpret(parse("return typeof missing.value"))).resolves.toMatchObject({
      ok: false,
      error: {
        code: "UNBOUND_IDENTIFIER"
      }
    });
  });

  it("unwraps return statements by evaluating their argument", async () => {
    await expect(interpret(parse("return answer"), { bindings: { answer: 42 } })).resolves.toEqual({
      ok: true,
      returnValue: 42,
      snapshot: {
        bindings: {
          answer: 42
        }
      },
      stats: {
        nodeVisits: 2
      }
    });
  });

  it("returns success without a returnValue for bare return statements", async () => {
    await expect(interpret(parse("return;"))).resolves.toEqual({
      ok: true,
      snapshot: {
        bindings: {}
      },
      stats: {
        nodeVisits: 1
      }
    });
  });

  it("layers provided bindings on top of the parent scope", async () => {
    const scope = new Scope({
      agentName: "planner",
      taskName: "ship"
    });

    await expect(
      interpret(parse("agentName"), {
        scope,
        bindings: {
          agentName: "reviewer"
        }
      })
    ).resolves.toEqual({
      ok: true,
      returnValue: "reviewer",
      snapshot: {
        bindings: {
          agentName: "reviewer",
          taskName: "ship"
        }
      },
      stats: {
        nodeVisits: 1
      }
    });
  });

  it("walks block statements until a nested return completes evaluation", async () => {
    const ignored = parse("'ignored'");
    const returnAnswer = parse("return answer");

    await expect(
      interpret(
        {
          type: "BlockStatement",
          body: [
            {
              type: "ExpressionStatement",
              expression: ignored,
              span: ignored.span
            },
            returnAnswer
          ],
          span: {
            start: ignored.span.start,
            end: returnAnswer.span.end
          }
        },
        { bindings: { answer: 42 } }
      )
    ).resolves.toEqual({
      ok: true,
      returnValue: 42,
      snapshot: {
        bindings: {
          answer: 42
        }
      },
      stats: {
        nodeVisits: 5
      }
    });
  });

  it("throws a sandbox error when the step budget is exceeded", async () => {
    await expect(
      interpret(parse("return answer"), {
        bindings: { answer: 42 },
        budget: new Budget({
          maxSteps: 1
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SandboxError",
        budget: "steps",
        current: 2,
        limit: 1
      } satisfies Partial<SandboxError>)
    );
  });

  it("throws a sandbox error when a string literal exceeds the allocation budget", async () => {
    await expect(
      interpret(parse("'hello'"), {
        budget: new Budget({
          stringLength: 4
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SandboxError",
        budget: "stringLength",
        current: 5,
        limit: 4
      } satisfies Partial<SandboxError>)
    );
  });

  it("evaluates console and JSON globals through member calls", async () => {
    const sink = {
      error: vi.fn(),
      log: vi.fn()
    };
    const budget = new Budget();

    await expect(
      interpret(parse(`console.log(JSON.stringify(JSON.parse('{"name":"poe"}'), null, 2))`), {
        bindings: createConsoleJsonGlobals({
          budget,
          sink
        }),
        budget
      })
    ).resolves.toMatchObject({
      ok: true,
      snapshot: {
        bindings: expect.objectContaining({
          JSON: expect.any(Object),
          console: expect.any(Object)
        })
      },
      stats: {
        nodeVisits: 12
      }
    });

    expect(sink.log).toHaveBeenCalledWith('{\n  "name": "poe"\n}');
    expect(sink.error).not.toHaveBeenCalled();
  });

  it("evaluates regex literal separators for intercepted string methods", async () => {
    const splitCall = parse("return value.split(separator)") as any;
    splitCall.argument.arguments[0] = {
      type: "RegexLiteral",
      raw: "/b+/",
      span: splitCall.argument.arguments[0].span
    };

    await expect(
      interpret(splitCall, {
        bindings: {
          value: "abba",
          separator: "b"
        }
      })
    ).resolves.toMatchObject({ ok: true, returnValue: ["a", "a"] });
  });

  it("rejects unbranded host regex values passed through bindings", async () => {
    await expect(
      interpret(parse("return value.split(separator)"), {
        bindings: {
          value: "abba",
          separator: /b+/ as never
        }
      })
    ).rejects.toThrow("String#split only supports string separator values.");

    await expect(
      interpret(parse("return value.replace(search, replacement)"), {
        bindings: {
          value: "abba",
          search: /a/ as never,
          replacement: "x"
        }
      })
    ).rejects.toThrow(
      "String#replace only supports string or regex search values and string or function replacements."
    );

    await expect(
      interpret(parse("return value.replaceAll(search, replacement)"), {
        bindings: {
          value: "abba",
          search: /a/g as never,
          replacement: "x"
        }
      })
    ).rejects.toThrow(
      "String#replaceAll only supports string or regex search values and string or function replacements."
    );
  });

  it("evaluates intercepted array members and methods through member expressions", async () => {
    await expect(
      interpret(parse("return values.length"), {
        bindings: {
          values: [1, 2, 3]
        }
      })
    ).resolves.toEqual({
      ok: true,
      returnValue: 3,
      snapshot: {
        bindings: {
          values: [1, 2, 3]
        }
      },
      stats: {
        nodeVisits: 3
      }
    });

    await expect(
      interpret(parse("return values.map(double)"), {
        bindings: {
          values: [1, 2, 3],
          double: createSandboxClosure({
            call: ([value]) => Number(value) * 2,
            name: "double"
          })
        }
      })
    ).resolves.toEqual({
      ok: true,
      returnValue: [2, 4, 6],
      snapshot: {
        bindings: {
          values: [1, 2, 3],
          double: expect.any(Object)
        }
      },
      stats: {
        nodeVisits: 5
      }
    });

    await expect(
      interpret(parse("return [1, 2, 3].flatMap(x => [x, x * 2])"))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [1, 2, 2, 4, 3, 6]
    });
  });

  it("evaluates intercepted number methods through member expressions", async () => {
    await expect(
      interpret(parse("return value.toString(16)"), {
        bindings: {
          value: 255
        }
      })
    ).resolves.toEqual({
      ok: true,
      returnValue: "ff",
      snapshot: {
        bindings: {
          value: 255
        }
      },
      stats: {
        nodeVisits: 5
      }
    });

    await expect(
      interpret(parse("return value.toFixed(2)"), {
        bindings: {
          value: 12.3456
        }
      })
    ).resolves.toEqual({
      ok: true,
      returnValue: "12.35",
      snapshot: {
        bindings: {
          value: 12.3456
        }
      },
      stats: {
        nodeVisits: 5
      }
    });
  });

  it.each([
    ["return (1).toString()", {}, "1"],
    ["return (255).toString(16)", {}, "ff"],
    ["return (8).toString(2)", {}, "1000"],
    ["return (0.1).toString()", {}, "0.1"],
    ["return (1).toString(36)", {}, "1"],
    ["return (-0).toString()", {}, "0"],
    ["return Infinity.toString()", { Infinity }, "Infinity"],
    ["return (-Infinity).toString()", { Infinity }, "-Infinity"],
    ["return NaN.toString()", { NaN }, "NaN"],
    ["return (1.005).toFixed(2)", {}, (1.005).toFixed(2)],
    ["return (1).toFixed(100)", {}, (1).toFixed(100)],
    ["return (1).toPrecision()", {}, "1"],
    ["return (1234.5).toPrecision(3)", {}, "1.23e+3"],
    ["return (1e21).toString()", {}, "1e+21"],
    ["return (0.0000001).toString()", {}, "1e-7"],
    ["return (1).toExponential(2)", {}, "1.00e+0"]
  ])("evaluates Number edge expression %s", async (source, bindings, expected) => {
    await expect(interpret(parse(source), { bindings })).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it.each(["return (1).toString(0)", "return (1).toString(1)", "return (1).toString(37)"])(
    "throws RangeError for Number edge expression %s",
    async (source) => {
      await expect(interpret(parse(source))).rejects.toMatchObject({
        name: "RangeError"
      });
    }
  );

  it.each([
    ["null object", "return obj?.prop", { obj: null }, undefined],
    ["undefined object", "return obj?.prop", { obj: undefined }, undefined],
    ["defined object", "return obj?.prop", { obj: { prop: 1 } }, 1],
    ["first nullish chain segment", "return a?.b?.c", { a: null }, undefined],
    ["undefined existing property", "return obj?.prop", { obj: { prop: undefined } }, undefined]
  ])("evaluates optional member access for %s", async (_label, source, bindings, expected) => {
    await expect(
      interpret(parse(source), {
        bindings
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it.each([
    ["null array", { arr: null }, undefined],
    ["undefined array", { arr: undefined }, undefined],
    ["defined array", { arr: [10] }, 10],
    ["out-of-bounds array index", { arr: [10] }, undefined, "return arr?.[1]"]
  ])(
    "evaluates computed optional member access for %s",
    async (_label, bindings, expected, source = "return arr?.[0]") => {
      await expect(
        interpret(parse(source), {
          bindings
        })
      ).resolves.toMatchObject({
        ok: true,
        returnValue: expected
      });
    }
  );

  it("does not evaluate computed optional member keys when the object is nullish", async () => {
    const key = vi.fn(() => 0);

    await expect(
      interpret(parse("return arr?.[key()]"), {
        bindings: {
          arr: null,
          key: createSandboxClosure({
            call: key,
            name: "key"
          })
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: undefined
    });

    expect(key).not.toHaveBeenCalled();
  });

  it("short-circuits chained computed optional member access at the first nullish segment", async () => {
    const k2 = vi.fn(() => "second");

    await expect(
      interpret(parse("return obj?.[k]?.[k2()]"), {
        bindings: {
          obj: {
            first: null
          },
          k: "first",
          k2: createSandboxClosure({
            call: k2,
            name: "k2"
          })
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: undefined
    });

    expect(k2).not.toHaveBeenCalled();
  });

  it("does not short-circuit computed optional member access for non-nullish falsy values", async () => {
    const key = vi.fn(() => "length");

    await expect(
      interpret(parse("return value?.[key()]"), {
        bindings: {
          value: "",
          key: createSandboxClosure({
            call: key,
            name: "key"
          })
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 0
    });

    expect(key).toHaveBeenCalledOnce();
  });

  it.each([
    ["undefined function", "return fn?.()", { fn: undefined }, undefined],
    ["null function", "return fn?.()", { fn: null }, undefined],
    [
      "defined function",
      "return fn?.()",
      {
        fn: createSandboxClosure({
          call: () => 7,
          name: "fn"
        })
      },
      7
    ],
    ["falsy number member", "return value?.toString()", { value: 0 }, "0"],
    ["undefined method", "return obj.method?.()", { obj: { method: undefined } }, undefined]
  ])("evaluates optional calls for %s", async (_label, source, bindings, expected) => {
    await expect(
      interpret(parse(source), {
        bindings
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it("evaluates recursive arrow calls", async () => {
    await expect(
      interpret(
        block(parse("const fact = n => n <= 1 ? 1 : n * fact(n - 1)"), parse("return fact(5)"))
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 120
    });
  });

  it("evaluates anonymous function expressions", async () => {
    await expect(
      interpret(parse("(function (left, right) { return left + right; })(2, 3)"))
    ).resolves.toMatchObject({ ok: true, returnValue: 5 });
  });

  it("binds a named function expression only inside its body", async () => {
    await expect(
      interpret(parse("(function check(n) { return n <= 1 ? 1 : n * check(n - 1); })(5)"))
    ).resolves.toMatchObject({ ok: true, returnValue: 120 });

    await expect(interpret(parse("check"))).resolves.toMatchObject({
      ok: false,
      error: { message: "Identifier 'check' is not defined." }
    });
  });

  it("keeps a named function expression binding separate from an outer binding", async () => {
    await expect(
      interpret(
        block(
          parse("const check = 7"),
          parse("const factorial = function check(n) { return n <= 1 ? 1 : n * check(n - 1); }"),
          parse("return factorial(5) + check")
        )
      )
    ).resolves.toMatchObject({ ok: true, returnValue: 127 });
  });

  it("allows parameters to shadow a named function expression binding", async () => {
    await expect(
      interpret(parse("(function check(check) { return check + 1; })(4)"))
    ).resolves.toMatchObject({ ok: true, returnValue: 5 });
  });

  it("evaluates async anonymous function expressions", async () => {
    await expect(
      interpret(parse("await (async function (value) { return value + 1; })(4)"))
    ).resolves.toMatchObject({ ok: true, returnValue: 5 });
  });

  it("evaluates object method shorthand closures", async () => {
    await expect(
      interpret(
        block(
          parse("const offset = 4"),
          parse(
            "const service = { reset() { return offset + 1; }, async load() { return offset + 2; } }"
          ),
          parse("return service.reset() + await service.load()")
        )
      )
    ).resolves.toMatchObject({ ok: true, returnValue: 11 });
  });

  it("evaluates computed and keyword-named shorthand methods", async () => {
    await expect(
      interpret(
        block(
          parse("const methodName = 'load'"),
          parse(
            "const service = { default() { return 1; }, [methodName](value = 2) { return value + 1; } }"
          ),
          parse("return service.default() + service.load()")
        )
      )
    ).resolves.toMatchObject({ ok: true, returnValue: 4 });
  });

  describe("this bindings", () => {
    it("returns undefined at module top level and in bare function calls", async () => {
      await expect(interpret(parse("this"))).resolves.toMatchObject({
        ok: true,
        returnValue: undefined
      });

      await expect(
        interpret(block(parse("function readThis() { return this; }"), parse("return readThis();")))
      ).resolves.toMatchObject({ ok: true, returnValue: undefined });
    });

    it("binds member-call receivers for declarations, expressions, and shorthand methods", async () => {
      await expect(
        interpret(
          block(
            parse("function read() { return this.value; }"),
            parse("const declared = { value: 2, read }"),
            parse("const expressed = { value: 3, read: function () { return this.value; } }"),
            parse("const shorthand = { value: 4, read() { return this.value; } }"),
            parse("return declared.read() + expressed.read() + shorthand.read();")
          )
        )
      ).resolves.toMatchObject({ ok: true, returnValue: 9 });
    });

    it("captures this lexically in arrows without rebinding it", async () => {
      await expect(
        interpret(
          block(
            parse("const service = { value: 7, makeReader() { return () => this.value; } }"),
            parse("const reader = service.makeReader()"),
            parse("return ({ value: 99, reader }).reader();")
          )
        )
      ).resolves.toMatchObject({ ok: true, returnValue: 7 });
    });

    it("uses undefined for detached and nested bare function calls", async () => {
      await expect(
        interpret(
          block(
            parse(
              "const service = { value: 7, read() { return this; }, compare() { function nested() { return this; } return [this.value, nested()]; } }"
            ),
            parse("const detached = service.read"),
            parse("return [detached(), service.compare()]")
          )
        )
      ).resolves.toMatchObject({ ok: true, returnValue: [undefined, [7, undefined]] });
    });

    it("preserves the receiver for optional calls and evaluates member access once", async () => {
      await expect(
        interpret(
          block(
            parse("let reads = 0"),
            parse("const holder = { value: 5, method() { return this.value; } }"),
            parse("const result = holder[(reads += 1, 'method')]?.()"),
            parse("return [result, reads]")
          )
        )
      ).resolves.toMatchObject({ ok: true, returnValue: [5, 1] });
    });

    it("short-circuits optional member calls without evaluating properties or arguments", async () => {
      await expect(
        interpret(
          block(
            parse("let effects = 0"),
            parse("const missing = undefined"),
            parse("const result = missing?.[(effects += 1, 'method')]((effects += 10))"),
            parse("return [result, effects]")
          )
        )
      ).resolves.toMatchObject({ ok: true, returnValue: [undefined, 0] });
    });

    it("evaluates the receiver once and preserves it through parenthesized member calls", async () => {
      await expect(
        interpret(
          block(
            parse("let creations = 0"),
            parse(
              "function create() { creations += 1; return { value: 6, read() { return this.value; } }; }"
            ),
            parse("const result = (create().read)()"),
            parse("return [result, creations]")
          )
        )
      ).resolves.toMatchObject({ ok: true, returnValue: [6, 1] });
    });

    it("binds this for async function forms", async () => {
      await expect(
        interpret(
          block(
            parse("const service = { value: 8, async read() { return this.value; } }"),
            parse("return await service.read()")
          )
        )
      ).resolves.toMatchObject({ ok: true, returnValue: 8 });
    });

    it("supports this in assignment, compound assignment, and delete targets", async () => {
      await expect(
        interpret(
          block(
            parse(
              "const service = { n: 1, flags: { old: true }, update() { this.value = 3; this.n += 2; delete this.flags.old; return [this.value, this.n, this.flags.old]; } }"
            ),
            parse("return service.update();")
          )
        )
      ).resolves.toMatchObject({ ok: true, returnValue: [3, 3, undefined] });
    });

    it("passes undefined this to array-method callbacks", async () => {
      await expect(
        interpret(
          block(
            parse("function readThis() { return this; }"),
            parse("return [1].map(readThis)[0];")
          )
        )
      ).resolves.toMatchObject({ ok: true, returnValue: undefined });
    });

    it("rejects declarations named this", () => {
      expect(() => parse("const this = 1")).toThrow();
      expect(() => parse("function this() {}")).toThrow();
      expect(() => parse("function work(this) {}")).toThrow();
    });

    it("rejects assignment to this as an invalid assignment target", () => {
      expect(() => parse("function replace() { this = undefined; }")).toThrow(
        "Invalid assignment target"
      );
    });
  });

  it("prevents assignment to a named function expression binding", async () => {
    await expect(interpret(parse("(function check() { check = 1; })()"))).rejects.toThrow(
      "Cannot assign to const binding 'check'."
    );
  });

  it("evaluates mutually recursive arrows assigned through let declarations", async () => {
    await expect(
      interpret(
        block(
          parse("let even = n => n === 0 ? true : odd(n - 1)"),
          parse("let odd = n => n === 0 ? false : even(n - 1)"),
          parse("return even(8) && !odd(8)")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: true
    });
  });

  it("reports a clear budget cause for self-recursive arrows that exceed maxCallDepth", async () => {
    await expect(
      interpret(block(parse("const loop = () => loop()"), parse("return loop()")), {
        budget: new Budget({
          maxCallDepth: 3
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SandboxError",
        code: "budgetExceeded",
        budget: "callDepth",
        current: 4,
        limit: 3,
        message: "Sandbox budget exceeded for callDepth: 4 > 3."
      } satisfies Partial<SandboxError>)
    );
  });

  it.each(["typeof [1].entries", "typeof 1..valueOf"])(
    "does not expose host prototypes through %s",
    async (source) => {
      await expect(interpret(parse(`return ${source}`))).resolves.toMatchObject({
        ok: true,
        returnValue: "undefined"
      });
    }
  );

  it("reads own custom properties but not inherited properties from host arrays", async () => {
    const inherited = Object.assign(Object.create(Array.prototype), { inherited: "host value" });
    const value = Object.assign(["element"], { custom: "host value" });
    Object.setPrototypeOf(value, inherited);

    await expect(
      interpret(parse("return [value[0], typeof value.custom, typeof value.inherited]"), {
        bindings: { value }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: ["element", "string", "undefined"]
    });
  });

  it("resolves only array and string indices plus length outside method tables", async () => {
    await expect(
      interpret(
        parse('return [["first"][0], ["first"]["0"], "value"[1], "value"["1"], [1].length]')
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: ["first", "first", "a", "a", 1]
    });
  });

  it.each([
    ["[1].shuffle()", "Array#shuffle is not a supported method."],
    ['"value".shuffle()', "String#shuffle is not a supported method."],
    ["1..shuffle()", "Number#shuffle is not a supported method."]
  ])("reports unsupported member calls for %s", async (source, message) => {
    await expect(interpret(parse(`return ${source}`))).rejects.toMatchObject({
      name: "TypeError",
      message
    });
  });

  it.each(["(1)()", "null()", "undefined()"])(
    "throws TypeError for non-function calls %s",
    async (source) => {
      await expect(interpret(parse(`return ${source}`))).rejects.toMatchObject({
        name: "TypeError",
        message: "Attempted to call a non-function value."
      });
    }
  );

  it("applies arrow parameter defaults only for undefined arguments", async () => {
    await expect(
      interpret(
        block(
          parse("const fn = (value = 7) => value"),
          parse("return [fn(undefined), fn(null), fn()]")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [7, null, 7]
    });
  });

  it.each([
    [
      "sync arrow",
      "const invoke = (value) => (({ type, payload: { value: nested = type }, ...meta }, [first, ...rest], { fallback = first } = {}) => { nested = nested + rest.length; return [nested, meta.extra, fallback]; })(value, [2, 3, 4])"
    ],
    [
      "async arrow",
      "const invoke = async (value) => await (async ({ type, payload: { value: nested = type }, ...meta }, [first, ...rest], { fallback = first } = {}) => { nested = nested + rest.length; return [nested, meta.extra, fallback]; })(value, [2, 3, 4])"
    ],
    [
      "function expression",
      "const invoke = (value) => (function ({ type, payload: { value: nested = type }, ...meta }, [first, ...rest], { fallback = first } = {}) { nested = nested + rest.length; return [nested, meta.extra, fallback]; })(value, [2, 3, 4])"
    ],
    [
      "function declaration",
      "function invoke(value) { function collect({ type, payload: { value: nested = type }, ...meta }, [first, ...rest], { fallback = first } = {}) { nested = nested + rest.length; return [nested, meta.extra, fallback]; } return collect(value, [2, 3, 4]); }"
    ]
  ])("binds destructured parameters in %s", async (_label, declaration) => {
    await expect(
      interpret(
        block(parse(declaration), parse("return await invoke({ type: 5, payload: {}, extra: 9 })"))
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [7, 9, 2]
    });
  });

  it("evaluates parameter defaults against earlier parameters", async () => {
    await expect(interpret(parse("return ((a, b = a + 1) => b)(4)"))).resolves.toMatchObject({
      ok: true,
      returnValue: 5
    });
  });

  it("binds parameters as reassignable let bindings", async () => {
    await expect(
      interpret(parse("return ((value) => { value = value + 1; return value; })(4)"))
    ).resolves.toMatchObject({ ok: true, returnValue: 5 });
  });

  it("ignores extra call arguments after evaluating them", async () => {
    const observe = vi.fn(() => 2);

    await expect(
      interpret(block(parse("const fn = value => value"), parse("return fn(1, observe())")), {
        bindings: {
          observe: createSandboxClosure({
            call: observe,
            name: "observe"
          })
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });
    expect(observe).toHaveBeenCalledOnce();
  });

  it("binds missing call arguments as undefined and fires defaults for missing parameters", async () => {
    await expect(
      interpret(block(parse("const fn = (a, b = 2, c) => [a, b, c]"), parse("return fn(1)")))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [1, 2, undefined]
    });
  });

  it("evaluates arrows that return themselves through another arrow", async () => {
    await expect(
      interpret(
        block(
          parse("const self = () => self"),
          parse("const pick = fn => fn()"),
          parse("return pick(self)() === self")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: true
    });
  });

  it("evaluates top-level this inside arrows as undefined", async () => {
    await expect(
      interpret(block(parse("const getThis = () => this"), parse("return getThis()")))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: undefined
    });
  });

  it("deep-copies sandbox-only call arguments before invoking host functions", async () => {
    const observedArgs: unknown[] = [];
    const host = vi.fn((input: { nested: { value: number } }) => {
      observedArgs.push(structuredClone(input));
      input.nested.value = 2;
      return input;
    });

    await expect(
      interpret(
        block(parse("const input = { nested: { value: 1 } }"), parse("return host(input)")),
        {
          bindings: wrapCallerInjectedBindings(
            {
              host
            },
            {
              budget: new Budget()
            }
          )
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: {
        nested: {
          value: 2
        }
      },
      snapshot: {
        bindings: {
          input: {
            nested: {
              value: 1
            }
          }
        }
      }
    });
    expect(host).toHaveBeenCalledTimes(1);
    expect(observedArgs).toEqual([
      {
        nested: {
          value: 1
        }
      }
    ]);
    expect(host.mock.calls[0]?.[0]).toEqual({
      nested: {
        value: 2
      }
    });
  });

  it("returns subset RangeError values for intercepted number methods with out-of-range arguments", async () => {
    await expect(
      interpret(parse("return value.toString(1)"), {
        bindings: {
          value: 10
        }
      })
    ).rejects.toMatchObject({
      name: "RangeError",
      message: "Number#toString radix must be between 2 and 36.",
      stack:
        "RangeError: Number#toString radix must be between 2 and 36.\n    at toString (line 1, column 8)"
    });

    await expect(
      interpret(parse("return value.toFixed(101)"), {
        bindings: {
          value: 10
        }
      })
    ).rejects.toMatchObject({
      name: "RangeError",
      message: "Number#toFixed digits must be between 0 and 100.",
      stack:
        "RangeError: Number#toFixed digits must be between 0 and 100.\n    at toFixed (line 1, column 8)"
    });

    await expect(
      interpret(parse("return value.toPrecision(0)"), {
        bindings: {
          value: 10
        }
      })
    ).rejects.toMatchObject({
      name: "RangeError",
      message: "Number#toPrecision precision must be between 1 and 100.",
      stack:
        "RangeError: Number#toPrecision precision must be between 1 and 100.\n    at toPrecision (line 1, column 8)"
    });
  });

  it("re-enters callback closures under the same budget for intercepted array methods", async () => {
    await expect(
      interpret(parse("return values.map(identity)"), {
        bindings: {
          values: [1],
          identity: createSandboxClosure({
            call: ([value]) => value,
            name: "identity"
          })
        },
        budget: new Budget({
          maxCallDepth: 1
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SandboxError",
        budget: "callDepth",
        current: 2,
        limit: 1
      } satisfies Partial<SandboxError>)
    );
  });

  it("evaluates Math globals including deterministic random when seeded", async () => {
    await expect(
      interpret(parse("return Math.min(Math.PI, Math.E)"), {
        bindings: createMathGlobals({ random: createSeededRandom(123).next })
      })
    ).resolves.toEqual({
      ok: true,
      returnValue: Math.E,
      snapshot: {
        bindings: {
          Infinity,
          NaN: Number.NaN,
          Math: expect.any(Object)
        }
      },
      stats: {
        nodeVisits: 8
      }
    });

    await expect(
      interpret(parse("return Math.PI"), {
        bindings: createMathGlobals({ random: createSeededRandom(123).next })
      })
    ).resolves.toEqual({
      ok: true,
      returnValue: Math.PI,
      snapshot: {
        bindings: {
          Infinity,
          NaN: Number.NaN,
          Math: expect.any(Object)
        }
      },
      stats: {
        nodeVisits: 3
      }
    });

    const seededRandom = createSeededRandom(123);
    const firstRandom = await interpret(parse("return Math.random()"), {
      bindings: createMathGlobals({ random: seededRandom.next })
    });
    const secondRandom = await interpret(parse("return Math.random()"), {
      bindings: createMathGlobals({ random: seededRandom.next })
    });

    expect(firstRandom).toEqual({
      ok: true,
      returnValue: 0.2837369213812053,
      snapshot: {
        bindings: {
          Infinity,
          NaN: Number.NaN,
          Math: expect.any(Object)
        }
      },
      stats: {
        nodeVisits: 4
      }
    });
    expect(secondRandom).toEqual({
      ok: true,
      returnValue: 0.4351300236303359,
      snapshot: {
        bindings: {
          Infinity,
          NaN: Number.NaN,
          Math: expect.any(Object)
        }
      },
      stats: {
        nodeVisits: 4
      }
    });
  });

  it("returns a subset Promise when calling an async arrow", async () => {
    const result = await interpret(parse("return (async () => await load())()"), {
      bindings: {
        load: createSandboxClosure({
          async: true,
          call: () => createSandboxPromise(Promise.resolve("ready")),
          name: "load"
        })
      }
    });

    expect(result.ok).toBe(true);
    expect(result.snapshot).toMatchObject({
      bindings: {
        load: expect.any(Object)
      }
    });
    expect(isSandboxPromise(result.ok ? result.returnValue : undefined)).toBe(true);
    await expect((result.ok ? result.returnValue : undefined)!.promise).resolves.toBe("ready");
  });

  it("supports top-level await and reports each await as a yield point", async () => {
    const program = parse("await (async () => await load())()");
    const topLevelAwait = program;

    if (topLevelAwait.type !== "AwaitExpression") {
      throw new Error("Expected top-level await expression.");
    }

    if (
      topLevelAwait.argument.type !== "CallExpression" ||
      topLevelAwait.argument.callee.type !== "ArrowFunctionExpression" ||
      topLevelAwait.argument.callee.body.type !== "AwaitExpression"
    ) {
      throw new Error("Expected nested async arrow await expression.");
    }

    const yieldNodeIds: Array<number | undefined> = [];

    await expect(
      interpret(program, {
        bindings: {
          load: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(Promise.resolve("done")),
            name: "load"
          })
        },
        onYield: (yieldPoint) => {
          yieldNodeIds.push(yieldPoint.nodeId);
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "done",
      snapshot: {
        bindings: {
          load: expect.any(Object)
        }
      }
    });

    expect(yieldNodeIds).toEqual([topLevelAwait.argument.callee.body.nodeId, topLevelAwait.nodeId]);
  });

  it("treats await on plain values as a yield point and returns the original value", async () => {
    const yieldNodeIds: Array<number | undefined> = [];
    const program = parse("await value");

    await expect(
      interpret(program, {
        bindings: {
          value: 42
        },
        onYield: (yieldPoint) => {
          yieldNodeIds.push(yieldPoint.nodeId);
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 42,
      snapshot: {
        bindings: {
          value: 42
        }
      }
    });

    expect(yieldNodeIds).toEqual([program.nodeId]);
  });

  it("returns subset Promises from async arrow block bodies and lets await unwrap them", async () => {
    const promiseResult = await interpret(parse("return (async () => { return value; })()"), {
      bindings: {
        value: "ready"
      }
    });

    expect(promiseResult.ok).toBe(true);
    expect(isSandboxPromise(promiseResult.ok ? promiseResult.returnValue : undefined)).toBe(true);
    await expect((promiseResult.ok ? promiseResult.returnValue : undefined)!.promise).resolves.toBe(
      "ready"
    );

    await expect(
      interpret(parse("return await (async () => { return value; })()"), {
        bindings: {
          value: "ready"
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "ready",
      snapshot: {
        bindings: {
          value: "ready"
        }
      }
    });

    await expect(
      interpret(parse("return await (async () => { return; })()"))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: undefined,
      snapshot: {
        bindings: {}
      }
    });
  });

  it("throws the rejection reason when awaiting a rejected subset Promise", async () => {
    await expect(
      interpret(parse("return await fail()"), {
        bindings: {
          fail: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(Promise.reject("boom")),
            name: "fail"
          })
        }
      })
    ).rejects.toBe("boom");
  });

  it("catches subset errors thrown from host closures", async () => {
    const budget = new Budget();

    await expect(
      interpret(
        parse(
          "try { explode(); } catch ({ name, message, stack }) { return JSON.stringify(Array.of(name, message, stack)); }"
        ),
        {
          bindings: {
            ...createConsoleJsonGlobals({
              budget
            }),
            ...createObjectArrayGlobals({
              budget
            }),
            explode: createSandboxClosure({
              call: () => {
                throw new TypeError("boom");
              },
              name: "explode"
            })
          },
          budget
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: JSON.stringify([
        "TypeError",
        "boom",
        "TypeError: boom\n    at explode (line 1, column 7)"
      ])
    });
  });

  it("binds destructured catch parameters", async () => {
    await expect(
      interpret(
        parse(
          "try { throw { code: 7, detail: ['boom'] }; } catch ({ code, detail: [message] }) { return [code, message]; }"
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [7, "boom"]
    });
  });

  it("evaluates destructuring assignment expressions", async () => {
    await expect(
      interpret(
        block(
          parse("let a = 1"),
          parse("let b = 2"),
          parse("[a, b] = [b, a]"),
          parse("let x = 0"),
          parse("const source = { x: 3 }"),
          parse("({ x } = source)"),
          parse("return [a, b, x]")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [2, 1, 3]
    });
  });

  it("returns the right-hand value from destructuring assignments", async () => {
    await expect(
      interpret(
        block(
          parse("let first = 0"),
          parse("let remaining = []"),
          parse("const assigned = ([first, ...remaining] = [1, 2, 3])"),
          parse("return [assigned, first, remaining]")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [[1, 2, 3], 1, [2, 3]]
    });
  });

  it("assigns destructured values to member targets", async () => {
    await expect(
      interpret(
        block(
          parse("const target = { x: 0, y: 0 }"),
          parse("[target.x, target.y] = [4, 5]"),
          parse("return [target.x, target.y]")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [4, 5]
    });
  });

  it("keeps unparenthesized object assignment invalid in statement position", () => {
    expect(() => parseModule("{ x } = source")).toThrow();
  });

  it("rejects uncaught host errors as subset sandbox values", async () => {
    await expect(
      interpret(parse("return explode()"), {
        bindings: {
          explode: createSandboxClosure({
            call: () => {
              throw new RangeError("boom");
            },
            name: "explode"
          })
        }
      })
    ).rejects.toMatchObject({
      name: "RangeError",
      message: "boom",
      stack: "RangeError: boom\n    at explode (line 1, column 8)"
    });
  });

  it("catches host promise rejections from sync closures as subset sandbox errors", async () => {
    const budget = new Budget();

    await expect(
      interpret(
        parse(
          "try { explode(); } catch ({ name, message, stack }) { return JSON.stringify(Array.of(name, message, stack)); }"
        ),
        {
          bindings: {
            ...createConsoleJsonGlobals({
              budget
            }),
            ...createObjectArrayGlobals({
              budget
            }),
            explode: createSandboxClosure({
              call: () => Promise.reject(new TypeError("boom")),
              name: "explode"
            })
          },
          budget
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: JSON.stringify([
        "TypeError",
        "boom",
        "TypeError: boom\n    at explode (line 1, column 7)"
      ])
    });
  });

  it("does not treat inherited interpreter fields on host rejections as internal errors", async () => {
    const reason = Object.assign(
      Object.create({
        code: "UNBOUND_IDENTIFIER",
        nodeType: "Identifier",
        span: {
          end: { column: 1, line: 1, offset: 0 },
          start: { column: 1, line: 1, offset: 0 }
        }
      }),
      {
        message: "spoofed boom",
        name: "RangeError"
      }
    );

    await expect(
      interpret(parse("try { explode(); } catch ({ name, message, stack }) { return stack; }"), {
        bindings: {
          explode: createSandboxClosure({
            call: () => Promise.reject(reason),
            name: "explode"
          })
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "RangeError: spoofed boom\n    at explode (line 1, column 7)"
    });
  });

  it("runs finally after normal try completion without replacing the following return value", async () => {
    await expect(
      interpret(
        block(
          parse("const events = []"),
          parse("try { events.push('try'); } finally { events.push('finally'); }"),
          parse("return events")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: ["try", "finally"]
    });
  });

  it("preserves a normal try completion value while running finally", async () => {
    const events: string[] = [];

    await expect(
      interpret(
        parse("try { push('try'); 'try-value'; } finally { push('finally'); 'finally-value'; }"),
        {
          bindings: {
            push: createSandboxClosure({
              call: ([event]) => {
                events.push(String(event));
                return undefined;
              },
              name: "push"
            })
          }
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "try-value"
    });

    expect(events).toEqual(["try", "finally"]);
  });

  it("runs finally when try throws and rethrows the original error", async () => {
    const cleanup = vi.fn();

    await expect(
      interpret(parse("try { throw 'boom'; } finally { cleanup(); }"), {
        bindings: {
          cleanup: createSandboxClosure({
            call: () => {
              cleanup();
              return undefined;
            },
            name: "cleanup"
          })
        }
      })
    ).rejects.toBe("boom");

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("runs finally when try returns and preserves the try return value", async () => {
    const cleanup = vi.fn();

    await expect(
      interpret(parse("try { return 'value'; } finally { cleanup(); }"), {
        bindings: {
          cleanup: createSandboxClosure({
            call: () => {
              cleanup();
              return undefined;
            },
            name: "cleanup"
          })
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "value"
    });

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("runs finally before a return exits an enclosing while loop", async () => {
    const cleanup = vi.fn();

    await expect(
      interpret(
        block(
          parse("while (cond) { try { return 1; } finally { cleanup(); } }"),
          parse("return 2;")
        ),
        {
          bindings: {
            cleanup: createSandboxClosure({
              call: () => {
                cleanup();
                return undefined;
              },
              name: "cleanup"
            }),
            cond: true
          }
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("lets a return from finally override a return from try", async () => {
    await expect(
      interpret(parse("try { return 'try'; } finally { return 'finally'; }"))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "finally"
    });
  });

  it("lets a throw from finally override a throw from try", async () => {
    await expect(
      interpret(parse("try { throw 'try'; } finally { throw 'finally'; }"))
    ).rejects.toBe("finally");
  });

  it("lets catch rethrow to an outer try", async () => {
    await expect(
      interpret(
        parse(
          "try { try { throw 'inner'; } catch (error) { throw error; } } catch (outer) { return outer; }"
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "inner"
    });
  });

  it("runs finally before propagating break from try inside for...of", async () => {
    await expect(
      interpret(
        block(
          parse("const events = []"),
          parse(
            "for (const value of [1, 2, 3]) { try { events.push(value); break; } finally { events.push('finally'); } }"
          ),
          parse("return events")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [1, "finally"]
    });
  });

  it("runs finally before propagating continue from try inside for...of", async () => {
    await expect(
      interpret(
        block(
          parse("const events = []"),
          parse(
            "for (const value of [1, 2, 3]) { try { events.push(value); continue; } finally { events.push('finally'); } events.push('skipped'); }"
          ),
          parse("return events")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [1, "finally", 2, "finally", 3, "finally"]
    });
  });

  it("rejects try without catch or finally while parsing", () => {
    expect(() => parse("try { work(); }")).toThrowError("Expected 'catch' or 'finally'");
  });

  it("rejects try statements with more than one catch clause while parsing", () => {
    expect(() => parse("try { } catch { } catch { }")).toThrowError(
      "Try statements support only one catch clause"
    );
  });

  it("evaluates for...of over sandbox arrays", async () => {
    await expect(
      interpret(
        block(
          parse("const out = []"),
          parse("for (const x of [1, 2, 3]) { out.push(x); }"),
          parse("return out")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [1, 2, 3]
    });
  });

  it("evaluates for...of over strings by code point", async () => {
    await expect(
      interpret(
        block(
          parse("const out = []"),
          parse('for (const character of "A😀B") { out.push(character); }'),
          parse("return out")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: ["A", "😀", "B"]
    });
  });

  it("supports empty strings and assignment targets in for...of", async () => {
    await expect(
      interpret(
        block(
          parse("const out = []"),
          parse("let character"),
          parse('for (character of "") { out.push(character); }'),
          parse('for (character of "ab") { out.push(character); }'),
          parse("return [out, character]")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [["a", "b"], "b"]
    });
  });

  it("binds destructuring declarations in for...of heads", async () => {
    const budget = new Budget();

    await expect(
      interpret(
        block(
          parse("const out = []"),
          parse("const source = { first: 1, second: 2 }"),
          parse("for (const [key, value] of Object.entries(source)) { out.push(key, value); }"),
          parse("return out")
        ),
        {
          bindings: createObjectArrayGlobals({ budget }),
          budget
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: ["first", 1, "second", 2]
    });
  });

  it("binds nested defaults and rest values in for...of heads", async () => {
    await expect(
      interpret(
        block(
          parse("const out = []"),
          parse(
            "for (const { value: [first = 9, ...rest], ...meta } of [{ value: [] }, { value: [1, 2], label: 'item' }]) { out.push([first, rest, meta.label]); }"
          ),
          parse("return out")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        [9, [], undefined],
        [1, [2], "item"]
      ]
    });
  });

  it("skips for...of bodies for empty arrays", async () => {
    const body = vi.fn(() => undefined);

    await expect(
      interpret(parse("for (const x of []) { body(); }"), {
        bindings: {
          body: createSandboxClosure({
            call: body,
            name: "body"
          })
        }
      })
    ).resolves.toMatchObject({
      ok: true
    });

    expect(body).not.toHaveBeenCalled();
  });

  it("consumes break completions inside for...of", async () => {
    await expect(
      interpret(
        block(
          parse("const out = []"),
          parse("for (const x of [1, 2, 3]) { out.push(x); if (x === 2) { break; } }"),
          parse("return out.length")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 2
    });
  });

  it("exits for...of loops at the matching break", async () => {
    await expect(
      interpret(
        block(
          parse("let last = 0"),
          parse("for (const x of [1, 2, 3]) { last = x; if (x === 2) { break; } }"),
          parse("return last")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 2
    });
  });

  it("consumes continue completions inside for...of", async () => {
    await expect(
      interpret(
        block(
          parse("const out = []"),
          parse("for (const x of [1, 2, 3]) { if (x === 2) { continue; } out.push(x); }"),
          parse("return out")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [1, 3]
    });
  });

  it("continues for...of loops without running the rest of the body", async () => {
    await expect(
      interpret(
        block(
          parse("const result = []"),
          parse("for (const x of [1, 2, 3]) { if (x === 2) { continue; } result.push(x); }"),
          parse("return result")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [1, 3]
    });
  });

  it("propagates throws from inside for...of bodies", async () => {
    await expect(interpret(parse('for (const x of [1]) { throw "boom"; }'))).rejects.toBe("boom");
  });

  it("lets catch handle throws from inside for...of bodies", async () => {
    const budget = new Budget();

    await expect(
      interpret(
        parse(
          "try { for (const x of arr) { if (x) { throw Error('loop'); } } } catch (e) { return e.message; }"
        ),
        {
          bindings: {
            arr: [0, 1],
            ...createErrorGlobals({
              budget
            })
          },
          budget
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "loop"
    });
  });

  it("propagates iterator next throws after yielding earlier for...of values", async () => {
    const iterable = {
      [Symbol.iterator]: () => {
        let index = 0;
        return {
          next: () => {
            index += 1;
            if (index === 1) {
              return {
                done: false,
                value: 1
              };
            }

            throw new Error("next failed");
          }
        };
      }
    };

    await expect(
      interpret(
        block(
          parse("const seen = []"),
          parse(
            "try { for (const value of iterable) { seen.push(value); } } catch (error) { return [seen, error.message]; }"
          )
        ),
        {
          bindings: {
            iterable: iterable as never
          }
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [[1], "next failed"]
    });
  });

  it("returns from the enclosing arrow inside for...of bodies", async () => {
    await expect(
      interpret(parse("return (() => { for (const x of [1, 2]) { return x; } return 0; })()"))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });
  });

  it("calls iterator return when return exits a for...of loop", async () => {
    const iteratorReturn = vi.fn(() => ({
      done: true,
      value: undefined
    }));
    const iterable = {
      [Symbol.iterator]: () => ({
        next: () => ({
          done: false,
          value: 1
        }),
        return: iteratorReturn
      })
    };

    await expect(
      interpret(parse("for (const value of iterable) { return value; }"), {
        bindings: {
          iterable: iterable as never
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });
    expect(iteratorReturn).toHaveBeenCalledTimes(1);
  });

  it("visits array elements pushed before a for...of iterator advances", async () => {
    await expect(
      interpret(
        block(
          parse("const values = [1, 2]"),
          parse("const seen = []"),
          parse(
            "for (const value of values) { seen.push(value); if (value === 1) { values.push(3); } }"
          ),
          parse("return seen")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [1, 2, 3]
    });
  });

  it("iterates own enumerable string keys with for...in ordering", async () => {
    await expect(
      interpret(
        parse(
          "return (() => { const seen = []; for (const key in value) seen.push(key); return seen; })()"
        ),
        { bindings: { value: { later: true, 10: true, 2: true, first: true } } }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: ["2", "10", "later", "first"] });
  });

  it.each([
    { value: Object.assign(["a", "b", "c"], { 1: undefined }), expected: ["0", "1", "2"] },
    { value: "abc", expected: ["0", "1", "2"] },
    { value: null, expected: [] },
    { value: undefined, expected: [] },
    { value: new Map([["key", 1]]), expected: [] },
    { value: new Set([1]), expected: [] },
    { value: /x/, expected: [] },
    { value: () => 1, expected: [] }
  ])("iterates supported for...in keys for $value", async ({ value, expected }) => {
    await expect(
      interpret(
        parse(
          "return (() => { const seen = []; for (const key in value) seen.push(key); return seen; })()"
        ),
        { bindings: { value: value as never } }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it("skips array holes and length", async () => {
    const value = ["a", "b", "c"];
    delete value[1];
    await expect(
      interpret(
        parse(
          "return (() => { const seen = []; for (const key in value) seen.push(key); return seen; })()"
        ),
        { bindings: { value } }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: ["0", "2"] });
  });

  it("iterates only present array indices", async () => {
    const value = Object.assign(["a", "b"], { extra: true });
    await expect(
      interpret(
        parse(
          "return (() => { const seen = []; for (const key in value) seen.push(key); return seen; })()"
        ),
        { bindings: { value } }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: ["0", "1"] });
  });

  it.each([
    Object.assign(new Map(), { extra: true }),
    Object.assign(new Set(), { extra: true }),
    Object.assign(/x/, { extra: true }),
    Object.assign(() => 1, { extra: true })
  ])("does not iterate custom properties on unsupported for...in values", async (value) => {
    await expect(
      interpret(
        parse(
          "return (() => { const seen = []; for (const key in value) seen.push(key); return seen; })()"
        ),
        { bindings: { value: value as never } }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: [] });
  });

  it("snapshots for...in keys, skips deleted keys, and ignores added keys", async () => {
    await expect(
      interpret(
        parse(
          "return (() => { const seen = []; for (const key in value) { seen.push(key); if (key === 'a') { delete value.b; value.c = 3; } } return seen; })()"
        ),
        { bindings: { value: { a: 1, b: 2 } } }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: ["a"] });
  });

  it("hoists var for...in heads to the function boundary", async () => {
    await expect(
      interpret(parse("return (() => { for (var key in { a: 1 }) {} return key; })()"))
    ).resolves.toMatchObject({ ok: true, returnValue: "a" });
  });

  it("assigns bare identifier for...in heads", async () => {
    await expect(
      interpret(parse("return (() => { let key; for (key in { a: 1 }) {} return key; })()"))
    ).resolves.toMatchObject({ ok: true, returnValue: "a" });
  });

  it.each(["null", "undefined"])(
    "throws a TypeError-shaped sandbox error for for...of over %s",
    async (value) => {
      await expect(
        interpret(parse(`for (const x of ${value}) { return x; }`))
      ).rejects.toMatchObject({
        name: "TypeError",
        message: `${value} is not a supported iterable`
      });
    }
  );

  // TODO: Assert that assigning to the const loop variable throws once AssignmentExpression is supported.

  it("caps million-element for...of iteration through the step budget", async () => {
    await expect(
      interpret(parse("for (const x of values) { sink.push(x); }"), {
        bindings: {
          sink: [],
          values: new Array(1_000_000).fill(1)
        },
        budget: new Budget({
          maxSteps: 20
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SandboxError",
        budget: "steps",
        limit: 20
      } satisfies Partial<SandboxError>)
    );
  });

  it("evaluates for loops with init, test, update, and body", async () => {
    await expect(
      interpret(
        block(
          parse("let count = 0"),
          parse("for (let i = 0; i < 3; i = i + 1) { count = count + 1; }"),
          parse("return count")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 3
    });
  });

  it("evaluates comma expressions in for loop updates", async () => {
    await expect(
      interpret(
        block(
          parse("let total = 0"),
          parse("for (let i = 0, j = 0; i < 3; i++, j++) { total = total + i + j; }"),
          parse("return total")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 6
    });
  });

  it("deletes properties from sandbox objects", async () => {
    await expect(
      interpret(
        block(
          parse("const item = { value: 1 }"),
          parse("const result = delete item.value"),
          parse("return [result, item.value]")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [true, undefined]
    });
  });

  it("continues for loops without a test until break exits", async () => {
    await expect(
      interpret(
        block(
          parse("let count = 0"),
          parse("for (let i = 0; ; i = i + 1) { if (i >= 2) { break; } count = count + 1; }"),
          parse("return count")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 2
    });
  });

  it("evaluates for loops without an init", async () => {
    await expect(
      interpret(
        block(
          parse("let i = 0"),
          parse("let count = 0"),
          parse("for (; i < 3; i = i + 1) { count = count + 1; }"),
          parse("return count")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 3
    });
  });

  it("evaluates for loops without an update", async () => {
    await expect(
      interpret(
        block(
          parse("let count = 0"),
          parse("for (let i = 0; i < 3;) { count = count + 1; i = i + 1; }"),
          parse("return count")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 3
    });
  });

  it("evaluates for loops with no init, test, or update", async () => {
    await expect(
      interpret(
        block(
          parse("let count = 0"),
          parse("for (;;) { count = count + 1; break; }"),
          parse("return count")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });
  });

  it("consumes break completions inside for bodies", async () => {
    await expect(
      interpret(
        block(
          parse("let count = 0"),
          parse("for (let i = 0; i < 3; i = i + 1) { count = count + 1; break; }"),
          parse("return count")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });
  });

  it("consumes continue completions inside for bodies and still evaluates the update", async () => {
    await expect(
      interpret(
        block(
          parse("let out = 0"),
          parse("for (let i = 0; i < 3; i = i + 1) { if (i === 1) { continue; } out = out + i; }"),
          parse("return out")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 2
    });
  });

  it("exits an outer for loop with a labeled break from a nested loop", async () => {
    await expect(
      interpret(
        block(
          parse("const out = []"),
          parse(
            "outer: for (let i = 0; i < 3; i = i + 1) { out.push(i); for (let j = 0; j < 3; j = j + 1) { break outer; } out.push(99); }"
          ),
          parse("return out")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [0]
    });
  });

  it("continues an outer for loop with a labeled continue from a nested loop", async () => {
    await expect(
      interpret(
        block(
          parse("const out = []"),
          parse(
            "outer: for (let i = 0; i < 3; i = i + 1) { out.push(i); for (let j = 0; j < 3; j = j + 1) { continue outer; } out.push(99); }"
          ),
          parse("return out")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [0, 1, 2]
    });
  });

  it("lets an adjacent inner loop label mask an outer loop label with the same name", async () => {
    await expect(
      interpret(
        block(
          parse("const out = []"),
          parse(
            "outer: for (let i = 0; i < 2; i = i + 1) { out.push(i); outer: outer: for (let j = 0; j < 2; j = j + 1) { out.push(j); break outer; } out.push(9); }"
          ),
          parse("return out")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [0, 0, 9, 1, 0, 9]
    });
  });

  it("allows any distinct adjacent label to target the same loop", async () => {
    await expect(
      interpret(
        block(
          parse("const out = []"),
          parse("outer: inner: for (let i = 0; i < 3; i = i + 1) { out.push(i); break outer; }"),
          parse("return out")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [0]
    });
  });

  it("continues a loop through any distinct adjacent label on that loop", async () => {
    await expect(
      interpret(
        block(
          parse("const out = []"),
          parse(
            "outer: inner: for (let i = 0; i < 3; i = i + 1) { out.push(i); if (i < 2) { continue outer; } out.push(9); }"
          ),
          parse("return out")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [0, 1, 2, 9]
    });
  });

  it("reports a clear error when a labeled break target is not in scope", async () => {
    await expect(interpret(parse("for (;;) { break foo; }"))).resolves.toMatchObject({
      ok: false,
      error: {
        message: "Label 'foo' not found"
      }
    });
  });

  it("keeps unlabeled break scoped to the inner loop", async () => {
    await expect(
      interpret(
        block(
          parse("const out = []"),
          parse(
            "for (let i = 0; i < 2; i = i + 1) { for (let j = 0; j < 3; j = j + 1) { out.push(j); break; } out.push(9); }"
          ),
          parse("return out")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [0, 9, 0, 9]
    });
  });

  it("preserves a labeled break across try/finally", async () => {
    await expect(
      interpret(
        block(
          parse("const out = []"),
          parse(
            "outer: for (let i = 0; i < 3; i = i + 1) { try { for (let j = 0; j < 3; j = j + 1) { break outer; } } finally { out.push('finally'); } out.push('skipped'); }"
          ),
          parse("return out")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: ["finally"]
    });
  });

  it("preserves a labeled break across return-and-rethrow finally handling", async () => {
    await expect(
      interpret(
        block(
          parse("const out = []"),
          parse(
            "outer: for (let i = 0; i < 3; i = i + 1) { try { try { throw 'boom'; } catch (error) { break outer; } finally { out.push('inner-finally'); } } finally { out.push('outer-finally'); } out.push('skipped'); }"
          ),
          parse("return out")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: ["inner-finally", "outer-finally"]
    });
  });

  it("propagates throws from inside for bodies", async () => {
    await expect(
      interpret(parse('for (let i = 0; i < 1; i = i + 1) { throw "boom"; }'))
    ).rejects.toBe("boom");
  });

  it("scopes variables declared in for init to the loop", async () => {
    await expect(
      interpret(block(parse("for (let i = 0; i < 1; i = i + 1) {}"), parse("return i")))
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "UNBOUND_IDENTIFIER",
        message: "Identifier 'i' is not defined.",
        nodeType: "Identifier"
      }
    });
  });

  it("caps infinite for loops through the step budget", async () => {
    await expect(
      interpret(parse("for (;;) {}"), {
        budget: new Budget({
          maxSteps: 20
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SandboxError",
        code: "budgetExceeded",
        budget: "steps",
        limit: 20
      } satisfies Partial<SandboxError>)
    );
  });

  it("evaluates while loops by re-checking the test expression each iteration", async () => {
    await expect(
      interpret(
        block(
          parse("let count = 0"),
          parse("while (count < 3) { count = count + 1; }"),
          parse("return count")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 3
    });
  });

  it("skips while bodies when the initial test is false", async () => {
    const body = vi.fn(() => undefined);

    await expect(
      interpret(parse("while (false) { body(); }"), {
        bindings: {
          body: createSandboxClosure({
            call: body,
            name: "body"
          })
        }
      })
    ).resolves.toMatchObject({
      ok: true
    });

    expect(body).not.toHaveBeenCalled();
  });

  it("consumes break completions inside while bodies", async () => {
    await expect(
      interpret(
        block(
          parse("let count = 0"),
          parse("while (true) { count = count + 1; break; }"),
          parse("return count")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });
  });

  it("consumes continue completions inside while bodies", async () => {
    await expect(
      interpret(
        block(
          parse("let count = 0"),
          parse("let out = 0"),
          parse(
            "while (count < 3) { count = count + 1; if (count === 2) { continue; } out = out + count; }"
          ),
          parse("return out")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 4
    });
  });

  it("returns from the enclosing arrow inside while bodies", async () => {
    await expect(
      interpret(parse("return (() => { while (true) { return 7; } return 0; })()"))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 7
    });
  });

  it("propagates throws from inside while bodies", async () => {
    await expect(interpret(parse('while (true) { throw "boom"; }'))).rejects.toBe("boom");
  });

  it("caps infinite while loops through the step budget", async () => {
    await expect(
      interpret(parse("while (true) {}"), {
        budget: new Budget({
          maxSteps: 20
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SandboxError",
        code: "budgetExceeded",
        budget: "steps",
        limit: 20
      } satisfies Partial<SandboxError>)
    );
  });

  it("runs do/while bodies once before a false test", async () => {
    const body = vi.fn(() => undefined);

    await expect(
      interpret(parse("do { body(); } while (false)"), {
        bindings: {
          body: createSandboxClosure({
            call: body,
            name: "body"
          })
        }
      })
    ).resolves.toMatchObject({
      ok: true
    });

    expect(body).toHaveBeenCalledOnce();
  });

  it("evaluates do/while counter loops by testing after each body run", async () => {
    await expect(
      interpret(
        block(
          parse("let count = 0"),
          parse("do { count = count + 1; } while (count < 3)"),
          parse("return count")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 3
    });
  });

  it("consumes break completions inside do/while bodies", async () => {
    await expect(
      interpret(
        block(
          parse("let count = 0"),
          parse("do { count = count + 1; break; } while (true)"),
          parse("return count")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });
  });

  it("runs the do/while test after continue completions", async () => {
    await expect(
      interpret(
        block(
          parse("let count = 0"),
          parse("do { count = count + 1; continue; count = count + 100; } while (count < 3)"),
          parse("return count")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 3
    });
  });

  it("returns from the enclosing arrow inside do/while bodies", async () => {
    await expect(
      interpret(parse("return (() => { do { return 7; } while (true); return 0; })()"))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 7
    });
  });

  it("propagates throws from inside do/while bodies", async () => {
    await expect(interpret(parse('do { throw "boom"; } while (true)'))).rejects.toBe("boom");
  });

  it("caps infinite do/while loops through the step budget", async () => {
    await expect(
      interpret(parse("do {} while (true)"), {
        budget: new Budget({
          maxSteps: 20
        })
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SandboxError",
        code: "budgetExceeded",
        budget: "steps",
        limit: 20
      } satisfies Partial<SandboxError>)
    );
  });

  it("charges the step budget during do/while iterations", async () => {
    await expect(
      interpret(
        block(
          parse("let count = 0"),
          parse("do { count = count + 1; } while (count < 3)"),
          parse("return count")
        ),
        {
          budget: new Budget({
            maxSteps: 10
          })
        }
      )
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SandboxError",
        code: "budgetExceeded",
        budget: "steps",
        limit: 10
      } satisfies Partial<SandboxError>)
    );
  });

  it.each([
    ["1", 1],
    ["0", 0],
    ['""', 0]
  ])("coerces while (%s) tests with JavaScript truthiness", async (test, expected) => {
    await expect(
      interpret(
        block(
          parse("let count = 0"),
          parse(`while (${test}) { count = count + 1; break; }`),
          parse("return count")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it("binds catch parameters in a dedicated catch scope", async () => {
    const budget = new Budget();

    await expect(
      interpret(parse("try { throw Error('boom'); } catch ({ message }) { return message; }"), {
        bindings: {
          ...createErrorGlobals({
            budget
          })
        },
        budget
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "boom"
    });
  });

  it("preserves an own __proto__ key in catch object rest bindings", async () => {
    await expect(
      interpret(parse("try { throw thrown; } catch ({ ...rest }) { return rest['__proto__']; }"), {
        bindings: {
          thrown: Object.fromEntries([["__proto__", "preserved"]]) as never
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "preserved"
    });
  });

  it("evaluates a truthy if consequent return", async () => {
    await expect(
      interpret(block(parse("if (true) { return 1; }"), parse("return 2;")))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });
  });

  it("skips a falsy if consequent and continues", async () => {
    await expect(
      interpret(block(parse("if (false) { return 1; }"), parse("return 2;")))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 2
    });
  });

  it.each([
    [true, 1],
    [false, 2]
  ])("keeps return statements after if reachable when cond is %s", async (cond, expected) => {
    await expect(
      interpret(block(parse("if (cond) { return 1; }"), parse("return 2;")), {
        bindings: {
          cond
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it.each([
    [1, "a"],
    [2, "b"]
  ])("evaluates if tests through binary expressions for x=%s", async (x, expected) => {
    await expect(
      interpret(block(parse('if (x === 1) { return "a"; }'), parse('return "b";')), {
        bindings: { x }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it("evaluates an else block when the if test is falsy", async () => {
    await expect(
      interpret(parse("if (false) { return 1; } else { return 2; }"))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 2
    });
  });

  it("returns the first truthy branch in an else-if chain", async () => {
    await expect(
      interpret(
        parse(
          'if (true) { return "first"; } else if (true) { return "second"; } else { return "else"; }'
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "first"
    });
  });

  it("returns the second branch in an else-if chain when the first branch is falsy", async () => {
    await expect(
      interpret(
        parse(
          'if (false) { return "first"; } else if (true) { return "second"; } else { return "else"; }'
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "second"
    });
  });

  it("returns the else branch in an else-if chain when all tests are falsy", async () => {
    await expect(
      interpret(
        parse(
          'if (false) { return "first"; } else if (false) { return "second"; } else { return "else"; }'
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "else"
    });
  });

  it("surfaces a nested if result from inside an if block", async () => {
    await expect(
      interpret(parse('if (true) { if (true) { return "inner"; } return "outer"; }'))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "inner"
    });
  });

  it("exits the enclosing arrow when returning inside an if block", async () => {
    await expect(
      interpret(parse("return (() => { if (true) { return 1; } return 2; })()"))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });
  });

  it("propagates throws from inside an if block", async () => {
    await expect(interpret(parse('if (true) { throw "boom"; }'))).rejects.toBe("boom");
  });

  it("returns no value for a falsy if without an alternate", async () => {
    await expect(interpret(parse("if (false) { return 1; }"))).resolves.toEqual({
      ok: true,
      snapshot: {
        bindings: {}
      },
      stats: {
        nodeVisits: 2
      }
    });
  });

  it.each(["0", '""', "null", "undefined"])("treats if (%s) as falsy", async (test) => {
    await expect(
      interpret(block(parse(`if (${test}) { return "truthy"; }`), parse('return "falsy";')))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "falsy"
    });
  });

  it.each(["1", '"x"', "{}", "[]"])("treats if (%s) as truthy", async (test) => {
    await expect(
      interpret(block(parse(`if (${test}) { return "truthy"; }`), parse('return "falsy";')))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "truthy"
    });
  });

  it("does not charge budget for a skipped if branch", async () => {
    await expect(
      interpret(
        block(parse('if (false) { return missing.value.call("skipped"); }'), parse("return 2;")),
        {
          budget: new Budget({
            maxSteps: 5
          })
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 2,
      stats: {
        nodeVisits: 5
      }
    });
  });

  it("hoists initialized function declarations within their block", async () => {
    await expect(
      interpret(
        parse("if (true) { return add(2, 3); function add(left, right) { return left + right; } }")
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 5
    });
  });

  it("evaluates a standalone function declaration as an initialized binding", async () => {
    const scope = new Scope();

    await expect(
      interpret(parse("function identity(value) { return value; }"), {
        scope,
        useScopeDirectly: true
      })
    ).resolves.toMatchObject({
      ok: true
    });

    const identity = scope.lookup("identity");
    expect(identity.found).toBe(true);
    if (!identity.found || identity.value.kind !== "fn") {
      return;
    }

    await expect(identity.value.call([7])).resolves.toBe(7);
  });

  it("supports recursive function declarations", async () => {
    await expect(
      interpret(
        parse(
          "if (true) { function factorial(value) { return value <= 1 ? 1 : value * factorial(value - 1); } return factorial(5); }"
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 120
    });
  });

  it("keeps function declarations scoped to their enclosing block", async () => {
    await expect(
      interpret(
        block(parse("if (true) { function hidden() { return 1; } }"), parse("return hidden();"))
      )
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "UNBOUND_IDENTIFIER"
      }
    });
  });

  it("supports defaults and rest parameters in function declarations", async () => {
    await expect(
      interpret(
        parse(
          "if (true) { function collect(first = 1, ...rest) { return [first, rest.length]; } return collect(undefined, 2, 3); }"
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [1, 2]
    });
  });

  it("executes async function declarations through closure machinery", async () => {
    await expect(
      interpret(
        parse("if (true) { async function load() { return await task(); } return await load(); }"),
        {
          bindings: {
            task: createSandboxClosure({
              async: true,
              call: () => createSandboxPromise(Promise.resolve(42))
            })
          }
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 42
    });
  });

  it("rejects function and variable redeclarations in one block", () => {
    expect(() => parse("if (true) { function work() {} const work = 1; }")).toThrowError(
      "Cannot redeclare binding 'work'"
    );
  });

  it("hoists var without a temporal dead zone and escapes blocks", async () => {
    await expect(
      interpret(
        block(
          parse("const before = value"),
          parse("if (true) { var value = 5; }"),
          parse("return [before, value]")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [undefined, 5],
      snapshot: {
        bindings: {
          value: 5
        }
      }
    });
  });

  it("stops var hoisting at nested function boundaries", async () => {
    await expect(
      interpret(
        block(
          parse("const run = () => { var local = 3; return local; }"),
          parse("run()"),
          parse("return local")
        )
      )
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "UNBOUND_IDENTIFIER",
        message: "Identifier 'local' is not defined."
      }
    });
  });

  it("hoists var from unexecuted catch bodies without a temporal dead zone", async () => {
    await expect(
      interpret(
        block(
          parse("try { var completed = true; } catch (error) { var failure = error; }"),
          parse("return [completed, failure]")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [true, undefined]
    });
  });

  it("allows var initializers to reuse a catch parameter binding", async () => {
    await expect(
      interpret(
        block(
          parse("var x = 1"),
          parse("try { throw 0; } catch (x) { var x = 2; }"),
          parse("return x")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });
  });

  it("uses one function-scoped binding for for-var closures", async () => {
    await expect(
      interpret(
        block(
          parse("const readers = []"),
          parse("for (var index = 0; index < 3; index++) { readers.push(() => index); }"),
          parse("return [readers[0](), readers[1](), readers[2]()]")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [3, 3, 3]
    });
  });

  it("allows var redeclaration and rejects same-frame lexical collisions", async () => {
    await expect(
      interpret(block(parse("var value = 1"), parse("var value = 2"), parse("return value")))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 2
    });
    await expect(
      interpret(
        block(
          parse("function makeValue() { return 1; }"),
          parse("var makeValue"),
          parse("return makeValue()")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });
    await expect(
      interpret(block(parse("let value = 1"), parse("var value = 2")))
    ).rejects.toThrowError("Cannot redeclare binding 'value' in the same scope.");
    await expect(
      interpret(
        block(
          parse("const run = (value) => { var value = 2; return value; }"),
          parse("return run(1)")
        )
      )
    ).resolves.toMatchObject({ ok: true, returnValue: 2 });
  });

  it("matches switch cases strictly and falls through", async () => {
    await expect(
      interpret(
        block(
          parse("const output = []"),
          parse(
            'switch (value) { case "1": output.push("string"); break; case 1: output.push("one"); default: output.push("default"); case 2: output.push("two"); }'
          ),
          parse("return output")
        ),
        { bindings: { value: 1 } }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: ["one", "default", "two"]
    });
  });

  it("uses default only after every case misses", async () => {
    await expect(
      interpret(
        block(
          parse("let output = ''"),
          parse('switch (2) { default: output += "default"; break; case 2: output += "matched"; }'),
          parse("return output")
        )
      )
    ).resolves.toMatchObject({ ok: true, returnValue: "matched" });
  });

  it("shares one lexical scope across unbraced switch cases", async () => {
    expect(() =>
      parse("switch (1) { case 1: const value = 1; break; case 2: const value = 2; }")
    ).toThrowError("Cannot redeclare binding 'value'");

    await expect(
      interpret(
        block(
          parse("let output = 0"),
          parse(
            "switch (1) { case 1: { const value = 1; output = value; } break; case 2: { const value = 2; output = value; } }"
          ),
          parse("return output")
        )
      )
    ).resolves.toMatchObject({ ok: true, returnValue: 1 });
  });

  it("routes break and continue through nested switches and loops", async () => {
    await expect(
      interpret(
        block(
          parse("const output = []"),
          parse(
            'outer: for (let index = 0; index < 3; index++) { switch (index) { case 0: output.push("switch-break"); break; case 1: continue; case 2: break outer; } output.push(index); }'
          ),
          parse("return output")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: ["switch-break", 0]
    });
  });
});

function cloneLoopSnapshot(
  snapshot: NonNullable<Parameters<typeof interpret>[1]["snapshot"]>
): NonNullable<Parameters<typeof interpret>[1]["snapshot"]> {
  return JSON.parse(JSON.stringify(snapshot)) as NonNullable<
    Parameters<typeof interpret>[1]["snapshot"]
  >;
}

function block(...statements: Statement[]): ParseResult {
  return {
    type: "BlockStatement",
    body: statements,
    span: {
      start: statements[0]?.span.start ?? span(1, 1, 0).start,
      end: statements.at(-1)?.span.end ?? span(1, 1, 0).end
    }
  };
}

function span(line: number, column: number, offset: number) {
  return {
    start: {
      line,
      column,
      offset
    },
    end: {
      line,
      column,
      offset
    }
  };
}
