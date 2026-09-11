import { createHash } from "node:crypto";
import { assert, describe, expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";

const originalWorkflow = `const expression = /a/g;
expression.lastIndex = 2;
const all = [...'aba'.matchAll(expression)].map(match => match[0]);
const afterMatchAll = expression.lastIndex;
const matched = 'aba'.match(expression);
const afterMatch = expression.lastIndex;
expression.lastIndex = 2;
const replaced = 'aba'.replace(expression, 'X');
return { all, afterMatchAll, matched, afterMatch, replaced, afterReplace: expression.lastIndex };
`;

const flagCombinations = ["g", "i", "m", "s"].reduce<string[]>(
  (combinations, flag) => [...combinations, ...combinations.map((flags) => flags + flag)],
  [""]
);

describe("independent STR-04 validation", () => {
  it("executes the unchanged allowlisted original with its full native result", async () => {
    expect(createHash("sha256").update(originalWorkflow).digest("hex")).toBe(
      "ff1d8e2c92e66ce74f34bb84377ae15ea784536190bed83e17492e4e9997bc8d"
    );
    const expected = {
      all: ["a"],
      afterMatchAll: 2,
      matched: ["a", "a"],
      afterMatch: 0,
      replaced: "XbX",
      afterReplace: 0
    };
    expect(new Function(originalWorkflow)()).toStrictEqual(expected);
    const actual = await run(originalWorkflow, { budget: new Budget({ maxSteps: 5_000 }) });
    assert(actual.ok);
    expect(structuredClone(actual.returnValue)).toStrictEqual(expected);
  });

  const cases = flagCombinations.flatMap((flags) =>
    ["matchAll", "match", "replace"].flatMap((method) =>
      [
        { pattern: "(a)(.)", input: "A\nab\naZ" },
        { pattern: "^a.", input: "az\nAZ\na\nz" },
        { pattern: "(?:)", input: "a\nB" },
        { pattern: "(?:)", input: "" }
      ].flatMap(({ pattern, input }) =>
        [-2, 0, 1, 2.75, 10].map((lastIndex) => ({
          flags,
          method,
          pattern,
          input,
          lastIndex
        }))
      )
    )
  );

  it.each(cases)(
    "$method /$pattern/$flags from $lastIndex on '$input' matches native",
    async ({ flags, method, pattern, input, lastIndex }) => {
      const operation =
        method === "matchAll"
          ? `[...input.matchAll(regex)].map(match => [match[0], match.index, ...match.slice(1)])`
          : method === "replace"
            ? `input.replace(regex, "X")`
            : `input.match(regex)`;
      const source = `
        const regex = new RegExp(${JSON.stringify(pattern)}, ${JSON.stringify(flags)});
        const input = ${JSON.stringify(input)};
        regex.lastIndex = ${lastIndex};
        let value;
        let errorName;
        try {
          value = ${operation};
          ${method === "match" ? "if (value !== null) value = [...value];" : ""}
        } catch (error) {
          errorName = error.name;
        }
        return { value, errorName, lastIndex: regex.lastIndex };
      `;
      const expected = new Function(source)();
      const actual = await run(source, { budget: new Budget({ maxSteps: 5_000 }) });
      assert(actual.ok);
      expect(actual.returnValue).toHaveProperty("lastIndex", expected.lastIndex);
      expect(structuredClone(actual.returnValue)).toStrictEqual(expected);
    }
  );

  it.each(
    flagCombinations.flatMap((flags) =>
      ["matchAll", "match", "replace"].map((method) => ({ flags, method }))
    )
  )(
    "$method /z/$flags preserves native failed-scan cursor transitions",
    async ({ flags, method }) => {
      const source = `
      const regex = new RegExp("z", ${JSON.stringify(flags)});
      regex.lastIndex = 2;
      let errorName;
      try {
        ${method === "matchAll" ? '[..."aba".matchAll(regex)]' : `"aba".${method}(regex${method === "replace" ? ', "X"' : ""})`};
      } catch (error) {
        errorName = error.name;
      }
      const afterScan = regex.lastIndex;
      const next = regex.exec("z");
      return { errorName, afterScan, next: next === null ? null : next[0], afterExec: regex.lastIndex };
    `;
      const expected = new Function(source)();
      const actual = await run(source, { budget: new Budget({ maxSteps: 5_000 }) });
      assert(actual.ok);
      expect(actual.returnValue).toHaveProperty("afterScan", expected.afterScan);
      expect(actual.returnValue).toHaveProperty("afterExec", expected.afterExec);
      expect(structuredClone(actual.returnValue)).toStrictEqual(expected);
    }
  );

  it.each(
    flagCombinations
      .filter((flags) => flags.includes("g"))
      .flatMap((flags) => ["replace", "replaceAll"].map((method) => ({ flags, method })))
  )(
    "$method /a/$flags separates copied scans and callback mutations",
    async ({ flags, method }) => {
      const source = `
      const regex = new RegExp("a", ${JSON.stringify(flags)});
      regex.lastIndex = 2;
      const saved = "aba".matchAll(regex);
      regex.lastIndex = 1;
      const seen = [];
      const replaced = "aba".${method}(regex, (text, offset) => {
        seen.push([text, offset, regex.lastIndex]);
        regex.lastIndex = 2;
        const nested = [..."aba".matchAll(regex)].map(match => match.index);
        seen.push([nested, regex.lastIndex]);
        regex.lastIndex = offset + 1;
        return "X";
      });
      const afterReplace = regex.lastIndex;
      const copied = [...saved].map(match => match.index);
      return { replaced, seen, afterReplace, copied, afterCopy: regex.lastIndex };
    `;
      const expected = new Function(source)();
      expect(expected).toStrictEqual({
        replaced: "XbX",
        seen: [
          ["a", 0, 0],
          [[2], 2],
          ["a", 2, 1],
          [[2], 2]
        ],
        afterReplace: 3,
        copied: [2],
        afterCopy: 3
      });
      const actual = await run(source, { budget: new Budget({ maxSteps: 5_000 }) });
      assert(actual.ok);
      expect(actual.returnValue).toHaveProperty("afterReplace", expected.afterReplace);
      expect(actual.returnValue).toHaveProperty("afterCopy", expected.afterCopy);
      expect(structuredClone(actual.returnValue)).toStrictEqual(expected);
    }
  );

  it.each(["y", "gy"])("executes sticky %s flags at the selected cursor", async (flags) => {
    await expect(
      run(`const regex=new RegExp("a", ${JSON.stringify(flags)});regex.lastIndex=1;return [regex.exec('ba').index,regex.lastIndex];`, {
        budget: new Budget({ maxSteps: 5_000 })
      })
    ).resolves.toMatchObject({ ok: true, returnValue: [1, 2] });
  });
});
