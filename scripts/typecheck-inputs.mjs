import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { consumerGroups, currentConsumerPaths, currentSourceConsumerGroups, negativeGroups, ownerPath } from "../tests/plugins/qualified-current-release/consumers.mjs";
import { verifyInventory } from "../tests/plugins/qualified-current-release/inventory-check.mjs";
import { verifyStagedTypeInputs } from "./typecheck-staged-inputs.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const classification = JSON.parse(readFileSync(new URL("../tests/plugins/qualified-current-release/captured-types.json", import.meta.url)));

export function verifyTypecheckInputs(root) {
  const config = JSON.parse(readFileSync(join(root, "tsconfig.json")));
  const staged = verifyStagedTypeInputs(root, consumerGroups);
  assert.deepEqual(config.include, ["src/**/*.ts", "tests/**/*.ts"], "current source/test coverage must remain enabled");
  assert.deepEqual(config.exclude, [...classification.existingExclusions, ...classification.entries.map(entry => entry.path), ...staged.entries.map(entry => entry.path)], "type-data exclusions must be the exact authenticated entries, not a directory or extension wildcard");
  for (const evidence of classification.evidence) assert.equal(sha256(readFileSync(join(root, evidence.path))), evidence.sha256, `frozen capture evidence changed: ${evidence.path}`);
  const provenance = JSON.parse(readFileSync(join(root, classification.provenance)));
  for (const entry of classification.entries) {
    const bytes = readFileSync(join(root, entry.path));
    assert.equal(bytes.length, entry.bytes, `captured data length changed: ${entry.path}`);
    assert.equal(sha256(bytes), entry.sha256, `captured data changed: ${entry.path}`);
    assert.equal(provenance.inputs.find(input => input.path === entry.originalPath)?.sha256, entry.sha256, `captured original identity missing: ${entry.path}`);
    assert.ok(existsSync(join(root, entry.originalPath)), `current contract source is missing: ${entry.originalPath}`);
  }
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString().split("\0").filter(Boolean);
  for (const entry of staged.entries) assert.ok(tracked.includes(entry.path) && tracked.includes(entry.owner.path), `staged input and owning manifest must be tracked: ${entry.path}`);
  const inventory = JSON.parse(readFileSync(join(root, ownerPath, "inventory.json")));
  const classified = new Set(inventory.entries.map(entry => entry.path));
  const unknown = tracked.filter(path => path.endsWith(".mts") && !classified.has(path));
  assert.equal(unknown.length, 0, `Unclassified current .mts inputs require an explicit existing-inventory route: ${unknown.join(", ")}`);
  verifyInventory(inventory, tracked, currentConsumerPaths(), negativeGroups.map(group => group.path), path => readFileSync(join(root, path)));
  for (const path of currentConsumerPaths()) assert.ok(existsSync(join(root, path)), `current standalone consumer is missing: ${path}`);
  for (const group of currentSourceConsumerGroups) for (const path of group.files) {
    assert.ok(tracked.includes(path), `current source consumer is not tracked: ${path}`);
    assert.ok(existsSync(join(root, path)), `current source consumer is missing: ${path}`);
    assert.ok(!config.exclude.includes(path), `current source consumer excluded: ${path}`);
  }
  return { capturedData: classification.entries.length, stagedInputs: staged.entries.map(({ path, role, currentGroup }) => ({ path, role, currentGroup })), currentSourceConsumerGroups, standaloneInventory: inventory.counts };
}

export function requireBuiltPackage(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json")));
  const paths = Object.values(pkg.exports).flatMap(entry => [entry.types, entry.import]).filter(path => path && !path.includes("*"));
  const missing = [...new Set(paths)].filter(path => !existsSync(join(root, path)));
  if (missing.length) {
    const error = new Error(`Built-package prerequisite missing (${missing.length} files). Run npm run typecheck:all to build once and check source plus current consumers, or npm run build before npm run typecheck. No consumer compilation was attempted.`);
    error.code = "TYPECHECK_BUILD_REQUIRED";
    throw error;
  }
}
