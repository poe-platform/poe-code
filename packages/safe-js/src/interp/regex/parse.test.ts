import { describe, expect, it } from "vitest";
import { parseRegex } from "./parse.js";

describe("parseRegex", () => {
  it("parses the supported feature matrix", () => {
    const pattern = parseRegex(
      "^(ab|c[0-9]+?)(?:x{2,4})?\\d\\D\\w\\W\\s\\S\\b\\B\\x41\\u0042.$",
      "gims"
    );

    expect(pattern.flags).toEqual({
      global: true,
      sticky: false,
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
    ["a", "u", "Unsupported regex flag 'u' at position 0"],
    ["a", "gg", "Duplicate regex flag 'g' at position 1"],
    ["(a)\\1", "", "Backreferences are not supported at position 3"],
    ["(?=a)", "", "Lookahead is not supported at position 0"],
    ["(?!a)", "", "Lookahead is not supported at position 0"],
    ["(?<=a)", "", "Lookbehind is not supported at position 0"],
    ["(?<!a)", "", "Lookbehind is not supported at position 0"],
    ["(?<name>a)", "", "Named groups are not supported at position 0"],
    ["\\p{Letter}", "", "Unicode property escapes are not supported at position 0"],
    ["\\P{Letter}", "", "Unicode property escapes are not supported at position 0"]
  ])("rejects %s", (source, flags, message) => {
    expect(() => parseRegex(source, flags)).toThrow(message);
  });

  it.each([
    ["(", "Unterminated group at position 0"],
    ["[a-", "Unterminated character class at position 0"],
    ["a{3,2}", "Quantifier range is out of order at position 1"],
    ["*a", "Nothing to repeat at position 0"],
    ["\\x0", "Invalid hexadecimal escape at position 0"],
    ["\\u000", "Invalid Unicode escape at position 0"]
  ])("reports malformed pattern %s", (source, message) => {
    expect(() => parseRegex(source)).toThrow(message);
  });
});
