import assert from "node:assert/strict";
import test from "node:test";
import { assertDefaultAcceptance, capture, fixtures } from "./evidence.js";

for (const fixture of fixtures) {
  test(`GNU default-strip parity preserves exact original safety input: ${fixture.id}`, async () => {
    const result = await capture(fixture, []);
    assertDefaultAcceptance(fixture, result);
  });

  test(`selected-path policy rejects retained -p0 parent before effects: ${fixture.id}`, async () => {
    const result = await capture(fixture, ["-p0"]);
    assert.equal(result.product.exitCode, 2);
    assert.equal(result.product.stdout, "");
    assert.match(result.product.stderr, fixture.id === "independent-file-parent" ? /not a directory/u : /symlink/u);
    assert.deepEqual(result.product.mutations, []);
    assert.deepEqual(result.product.after, result.product.before);

  });
}
