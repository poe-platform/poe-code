import assert from "node:assert/strict";
import { test } from "node:test";
import { createMatcher, matchesRow, pythonRstrip } from "./match.js";
import { CsvBudget } from "safe-bash-csv-engine";
const budget = () => new CsvBudget({}, new AbortController().signal);
test("explicit Unicode flags preserve Python search categories and case behavior", () => {
  for (const [regex, text, expected] of [
    ["(?u)\\d", "١", true],
    ["(?u)\\d", "a", false],
    ["(?u)\\s", "\u001c", true],
    ["(?u)\\s", "\ufeff", false],
    ["(?ui)[a-z]", "İ", true],
    ["(?um)^a$", "z\na\nz", true],
    ["(?us).", "\n", true]
  ] as const) {
    assert.equal(createMatcher({ regex }, new Set(), budget())!(text), expected, regex);
  }
  for (const regex of ["(?au)\\d", "(?ua)\\d", "(?u:a)", "(?L)a", "(?x)a"])
    assert.throws(() => createMatcher({ regex }, new Set(), budget()));
});
test("match-file presence wins over substring even for an empty path", () => {
  const b = budget();
  const match = createMatcher({ file: "", match: "a" }, new Set(["b"]), b)!;
  assert.equal(match("a"), false);
  assert.equal(match("b"), true);
  assert.equal(b.accounting.patternBytes, 0);
});
test("aggregate any/all then inversion; omitted empty patterns have vacuous aggregate", () => {
  for (const any of [false, true])
    for (const invert of [false, true]) {
      const b = budget(),
        m = createMatcher({ match: "a" }, new Set(), b);
      assert.equal(matchesRow(["a", "b"], [0, 1], m, any, invert, b), any !== invert);
      const empty = createMatcher({ match: "" }, new Set(), b);
      assert.equal(matchesRow(["a"], [0], empty, any, invert, b), !any !== invert);
    }
});
test("truthy regex wins file wins literal, short field is empty", () => {
  let b = budget();
  assert.equal(
    matchesRow(
      ["b"],
      [0],
      createMatcher({ regex: "^b$", file: "F", match: "a" }, new Set(["a"]), b),
      false,
      false,
      b
    ),
    true
  );
  b = budget();
  assert.equal(
    matchesRow(
      ["b"],
      [0],
      createMatcher({ regex: "", file: "F", match: "a" }, new Set(["b"]), b),
      false,
      false,
      b
    ),
    true
  );
  b = budget();
  assert.equal(
    matchesRow(["a"], [1], createMatcher({ regex: "^$" }, new Set(), b), false, false, b),
    true
  );
});
test("Python whitespace includes controls but excludes BOM", () => {
  assert.equal(pythonRstrip("a \t\u00a0\u001c"), "a");
  assert.equal(pythonRstrip("\ufeff"), "\ufeff");
});
test("explicit regex profile: search, Unicode digits, ASCII flags, final-LF and absolute anchors", () => {
  for (const [pattern, text, expected] of [
    ["abc", "zabc", true],
    ["\\d", "١", true],
    ["(?a)\\d", "١", false],
    ["^abc$", "abc\n", true],
    ["\\Aabc\\Z", "abc\n", false],
    ["(?m)^a$", "z\na\nz", true],
    ["(?i)[a-z]", "İ", true]
  ] as const) {
    const b = budget();
    assert.equal(
      matchesRow([text], [0], createMatcher({ regex: pattern }, new Set(), b), false, false, b),
      expected,
      pattern
    );
  }
  for (const pattern of ["(", "(?P<x>a)(?P=x)", "(?<=z)a", "(a+)+$", "a{2}", "a|b"])
    assert.throws(() => createMatcher({ regex: pattern }, new Set(), budget()));
});
test("pattern and scanned-cell limits are checked even with no matches", () => {
  assert.throws(() =>
    createMatcher(
      { match: "ab" },
      new Set(),
      new CsvBudget({ patternBytes: 1 }, new AbortController().signal)
    )
  );
  const b = new CsvBudget({ scannedCells: 1 }, new AbortController().signal),
    m = createMatcher({ match: "a" }, new Set(), b);
  matchesRow(["b"], [0], m, false, false, b);
  assert.throws(() => matchesRow(["b"], [0], m, false, false, b));
});
test("non-ASCII ignore-case literals are explicitly unqualified", () => {
  assert.throws(() => createMatcher({ regex: "(?i)é" }, new Set(), budget()));
});
test("complete groups are unsupported, malformed open group has Python release diagnostic", () => {
  assert.throws(() => createMatcher({ regex: "(a)" }, new Set(), budget()), {
    code: "UNSUPPORTED"
  });
  assert.throws(() => createMatcher({ regex: "(" }, new Set(), budget()), {
    code: "REGEX",
    message: "missing ), unterminated subpattern at position 0"
  });
  const points = [
    9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003,
    0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000
  ];
  for (const code of points) assert.equal(pythonRstrip("a" + String.fromCodePoint(code)), "a");
});
test("bounded-sequence-v1 flags, complements, classes and escaped literals have independent controls", () => {
  for (const [pattern, text, expected] of [
    ["(?i)[a-z]", "İ", true],
    ["(?i)[a-z]", "ı", true],
    ["(?i)[a-z]", "ſ", true],
    ["(?i)[a-z]", "K", true],
    ["(?ai)[a-z]", "İ", false],
    ["(?ai)[a-z]", "K", false],
    [".", "\n", false],
    ["(?s).", "\n", true],
    ["\\D", "١", false],
    ["\\D", "a", true],
    ["\\s", "\u001c", true],
    ["(?a)\\s", "\u001c", false],
    ["\\S", "\u00a0", false],
    ["[^a]", "b", true],
    ["[^a]", "a", false],
    ["\\.", ".", true],
    ["\\.", "a", false],
    ["😀", "x😀", true]
  ] as const) {
    const b = budget();
    assert.equal(
      matchesRow([text], [0], createMatcher({ regex: pattern }, new Set(), b), false, false, b),
      expected,
      pattern + text
    );
  }
});
test("mixed-case and nonletter ignore-case ranges fail instead of folding endpoints inaccurately", () => {
  for (const regex of ["(?i)[A-z]", "(?i)[@-C]", "(?i)[0-Z]", "(?i)[0-9]"])
    assert.throws(() => createMatcher({ regex }, new Set(), budget()), { code: "UNSUPPORTED" });
});
