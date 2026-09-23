import assert from "node:assert/strict";
import { test } from "node:test";
import { cases, contextChange, marker } from "./fixtures.js";
import { product, productIssues } from "./helpers.js";

for (const fixture of cases) {
  test(fixture.id, { timeout: 5000 }, async () => {
    const result = await product(fixture);
    assert.deepEqual(productIssues(fixture, result), [], JSON.stringify({ id: fixture.id, before: fixture.before, patch: fixture.patch, options: fixture.options }));
  });
}

// GNU patch accepts surplus markers after a complete new context side. The first
// marker still controls the replacement's EOF, including an untouched suffix.
for (const count of [1, 2, 3]) for (const suffix of ["", "keep\nend\n", "keep\nend"]) for (const atomic of [false, true]) {
  test(`context trailing markers=${count}, suffix=${JSON.stringify(suffix)}, atomic=${atomic}`, async () => {
    const fixture = {
      id: "context-trailing-newline-markers", category: "GNU trailing newline markers",
      before: `old\n${suffix}`, patch: contextChange + marker.repeat(count),
      after: suffix ? `new\n${suffix}` : "new",
      args: ["--batch", "--forward", ...(atomic ? ["--atomic"] : [])],
    };
    const result = await product(fixture);
    assert.deepEqual(productIssues(fixture, result), []);
    assert.equal(result.stdout, "patching file /work/target\n");
    assert.equal(result.stderr, "");
    assert.deepEqual(result.mutations, ["writeFile:/work/target"]);
  });
}
