import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { compileJsonSchema } from "../dist/index.js";

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
  const directory = new URL(
    `../../toolcraft-schema/test/json-schema-test-suite/tests/${draft}/`,
    import.meta.url
  );
  for (const filename of readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()) {
    const file = new URL(filename, directory);
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
      test(`official ${draft} ${filename}: ${group.description}`, () => {
        const compiled = compileJsonSchema(schema, { registry });
        for (const entry of group.tests) {
          assert.equal(compiled.validate(entry.data).ok, entry.valid, entry.description);
        }
      });
    }
  }
}
