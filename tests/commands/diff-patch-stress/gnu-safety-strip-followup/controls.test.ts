import assert from "node:assert/strict";
import test from "node:test";
import { assertDefaultAcceptance, capture, fixtures, semanticNamespace } from "./evidence.js";

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
    const fileParent = fixture.id === "independent-file-parent";
    assert.equal(result.native.exitCode, fileParent ? 1 : 0);
    assert.equal(result.native.stderr, "");
    assert.equal(result.native.stdout, ("first" in fixture.files ? "patching file first\n" : "")
      + (fileParent ? "Invalid file name blocker/child -- skipping patch\n" : `patching file ${fixture.retainedPath}\n`));
    const modifiedPaths = [
      ...("first" in fixture.files ? [`${fixture.cwd}/first`] : []),
      ...(fileParent ? [] : [`${fixture.cwd}/dir/target`]),
    ];
    const expected = semanticNamespace(result.native.before).map(entry => modifiedPaths.includes(entry.path)
      ? { ...entry, data: Buffer.from("new\n").toString("hex") } : entry);
    assert.deepEqual(semanticNamespace(result.native.after), expected);
    const ignoredBefore = result.native.before.filter(entry => !modifiedPaths.includes(entry.path));
    const ignoredAfter = result.native.after.filter(entry => !modifiedPaths.includes(entry.path));
    assert.deepEqual(ignoredAfter, ignoredBefore);
  });
}
