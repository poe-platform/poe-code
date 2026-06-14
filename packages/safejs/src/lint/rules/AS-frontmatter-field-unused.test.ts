import { describe, expect, it } from "vitest";

import { lint } from "../../lint.js";

function frontmatterDiagnostics(source: string, frontmatterFields?: readonly string[]) {
  return lint(source, {
    allowedExportNames: ["schema"],
    filename: "harness.ajs",
    frontmatterFields,
    modules: {
      schema: ["S"]
    }
  }).filter((diagnostic) => diagnostic.code === "AS-FRONTMATTER-FIELD-UNUSED");
}

describe("AS-FRONTMATTER-FIELD-UNUSED", () => {
  it("does nothing when frontmatter fields are absent", () => {
    expect(frontmatterDiagnostics("export default (frontmatter) => frontmatter.a;")).toEqual([]);
  });

  it("does not report schema fields referenced through frontmatter member access", () => {
    const source = [
      'import { S } from "schema";',
      "export const schema = S.Object({ a: S.String(), b: S.String() });",
      "export default (frontmatter) => frontmatter.a.concat(frontmatter.b);"
    ].join("\n");

    expect(frontmatterDiagnostics(source, ["a", "b"])).toEqual([]);
  });

  it("reports schema fields that are not referenced through frontmatter", () => {
    const source = [
      'import { S } from "schema";',
      "export const schema = S.Object({ a: S.String(), b: S.String() });",
      "export default (frontmatter) => frontmatter.a;"
    ].join("\n");

    expect(frontmatterDiagnostics(source, ["a", "b"])).toEqual([
      expect.objectContaining({
        code: "AS-FRONTMATTER-FIELD-UNUSED",
        severity: "info",
        message: "Frontmatter field 'b' is declared by the schema but never read."
      })
    ]);
  });

  it("counts top-level object destructuring from frontmatter", () => {
    const source = [
      'import { S } from "schema";',
      "export const schema = S.Object({ a: S.String(), b: S.String() });",
      "export default (frontmatter) => {",
      "  const { a } = frontmatter;",
      "  return a;",
      "};"
    ].join("\n");

    expect(frontmatterDiagnostics(source, ["a", "b"])).toEqual([
      expect.objectContaining({
        code: "AS-FRONTMATTER-FIELD-UNUSED",
        message: "Frontmatter field 'b' is declared by the schema but never read."
      })
    ]);
  });

  it("suppresses info when frontmatter is read through dynamic computed access", () => {
    const source = [
      'import { S } from "schema";',
      "export const schema = S.Object({ a: S.String(), b: S.String() });",
      "export default (frontmatter, name) => frontmatter[name];"
    ].join("\n");

    expect(frontmatterDiagnostics(source, ["a", "b"])).toEqual([]);
  });

  it("checks only top-level schema fields", () => {
    const source = [
      'import { S } from "schema";',
      "export const schema = S.Object({ a: S.Object({ nested: S.String() }) });",
      "export default (frontmatter) => frontmatter.a;"
    ].join("\n");

    expect(frontmatterDiagnostics(source, ["a"])).toEqual([]);
  });
});
