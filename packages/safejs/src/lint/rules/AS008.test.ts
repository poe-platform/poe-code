import { describe, expect, it } from "vitest";

import { AS008 } from "./AS008.js";

describe("AS008", () => {
  const reportedLines = (source: string) => AS008(source).map((diagnostic) => diagnostic.line);

  it("allows await at the script top level and inside async arrow functions", () => {
    const source = [
      "await load();",
      "const run = async () => await load();",
      "const nested = () => async () => await load();"
    ].join("\n");

    expect(AS008(source, { filename: "rule.js" })).toEqual([]);
  });

  it("lets AS-MISSING-ASYNC own await inside non-async arrow functions", () => {
    expect(AS008("const run = () => await load();", { filename: "rule.js" })).toEqual([]);
  });

  it("reports await inside nested blocks outside async arrow functions", () => {
    const source = ["if (ready) {", "  await load();", "}"].join("\n");

    expect(AS008(source)).toEqual([
      {
        code: "AS008",
        severity: "error",
        message: "Await is only allowed at the script top level or inside async arrow functions.",
        filename: "<input>",
        line: 2,
        column: 3,
        span: {
          start: { line: 2, column: 3, offset: source.indexOf("await") },
          end: { line: 2, column: 15, offset: source.indexOf("await") + "await load()".length }
        }
      }
    ]);
  });

  it("allows await in top-level control-flow headers and single-statement bodies", () => {
    const source = [
      "if (await ready()) await load();",
      "while (await ready()) await tick();",
      "for (; await ready(); await advance()) await step();",
      "for (const item of await items()) await handle(item);"
    ].join("\n");

    expect(AS008(source, { filename: "rule.js" })).toEqual([]);
  });

  it("still reports await in nested blocks reached from top-level control flow", () => {
    const source = [
      "if (await ready()) {",
      "  await load();",
      "}",
      "while (await ready()) {",
      "  await tick();",
      "}",
      "for (; await ready(); await advance()) {",
      "  await step();",
      "}"
    ].join("\n");

    expect(AS008(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS008",
        severity: "error",
        message: "Await is only allowed at the script top level or inside async arrow functions.",
        filename: "rule.js",
        line: 2,
        column: 3,
        span: {
          start: { line: 2, column: 3, offset: source.indexOf("await load()") },
          end: {
            line: 2,
            column: 15,
            offset: source.indexOf("await load()") + "await load()".length
          }
        }
      },
      {
        code: "AS008",
        severity: "error",
        message: "Await is only allowed at the script top level or inside async arrow functions.",
        filename: "rule.js",
        line: 5,
        column: 3,
        span: {
          start: { line: 5, column: 3, offset: source.indexOf("await tick()") },
          end: {
            line: 5,
            column: 15,
            offset: source.indexOf("await tick()") + "await tick()".length
          }
        }
      },
      {
        code: "AS008",
        severity: "error",
        message: "Await is only allowed at the script top level or inside async arrow functions.",
        filename: "rule.js",
        line: 8,
        column: 3,
        span: {
          start: { line: 8, column: 3, offset: source.indexOf("await step()") },
          end: {
            line: 8,
            column: 15,
            offset: source.indexOf("await step()") + "await step()".length
          }
        }
      }
    ]);
  });

  it("reports await inside template-literal interpolations in nested blocks", () => {
    const source = ["if (ready) {", "  const value = `${await load()}`;", "}"].join("\n");

    expect(reportedLines(source)).toEqual([2]);
  });

  it("reports await inside catch binding pattern defaults", () => {
    const source = [
      "try {",
      "  fail();",
      "} catch ({ value = await load() }) {",
      "  value;",
      "}"
    ].join("\n");

    expect(reportedLines(source)).toEqual([3]);
  });

  it("allows await at file boundaries when it remains top-level", () => {
    expect(AS008("await start();")).toEqual([]);
    expect(AS008("const ready = true;\nawait finish();")).toEqual([]);
  });

  it("visits exported default arrows and leaves nested await ownership to AS-MISSING-ASYNC", () => {
    const source = "export default () => () => await load();";

    expect(AS008(source)).toEqual([]);
  });

  it("reports await inside object and array destructuring defaults in nested blocks", () => {
    const source = [
      "if (ready) {",
      "  const { value = await load() } = input;",
      "  const [item = await next()] = input;",
      "}"
    ].join("\n");

    expect(reportedLines(source)).toEqual([2, 3]);
  });

  it("allows await inside async arrow parameter defaults and destructuring defaults", () => {
    const source = [
      "const readParam = async (value = await load()) => value;",
      "const readObject = async ({ value = await load() } = {}) => value;"
    ].join("\n");

    expect(AS008(source)).toEqual([]);
  });

  it("reports await at the end of a nested block at the end of a file", () => {
    const source = ["if (ready) {", "  await finish();", "}"].join("\n");

    expect(reportedLines(source)).toEqual([2]);
  });
});
