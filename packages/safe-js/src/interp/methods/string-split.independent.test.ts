import { createHash } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import { assert, describe, expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createSandboxRegex } from "../values.js";
import { callStringMethod } from "./string.js";

const originalWorkflow = String.raw`return {
  empty: ''.split(/(?:)/),
  characters: 'ab'.split(/(?:)/),
  captured: 'ab'.split(/(b)?/),
  bounded: 'a1b2c'.split(/(\d)/, 4),
  astralCodeUnits: '🧪'.split(/(?:)/).map(character => character.charCodeAt(0))
};
`;

const flagCombinations = ["g", "i", "m", "s"].reduce<string[]>(
  (combinations, flag) => [...combinations, ...combinations.map((flags) => flags + flag)],
  [""]
);

function assertSplitSlots(actual: unknown, expected: readonly unknown[]): void {
  assert(Array.isArray(actual));
  expect(actual).toHaveLength(expected.length);
  expect(Object.keys(actual)).toStrictEqual(Object.keys(expected));
  for (const [index, value] of expected.entries()) {
    expect(Object.hasOwn(actual, index)).toBe(Object.hasOwn(expected, index));
    expect(actual[index]).toBe(value);
    if (value === undefined) {
      expect(actual[index]).not.toBe("");
      expect(actual[index]).not.toBe(null);
    }
  }
  expect(actual).toStrictEqual(expected);
}

