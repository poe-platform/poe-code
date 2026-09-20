import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { test } from "node:test";
import { compileJsonSchema } from "../dist/index.js";

// Patterns get their conformance gate when the implementation lands; unavailable
// cases are never counted as passes.
const families = [
  "type",
  "const",
  "enum",
  "maximum",
  "minimum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
  "required",
  "dependentRequired",
  "uniqueItems",
  "not",
  "ref",
  "refRemote",
  "defs",
  "definitions",
  "anchor",
  "dynamicRef",
  "vocabulary"
];
const registry = {};
const remoteRoot = new URL(
  "../../toolcraft-schema/test/json-schema-test-suite/remotes/",
  import.meta.url
);
function loadRegistry(directory, prefix = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    const url = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, directory);
    if (entry.isDirectory()) loadRegistry(url, `${path}/`);
    else if (entry.name.endsWith(".json"))
      registry[`http://localhost:1234/${path}`] = JSON.parse(readFileSync(url, "utf8"));
  }
}
loadRegistry(remoteRoot);
for (const draft of ["draft7", "draft2020-12"]) {
  for (const family of families) {
    const file = new URL(
      `../../toolcraft-schema/test/json-schema-test-suite/tests/${draft}/${family}.json`,
      import.meta.url
    );
    if (!existsSync(file)) {
      assert.ok(
        draft === "draft7"
          ? ["dependentRequired", "defs", "anchor", "dynamicRef", "vocabulary"].includes(family)
          : family === "definitions"
      );
      continue;
    }
    const groups = JSON.parse(readFileSync(file, "utf8"));
    for (const group of groups) {
      const schema =
        typeof group.schema === "object" && group.schema !== null
          ? {
              $schema:
                draft === "draft7"
                  ? "http://json-schema.org/draft-07/schema#"
                  : "https://json-schema.org/draft/2020-12/schema",
              ...group.schema
            }
          : group.schema;
      test(`official ${draft} ${family}: ${group.description}`, () => {
        const compiled = compileJsonSchema(schema, { registry });
        for (const entry of group.tests) {
          assert.equal(compiled.validate(entry.data).ok, entry.valid, entry.description);
        }
      });
    }
  }
}
