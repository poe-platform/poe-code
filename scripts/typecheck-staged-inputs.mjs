import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export const stagedClassificationPath = "tests/plugins/qualified-current-release/staged-types.json";

export function verifyStagedTypeInputs(root, groups) {
  const classification = JSON.parse(readFileSync(join(root, stagedClassificationPath)));
  assert.equal(classification.schema, 1, "unsupported staged-type classification");
  const roles = new Set(["sealed-capture", "versioned-template", "reusable-template"]);
  const paths = new Set();
  const readRegular = path => {
    assert.ok(lstatSync(join(root, path)).isFile(), `staged input must be a regular file: ${path}`);
    return readFileSync(join(root, path));
  };
  for (const entry of classification.entries) {
    assert.ok(roles.has(entry.role), `unknown staged-input role: ${entry.path}`);
    assert.match(entry.path, /^tests\/.*\/consumer\.ts$/u);
    assert.ok(!entry.path.split("/").some(part => [".", ".."].includes(part)) && !/[*?{}[\]\\]/u.test(entry.path), "staged exclusions must be literal file paths");
    assert.ok(!paths.has(entry.path), `duplicate staged input: ${entry.path}`);
    paths.add(entry.path);
    const bytes = readRegular(entry.path);
    assert.equal(bytes.length, entry.bytes, `staged input length changed: ${entry.path}`);
    assert.equal(digest(bytes), entry.sha256, `staged input changed: ${entry.path}`);
    const ownerBytes = readRegular(entry.owner.path);
    assert.equal(digest(ownerBytes), entry.owner.sha256, `staged owning manifest changed: ${entry.owner.path}`);
    const owner = JSON.parse(ownerBytes);
    assert.ok(["files", "harness.inputs"].includes(entry.owner.collection), "unknown owning-manifest collection");
    const records = entry.owner.collection === "files" ? owner.files : owner.harness?.inputs;
    const matches = records?.filter(record => record.path === entry.owner.input);
    assert.equal(matches?.length, 1, `owning manifest must bind exactly one input: ${entry.path}`);
    assert.equal(matches[0].sha256, entry.sha256, `owning input identity differs: ${entry.path}`);
    assert.equal(matches[0].bytes, entry.bytes, `owning input length differs: ${entry.path}`);
    const route = groups.find(group => group.name === entry.currentGroup);
    assert.ok(route?.localPackage === true && route.runtime.length > 0, `staged input requires a maintained local-package runtime route: ${entry.path}`);
    for (const path of [...route.files, ...route.companions ?? []]) readRegular(path);
  }
  return classification;
}
