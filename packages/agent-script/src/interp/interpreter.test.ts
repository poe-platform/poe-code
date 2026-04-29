import { describe, expect, it, vi } from "vitest";

import { parse } from "../parse.js";
import { Budget, SandboxError } from "./budget.js";
import { createConsoleJsonGlobals } from "./globals/console-json.js";
import { createMathGlobals, createSeededRandom } from "./globals/math.js";
import { interpret, Scope } from "./interpreter.js";

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
    await expect(interpret(parse("left + right"))).resolves.toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_NODE",
        message: "Unsupported AST node type 'BinaryExpression'.",
        nodeType: "BinaryExpression"
      },
      snapshot: {
        bindings: {}
      },
      stats: {
        nodeVisits: 1
      }
    });
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
    const returnBinaryExpression = parse("return left + right");

    await expect(
      interpret({
        type: "BlockStatement",
        body: [returnBinaryExpression],
        span: returnBinaryExpression.span
      })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_NODE",
        message: "Unsupported AST node type 'BinaryExpression'.",
        nodeType: "BinaryExpression"
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
});
