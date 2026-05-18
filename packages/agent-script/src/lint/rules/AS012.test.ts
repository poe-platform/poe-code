import { describe, expect, it } from "vitest";

import { AS012 } from "./AS012.js";

describe("AS012", () => {
  const messages = (source: string) => AS012(source).map((diagnostic) => diagnostic.message);

  it("reports function replacers for replace and replaceAll", () => {
    const source = [
      "const once = value.replace('a', () => 'b');",
      "const all = value.replaceAll('a', (match) => match);"
    ].join("\n");

    expect(AS012(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS012",
        severity: "error",
        message: "String#replace does not support function replacers or regex search values.",
        filename: "rule.js",
        line: 1,
        column: 33,
        span: {
          start: { line: 1, column: 33, offset: source.indexOf("() => 'b'") },
          end: { line: 1, column: 42, offset: source.indexOf("() => 'b'") + "() => 'b'".length }
        }
      },
      {
        code: "AS012",
        severity: "error",
        message: "String#replaceAll does not support function replacers or regex search values.",
        filename: "rule.js",
        line: 2,
        column: 35,
        span: {
          start: { line: 2, column: 35, offset: source.indexOf("(match) => match") },
          end: {
            line: 2,
            column: 51,
            offset: source.indexOf("(match) => match") + "(match) => match".length
          }
        }
      }
    ]);
  });

  it("reports regex literal search arguments for split, replace, and replaceAll", () => {
    const source = [
      "const pieces = value.split(/,/);",
      "const once = value.replace(/a/, 'b');",
      "const all = value.replaceAll(/a/g, 'b');"
    ].join("\n");

    expect(AS012(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS012",
        severity: "error",
        message: "String#split does not support regex separator values.",
        filename: "rule.js",
        line: 1,
        column: 28,
        span: {
          start: { line: 1, column: 28, offset: source.indexOf("/,/") },
          end: { line: 1, column: 31, offset: source.indexOf("/,/") + "/,/".length }
        }
      },
      {
        code: "AS012",
        severity: "error",
        message: "String#replace does not support function replacers or regex search values.",
        filename: "rule.js",
        line: 2,
        column: 28,
        span: {
          start: { line: 2, column: 28, offset: source.indexOf("/a/") },
          end: { line: 2, column: 31, offset: source.indexOf("/a/") + "/a/".length }
        }
      },
      {
        code: "AS012",
        severity: "error",
        message: "String#replaceAll does not support function replacers or regex search values.",
        filename: "rule.js",
        line: 3,
        column: 30,
        span: {
          start: { line: 3, column: 30, offset: source.indexOf("/a/g") },
          end: { line: 3, column: 34, offset: source.indexOf("/a/g") + "/a/g".length }
        }
      }
    ]);
  });

  it("reports each unsupported replace shape when both are present", () => {
    const source = "value.replace(/a/, () => 'b');";

    expect(AS012(source)).toEqual([
      {
        code: "AS012",
        severity: "error",
        message: "String#replace does not support function replacers or regex search values.",
        filename: "<input>",
        line: 1,
        column: 15,
        span: {
          start: { line: 1, column: 15, offset: source.indexOf("/a/") },
          end: { line: 1, column: 18, offset: source.indexOf("/a/") + "/a/".length }
        }
      },
      {
        code: "AS012",
        severity: "error",
        message: "String#replace does not support function replacers or regex search values.",
        filename: "<input>",
        line: 1,
        column: 20,
        span: {
          start: { line: 1, column: 20, offset: source.indexOf("() => 'b'") },
          end: { line: 1, column: 29, offset: source.indexOf("() => 'b'") + "() => 'b'".length }
        }
      }
    ]);
  });

  it("reports sort comparators that are not arrows with an obvious numeric result", () => {
    const source = [
      "values.sort(compare);",
      "values.sort((left, right) => left > right);",
      "values.sort((left, right) => { return left - right; });",
      "values.sort(async (left, right) => left - right);",
      "values.sort((left, right) => left + right);",
      "values.sort((left, right) => (left > right ? 1 : '0'));"
    ].join("\n");

    expect(AS012(source)).toEqual([
      {
        code: "AS012",
        severity: "error",
        message: "Array#sort only supports comparators that are arrows returning a number.",
        filename: "<input>",
        line: 1,
        column: 13,
        span: {
          start: { line: 1, column: 13, offset: source.indexOf("compare") },
          end: { line: 1, column: 20, offset: source.indexOf("compare") + "compare".length }
        }
      },
      {
        code: "AS012",
        severity: "error",
        message: "Array#sort only supports comparators that are arrows returning a number.",
        filename: "<input>",
        line: 2,
        column: 13,
        span: {
          start: { line: 2, column: 13, offset: source.indexOf("(left, right) => left > right") },
          end: {
            line: 2,
            column: 42,
            offset:
              source.indexOf("(left, right) => left > right") +
              "(left, right) => left > right".length
          }
        }
      },
      {
        code: "AS012",
        severity: "error",
        message: "Array#sort only supports comparators that are arrows returning a number.",
        filename: "<input>",
        line: 3,
        column: 13,
        span: {
          start: {
            line: 3,
            column: 13,
            offset: source.indexOf("(left, right) => { return left - right; }")
          },
          end: {
            line: 3,
            column: 54,
            offset:
              source.indexOf("(left, right) => { return left - right; }") +
              "(left, right) => { return left - right; }".length
          }
        }
      },
      {
        code: "AS012",
        severity: "error",
        message: "Array#sort only supports comparators that are arrows returning a number.",
        filename: "<input>",
        line: 4,
        column: 13,
        span: {
          start: {
            line: 4,
            column: 13,
            offset: source.indexOf("async (left, right) => left - right")
          },
          end: {
            line: 4,
            column: 48,
            offset:
              source.indexOf("async (left, right) => left - right") +
              "async (left, right) => left - right".length
          }
        }
      },
      {
        code: "AS012",
        severity: "error",
        message: "Array#sort only supports comparators that are arrows returning a number.",
        filename: "<input>",
        line: 5,
        column: 13,
        span: {
          start: {
            line: 5,
            column: 13,
            offset: source.indexOf("(left, right) => left + right")
          },
          end: {
            line: 5,
            column: 42,
            offset:
              source.indexOf("(left, right) => left + right") +
              "(left, right) => left + right".length
          }
        }
      },
      {
        code: "AS012",
        severity: "error",
        message: "Array#sort only supports comparators that are arrows returning a number.",
        filename: "<input>",
        line: 6,
        column: 13,
        span: {
          start: {
            line: 6,
            column: 13,
            offset: source.indexOf("(left, right) => (left > right ? 1 : '0')")
          },
          end: {
            line: 6,
            column: 54,
            offset:
              source.indexOf("(left, right) => (left > right ? 1 : '0')") +
              "(left, right) => (left > right ? 1 : '0')".length
          }
        }
      }
    ]);
  });

  it("ignores supported and ambiguous method calls", () => {
    const source = [
      "value.split(',');",
      "value.replace('a', 'b');",
      "value.replaceAll('a', otherValue);",
      "values.sort();",
      "values.sort((left, right) => left - right);",
      "values.sort((left, right) => left.localeCompare(right));",
      "values.sort((left, right) => (left > right ? 1 : -1));",
      "values.sort((left, right) => left | 0);"
    ].join("\n");

    expect(AS012(source, { filename: "rule.js" })).toEqual([]);
  });

  it("reports unsupported calls inside template-literal interpolations", () => {
    const source = "const value = `${text.replace(/a/, 'b')}`;";

    expect(messages(source)).toEqual([
      "String#replace does not support function replacers or regex search values."
    ]);
  });

  it("reports unsupported calls inside parameter and destructuring defaults", () => {
    const source = [
      "const readParam = (value = text.split(/,/)) => value;",
      "const { value = text.replaceAll(/a/g, 'b') } = input;",
      "const [item = values.sort(compare)] = input;"
    ].join("\n");

    expect(messages(source)).toEqual([
      "String#split does not support regex separator values.",
      "String#replaceAll does not support function replacers or regex search values.",
      "Array#sort only supports comparators that are arrows returning a number."
    ]);
  });

  it("reports unsupported calls inside catch binding pattern defaults", () => {
    const source = "try { fail(); } catch ({ value = text.replace('a', () => 'b') }) { value; }";

    expect(messages(source)).toEqual([
      "String#replace does not support function replacers or regex search values."
    ]);
  });

  it("reports unsupported calls inside inner arrows that are exported handlers", () => {
    const source = "export default () => () => text.split(/,/);";

    expect(messages(source)).toEqual(["String#split does not support regex separator values."]);
  });

  it("reports unsupported computed method calls", () => {
    const source = [
      'text["split"](/,/);',
      'text["replace"](/a/, "b");',
      'text["replaceAll"]("a", () => "b");'
    ].join("\n");

    expect(messages(source)).toEqual([
      "String#split does not support regex separator values.",
      "String#replace does not support function replacers or regex search values.",
      "String#replaceAll does not support function replacers or regex search values."
    ]);
  });

  it("reports unsupported calls inside computed keys and spread expressions", () => {
    const source = "const value = { [text.split(/,/)] : 1, ...items.sort(compare) };";

    expect(messages(source)).toEqual([
      "String#split does not support regex separator values.",
      "Array#sort only supports comparators that are arrows returning a number."
    ]);
  });

  it("reports unsupported calls at file boundaries", () => {
    const source = ["text.replace(/a/, 'b');", "const safe = 1;", "items.sort(compare);"].join(
      "\n"
    );

    expect(messages(source)).toEqual([
      "String#replace does not support function replacers or regex search values.",
      "Array#sort only supports comparators that are arrows returning a number."
    ]);
  });
});
