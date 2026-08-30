import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { join } from "node:path";
import { consumerGroups, currentConsumerPaths, currentSourceConsumerGroups, negativeGroups } from "../tests/plugins/qualified-current-release/consumers.mjs";
import { verifyInventory } from "../tests/plugins/qualified-current-release/inventory-check.mjs";
import { verifyStagedTypeInputs } from "./typecheck-staged-inputs.mjs";
import { integrationExclusions, loadBoundaries, readTypecheckInventories } from "./integration-inputs.mjs";
import { assertAdmittedInputPath, isHeldInputPath, readIntegrationTypeInputs, readRegularInput } from "./typecheck-integration-inputs.mjs";
import { assertSafeOutputDirectory } from "../../../scripts/guard-package-dist.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export function verifyAdmittedStandaloneInventory(inventory, tracked, currentPaths, negativePaths, read, boundaries) {
  const paths = inventory.entries.map(entry => entry.path);
  assert.deepEqual(tracked.filter(path => path.endsWith(".mts")).sort(), [...paths].sort(), "standalone inventory changed; classify new paths explicitly before qualification");
  assert.equal(new Set(paths).size, paths.length);
  const counts = {}, admittedCounts = {}, entries = [], heldEvidence = [];
  for (const entry of inventory.entries) {
    counts[entry.classification] = (counts[entry.classification] ?? 0) + 1;
    if (isHeldInputPath(entry.path, boundaries)) {
      assert.ok(["frozen-evidence", "frozen-oracle"].includes(entry.classification), `current/declaration/negative input cannot be withheld: ${entry.path}`);
      heldEvidence.push({ path: entry.path, classification: entry.classification, evidence: (entry.freeze?.evidence ?? []).map(evidence => evidence.path), contentVerified: false });
    } else {
      for (const evidence of entry.freeze?.evidence ?? []) assertAdmittedInputPath(evidence.path, boundaries);
      entries.push(entry);
      admittedCounts[entry.classification] = (admittedCounts[entry.classification] ?? 0) + 1;
    }
  }
  assert.deepEqual(counts, inventory.counts, "inventory totals disagree with entries");
  const withheld = new Set(heldEvidence.map(entry => entry.path));
  const checked = verifyInventory({ ...inventory, entries, counts: admittedCounts }, tracked.filter(path => !withheld.has(path)), currentPaths, negativePaths, read);
  return { checked, heldEvidence, qualification: "Held historical entries remain inventoried but their contents and seals are not read or verified; all current and negative routes remain required" };
}

export function verifyTypecheckInputs(root, fileSystem = fs) {
  const boundaries = loadBoundaries(root, fileSystem);
  const { captured: classification, inventory: originalInventory } = readTypecheckInventories(root, boundaries, fileSystem);
  const read = path => readRegularInput(root, path, 16 * 1024 * 1024, fileSystem, boundaries);
  const config = JSON.parse(read("tsconfig.json"));
  const staged = verifyStagedTypeInputs(root, consumerGroups, fileSystem);
  const integrationTypes = readIntegrationTypeInputs(root, boundaries, fileSystem);
  assert.deepEqual(config.include, ["src/**/*.ts", "tests/**/*.ts"], "current source/test coverage must remain enabled");
  assert.deepEqual(config.exclude, [...classification.existingExclusions, ...classification.entries.map(entry => entry.path), ...staged.entries.map(entry => entry.path), ...integrationExclusions(boundaries), ...integrationTypes.capturedPaths], "type-data exclusions must be the exact authenticated entries and integration boundaries, not a directory or extension wildcard");
  for (const evidence of classification.evidence) assert.equal(sha256(read(evidence.path)), evidence.sha256, `frozen capture evidence changed: ${evidence.path}`);
  const provenance = JSON.parse(read(classification.provenance));
  for (const entry of classification.entries) {
    const bytes = read(entry.path);
    assert.equal(bytes.length, entry.bytes, `captured data length changed: ${entry.path}`);
    assert.equal(sha256(bytes), entry.sha256, `captured data changed: ${entry.path}`);
    assert.equal(provenance.inputs.find(input => input.path === entry.originalPath)?.sha256, entry.sha256, `captured original identity missing: ${entry.path}`);
    read(entry.originalPath);
  }
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString().split("\0").filter(Boolean);
  for (const entry of staged.entries) assert.ok(tracked.includes(entry.path) && tracked.includes(entry.owner.path), `staged input and owning manifest must be tracked: ${entry.path}`);
  const inventory = {
    ...originalInventory,
    entries: [...originalInventory.entries, ...integrationTypes.standaloneEntries],
    counts: { ...originalInventory.counts, "frozen-evidence": originalInventory.counts["frozen-evidence"] + integrationTypes.standaloneEntries.length },
  };
  const classified = new Set(inventory.entries.map(entry => entry.path));
  const unknown = tracked.filter(path => path.endsWith(".mts") && !classified.has(path));
  assert.equal(unknown.length, 0, `Unclassified current .mts inputs require an explicit existing-inventory route: ${unknown.join(", ")}`);
  const standaloneAdmission = verifyAdmittedStandaloneInventory(inventory, tracked, currentConsumerPaths(), negativeGroups.map(group => group.path), read, boundaries);
  for (const path of currentConsumerPaths()) read(path);
  for (const group of currentSourceConsumerGroups) for (const path of group.files) {
    assert.ok(tracked.includes(path), `current source consumer is not tracked: ${path}`);
    read(path);
    assert.ok(!config.exclude.includes(path), `current source consumer excluded: ${path}`);
  }
  return { capturedData: classification.entries.length, stagedInputs: staged.entries.map(({ path, role, currentGroup }) => ({ path, role, currentGroup })), currentSourceConsumerGroups, standaloneInventory: inventory.counts, standaloneAdmission, integrationTypeEvidence: { capturedPaths: integrationTypes.capturedPaths, standaloneEntries: integrationTypes.standaloneEntries, cohorts: integrationTypes.cohorts } };
}

export function requireBuiltPackage(root) {
  const pkg = JSON.parse(readRegularInput(root, "package.json", 300000));
  const paths = Object.values(pkg.exports).flatMap(entry => [entry.types, entry.import]).filter(path => path && !path.includes("*"));
  const missing = [...new Set(paths)].filter(path => !fs.existsSync(join(root, path)));
  if (missing.length) {
    const error = new Error(`Built-package prerequisite missing (${missing.length} files). Run npm run typecheck:all to build once and check source plus current consumers, or npm run build before npm run typecheck. No consumer compilation was attempted.`);
    error.code = "TYPECHECK_BUILD_REQUIRED";
    throw error;
  }
}

export async function buildForTypecheck(root, compile, fileSystem) {
  await assertSafeOutputDirectory(root, join(root, "dist"), fileSystem);
  if (compile("build", ["-p", "tsconfig.build.json"]).status !== 0) throw new Error("Production build failed; stale declarations will not be used for consumer checks.");
}
