import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createSandboxRegex } from "../values.js";
import { callStringMethod } from "./string.js";

describe("regex split capture assembly", () => {
  it.each([
    ["unmatched optional", "xaZ", "a(b)?", ["x", undefined, "Z"]],
    ["matched empty", "xaZ", "a(b*)", ["x", "", "Z"]],
    ["present optional", "xabZ", "a(b)?", ["x", "b", "Z"]],
    ["multiple optional occurrences", "xaYabZ", "a(b)?", ["x", undefined, "Y", "b", "Z"]],
    [
      "nested optional captures",
      "xaYabZ",
      "a((b)(c)?)?",
      ["x", undefined, undefined, undefined, "Y", "b", "b", undefined, "Z"]
    ],
    ["alternative captures", "a,b;c", "(,)|(;)", ["a", ",", undefined, "b", undefined, ";", "c"]],
    ["terminal optional match", "ab", "(b)?", ["a", "b", ""]],
    ["terminal empty capture", "ab", "(b*)", ["a", "b", ""]],
    ["interior unmatched capture", "abc", "(b)?", ["a", "b", "c"]],
    ["interior zero-width capture", "ac", "(b)?", ["a", undefined, "c"]],
    ["interior empty capture", "ac", "()", ["a", "", "c"]],
    ["zero-width after consuming match", "abbc", "(b)?", ["a", "b", "", "b", "c"]],
    ["end anchor capture", "ab", "($)", ["ab"]],
    ["start anchor capture", "ab", "(^)", ["ab"]],
    ["empty matched input", "", "(b)?", []],
    ["empty nonmatched input", "", "(b)", [""]],
    ["empty capture on empty input", "", "()", []],
    ["nonmatch", "ac", "(b)", ["ac"]]
  ] as const)("preserves %s", (_name, input, pattern, expected) => {
    const native = input.split(new RegExp(pattern));
    const actual = callStringMethod(
      input,
      "split",
      [createSandboxRegex(pattern, "")],
      new Budget()
    );

    expect(native).toStrictEqual(expected);
    expect(actual).toStrictEqual(native);
    expect(Array.isArray(actual)).toBe(true);
    if (!Array.isArray(actual)) throw new Error("Expected a split array");
    expect(actual).toHaveLength(expected.length);
    for (const [index, capture] of expected.entries()) {
      expect(Object.hasOwn(actual, index)).toBe(true);
      if (capture === undefined) {
        expect(actual[index]).toBeUndefined();
        expect(actual[index]).not.toBe("");
      } else if (capture === "") {
        expect(actual[index]).toBe("");
        expect(actual[index]).not.toBeUndefined();
      }
    }
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, undefined])(
    "limits nested captures to %s elements",
    (limit) => {
      const input = "xaYabZ";
      const pattern = "a((b)(c)?)?";
      const native = input.split(new RegExp(pattern), limit);
      const actual = callStringMethod(
        input,
        "split",
        [createSandboxRegex(pattern, ""), limit],
        new Budget()
      );

      expect(actual).toStrictEqual(native);
      expect(actual).toStrictEqual(
        ["x", undefined, undefined, undefined, "Y", "b", "b", undefined, "Z"].slice(0, limit)
      );
    }
  );

  it.each(["", "g", "i", "m", "s", "gims"])(
    "preserves optional captures and lastIndex with '%s' flags",
    (flags) => {
      const input = "xaYabZ";
      const pattern = "a(b)?";
      const nativeRegex = new RegExp(pattern, flags);
      const sandboxRegex = createSandboxRegex(pattern, flags);
      nativeRegex.lastIndex = 3;
      sandboxRegex.lastIndex = 3;

      expect(callStringMethod(input, "split", [sandboxRegex], new Budget())).toStrictEqual(
        input.split(nativeRegex)
      );
      expect(callStringMethod("ab", "split", [sandboxRegex], new Budget())).toStrictEqual(
        "ab".split(nativeRegex)
      );
      expect(nativeRegex.lastIndex).toBe(3);
      expect(sandboxRegex.lastIndex).toBe(3);
    }
  );

  it.each([0, 1, 2, 3, 4, 5, undefined])("limits zero-width captures to %s elements", (limit) => {
    for (const input of ["ab", "ac", ""]) {
      expect(
        callStringMethod(input, "split", [createSandboxRegex("(b)?", ""), limit], new Budget())
      ).toStrictEqual(input.split(/(b)?/, limit));
    }
  });

  it.each([
    ["ignore case", "aB", "(b)?", "i"],
    ["multiline", "a\nb", "(^)", "m"],
    ["dot all", "a\nb", "a(.)?", "s"],
    ["UTF-16 code units", "🧪", "()", ""]
  ])("honors %s controls", (_name, input, pattern, flags) => {
    expect(
      callStringMethod(input, "split", [createSandboxRegex(pattern, flags)], new Budget())
    ).toStrictEqual(input.split(new RegExp(pattern, flags)));
  });

  it("retains literal and omitted separator behavior", () => {
    expect(callStringMethod("a,b,", "split", [","], new Budget())).toStrictEqual(["a", "b", ""]);
    expect(callStringMethod("abc", "split", [], new Budget())).toStrictEqual(["abc"]);
    expect(callStringMethod("abc", "split", ["", 2], new Budget())).toStrictEqual(["a", "b"]);
  });
});

describe("split source regressions", () => {
  it("matches the unchanged STR-05 audit reduction without an extra terminal slot", async () => {
    const source = `return {
  empty: ''.split(/(?:)/),
  characters: 'ab'.split(/(?:)/),
  captured: 'ab'.split(/(b)?/),
  bounded: 'a1b2c'.split(/(\\d)/, 4),
  astralCodeUnits: '🧪'.split(/(?:)/).map(character => character.charCodeAt(0))
};
`;
    const native = runInNewContext(`(function () {${source}})()`);
    const result = await run(source);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected successful split evaluation");
    expect(structuredClone(result.returnValue)).toStrictEqual(structuredClone(native));
    expect(result.returnValue).toMatchObject({ captured: ["a", "b", ""] });
    const captured = (result.returnValue as { captured: unknown[] }).captured;
    expect(captured).toHaveLength(3);
    expect(Object.hasOwn(captured, 3)).toBe(false);
  });

  it("distinguishes undefined, empty, and present captures through the interpreter", async () => {
    const source = `
      const missing = "xaZ".split(/a(b)?/);
      const empty = "xaZ".split(/a(b*)/);
      const present = "xabZ".split(/a(b)?/);
      return {
        missing,
        empty,
        present,
        nested: "xaYabZ".split(/a((b)(c)?)?/),
        missingIsUndefined: missing[1] === undefined,
        missingIsEmpty: missing[1] === "",
        missingIsOwn: Object.hasOwn(missing, 1),
        emptyIsUndefined: empty[1] === undefined,
        emptyIsEmpty: empty[1] === ""
      };
    `;
    const native = runInNewContext(`(function () {${source}})()`);
    const result = await run(source);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected successful capture evaluation");
    expect(structuredClone(result.returnValue)).toStrictEqual(structuredClone(native));
    expect(result.returnValue).toMatchObject({
      missing: ["x", undefined, "Z"],
      empty: ["x", "", "Z"],
      present: ["x", "b", "Z"],
      missingIsUndefined: true,
      missingIsEmpty: false,
      missingIsOwn: true,
      emptyIsUndefined: false,
      emptyIsEmpty: true
    });
  });
});
