import { describe, expect, it } from "vitest";

import { AS_NEEDLESS_TEMPLATE, fixASNeedlessTemplate } from "./AS-needless-template.js";

function codes(source: string): string[] {
  return AS_NEEDLESS_TEMPLATE(source, { filename: "rule.js" }).map((diagnostic) => diagnostic.code);
}

describe("AS_NEEDLESS_TEMPLATE", () => {
  it("reports a template with only one interpolation", () => {
    const source = "const value = `${x}`;";

    expect(AS_NEEDLESS_TEMPLATE(source, { filename: "rule.js" })).toMatchObject([
      {
        code: "AS-NEEDLESS-TEMPLATE",
        severity: "info",
        message:
          "Template literals with only one interpolation should use the value or String(value).",
        hint: "Use String(x).",
        filename: "rule.js",
        line: 1,
        column: 15,
        span: {
          start: { line: 1, column: 15, offset: source.indexOf("`") },
          end: { line: 1, column: 21, offset: source.indexOf("`") + "`${x}`".length }
        }
      }
    ]);
  });

  it("allows a template with prefix text", () => {
    expect(codes("const value = `n=${x}`;")).toEqual([]);
  });

  it("allows a template with suffix text", () => {
    expect(codes("const value = `${x}!`;")).toEqual([]);
  });

  it("allows a template with two interpolations", () => {
    expect(codes("const value = `${a} ${b}`;")).toEqual([]);
  });

  it("allows a literal-only template", () => {
    expect(codes("const value = `hello`;")).toEqual([]);
  });

  it("reports the inner template for nested needless templates", () => {
    const source = "const value = `${`${x}`}`;";
    const innerTemplateStart = source.indexOf("`${x}`");

    expect(AS_NEEDLESS_TEMPLATE(source, { filename: "rule.js" })).toEqual([
      expect.objectContaining({
        code: "AS-NEEDLESS-TEMPLATE",
        line: 1,
        column: 18,
        span: {
          start: { line: 1, column: 18, offset: innerTemplateStart },
          end: { line: 1, column: 24, offset: innerTemplateStart + "`${x}`".length }
        }
      })
    ]);
  });

  it("fixes needless templates with String calls", () => {
    expect(fixASNeedlessTemplate("const value = `${x}`;")).toBe("const value = String(x);");
  });

  it("fixes multiple needless templates", () => {
    expect(fixASNeedlessTemplate("const values = [`${a}`, `${b.c()}`];")).toBe(
      "const values = [String(a), String(b.c())];"
    );
  });

  it("fixes nested needless templates without leaving another needless template", () => {
    const fixed = fixASNeedlessTemplate("const value = `${`${x}`}`;");

    expect(fixed).toBe("const value = String(x);");
    expect(codes(fixed)).toEqual([]);
  });

  it("fixes overlapping needless templates without corrupting the source", () => {
    const fixed = fixASNeedlessTemplate("const value = `${`${x}`.trim()}`;");

    expect(fixed).toBe("const value = String(String(x).trim());");
    expect(codes(fixed)).toEqual([]);
  });

  it("does not wrap an existing String call while fixing", () => {
    expect(fixASNeedlessTemplate("const value = `${String(x)}`;")).toBe("const value = String(x);");
  });
});
