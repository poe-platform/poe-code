import { describe, expect, it } from "vitest";
import { parseRegex } from "./parse.js";

describe("parseRegex", () => {
  it("parses the supported feature matrix", () => {
    const pattern = parseRegex(
      "^(ab|c[0-9]+?)(?:x{2,4})?\\d\\D\\w\\W\\s\\S\\b\\B\\x41\\u0042.$",
      "gims"
    );

    expect(pattern.flags).toEqual({
      hasIndices: false,
      global: true,
      sticky: false,
      unicode: false,
      unicodeSets: false,
      ignoreCase: true,
      multiline: true,
      dotAll: true
    });
    expect(pattern.captureCount).toBe(1);
    expect(pattern.body.type).toBe("sequence");
  });

  it("parses empty positive and negated character classes", () => {
    expect(parseRegex("[]").body).toMatchObject({
      type: "characterClass",
      negated: false,
      items: []
    });
    expect(parseRegex("[^]").body).toMatchObject({
      type: "characterClass",
      negated: true,
      items: []
    });
  });

  it.each([
    ["a", "z", "Unsupported regex flag 'z' at position 0"],
    ["a", "gg", "Duplicate regex flag 'g' at position 1"],
    ["(a)\\1{2,1}", "", "Quantifier range is out of order at position 5"],
    ["(?=a", "", "Unterminated group at position 0"],
    ["(?!a", "", "Unterminated group at position 0"],
    ["(?<=a", "", "Unterminated group at position 0"],
    ["(?<!a", "", "Unterminated group at position 0"],
    ["(?<name>a", "", "Unterminated group at position 0"],
    ["\\p{Not_A_Property}", "u", "Unknown Unicode property at position 0"],
    ["\\P{Not_A_Property}", "u", "Unknown Unicode property at position 0"]
  ])("rejects %s", (source, flags, message) => {
    expect(() => parseRegex(source, flags)).toThrow(message);
  });

  it.each([
    ["(", "Unterminated group at position 0"],
    ["[a-", "Unterminated character class at position 0"],
    ["a{3,2}", "Quantifier range is out of order at position 1"],
    ["*a", "Nothing to repeat at position 0"]
  ])("reports malformed pattern %s", (source, message) => {
    expect(() => parseRegex(source)).toThrow(message);
  });

  it.each(["\\x0", "\\u000"])("rejects malformed escapes in Unicode mode: %s", source => {
    expect(() => parseRegex(source, "u")).toThrow(SyntaxError);
  });
});
