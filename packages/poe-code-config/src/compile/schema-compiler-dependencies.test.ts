import { Project } from "ts-morph";
import { expect, it, vi } from "vitest";
import { compileConfigSchemaFromSourceTexts } from "./schema-compiler.js";

it("limits schema analysis to reachable input sources without loading ambient libraries", () => {
  const createSourceFile = vi.spyOn(Project.prototype, "createSourceFile");
  try {
    const document = compileConfigSchemaFromSourceTexts({
      entrypoints: ["/repo/index.ts"],
      files: {
        "/repo/index.ts": 'export { settings } from "./settings.js";',
        "/repo/settings.ts": `
          import { defineScope } from "@poe-code/poe-code-config";
          export const settings: Readonly<Record<string, unknown>> = defineScope("settings", {
            enabled: { type: "boolean", default: true, doc: "Enable the feature" }
          });
        `,
        "/repo/unused.ts": "throw new Error('unreachable');"
      }
    });
    expect(document).toMatchObject({
      properties: { settings: { properties: { enabled: { type: "boolean", default: true } } } }
    });
    const project = createSourceFile.mock.contexts[0];
    expect(project.getProgram().compilerObject.getSourceFiles().map(file => file.fileName).sort())
      .toEqual(["/repo/index.ts", "/repo/settings.ts"]);
  } finally {
    createSourceFile.mockRestore();
  }
});
