import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";
import { compileJsonSchema } from "../dist/index.js";

// These keyword families have landed in this checkpoint. Graph URI resolution,
// dynamic references, vocabularies and patterns get their own conformance gates
// as those implementations land; unavailable cases are never counted as passes.
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
  "not"
];
for (const draft of ["draft7", "draft2020-12"]) {
  for (const family of families) {
    const file = new URL(
      `../../toolcraft-schema/test/json-schema-test-suite/tests/${draft}/${family}.json`,
      import.meta.url
    );
    if (!existsSync(file)) {
      assert.equal(family, "dependentRequired");
      assert.equal(draft, "draft7");
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
        const compiled = compileJsonSchema(schema);
        for (const entry of group.tests) {
          assert.equal(compiled.validate(entry.data).ok, entry.valid, entry.description);
        }
      });
    }
  }
}
