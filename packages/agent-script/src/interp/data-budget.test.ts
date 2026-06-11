import { describe, expect, it } from "vitest";

import { dump } from "../dump.js";
import { run } from "../run.js";
import { serialize } from "../snapshot/serialize.js";
import { restore as restoreRuntimeSnapshot } from "../snapshot/restore.js";
import { parseModule } from "../parse/parser.js";
import { Budget, SandboxError } from "./budget.js";
import { createCollectionGlobals } from "./globals/collections.js";
import { wrapCallerInjectedBindings } from "./host-bridge.js";
import { interpret } from "./interpreter.js";
import { parse, type ParseResult } from "../parse.js";

function expectDataBudgetError(error: unknown): void {
  expect(error).toBeInstanceOf(SandboxError);
  expect(error).toEqual(
    expect.objectContaining({
      code: "budgetExceeded",
      budget: "dataSize"
    })
  );
}

describe("aggregate sandbox data budget", () => {
  it("rejects many small strings below the per-string limit", async () => {
    const budget = new Budget({ dataSize: 20, stringLength: 8 });

    await expect(
      interpret(
        block('const values = ["aa", "bb", "cc", "dd", "ee", "ff", "gg"]', "return values"),
        {
          budget
        }
      )
    ).rejects.toSatisfy((error: unknown) => {
      expectDataBudgetError(error);
      return true;
    });
  });

  it.each([
    "const value = [[], [], [], [], [], [], [], []]; return value;",
    "const value = [{}, {}, {}, {}, {}, {}, {}, {}]; return value;",
    "const value = new Map([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]); return value;"
  ])("rejects many small retained containers: %s", async (source) => {
    const budget = new Budget({ dataSize: 12 });
    await expect(
      interpret(block(...source.split("; ").filter(Boolean)), {
        bindings: source.includes("Map") ? createCollectionGlobals({ budget }) : undefined,
        budget
      })
    ).rejects.toSatisfy((error: unknown) => {
      expectDataBudgetError(error);
      return true;
    });
  });

  it("does not double-charge aliased retained objects", async () => {
    const result = await interpret(
      block("const value = { nested: [] }", "const alias = value", "return alias"),
      {
        budget: new Budget({ dataSize: 9 })
      }
    );

    expect(result.ok).toBe(true);
    expect(result.stats).toMatchObject({
      currentDataSize: expect.any(Number),
      peakDataSize: expect.any(Number)
    });
  });

  it("rolls back provisional host-result charges after a failed import", () => {
    const budget = new Budget({ dataSize: 8 });

    expect(() =>
      wrapCallerInjectedBindings(
        {
          rejected: { first: "aaaa", second: "bbbb" }
        },
        { budget }
      )
    ).toThrow(SandboxError);

    expect(() =>
      wrapCallerInjectedBindings(
        {
          accepted: "ok"
        },
        { budget }
      )
    ).not.toThrow();
  });

  it("keeps copied host values charged while sandbox bindings retain them", async () => {
    const budget = new Budget({ dataSize: 9 });

    await expect(
      run("const local = ['a', 'b', 'c']; return 1;", {
        bindings: {
          imported: { a: "x" }
        },
        budget
      })
    ).rejects.toSatisfy((error: unknown) => {
      expectDataBudgetError(error);
      return true;
    });
  });

  it("keeps the last durable snapshot dumpable after budget exhaustion", async () => {
    const source = 'let durable = "ok"; await pause(); durable = ["aaaa", "bbbb", "cccc", "dddd"];';
    const result = run(source, {
      bindings: {
        pause: async () => undefined
      },
      budget: new Budget({ dataSize: 18, stringLength: 8 })
    });

    await expect(result).rejects.toSatisfy((error: unknown) => {
      expectDataBudgetError(error);
      return true;
    });
    const durable = JSON.parse(await dump(result)) as { bindings?: Record<string, unknown> };
    expect(durable).toMatchObject({
      bindings: {
        durable: "ok"
      }
    });
  });

  it("rejects a decoded snapshot graph over the configured data budget", () => {
    const source = "await task();";
    const module = parseModule(source);
    const currentAstNodeId = module.body[0]!.nodeId!;
    const serialized = serialize({
      source,
      currentAstNodeId,
      scopeChain: [
        {
          id: "module",
          bindings: {
            values: ["aa", "bb", "cc", "dd", "ee", "ff"]
          }
        }
      ],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });

    expect(() =>
      restoreRuntimeSnapshot(serialized, {
        source,
        budget: new Budget({ dataSize: 12 })
      })
    ).toThrowError(
      expect.objectContaining({
        code: "budgetExceeded",
        budget: "dataSize"
      })
    );
  });
});

function block(...statements: string[]): ParseResult {
  const body = statements.map((statement) => parse(statement));
  const first = body[0]!;
  const last = body.at(-1)!;
  return {
    type: "BlockStatement",
    body,
    span: {
      start: first.span.start,
      end: last.span.end
    }
  };
}