describe("independent STR-05 typed split validation", () => {
  it("matches all five fields of the byte-identical original without an extra slot", async () => {
    expect(createHash("sha256").update(originalWorkflow).digest("hex")).toBe(
      "9ec3190d87f38c9087ee5fd5610420319153e1d86b3a90bfe476f35396e7def1"
    );
    const expected = {
      empty: [],
      characters: ["a", "b"],
      captured: ["a", "b", ""],
      bounded: ["a", "1", "b", "2"],
      astralCodeUnits: [55358, 56810]
    };
    expect(new Function(originalWorkflow)()).toStrictEqual(expected);
    const actual = await run(originalWorkflow, {
      modules: {},
      budget: new Budget({ maxSteps: 5_000 })
    });
    assert(actual.ok);
    expect(structuredClone(actual.returnValue)).toStrictEqual(expected);
    const result = actual.returnValue as typeof expected;
    for (const field of Object.keys(expected) as (keyof typeof expected)[]) {
      assertSplitSlots(result[field], expected[field]);
    }
    expect(Object.hasOwn(result.captured, 3)).toBe(false);
  });

  const fixtures = [
    { input: "ab", pattern: "(b)?" },
    { input: "ac", pattern: "(b)?" },
    { input: "abbc", pattern: "(b)?" },
    { input: "ab", pattern: "(b*)" },
    { input: "xaYabZ", pattern: "a((b)(c)?)?" },
    { input: "a\n🧪", pattern: "()" },
    { input: "a\nb", pattern: "(^)" },
    { input: "a\nb", pattern: "($)" },
    { input: "a\nb", pattern: "(.)" },
    { input: "aB", pattern: "(b)" },
    { input: "", pattern: "(?:)" },
    { input: "", pattern: "(b)" }
  ];

  it.each(
    flagCombinations.flatMap((flags) =>
      fixtures.flatMap(({ input, pattern }) =>
        [undefined, 0, 2, 5].map((limit) => ({ flags, input, pattern, limit }))
      )
    )
  )(
    "preserves typed slots for /$pattern/$flags on '$input', limit $limit",
    async ({ flags, input, pattern, limit }) => {
      const nativeRegex = new RegExp(pattern, flags);
      nativeRegex.lastIndex = 2;
      const expected = input.split(nativeRegex, limit);
      const regex = createSandboxRegex(pattern, flags, 2);
      const direct = await callStringMethod(input, "split", [regex, limit], new Budget());
      assertSplitSlots(direct, expected);
      expect(regex.lastIndex).toBe(nativeRegex.lastIndex);
      const source = `
      const regex = new RegExp(${JSON.stringify(pattern)}, ${JSON.stringify(flags)});
      regex.lastIndex = 2;
      const result = ${JSON.stringify(input)}.split(regex, ${limit === undefined ? "undefined" : limit});
      return { result, lastIndex: regex.lastIndex };
    `;
      const native = new Function(source)();
      const actual = await run(source, { modules: {}, budget: new Budget({ maxSteps: 5_000 }) });
      assert(actual.ok);
      expect(structuredClone(actual.returnValue)).toStrictEqual(native);
      assertSplitSlots((actual.returnValue as { result: unknown }).result, expected);
    }
  );

  it("distinguishes genuine own undefined, an empty capture, and a missing slot", async () => {
    const source = `
      const absent = "xaZ".split(/a(b)?/);
      const empty = "xaZ".split(/a(b*)/);
      const interior = "ac".split(/(b)?/);
      return { absent, empty, interior, own: Object.hasOwn(absent, 1), missing: Object.hasOwn(absent, 3) };
    `;
    const expected = {
      absent: ["x", undefined, "Z"],
      empty: ["x", "", "Z"],
      interior: ["a", undefined, "c"],
      own: true,
      missing: false
    };
    expect(new Function(source)()).toStrictEqual(expected);
    const actual = await run(source, { modules: {}, budget: new Budget({ maxSteps: 5_000 }) });
    assert(actual.ok);
    const result = structuredClone(actual.returnValue) as typeof expected;
    expect(result).toStrictEqual(expected);
    assertSplitSlots(result.absent, expected.absent);
    assertSplitSlots(result.empty, expected.empty);
    assertSplitSlots(result.interior, expected.interior);
    const hole = new Array<string>(3);
    hole[0] = "x";
    hole[2] = "Z";
    expect(Object.hasOwn(hole, 1)).toBe(false);
    expect(result.absent).not.toStrictEqual(hole);
    expect(result.absent).not.toStrictEqual(["x", "", "Z"]);
    expect(result.absent).not.toStrictEqual(["x", null, "Z"]);
    assertSplitSlots(deserialize(serialize(result.absent)), expected.absent);
    expect(Object.hasOwn(deserialize(serialize(hole)), 1)).toBe(false);
  });

  it.each(
    ["", "ab", "🧪"].flatMap((input) =>
      ["", ",", undefined].flatMap((separator) =>
        [undefined, 0, 1, 3].map((limit) => ({ input, separator, limit }))
      )
    )
  )(
    "preserves literal separator $separator on '$input', limit $limit",
    async ({ input, separator, limit }) => {
      const expected = input.split(separator as string, limit);
      const actual = await callStringMethod(input, "split", [separator, limit], new Budget());
      assertSplitSlots(actual, expected);
      const source = `return ${JSON.stringify(input)}.split(${separator === undefined ? "undefined" : JSON.stringify(separator)}, ${limit === undefined ? "undefined" : limit});`;
      const result = await run(source, { modules: {}, budget: new Budget({ maxSteps: 5_000 }) });
      assert(result.ok);
      assertSplitSlots(result.returnValue, expected);
    }
  );

  it("preserves omitted separators and upstream replacement substitutions", async () => {
    const source = `return {
      omitted: "ab".split(),
      emptyOmitted: "".split(),
      numeric: "a".replace(/(a)/, "$10"),
      missing: "a".replace(/a(b)?/, "<$1>"),
      context: "abc".replace(/b/, ${JSON.stringify("$`-$'")})
    };`;
    const expected = {
      omitted: ["ab"],
      emptyOmitted: [""],
      numeric: "a0",
      missing: "<>",
      context: "aa-cc"
    };
    expect(new Function(source)()).toStrictEqual(expected);
    const actual = await run(source, { modules: {}, budget: new Budget({ maxSteps: 5_000 }) });
    assert(actual.ok);
    expect(structuredClone(actual.returnValue)).toStrictEqual(expected);
  });

  it.each(["u", "gu", "v"])("does not add unsupported %s flags", async (flags) => {
    await expect(
      run(`return "ab".split(new RegExp("()", ${JSON.stringify(flags)}));`, { modules: {} })
    ).rejects.toThrow("Unsupported regex flag");
  });
});
