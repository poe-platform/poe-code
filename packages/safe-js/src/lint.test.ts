import { describe, expect, it } from "vitest";

import { lint } from "./lint.js";

function diagnosticCodes(source: string, options: Parameters<typeof lint>[1] = {}): string[] {
  return lint(source, { filename: "rule.js", ...options }).map((diagnostic) => diagnostic.code);
}

function diagnostics(source: string, options: Parameters<typeof lint>[1] = {}) {
  return lint(source, { filename: "rule.js", ...options });
}

describe("lint export and import.meta module syntax", () => {
  it("reports unknown named exports unless the name is allowed", () => {
    expect(
      diagnosticCodes("export const schema = {};", { allowedExportNames: ["schema"] })
    ).not.toContain("AS-EXPORT-UNKNOWN");
    expect(diagnosticCodes("export const schema = {};")).toContain("AS-EXPORT-UNKNOWN");
    expect(
      diagnosticCodes("export const schema = {}; export const tools = [];", {
        allowedExportNames: ["schema"]
      })
    ).toContain("AS-EXPORT-UNKNOWN");
  });

  it("reports multiple default exports", () => {
    expect(diagnosticCodes("export default () => 1;")).not.toContain("AS-EXPORT-DEFAULT-MULTIPLE");
    expect(diagnosticCodes("export default () => 1; export default () => 2;")).toContain(
      "AS-EXPORT-DEFAULT-MULTIPLE"
    );
  });

  it("reports default exports whose initializer is not an arrow expression", () => {
    expect(diagnosticCodes("export default async () => 1;")).not.toContain(
      "AS-EXPORT-DEFAULT-NOT-ARROW"
    );
    expect(diagnosticCodes("export default (() => 1);")).not.toContain(
      "AS-EXPORT-DEFAULT-NOT-ARROW"
    );
    expect(diagnosticCodes("export default 1;")).toContain("AS-EXPORT-DEFAULT-NOT-ARROW");
  });

  it("warns when a top-level return appears alongside a default export", () => {
    expect(diagnosticCodes("return 1;")).not.toContain("AS-RETURN-AT-TOP");
    expect(diagnosticCodes("export default () => { return 1; };")).not.toContain(
      "AS-RETURN-AT-TOP"
    );
    expect(diagnosticCodes("export default () => 1; return 2;")).toContain("AS-RETURN-AT-TOP");
    expect(
      diagnostics("export default () => 1; return 2;").find(
        (diagnostic) => diagnostic.code === "AS-RETURN-AT-TOP"
      )
    ).toMatchObject({ severity: "warning" });
  });

  it("reports assignment targets that involve import.meta", () => {
    expect(diagnosticCodes("const url = import.meta.url;")).not.toContain("AS-IMPORT-META-ASSIGN");
    expect(diagnosticCodes("import.meta = {};")).toContain("AS-IMPORT-META-ASSIGN");
    expect(diagnosticCodes("import.meta.url = 'agent.md';")).toContain("AS-IMPORT-META-ASSIGN");
    expect(diagnosticCodes("target[import.meta.url] = value;")).toContain("AS-IMPORT-META-ASSIGN");
    expect(diagnosticCodes("[import.meta.url] = [url];")).toContain("AS-IMPORT-META-ASSIGN");
    expect(diagnosticCodes("({ url: import.meta.url } = source);")).toContain(
      "AS-IMPORT-META-ASSIGN"
    );
    expect(diagnosticCodes("for (import.meta.url of urls) {}")).toContain("AS-IMPORT-META-ASSIGN");
  });

  it("visits import.meta assignment inside nested arrows that are exported handlers", () => {
    expect(
      diagnosticCodes("export default () => () => { import.meta.url = 'agent.md'; };")
    ).toContain("AS-IMPORT-META-ASSIGN");
  });

  it("keeps import.meta binding reads within the direct static reach of the rule", () => {
    expect(diagnosticCodes("const m = import.meta; m.url;")).not.toContain("AS-IMPORT-META-ASSIGN");
    expect(diagnosticCodes("const m = import.meta; m.url = 'agent.md';")).not.toContain(
      "AS-IMPORT-META-ASSIGN"
    );
  });

  it("allows destructured aliases of import.meta", () => {
    expect(diagnosticCodes("const { url: agentUrl } = import.meta; agentUrl;")).not.toContain(
      "AS-IMPORT-META-ASSIGN"
    );
  });

  it("does not require a default export", () => {
    expect(
      diagnosticCodes("export const schema = {};", { allowedExportNames: ["schema"] })
    ).not.toContain("AS-EXPORT-DEFAULT-NOT-ARROW");
    expect(
      diagnosticCodes("export const schema = {};", { allowedExportNames: ["schema"] })
    ).not.toContain("AS-EXPORT-DEFAULT-MULTIPLE");
  });
});
