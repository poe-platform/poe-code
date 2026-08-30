import { describe, expect, it } from "vitest";
import { SandboxError } from "../budget.js";
import { matchRegex } from "./engine.js";
import { parseRegex } from "./parse.js";

describe("matchRegex", () => {
  it.each([
    ["abc", "", "--abc--", 0],
    ["a.c", "", "a\nc", 0],
    ["a.c", "s", "a\nc", 0],
    ["^b$", "m", "a\nb\nc", 0],
    ["[a-c]+", "i", "--AbC--", 0],
    ["[^0-9]+", "", "123abc456", 0],
    ["\\d+\\s+\\w+", "", "x 12 abc!", 0],
    ["\\bcat\\B", "", "cats cat", 0],
    ["a+?", "", "aaaa", 0],
    ["a{2,3}", "", "aaaa", 0],
    ["(?:ab|a)c", "", "--ac--", 0],
    ["a$", "", "a\n", 0],
    ["a$", "", "a\r\n", 0],
    ["\\x41\\u0042", "", "--AB--", 0],
    ["[]", "", "x", 0],
    ["[^]", "", "x", 0]
  ])("matches /%s/%s like RegExp", (source, flags, input, lastIndex) => {
    const expected = new RegExp(source, flags).exec(input);
    const actual = matchRegex(parseRegex(source, flags), input, lastIndex);

    expect(actual).toEqual(
      expected === null
        ? null
        : {
            index: expected.index,
            text: expected[0],
            captures: expected.slice(1).map((capture) => capture ?? undefined)
          }
    );
  });

  it("returns captures and undefined non-participating groups", () => {
    expect(matchRegex(parseRegex("(a)?(b(c))"), "bc")).toEqual({
      index: 0,
      text: "bc",
      captures: [undefined, "bc", "c"]
    });
  });

  it("backtracks across captures and alternation", () => {
    expect(matchRegex(parseRegex("(a|ab)c"), "abc")).toEqual({
      index: 0,
      text: "abc",
      captures: ["ab"]
    });
  });

  it.each([
    ["^", "m", "a\nb"],
    ["$", "m", "a\nb"],
    ["(a|(b))*", "", "ab"],
    ["(a?)*", "", "a"],
    ["(a|)*", "", "a"],
    ["(a?){2}", "", ""],
    ["(a?){2,3}", "", "a"]
  ])("matches zero-width and capture behavior for /%s/%s", (source, flags, input) => {
    const expected = new RegExp(source, flags).exec(input);
    const actual = matchRegex(parseRegex(source, flags), input);

    expect(actual).toEqual(
      expected === null
        ? null
        : {
            index: expected.index,
            text: expected[0],
            captures: expected.slice(1).map((capture) => capture ?? undefined)
          }
    );
  });

  it("clears captures that do not participate in a later repetition", () => {
    expect(matchRegex(parseRegex("((a)|(b))*"), "ab")).toEqual({
      index: 0,
      text: "ab",
      captures: ["b", undefined, "b"]
    });
  });

  it("starts global searches from lastIndex", () => {
    const pattern = parseRegex("a*", "g");

    expect(matchRegex(pattern, "baaa", 0)).toEqual({ index: 0, text: "", captures: [] });
    expect(matchRegex(pattern, "baaa", 1)).toEqual({ index: 1, text: "aaa", captures: [] });
    expect(matchRegex(pattern, "baaa", 4)).toEqual({ index: 4, text: "", captures: [] });
    expect(matchRegex(pattern, "baaa", 5)).toBeNull();
  });

  it("ignores lastIndex without the global flag", () => {
    expect(matchRegex(parseRegex("a"), "ba", 2)).toEqual({ index: 1, text: "a", captures: [] });
  });

  it("fails catastrophic backtracking within the regex step cap", () => {
    const startedAt = performance.now();

    expect(() => matchRegex(parseRegex("(a+)+b"), "aaaaaaaaaaaaaaaaaaaaaaaaaaaX")).toThrow(
      SandboxError
    );
    expect(performance.now() - startedAt).toBeLessThan(100);
  });

  it("reports budget exhaustion instead of overflowing the host stack", () => {
    expect(() => matchRegex(parseRegex("a*"), "a".repeat(20_000))).toThrow(SandboxError);
  });

  it.each([
    ["[A-z]", "_"],
    ["k", "K"],
    ["ß", "ẞ"]
  ])("matches ignore-case edge case /%s/i like RegExp", (source, input) => {
    const expected = new RegExp(source, "i").exec(input);
    const actual = matchRegex(parseRegex(source, "i"), input);

    expect(actual).toEqual(
      expected === null
        ? null
        : {
            index: expected.index,
            text: expected[0],
            captures: expected.slice(1).map((capture) => capture ?? undefined)
          }
    );
  });
});
