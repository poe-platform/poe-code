import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";

describe("frozen RegExp search", () => {
  it.each(["a", "b"])("matches frozen non-global native outcome for %s", async (input) => {
    const source = `const expression = /a/;
      Object.freeze(expression);
      return ${JSON.stringify(input)}.search(expression);`;
    const expected = new Function(source)();
    expect(expected).toBe(input === "a" ? 0 : -1);
    const actual = await run(source, { budget: new Budget({ maxSteps: 20_000 }) });
    assert(actual.ok);
    expect(actual.returnValue).toStrictEqual(expected);
  });

  it.each(["a", "b"])("preserves required-write API rejection /a/g on %s", async (input) => {
    const source = `const expression = /a/g;
      Object.freeze(expression);
      return ${JSON.stringify(input)}.search(expression);`;
    expect(() => new Function(source)()).toThrow(TypeError);
    await expect(run(source, { budget: new Budget({ maxSteps: 20_000 }) })).rejects.toMatchObject({
      name: "TypeError"
    });
  });

  it.each(["", "g"].flatMap((flags) => ["a", "b"].map((input) => ({ flags, input }))))(
    "keeps caught completion and frozen +0 cursor /a/$flags on $input",
    async ({ flags, input }) => {
      const source = `const expression = /a/${flags};
      Object.freeze(expression);
      let outcome;
      try { outcome = ["return", ${JSON.stringify(input)}.search(expression)]; }
      catch (error) { outcome = ["throw", error.name]; }
      return [outcome, expression.lastIndex, Object.is(expression.lastIndex, 0)];`;
      const expected = new Function(source)();
      const actual = await run(source, { budget: new Budget({ maxSteps: 20_000 }) });
      assert(actual.ok);
      expect(actual.returnValue).toStrictEqual(expected);
    }
  );

  it.each(["-0", "1", "NaN"])(
    "does not suppress the required initial write from frozen %s",
    async (cursor) => {
      const source = `const expression = /a/;
        const cursor = ${cursor}; expression.lastIndex = cursor;
        Object.freeze(expression);
        let outcome;
        try { outcome = ["return", "a".search(expression)]; }
        catch (error) { outcome = ["throw", error.name]; }
        return [outcome, expression.lastIndex, Object.is(expression.lastIndex, cursor)];`;
      const expected = new Function(source)();
      const actual = await run(source, { budget: new Budget({ maxSteps: 20_000 }) });
      assert(actual.ok);
      expect(actual.returnValue).toStrictEqual(expected);
    }
  );

  it.each(["", "g"])("restores exact negative zero for /a/%s", async (flags) => {
    const source = `const expression = /a/${flags}; expression.lastIndex = -0;
      const result = "a".search(expression);
      return [result, expression.lastIndex, Object.is(expression.lastIndex, -0)];`;
    const expected = new Function(source)();
    const actual = await run(source, { budget: new Budget({ maxSteps: 20_000 }) });
    assert(actual.ok);
    expect(actual.returnValue).toStrictEqual(expected);
  });
});
