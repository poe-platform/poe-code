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

  it("reports unsupported nodes through the result envelope", async () => {
    await expect(interpret(parse("left = right"))).resolves.toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_NODE",
        message: "Unsupported AST node type 'AssignmentExpression'.",
        nodeType: "AssignmentExpression"
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

  it("reports unsupported nested nodes with the nested node metadata", async () => {
    const returnAssignmentExpression = parse("return left = right");

    await expect(
      interpret({
        type: "BlockStatement",
        body: [returnAssignmentExpression],
        span: returnAssignmentExpression.span
      })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_NODE",
        message: "Unsupported AST node type 'AssignmentExpression'.",
        nodeType: "AssignmentExpression"
      },
      snapshot: {
        bindings: {}
      },
      stats: {
        nodeVisits: 3
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
      stack: "RangeError: Number#toString radix must be between 2 and 36.\n    at toString (line 1, column 8)"
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
      stack: "RangeError: Number#toFixed digits must be between 0 and 100.\n    at toFixed (line 1, column 8)"
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

    expect(yieldNodeIds).toEqual([
      topLevelAwait.nodeId,
      topLevelAwait.argument.callee.body.nodeId
    ]);
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

  it("runs finally before returning from try blocks", async () => {
    const cleanup = vi.fn();

    await expect(
      interpret(parse("try { return answer; } finally { cleanup(); }"), {
        bindings: {
          answer: 42,
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
      returnValue: 42
    });

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("runs finally before propagating throws and lets finally override prior exits", async () => {
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

    await expect(
      interpret(parse("try { return 1; } finally { throw 'override'; }"))
    ).rejects.toBe("override");
  });

  it("runs finally on break and continue completions", async () => {
    const cleanup = vi.fn();
    const cleanupClosure = createSandboxClosure({
      call: () => {
        cleanup();
        return undefined;
      },
      name: "cleanup"
    });

    const breakProgram = {
      type: "TryStatement",
      block: {
        type: "BlockStatement",
        body: [
          {
            type: "BreakStatement",
            span: span(1, 7, 12)
          }
        ],
        span: span(1, 1, 14)
      },
      handler: undefined,
      finalizer: {
        type: "BlockStatement",
        body: [
          {
            type: "ExpressionStatement",
            expression: {
              type: "CallExpression",
              callee: {
                type: "Identifier",
                name: "cleanup",
                span: span(1, 25, 32)
              },
              arguments: [],
              optional: false,
              span: span(1, 25, 34)
            },
            span: span(1, 25, 35)
          }
        ],
        span: span(1, 23, 37)
      },
      span: span(1, 1, 37)
    } satisfies ParseResult;

    const continueProgram = {
      type: "TryStatement",
      block: {
        type: "BlockStatement",
        body: [
          {
            type: "ContinueStatement",
            span: span(1, 7, 15)
          }
        ],
        span: span(1, 1, 17)
      },
      handler: undefined,
      finalizer: {
        type: "BlockStatement",
        body: [
          {
            type: "ExpressionStatement",
            expression: {
              type: "CallExpression",
              callee: {
                type: "Identifier",
                name: "cleanup",
                span: span(1, 28, 35)
              },
              arguments: [],
              optional: false,
              span: span(1, 28, 37)
            },
            span: span(1, 28, 38)
          }
        ],
        span: span(1, 26, 40)
      },
      span: span(1, 1, 40)
    } satisfies ParseResult;

    await expect(
      interpret(breakProgram, {
        bindings: {
          cleanup: cleanupClosure
        }
      })
    ).resolves.toMatchObject({
      ok: true
    });

    await expect(
      interpret(continueProgram, {
        bindings: {
          cleanup: cleanupClosure
        }
      })
    ).resolves.toMatchObject({
      ok: true
    });

    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("binds catch parameters in a dedicated catch scope", async () => {
    const budget = new Budget();

    await expect(
      interpret(
        parse("try { throw Error('boom'); } catch ({ message }) { return message; }"),
        {
          bindings: {
            ...createErrorGlobals({
              budget
            })
          },
          budget
        }
      )
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
