import assert from "node:assert/strict";
import { sha256 } from "../stream-five-public/current-profile.mjs";

export function verifyInventory(inventory, tracked, currentPaths, negativePaths, read) {
  const paths = tracked.filter(path => path.endsWith(".mts")).sort();
  assert.deepEqual(paths, inventory.entries.map(entry => entry.path).sort(), "standalone inventory changed; classify new paths explicitly before qualification");
  assert.equal(new Set(paths).size, paths.length);
  assert.deepEqual([...new Set(currentPaths)].sort(), inventory.entries.filter(entry => entry.classification === "current").map(entry => entry.path).sort(), "current consumers must have an explicit compile/runtime route");
  assert.deepEqual([...negativePaths].sort(), inventory.entries.filter(entry => entry.classification === "negative-types").map(entry => entry.path).sort(), "negative consumers must have exact-diagnostic routes");
  const allowed = new Set(["current", "negative-types", "declaration", "frozen-evidence", "frozen-oracle"]);
  const counts = {};
  for (const entry of inventory.entries) {
    assert.ok(allowed.has(entry.classification), `unknown classification: ${entry.path}`);
    counts[entry.classification] = (counts[entry.classification] ?? 0) + 1;
    if (entry.classification !== "current") assert.equal(sha256(read(entry.path)), entry.sha256, `historical/declaration/negative inventory changed: ${entry.path}`);
    if (entry.freeze) {
      assert.match(entry.freeze.sourceCommit, /^[a-f0-9]{40}$/u);
      assert.ok(entry.freeze.packageSha256 || entry.freeze.packageIntegrity, `missing frozen package identity: ${entry.path}`);
      assert.ok(entry.freeze.evidence.length > 0);
      for (const evidence of entry.freeze.evidence) assert.equal(sha256(read(evidence.path)), evidence.sha256, `frozen evidence changed: ${evidence.path}`);
    }
  }
  assert.deepEqual(counts, inventory.counts, "inventory totals disagree with entries");
  return counts;
}
