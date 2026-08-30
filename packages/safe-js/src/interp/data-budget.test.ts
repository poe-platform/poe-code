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
  it("charges source closures retained only by the replay capability registry", async () => {
    const source =
      "for (let index = 0; index < 32; index += 1) { const payload = ['abcdefgh'.repeat(64)]; remember(() => payload); } return 'done';";
    await expect(
      run(source, {
        bindings: { remember: () => undefined },
        budget: new Budget({ dataSize: 4096 })
      })
    ).rejects.toSatisfy((error: unknown) => {
      expectDataBudgetError(error);
      return true;
    });
  });

  it("charges immutable initial input history after mutable input is discarded", async () => {
    const source =
      "payload.value = ''; await Promise.resolve(); const next = 'abcdefgh'.repeat(900); return next.length;";
    expect(
      await run(source, {
        bindings: { payload: { value: "" } },
        budget: new Budget({ dataSize: 16000 })
      })
    ).toMatchObject({ ok: true, returnValue: 7200 });
    await expect(
      run(source, {
        bindings: { payload: { value: "x".repeat(4096) } },
        budget: new Budget({ dataSize: 16000 })
      })
    ).rejects.toSatisfy((error: unknown) => {
      expectDataBudgetError(error);
      return true;
    });
  });
  it("bounds replay metadata for synchronous calls returning no data", async () => {
    await expect(
      run("for (let index = 0; index < 512; index += 1) { read(); }", {
        bindings: { read: () => undefined },
        budget: new Budget({ dataSize: 128 })
      })
    ).rejects.toSatisfy((error: unknown) => {
      expectDataBudgetError(error);
      return true;
    });
  });

  it("bounds the retained promise scheduling trace", async () => {
    await expect(
      run("for (let index = 0; index < 100; index += 1) { await Promise.resolve(index); }", {
        budget: new Budget({ dataSize: 128 })
      })
    ).rejects.toSatisfy((error: unknown) => {
      expectDataBudgetError(error);
      return true;
    });
  });

  it.each([false, true])(
    "charges completed host replay values even after scope drops them (async: %s)",
    async (asynchronous) => {
      const source =
        "for (let index = 0; index < 100; index += 1) { await read(); } return 'done';";
      const read = () => "x".repeat(64);
      await expect(
        run(source, {
          bindings: { read: asynchronous ? async () => read() : read },
          budget: new Budget({ dataSize: 4096 })
        })
      ).rejects.toSatisfy((error: unknown) => {
        expectDataBudgetError(error);
        return true;
      });
    }
  );

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
        path: expect.stringContaining("$.scopeChain")
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
