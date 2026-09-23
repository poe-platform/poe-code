import { afterEach, expect, it, vi } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { CompileScope } from "./regex/compile-guard.js";
import { Scope } from "./scope.js";
import { createSandboxClosure } from "./values.js";
import { run } from "../run.js";

afterEach(() => vi.restoreAllMocks());

it.each(["1", "true", "false", "null", "'text'"])(
  "does not create an empty child compile scope for %s",
  async (source) => {
    const ast = parseModule(source);
    const statement = ast.body[0];
    if (statement?.type !== "ExpressionStatement") throw new Error("Missing expression");
    const dispose = vi.spyOn(CompileScope.prototype, "dispose");
    const result = await interpret(statement.expression);
    expect(result.ok).toBe(true);
    const children = dispose.mock.contexts.filter(
      (scope) => scope instanceof CompileScope && scope.parent !== undefined
    );
    expect(children).toHaveLength(0);
  }
);

it("enforces the string limit at the literal and preserves its error location", async () => {
  const statement = parseModule("'text'").body[0];
  if (statement?.type !== "ExpressionStatement") throw new Error("Missing expression");
  await expect(
    interpret(statement.expression, { budget: new Budget({ stringLength: 3 }) })
  ).rejects.toMatchObject({
    budget: "stringLength",
    span: statement.expression.span
  });
  expect(
    await interpret(statement.expression, { budget: new Budget({ stringLength: 4 }) })
  ).toMatchObject({
    ok: true,
    returnValue: "text"
  });
});

it("preserves compiled regex values across intervening primitive evaluations", async () => {
  expect(
    await run("const pattern = /a+/; 1; true; null; return pattern.test('aaa');")
  ).toMatchObject({
    ok: true,
    returnValue: true
  });
});

it.each([false, true])(
  "still checks fresh retained payloads at a numeric literal (held=%s)",
  async (held) => {
    const ast = parseModule("1");
    const statement = ast.body[0];
    if (statement?.type !== "ExpressionStatement") throw new Error("Missing expression");
    let collections = 0;
    const closure = createSandboxClosure({
      call: () => undefined,
      retainedValues: () => {
        collections++;
        return ["x".repeat(1000)];
      }
    });
    const budget = new Budget({ dataSize: 500 });
    const release = held ? budget.deferReconciliation() : undefined;
    try {
      await expect(
        interpret(statement.expression, {
          budget,
          scope: new Scope({ closure }),
          useScopeDirectly: true
        })
      ).rejects.toMatchObject({ budget: "dataSize", span: statement.expression.span });
      expect(collections).toBeGreaterThan(0);
    } finally {
      release?.();
    }
  }
);
