import { describe, expect, it } from "vitest";

import { AS008 } from "./AS008.js";

describe("AS008", () => {
  it("allows await at the script top level and inside async arrow functions", () => {
    const source = [
      "await load();",
      "const run = async () => await load();",
      "const nested = () => async () => await load();"
    ].join("\n");

    expect(AS008(source, { filename: "rule.js" })).toEqual([]);
  });

  it("reports await inside non-async arrow functions", () => {
    const source = "const run = () => await load();";

    expect(AS008(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS008",
        severity: "error",
        message: "Await is only allowed at the script top level or inside async arrow functions.",
        filename: "rule.js",
        line: 1,
        column: 19,
        span: {
          start: { line: 1, column: 19, offset: source.indexOf("await") },
          end: { line: 1, column: 31, offset: source.indexOf("await") + "await load()".length }
        }
      }
    ]);
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
          end: { line: 2, column: 15, offset: source.indexOf("await load()") + "await load()".length }
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
          end: { line: 5, column: 15, offset: source.indexOf("await tick()") + "await tick()".length }
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
          end: { line: 8, column: 15, offset: source.indexOf("await step()") + "await step()".length }
        }
      }
    ]);
  });
});
