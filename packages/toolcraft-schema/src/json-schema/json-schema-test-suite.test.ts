import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compileJsonSchema } from "./index.js";

type SuiteCase = {
  description: string;
  schema: unknown;
  tests: Array<{ description: string; data: unknown; valid: boolean }>;
};

const suiteRoot = path.resolve("packages/toolcraft-schema/test/json-schema-test-suite");

function loadRegistry(): Record<string, unknown> {
  const registry: Record<string, unknown> = {};
  const remoteRoot = path.join(suiteRoot, "remotes");

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.name.endsWith(".json")) {
        const relativePath = path.relative(remoteRoot, entryPath).split(path.sep).join("/");
        registry[`http://localhost:1234/${relativePath}`] = JSON.parse(
          readFileSync(entryPath, "utf8")
        );
      }
    }
  }

  visit(remoteRoot);
  return registry;
}

const registry = loadRegistry();

function schemaForDraft(schema: unknown, draft: "draft2020-12" | "draft7"): unknown {
  if (
    typeof schema !== "object" ||
    schema === null ||
    Array.isArray(schema) ||
    "$schema" in schema
  ) {
    return schema;
  }
  return {
    $schema:
      draft === "draft7"
        ? "http://json-schema.org/draft-07/schema#"
        : "https://json-schema.org/draft/2020-12/schema",
    ...schema
  };
}

for (const draft of ["draft2020-12", "draft7"] as const) {
  describe(`JSON Schema Test Suite ${draft}`, () => {
    const directory = path.join(suiteRoot, "tests", draft);
    for (const filename of readdirSync(directory)
      .filter((entry) => entry.endsWith(".json"))
      .sort()) {
      const groups = JSON.parse(
        readFileSync(path.join(directory, filename), "utf8")
      ) as SuiteCase[];
      for (const group of groups) {
        describe(`${filename}: ${group.description}:`, () => {
          let compiled: ReturnType<typeof compileJsonSchema>;
          beforeAll(() => {
            compiled = compileJsonSchema(schemaForDraft(group.schema, draft), { registry });
          });
          for (const testCase of group.tests) {
            it(testCase.description, () => {
              expect(compiled.validate(testCase.data).ok).toBe(testCase.valid);
            });
          }
        });
      }
    }
  });
}
