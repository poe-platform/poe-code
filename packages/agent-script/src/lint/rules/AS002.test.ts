import { describe, expect, it } from "vitest";

import { AS002 } from "./AS002.js";

describe("AS002", () => {
  const reportedNames = (source: string) =>
    AS002(source).map((diagnostic) => diagnostic.message.match(/'([^']+)'/)?.[1]);

  it("allows lambdas to close over const bindings, parameters, and imports", () => {
    const source = [
      'import { delay as importedDelay } from "delay";',
      "const shared = 1;",
      "(input) => Promise.all([",
      "  () => shared + input + importedDelay,",
      "  ({ extra } = { extra: importedDelay }) => extra + shared",
      "]);"
    ].join("\n");

    expect(AS002(source, { filename: "rule.js" })).toEqual([]);
  });

  it("reports let bindings captured by nested closures", () => {
    const source = ["let count = 0;", "() => {", "  return () => count;", "};"].join("\n");

    expect(AS002(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS002",
        severity: "error",
        message:
          "Lambda closes over let-bound 'count' from an outer scope. Change it to const or pass it as a parameter.",
        filename: "rule.js",
        line: 3,
        column: 16,
        span: {
          start: { line: 3, column: 16, offset: 38 },
          end: { line: 3, column: 21, offset: 43 }
        }
      }
    ]);
  });

  it("reports each Promise.all branch that closes over an outer let binding", () => {
    const source = [
      "let counter = 0;",
      "() => Promise.all([",
      "  () => counter,",
      "  async (value) => value + counter",
      "]);"
    ].join("\n");

    expect(AS002(source)).toEqual([
      {
        code: "AS002",
        severity: "error",
        message:
          "Lambda closes over let-bound 'counter' from an outer scope. Change it to const or pass it as a parameter.",
        filename: "<input>",
        line: 3,
        column: 9,
        span: {
          start: { line: 3, column: 9, offset: 45 },
          end: { line: 3, column: 16, offset: 52 }
        }
      },
      {
        code: "AS002",
        severity: "error",
        message:
          "Lambda closes over let-bound 'counter' from an outer scope. Change it to const or pass it as a parameter.",
        filename: "<input>",
        line: 4,
        column: 28,
        span: {
          start: { line: 4, column: 28, offset: 81 },
          end: { line: 4, column: 35, offset: 88 }
        }
      }
    ]);
  });

  it("allows nested lambdas to use shadowing parameters instead of outer let bindings", () => {
    const source = [
      "let counter = 0;",
      "(counter) => Promise.all([",
      "  () => counter,",
      "  ({ counter: alias } = { counter }) => alias",
      "]);"
    ].join("\n");

    expect(AS002(source)).toEqual([]);
  });

  it("reports let bindings captured through default parameters in nested Promise.all branches", () => {
    const source = [
      "let counter = 0;",
      "() => Promise.all([",
      "  (value = () => counter) => value(),",
      "  async ({ read = () => counter } = {}) => read()",
      "]);"
    ].join("\n");

    expect(AS002(source)).toEqual([
      {
        code: "AS002",
        severity: "error",
        message:
          "Lambda closes over let-bound 'counter' from an outer scope. Change it to const or pass it as a parameter.",
        filename: "<input>",
        line: 3,
        column: 18,
        span: {
          start: { line: 3, column: 18, offset: 54 },
          end: { line: 3, column: 25, offset: 61 }
        }
      },
      {
        code: "AS002",
        severity: "error",
        message:
          "Lambda closes over let-bound 'counter' from an outer scope. Change it to const or pass it as a parameter.",
        filename: "<input>",
        line: 4,
        column: 25,
        span: {
          start: { line: 4, column: 25, offset: 99 },
          end: { line: 4, column: 32, offset: 106 }
        }
      }
    ]);
  });

  it("reports nested lambdas that capture let bindings declared in an outer lambda body", () => {
    const source = ["() => {", "  let counter = 0;", "  return () => counter;", "};"].join("\n");

    expect(AS002(source)).toEqual([
      {
        code: "AS002",
        severity: "error",
        message:
          "Lambda closes over let-bound 'counter' from an outer scope. Change it to const or pass it as a parameter.",
        filename: "<input>",
        line: 3,
        column: 16,
        span: {
          start: { line: 3, column: 16, offset: 42 },
          end: { line: 3, column: 23, offset: 49 }
        }
      }
    ]);
  });

  it("reports captures inside template-literal interpolations", () => {
    const source = ["let counter = 0;", "const read = () => `${counter}`;"].join("\n");

    expect(reportedNames(source)).toEqual(["counter"]);
  });

  it("reports captures inside catch binding pattern defaults", () => {
    const source = [
      "let fallback = 1;",
      "try {",
      "  fail();",
      "} catch ({ read = () => fallback }) {",
      "  read();",
      "}"
    ].join("\n");

    expect(reportedNames(source)).toEqual(["fallback"]);
  });

  it("reports captures inside object and array destructuring defaults", () => {
    const source = [
      "let fallback = 1;",
      "const readObject = ({ value = () => fallback } = {}) => value();",
      "const readArray = ([value = () => fallback] = []) => value();"
    ].join("\n");

    expect(reportedNames(source)).toEqual(["fallback", "fallback"]);
  });

  it("reports captures inside inner arrows that are exported handlers", () => {
    const source = ["let counter = 0;", "export default () => () => counter;"].join("\n");

    expect(reportedNames(source)).toEqual(["counter"]);
  });

  it("reports top-level let captures at file boundaries", () => {
    expect(reportedNames("let counter = 0;\n() => counter;")).toEqual(["counter"]);
    expect(reportedNames("let counter = 0;\nconst ready = true;\n() => ready && counter;")).toEqual(
      ["counter"]
    );
  });

  it("reports captures inside nested expressions in parameter defaults", () => {
    const source = [
      "let counter = 0;",
      "const run = (readers = [() => counter, () => `${counter}`]) => readers;"
    ].join("\n");

    expect(reportedNames(source)).toEqual(["counter", "counter"]);
  });

  it("reports captures in computed destructuring keys and rest-adjacent defaults", () => {
    const source = [
      "let key = 'value';",
      "let fallback = 1;",
      "const read = ({ [key]: value = () => fallback, ...rest } = {}) => value();"
    ].join("\n");

    expect(reportedNames(source)).toEqual(["key", "fallback"]);
  });
});
