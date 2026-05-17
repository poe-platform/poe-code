import { describe, expect, it, vi } from "vitest";

import { parse, type ParseResult, type Statement } from "../parse.js";
import { Budget, SandboxError } from "./budget.js";
import { createConsoleJsonGlobals } from "./globals/console-json.js";
import { createErrorGlobals } from "./globals/error.js";
import { createMathGlobals, createSeededRandom } from "./globals/math.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";
import { interpret, Scope } from "./interpreter.js";
import { createSandboxClosure, createSandboxPromise, isSandboxPromise } from "./values.js";

describe("interpret", () => {
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
    ['1 == "1"', false],
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
    ["{ ...{ a: 1 }, a: 9 }", { a: 9 }],
    ["{ ...{ a: 1 }, ...{ a: 2 } }", { a: 2 }]
  ])("evaluates object spread literal %s", async (source, expected) => {
    await expect(interpret(parse(`return (${source})`))).resolves.toMatchObject({
      ok: true,
      returnValue: expected
    });
  });

  it("rejects array spread in object literals", async () => {
    await expect(interpret(parse("return ({ ...[1] })"))).rejects.toThrow(
      "Cannot spread array into object literal."
    );
  });

  it.each(["string", "number", "boolean"] as const)(
    "rejects %s spread in object literals",
    async (type) => {
      const source = {
        string: '"value"',
        number: "1",
        boolean: "true"
      }[type];

      await expect(interpret(parse(`return ({ ...${source} })`))).rejects.toThrow(
        `Cannot spread ${type} into object literal.`
      );
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
      message: "Cannot assign to const 'x'"
    });
  });

  it.each(["obj.x = 1", "arr[0] = 1"])("rejects member-target assignment %s", async (source) => {
    await expect(interpret(parse(source))).rejects.toMatchObject({
      message: "member-target assignment is not supported"
    });
  });

  it("reports compound assignment to an undeclared identifier as unbound", async () => {
    await expect(interpret(parse("missing += 1"))).resolves.toMatchObject({
      ok: false,
      error: {
        code: "UNBOUND_IDENTIFIER",
        message: "Identifier 'missing' is not defined.",
        nodeType: "Identifier"
      }
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

  it("throws a TypeError-shaped sandbox error for array destructuring from null", async () => {
    await expect(interpret(parse("const [x] = null;"))).rejects.toMatchObject({
      name: "TypeError",
      message: "Array destructuring declarations require an array value."
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
        bindings: createStringRawBindings()
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "a\\nb"
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
            call: ([strings, value]) => `${(strings as string[])[0]}${String(value)}${(strings as string[])[1]}`,
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
          Math: expect.any(Object)
        }
      },
      stats: {
        nodeVisits: 6
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

  it("rejects regex separators for intercepted string methods before generic expression evaluation", async () => {
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
    ).rejects.toThrow("String#split does not support regex separator values.");
  });

  it("rejects regex values passed through bindings for split, replace, and replaceAll", async () => {
    await expect(
      interpret(parse("return value.split(separator)"), {
        bindings: {
          value: "abba",
          separator: /b+/ as never
        }
      })
    ).rejects.toThrow("String#split does not support regex separator values.");

    await expect(
      interpret(parse("return value.replace(search, replacement)"), {
        bindings: {
          value: "abba",
          search: /a/ as never,
          replacement: "x"
        }
      })
    ).rejects.toThrow("String#replace does not support function replacers or regex search values.");

    await expect(
      interpret(parse("return value.replaceAll(search, replacement)"), {
        bindings: {
          value: "abba",
          search: /a/g as never,
          replacement: "x"
        }
      })
    ).rejects.toThrow(
      "String#replaceAll does not support function replacers or regex search values."
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
    ["undefined function", "return fn?.()", { fn: undefined }, undefined],
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

    expect(yieldNodeIds).toEqual([topLevelAwait.nodeId, topLevelAwait.argument.callee.body.nodeId]);
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
      interpret(parse("try { push('try'); 'try-value'; } finally { push('finally'); 'finally-value'; }"), {
        bindings: {
          push: createSandboxClosure({
            call: ([event]) => {
              events.push(String(event));
              return undefined;
            },
            name: "push"
          })
        }
      })
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

  it("propagates throws from inside for...of bodies", async () => {
    await expect(interpret(parse('for (const x of [1]) { throw "boom"; }'))).rejects.toBe("boom");
  });

  it("returns from the enclosing arrow inside for...of bodies", async () => {
    await expect(
      interpret(parse("return (() => { for (const x of [1, 2]) { return x; } return 0; })()"))
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 1
    });
  });

  it("throws a TypeError-shaped sandbox error for unsupported for...of iterables", async () => {
    await expect(interpret(parse('for (const x of "abc") { return x; }'))).rejects.toMatchObject({
      name: "TypeError",
      message: "abc is not a supported iterable"
    });
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
});

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

function createStringRawBindings() {
  return {
    String: {
      raw: createSandboxClosure({
        call: ([strings, ...values]) => {
          const raw = (strings as { raw?: unknown }).raw;
          if (!Array.isArray(raw)) {
            throw new TypeError("String.raw requires a raw strings array.");
          }

          let result = "";
          for (let index = 0; index < raw.length; index += 1) {
            result += String(raw[index]);
            if (index < values.length) {
              result += String(values[index]);
            }
          }

          return result;
        },
        name: "raw"
      })
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
