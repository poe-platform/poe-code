import { describe, expect, it } from "vitest";
import { compileConfigSchemaFromSourceTexts } from "./schema-compiler.js";
import * as core from "../core.js";
import * as config from "../index.js";
import * as publicConfig from "../../../../src/config.js";

const root = "/repo";

describe("compileConfigSchemaFromSourceTexts", () => {
  it("preserves the root API alongside the compiler-free runtime entrypoint", () => {
    expect(Object.keys(config).sort()).toEqual([
      ...Object.keys(core),
      "compileConfigSchemaFromEntrypoints",
      "compileConfigSchemaFromSourceTexts"
    ].sort());
    for (const [name, value] of Object.entries(core)) {
      expect(config[name as keyof typeof core]).toBe(value);
    }
    expect(config.compileConfigSchemaFromSourceTexts).toBe(compileConfigSchemaFromSourceTexts);
    expect(publicConfig).toEqual(config);
  });

  it.each(["@poe-code/poe-code-config", "@poe-code/poe-code-config/core"])("collects reachable static scopes from %s and emits a JSON Schema document", (moduleName) => {
    const document = compileConfigSchemaFromSourceTexts({
      entrypoints: [`${root}/packages/pipeline/src/index.ts`],
      files: {
        [`${root}/packages/pipeline/src/index.ts`]:
          'export { pipelineConfigScope } from "./poe-code-config.js";\n',
        [`${root}/packages/pipeline/src/poe-code-config.ts`]: `
          import { defineScope } from "${moduleName}";

          export const pipelineConfigScope = defineScope("pipeline", {
            plan_directory: {
              type: "string",
              default: "docs/plans",
              env: "POE_PIPELINE_PLAN_DIRECTORY",
              doc: "Directory for Pipeline plan files"
            }
          });
        `,
        [`${root}/packages/pipeline/src/unreachable.ts`]: `
          import { defineScope } from "@poe-code/poe-code-config";

          export const hiddenScope = defineScope("hidden", {
            enabled: {
              type: "boolean",
              default: true,
              doc: "Should not be collected"
            }
          });
        `
      },
      document: {
        id: "https://example.test/poe-code.schema.json",
        title: "poe-code config",
        description: "Schema for poe-code config files"
      }
    });

    expect(document).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://example.test/poe-code.schema.json",
      title: "poe-code config",
      description: "Schema for poe-code config files",
      type: "object",
      additionalProperties: false,
      properties: {
        version: {
          type: "number",
          default: 1
        },
        pipeline: {
          type: "object",
          additionalProperties: false,
          properties: {
            plan_directory: {
              type: "string",
              default: "docs/plans",
              description: "Directory for Pipeline plan files"
            }
          },
          required: ["plan_directory"]
        }
      },
      required: ["version"]
    });
  });

  it("merges fragments that contribute distinct fields to the same scope", () => {
    const document = compileConfigSchemaFromSourceTexts({
      entrypoints: [`${root}/src/index.ts`],
      files: {
        [`${root}/src/index.ts`]: `
          export { coreAuthScope } from "./auth.js";
          export { coreUiScope } from "./ui.js";
        `,
        [`${root}/src/auth.ts`]: `
          import { defineScope } from "@poe-code/poe-code-config";

          export const coreAuthScope = defineScope("core", {
            apiKey: {
              type: "string",
              default: "",
              env: "POE_API_KEY",
              doc: "Poe API key"
            }
          });
        `,
        [`${root}/src/ui.ts`]: `
          import { defineScope } from "@poe-code/poe-code-config";

          export const coreUiScope = defineScope("core", {
            darkMode: {
              type: "boolean",
              default: false,
              doc: "Enable dark mode"
            }
          });
        `
      }
    });

    expect(document.properties?.core).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        apiKey: {
          type: "string",
          default: "",
          description: "Poe API key"
        },
        darkMode: {
          type: "boolean",
          default: false,
          description: "Enable dark mode"
        }
      },
      required: ["apiKey", "darkMode"]
    });
  });

  it("rejects duplicate fields inside the same scope", () => {
    expect(() =>
      compileConfigSchemaFromSourceTexts({
        entrypoints: [`${root}/src/index.ts`],
        files: {
          [`${root}/src/index.ts`]: `
            export { coreAuthScope } from "./auth.js";
            export { duplicateAuthScope } from "./duplicate.js";
          `,
          [`${root}/src/auth.ts`]: `
            import { defineScope } from "@poe-code/poe-code-config";

            export const coreAuthScope = defineScope("core", {
              apiKey: {
                type: "string",
                default: "",
                doc: "Poe API key"
              }
            });
          `,
          [`${root}/src/duplicate.ts`]: `
            import { defineScope } from "@poe-code/poe-code-config";

            export const duplicateAuthScope = defineScope("core", {
              apiKey: {
                type: "string",
                default: "other",
                doc: "Duplicate API key"
              }
            });
          `
        }
      })
    ).toThrow('Duplicate config field "core.apiKey"');
  });

  it("rejects duplicate fields inside one scope fragment", () => {
    expect(() =>
      compileConfigSchemaFromSourceTexts({
        entrypoints: [`${root}/src/index.ts`],
        files: {
          [`${root}/src/index.ts`]: 'export { coreScope } from "./core.js";\n',
          [`${root}/src/core.ts`]: `
            import { defineScope } from "@poe-code/poe-code-config";

            export const coreScope = defineScope("core", {
              apiKey: {
                type: "string",
                default: "",
                doc: "Poe API key"
              },
              apiKey: {
                type: "string",
                default: "other",
                doc: "Duplicate API key"
              }
            });
          `
        }
      })
    ).toThrow('Duplicate config field "core.apiKey"');
  });

  it("rejects dynamic scope definitions", () => {
    expect(() =>
      compileConfigSchemaFromSourceTexts({
        entrypoints: [`${root}/src/index.ts`],
        files: {
          [`${root}/src/index.ts`]: 'export { dynamicScope } from "./dynamic.js";\n',
          [`${root}/src/dynamic.ts`]: `
            import { defineScope } from "@poe-code/poe-code-config";

            const name = "dynamic";
            export const dynamicScope = defineScope(name, {
              enabled: {
                type: "boolean",
                default: true,
                doc: "Dynamic scope"
              }
            });
          `
        }
      })
    ).toThrow("defineScope scope name must be a string literal");
  });

  it("rejects unsupported field metadata instead of ignoring it", () => {
    expect(() =>
      compileConfigSchemaFromSourceTexts({
        entrypoints: [`${root}/src/index.ts`],
        files: {
          [`${root}/src/index.ts`]: 'export { coreScope } from "./core.js";\n',
          [`${root}/src/core.ts`]: `
            import { defineScope } from "@poe-code/poe-code-config";

            export const coreScope = defineScope("core", {
              apiKey: {
                type: "string",
                default: "",
                doc: "Poe API key",
                secret: true
              }
            });
          `
        }
      })
    ).toThrow('Unsupported metadata "secret" on config field "apiKey"');
  });

  it("rejects json fields before parsing json-only metadata", () => {
    expect(() =>
      compileConfigSchemaFromSourceTexts({
        entrypoints: [`${root}/src/index.ts`],
        files: {
          [`${root}/src/index.ts`]: 'export { agentScope } from "./agent.js";\n',
          [`${root}/src/agent.ts`]: `
            import { defineScope } from "@poe-code/poe-code-config";

            export const agentScope = defineScope("agent", {
              plugins: {
                type: "json",
                default: null as unknown,
                parse: parsePlugins,
                doc: "Plugin entries"
              }
            });

            function parsePlugins(value: unknown): unknown {
              return value;
            }
          `
        }
      })
    ).toThrow('config field "plugins" uses json, which schema compilation does not support yet');
  });

  it("rejects unsafe scope and field names", () => {
    expect(() =>
      compileConfigSchemaFromSourceTexts({
        entrypoints: [`${root}/src/index.ts`],
        files: {
          [`${root}/src/index.ts`]: 'export { unsafeScope } from "./unsafe.js";\n',
          [`${root}/src/unsafe.ts`]: `
            import { defineScope } from "@poe-code/poe-code-config";

            export const unsafeScope = defineScope("__proto__", {
              apiKey: {
                type: "string",
                default: "",
                doc: "Poe API key"
              }
            });
          `
        }
      })
    ).toThrow('Unsafe config schema name "__proto__"');

    expect(() =>
      compileConfigSchemaFromSourceTexts({
        entrypoints: [`${root}/src/index.ts`],
        files: {
          [`${root}/src/index.ts`]: 'export { unsafeScope } from "./unsafe.js";\n',
          [`${root}/src/unsafe.ts`]: `
            import { defineScope } from "@poe-code/poe-code-config";

            export const unsafeScope = defineScope("core", {
              "__proto__": {
                type: "string",
                default: "",
                doc: "Poe API key"
              }
            });
          `
        }
      })
    ).toThrow('Unsafe config schema name "__proto__"');
  });

  it("rejects array literals because v1 schema compilation only supports primitive and object literals", () => {
    expect(() =>
      compileConfigSchemaFromSourceTexts({
        entrypoints: [`${root}/src/index.ts`],
        files: {
          [`${root}/src/index.ts`]: 'export { coreScope } from "./core.js";\n',
          [`${root}/src/core.ts`]: `
            import { defineScope } from "@poe-code/poe-code-config";

            export const coreScope = defineScope("core", {
              apiKey: {
                type: "string",
                default: "",
                doc: ["Poe API key"]
              }
            });
          `
        }
      })
    ).toThrow("array literals are not supported");
  });
});
