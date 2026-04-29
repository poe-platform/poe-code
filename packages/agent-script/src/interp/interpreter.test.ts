import { describe, expect, it } from "vitest";

import { parse } from "../parse.js";
import { Budget, SandboxError } from "./budget.js";
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
});
