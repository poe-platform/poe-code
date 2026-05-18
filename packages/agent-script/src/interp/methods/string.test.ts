import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { Budget, SandboxError } from "../budget.js";
import { createSandboxClosure, isSandboxClosure, type SandboxValue } from "../values.js";
import { callStringMethod, getStringMember, validateStringMethodArguments } from "./string.js";

type StringMethodName = Parameters<typeof callStringMethod>[1];

describe("string methods", () => {
  it("exposes intercepted string members", () => {
    const budget = new Budget();

    expect(getStringMember("abc", "length", budget)).toBe(3);
    expect(isSandboxClosure(getStringMember("abc", "charAt", budget))).toBe(true);
    expect(isSandboxClosure(getStringMember("abc", "at", budget))).toBe(true);
    expect(getStringMember("abc", "missing", budget)).toBeUndefined();
  });

  it("evaluates string methods through script member calls", async () => {
    const result = await run(
      [
        "return [",
        '  "abc".charAt(0),',
        '  "abc".charAt(10),',
        '  "abc".charCodeAt(0),',
        '  Number.isNaN("abc".charCodeAt(10)),',
        '  "\\uD83D\\uDE00".codePointAt(0),',
        '  "\\uD83D\\uDE00".charCodeAt(0),',
        '  "abc".at(-1),',
        '  "abc".concat("d", "e"),',
        '  "abcd".startsWith("ab"),',
        '  "abcd".startsWith("bc", 1),',
        '  "abcd".endsWith("cd"),',
        '  "abcd".endsWith("ab", 2),',
        '  "abc".indexOf("b"),',
        '  "abc".indexOf("z"),',
        '  "abc".indexOf("a", 1),',
        '  "aba".lastIndexOf("a"),',
        '  "abc".includes("b"),',
        '  "abc".includes("z"),',
        '  "a,b,c".split(","),',
        '  "abc".split(""),',
        '  "".split(","),',
        '  "abc".replace("b", "X"),',
        '  "aba".replaceAll("a", "X"),',
        '  "abc".repeat(3),',
        '  "abc".repeat(0),',
        '  "  abc  ".trim(),',
        '  "  abc  ".trimStart(),',
        '  "  abc  ".trimEnd(),',
        '  "abc".padStart(5, "0"),',
        '  "abc".padStart(2),',
        '  "abc".padEnd(5),',
        '  "ABC".toLowerCase(),',
        '  "abc".toUpperCase(),',
        '  "\\u0130".toLowerCase(),',
        '  "abc".slice(1, 2),',
        '  "abc".slice(-2),',
        '  "abc".slice(1, -1),',
        '  "abc".substring(2, 0),',
        '  "abc".substr(1, 2),',
        '  "e\\u0301".normalize("NFC")',
        "];"
      ].join("\n")
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: [
        "a",
        "",
        97,
        true,
        128512,
        55357,
        "c",
        "abcde",
        true,
        true,
        true,
        true,
        1,
        -1,
        -1,
        2,
        true,
        false,
        ["a", "b", "c"],
        ["a", "b", "c"],
        [""],
        "aXc",
        "XbX",
        "abcabcabc",
        "",
        "abc",
        "abc  ",
        "  abc",
        "00abc",
        "abc",
        "abc  ",
        "abc",
        "ABC",
        "i\u0307",
        "b",
        "bc",
        "b",
        "ab",
        "bc",
        "\u00e9"
      ]
    });
  });

  it("supports character lookup methods", () => {
    const budget = new Budget();

    expectStringMethod("abc", "charAt", [0], "a", budget);
    expectStringMethod("abc", "charAt", [10], "", budget);
    expectStringMethod("abc", "charCodeAt", [0], 97, budget);
    expect(Number.isNaN(callStringMethod("abc", "charCodeAt", [10], budget))).toBe(true);
    expectStringMethod(String.fromCodePoint(0x1f600), "codePointAt", [0], 128512, budget);
    expectStringMethod(String.fromCodePoint(0x1f600), "charCodeAt", [0], 55357, budget);
    expectStringMethod("abc", "at", [-1], "c", budget);
  });

  it("supports concatenation and prefix or suffix checks", () => {
    const budget = new Budget();

    expectStringMethod("abc", "concat", ["d", "e"], "abcde", budget);
    expectStringMethod("abcd", "startsWith", ["ab"], true, budget);
    expectStringMethod("abcd", "startsWith", ["bc", 1], true, budget);
    expectStringMethod("abcd", "endsWith", ["cd"], true, budget);
    expectStringMethod("abcd", "endsWith", ["ab", 2], true, budget);
  });

  it("supports search methods", () => {
    const budget = new Budget();

    expectStringMethod("abc", "indexOf", ["b"], 1, budget);
    expectStringMethod("abc", "indexOf", ["z"], -1, budget);
    expectStringMethod("abc", "indexOf", ["a", 1], -1, budget);
    expectStringMethod("aba", "lastIndexOf", ["a"], 2, budget);
    expectStringMethod("abc", "includes", ["b"], true, budget);
    expectStringMethod("abc", "includes", ["z"], false, budget);
  });

  it("supports split with string separators and rejects regex separators", () => {
    const budget = new Budget();

    expectStringMethod("a,b,c", "split", [","], ["a", "b", "c"], budget);
    expectStringMethod("abc", "split", [""], ["a", "b", "c"], budget);
    expectStringMethod("", "split", [","], [""], budget);

    expect(() => callStringMethod("abc", "split", [/[,]/ as never], budget)).toThrow(
      "String#split does not support regex separator values."
    );
    expect(() =>
      validateStringMethodArguments("split", [
        {
          raw: "/[,]/",
          span: { end: 14, start: 10 },
          type: "RegexLiteral"
        } as never
      ])
    ).toThrow("String#split does not support regex separator values.");
  });

  it("supports replace and replaceAll with string arguments", () => {
    const budget = new Budget();

    expectStringMethod("abc", "replace", ["b", "X"], "aXc", budget);
    expectStringMethod("aba", "replaceAll", ["a", "X"], "XbX", budget);
  });

  it("rejects unsupported replace and replaceAll arguments", () => {
    const budget = new Budget();
    const replacer = createSandboxClosure({
      call: () => "X",
      name: "replacer"
    });

    expect(() => callStringMethod("abc", "replace", [/b/ as never, "X"], budget)).toThrow(
      "String#replace does not support function replacers or regex search values."
    );
    expect(() => callStringMethod("abc", "replaceAll", ["b", replacer], budget)).toThrow(
      "String#replaceAll does not support function replacers or regex search values."
    );
  });

  it("supports repeat and preserves native RangeError cases", () => {
    const budget = new Budget();

    expectStringMethod("abc", "repeat", [3], "abcabcabc", budget);
    expectStringMethod("abc", "repeat", [0], "", budget);
    expect(() => callStringMethod("abc", "repeat", [-1], budget)).toThrow(RangeError);
    expect(() => callStringMethod("abc", "repeat", [Number.POSITIVE_INFINITY], budget)).toThrow(
      RangeError
    );
  });

  it("checks repeated strings against the stringLength budget", () => {
    expect(() =>
      callStringMethod("abc", "repeat", [1e6], new Budget({ stringLength: 10 }))
    ).toThrow(SandboxError);

    try {
      callStringMethod("abc", "repeat", [1e6], new Budget({ stringLength: 10 }));
      throw new Error("Expected SandboxError to be thrown.");
    } catch (error) {
      expect(error).toMatchObject({
        budget: "stringLength",
        code: "budgetExceeded",
        current: 3_000_000,
        limit: 10
      });
    }
  });

  it("supports trimming and padding methods", () => {
    const budget = new Budget();

    expectStringMethod("  abc  ", "trim", [], "abc", budget);
    expectStringMethod("  abc  ", "trimStart", [], "abc  ", budget);
    expectStringMethod("  abc  ", "trimEnd", [], "  abc", budget);
    expectStringMethod("abc", "padStart", [5, "0"], "00abc", budget);
    expectStringMethod("abc", "padStart", [2], "abc", budget);
    expectStringMethod("abc", "padEnd", [5], "abc  ", budget);
  });

  it("supports Unicode-aware case conversion", () => {
    const budget = new Budget();

    expectStringMethod("ABC", "toLowerCase", [], "abc", budget);
    expectStringMethod("abc", "toUpperCase", [], "ABC", budget);
    expectStringMethod("İ", "toLowerCase", [], "i\u0307", budget);
  });

  it("supports slice, substring, and deprecated substr", () => {
    const budget = new Budget();

    expectStringMethod("abc", "slice", [1, 2], "b", budget);
    expectStringMethod("abc", "slice", [-2], "bc", budget);
    expectStringMethod("abc", "slice", [1, -1], "b", budget);
    expectStringMethod("abc", "substring", [2, 0], "ab", budget);
    expectStringMethod("abc", "substr", [1, 2], "bc", budget);
  });

  it("supports Unicode normalization", () => {
    const budget = new Budget();

    expectStringMethod("e\u0301", "normalize", ["NFC"], "\u00e9", budget);
    expectStringMethod("abc", "normalize", ["NFC"], "abc", budget);
  });

  it("rejects function arguments for non-callback string methods", () => {
    const budget = new Budget();
    const value = createSandboxClosure({
      call: () => "b",
      name: "value"
    });

    expect(() => callStringMethod("abc", "includes", [value], budget)).toThrow(
      "String#includes does not support function arguments."
    );
  });
});

function expectStringMethod(
  value: string,
  methodName: StringMethodName,
  args: readonly SandboxValue[],
  expected: SandboxValue,
  budget: Budget
): void {
  expect(callStringMethod(value, methodName, args, budget)).toEqual(expected);
}
