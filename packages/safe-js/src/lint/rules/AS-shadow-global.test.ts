import { describe, expect, it } from "vitest";

import { AS_SHADOW_GLOBAL } from "./AS-shadow-global.js";

describe("AS_SHADOW_GLOBAL", () => {
  it("warns when const bindings shadow runtime globals", () => {
    const source = 'const String = "x";';

    expect(AS_SHADOW_GLOBAL(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS-SHADOW-GLOBAL",
        severity: "warning",
        message: "Local binding 'String' shadows a runtime global.",
        filename: "rule.js",
        line: 1,
        column: 7,
        span: {
          start: { line: 1, column: 7, offset: source.indexOf("String") },
          end: { line: 1, column: 13, offset: source.indexOf("String") + "String".length }
        }
      }
    ]);
  });

  it("warns when let bindings shadow runtime globals", () => {
    const source = "let Math = 0;";

    expect(AS_SHADOW_GLOBAL(source)).toEqual([
      {
        code: "AS-SHADOW-GLOBAL",
        severity: "warning",
        message: "Local binding 'Math' shadows a runtime global.",
        filename: "<input>",
        line: 1,
        column: 5,
        span: {
          start: { line: 1, column: 5, offset: source.indexOf("Math") },
          end: { line: 1, column: 9, offset: source.indexOf("Math") + "Math".length }
        }
      }
    ]);
  });

  it("allows imported bindings to match runtime globals", () => {
    expect(AS_SHADOW_GLOBAL('import { Math } from "custom";')).toEqual([]);
  });

  it("allows bindings whose names only contain runtime global names", () => {
    expect(AS_SHADOW_GLOBAL('const customString = "x";')).toEqual([]);
  });

  it("warns on nested declarations that shadow runtime globals", () => {
    const source = "if (true) { const String = 1; }";

    expect(AS_SHADOW_GLOBAL(source)).toEqual([
      {
        code: "AS-SHADOW-GLOBAL",
        severity: "warning",
        message: "Local binding 'String' shadows a runtime global.",
        filename: "<input>",
        line: 1,
        column: 19,
        span: {
          start: { line: 1, column: 19, offset: source.indexOf("String") },
          end: { line: 1, column: 25, offset: source.indexOf("String") + "String".length }
        }
      }
    ]);
  });

  it("warns on parameters that shadow runtime globals", () => {
    const source = "(String) => String";

    expect(AS_SHADOW_GLOBAL(source)).toEqual([
      {
        code: "AS-SHADOW-GLOBAL",
        severity: "warning",
        message: "Local binding 'String' shadows a runtime global.",
        filename: "<input>",
        line: 1,
        column: 2,
        span: {
          start: { line: 1, column: 2, offset: source.indexOf("String") },
          end: { line: 1, column: 8, offset: source.indexOf("String") + "String".length }
        }
      }
    ]);
  });

  it("does not treat assignment targets as local declarations", () => {
    expect(AS_SHADOW_GLOBAL("({ String } = source);")).toEqual([]);
  });
});
