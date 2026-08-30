import { createHash } from "node:crypto";
import { assert, describe, expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createSandboxRegex } from "../values.js";
import { callStringMethod } from "./string.js";

const originalWorkflow = String.raw`const match = 'plain'.match(/\d+/g);
return { isNull: match === null, value: match };
`;

const flagCombinations = ["g", "i", "m", "s"].reduce<string[]>(
  (combinations, flag) => [...combinations, ...combinations.map((flags) => flags + flag)],
  [""]
);

describe("independent STR-02 no-match validation", () => {
  it("preserves the complete unchanged original source and native null result", async () => {
    expect(createHash("sha256").update(originalWorkflow).digest("hex")).toBe(
      "5d7008596bfe91cbdf97d7486c854bd6f59b25a2edb131131aadb0032d505e3b"
    );
    const expected = { isNull: true, value: null };
    expect(new Function(originalWorkflow)()).toStrictEqual(expected);
    const actual = await run(originalWorkflow, {
      modules: {},
      budget: new Budget({ maxSteps: 5_000 })
    });
    assert(actual.ok);
    expect(structuredClone(actual.returnValue)).toStrictEqual(expected);
  });

  it.each(
    flagCombinations.flatMap((flags) =>
      [
        { input: "plain", pattern: "\\d+" },
        { input: "", pattern: "\\d+" },
        { input: "plain\ntext", pattern: "^z+$" },
        { input: "aA", pattern: "(a)" },
        { input: "A", pattern: "(a)" },
        { input: "x\na", pattern: "^a" },
        { input: "a\nb", pattern: "a.b" },
        { input: "", pattern: "(?:)" },
        { input: "ab", pattern: "(?:)" }
      ].map(({ input, pattern }) => ({ flags, input, pattern }))
    )
  )(
    "matches native nullable results for /$pattern/$flags on '$input'",
    async ({ flags, input, pattern }) => {
      const native = input.match(new RegExp(pattern, flags));
      const direct = await callStringMethod(
        input,
        "match",
        [createSandboxRegex(pattern, flags)],
        new Budget({ maxSteps: 5_000 })
      );
      expect(direct).toEqual(native);
      const source = `
      const matches = ${JSON.stringify(input)}.match(new RegExp(${JSON.stringify(pattern)}, ${JSON.stringify(flags)}));
      const fallback = matches || ["missing"];
      return {
        isNull: matches === null,
        truthy: !!matches,
        branch: matches === null ? "no match" : "matched",
        values: matches === null ? null : [...matches],
        length: matches === null ? null : matches.length,
        fallbackFirst: fallback[0]
      };
    `;
      const expected = new Function(source)();
      const actual = await run(source, { modules: {}, budget: new Budget({ maxSteps: 5_000 }) });
      assert(actual.ok);
      expect(structuredClone(actual.returnValue)).toStrictEqual(expected);
    }
  );

  it.each(flagCombinations.flatMap((flags) => ["plain", ""].map((input) => ({ flags, input }))))(
    "preserves neighboring no-match operations with /\\d+/$flags on '$input'",
    async ({ flags, input }) => {
      const source = `
      const input = ${JSON.stringify(input)};
      const regex = new RegExp("\\\\d+", ${JSON.stringify(flags)});
      let all;
      let allError;
      try { all = [...input.matchAll(regex)]; } catch (error) { allError = error.name; }
      return {
        all, allError,
        searched: input.search(regex),
        executed: regex.exec(input),
        tested: regex.test(input),
        replaced: input.replace(regex, "X"),
        ${flags.includes("g") ? 'replacedAll: input.replaceAll(regex, "X"),' : ""}
        split: input.split(regex)
      };
    `;
      const expected = new Function(source)();
      const actual = await run(source, { modules: {}, budget: new Budget({ maxSteps: 5_000 }) });
      assert(actual.ok);
      expect(structuredClone(actual.returnValue)).toStrictEqual(expected);
    }
  );

  it.each(flagCombinations.filter((flags) => flags.includes("g")))(
    "preserves repeated null/success/null results with flags %s",
    async (flags) => {
      const source = `
        const regex = new RegExp("\\\\d+", ${JSON.stringify(flags)});
        return ["plain", "a1", "plain", "", "b22", "plain"].map(input => input.match(regex));
      `;
      const expected = [null, ["1"], null, null, ["22"], null];
      expect(new Function(source)()).toStrictEqual(expected);
      const actual = await run(source, { modules: {}, budget: new Budget({ maxSteps: 5_000 }) });
      assert(actual.ok);
      expect(structuredClone(actual.returnValue)).toStrictEqual(expected);
    }
  );

  it.each(["plain", ""])("preserves supported literal-string controls for %j", async (input) => {
    const source = `
      const input = ${JSON.stringify(input)};
      return {
        replaced: input.replace("z", "X"), replacedAll: input.replaceAll("z", "X"),
        split: input.split("z"), included: input.includes("z"), index: input.indexOf("z")
      };
    `;
    const expected = new Function(source)();
    const actual = await run(source, { modules: {}, budget: new Budget({ maxSteps: 5_000 }) });
    assert(actual.ok);
    expect(structuredClone(actual.returnValue)).toStrictEqual(expected);
  });

  it.each(["y", "gy"])("keeps unsupported %s flags rejected", async (flags) => {
    await expect(
      run(`return new RegExp("a", ${JSON.stringify(flags)});`, { modules: {} })
    ).rejects.toThrow("Unsupported regex flag 'y'");
  });
});
