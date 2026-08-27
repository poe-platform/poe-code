import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const revision = "847dfd766eddbc8f0438f5f999f27ba6a20b8ca7";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const cache = new Map();
function git(args) {
  const result = spawnSync("git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}
function read(path) {
  if (!cache.has(path)) cache.set(path, git(["show", `${revision}:${path}`]));
  return cache.get(path);
}
const scratch = mkdtempSync(join(tmpdir(), "safe-bash-inventory-guard-independent-"));
try {
for (const path of ["tests/plugins/qualified-current-release/inventory-check.mjs",
  "tests/plugins/qualified-current-release/consumers.mjs", "tests/plugins/stream-five-public/current-profile.mjs"]) {
  const target = join(scratch, path); mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, read(path));
  assert.equal(hash(readFileSync(target)), hash(read(path)), `copied frozen helper drift: ${path}`);
}
const { verifyInventory } = await import(pathToFileURL(join(scratch, "tests/plugins/qualified-current-release/inventory-check.mjs")).href);
const { consumerGroups, currentConsumerPaths, negativeGroups } = await import(pathToFileURL(join(scratch, "tests/plugins/qualified-current-release/consumers.mjs")).href);
const inventory = JSON.parse(read("tests/plugins/qualified-current-release/inventory.json"));
const census = git(["ls-tree", "-r", "--name-only", revision]).toString().trim().split("\n");
const excludedPrefix = "tests/integration/stream-five-public/";
const tracked = census.filter(path => !path.startsWith(excludedPrefix));
const current = currentConsumerPaths();
const negatives = negativeGroups.map(group => group.path);
const original = JSON.parse(read("tests/plugins/time-env-public/evidence/release-inventory.json")).rows[1].unclassified;
assert.equal(original.length, 20);
const expected = new Map([
  ["tests/commands/time-env-stress/fix-review/holdout.mts", "frozen-evidence"],
  ...["controls", "public-time-env-unavailable"].map(name => [`tests/commands/time-env-stress/fraction-independent/packed/${name}.mts`, "frozen-evidence"]),
  ...["leaf-negative", "public-negative"].map(name => [`tests/commands/time-env-stress/fraction-independent/packed/${name}.mts`, "negative-types"]),
  ...["leaf-positive", "public-positive"].map(name => [`tests/commands/time-env-stress/fraction-independent/packed/${name}.mts`, "current"]),
  ["tests/fs/webdav/atomic-extension-independent/consumer.mts", "current"],
  ...["consumer", "example", "https"].map(name => [`tests/fs/webdav/atomic-extension/${name}.mts`, "current"]),
  ...["first", "second", "final"].flatMap(stage => ["consumer", "example", "https"].map(name => [`tests/fs/webdav/atomic-extension/evidence/provider-${stage}/inputs/${name}.mts`, "frozen-evidence"])),
]);
assert.equal(expected.size, 20);
const rows = original.map(previous => {
  const entry = inventory.entries.find(candidate => candidate.path === previous.path);
  assert.ok(entry);
  assert.equal(entry.classification, expected.get(entry.path));
  assert.equal(hash(read(entry.path)), previous.sha256, `original input changed: ${entry.path}`);
  const routes = consumerGroups.filter(group => [...group.files, ...group.companions ?? []].includes(entry.path))
    .map(group => ({ name: group.name, runtime: group.runtime, companions: group.companions, qualification: group.qualification }));
  const proofs = (entry.freeze?.evidence ?? []).map(proof => {
    assert.equal(hash(read(proof.path)), proof.sha256);
    return { ...proof, containsInputHash: read(proof.path).includes(entry.sha256) };
  });
  let binding;
  if (entry.freeze) {
    const text = entry.freeze.evidence.map(proof => read(proof.path).toString()).join("\n");
    const sourceExists = git(["cat-file", "-t", entry.freeze.sourceCommit]).toString().trim() === "commit";
    const sourceLinked = text.includes(entry.freeze.sourceCommit);
    const packageLinked = text.includes(entry.freeze.packageSha256 ?? entry.freeze.packageIntegrity);
    const archiveLinked = entry.freeze.archiveSha256 === undefined || text.includes(entry.freeze.archiveSha256);
    assert.ok(sourceExists && sourceLinked && packageLinked && archiveLinked, `frozen identities lack evidence: ${entry.path}`);
    binding = { sourceExists, sourceLinked, packageLinked, archiveLinked, sourceCommit: entry.freeze.sourceCommit,
      packageIdentity: entry.freeze.packageSha256 ?? entry.freeze.packageIntegrity };
  }
  return { path: entry.path, sha256: entry.sha256, classification: entry.classification, routes,
    negative: negativeGroups.find(group => group.path === entry.path), proofs, binding };
});
const counts = verifyInventory(inventory, tracked, current, negatives, read);
const mutations = [];
function mutate(name, expectedRejection, action) {
  let rejected = false, message;
  try { action(); } catch (error) { rejected = true; message = error.message; }
  mutations.push({ name, expectedRejection, rejected, message });
  assert.equal(rejected, expectedRejection, name);
}
const check = (value = inventory, paths = tracked, maintained = current, invalid = negatives, reader = read) =>
  verifyInventory(value, paths, maintained, invalid, reader);
for (const path of ["examples/fresh.test.mts", "src/fresh.mts", "root.test.mts"]) {
  mutate(`unknown tracked input ${path}`, true, () => check(inventory, [...tracked, path]));
}
mutate("current compile-route omitted", true, () => check(inventory, tracked, current.slice(1)));
mutate("negative route omitted", true, () => check(inventory, tracked, current, negatives.slice(1)));
for (const row of rows.filter(row => row.classification === "frozen-evidence")) {
  mutate(`frozen input changed ${row.path}`, true, () => check(inventory, tracked, current, negatives,
    path => path === row.path ? Buffer.from("changed historical input") : read(path)));
}
for (const path of negatives) mutate(`negative bytes changed ${path}`, true, () =>
  check(inventory, tracked, current, negatives, candidate => candidate === path ? Buffer.from("void 0;") : read(candidate)));
const frozen = inventory.entries.find(entry => entry.freeze);
const proof = frozen.freeze.evidence[0];
mutate("frozen proof changed", true, () => check(inventory, tracked, current, negatives,
  path => path === proof.path ? Buffer.from("{}") : read(path)));
mutate("unknown classification", true, () => {
  const changed = structuredClone(inventory); changed.entries[0].classification = "skip"; check(changed);
});
mutate("invented total", true, () => { const changed = structuredClone(inventory); changed.counts.current++; check(changed); });
mutate("single classification downgrade", true, () => {
  const changed = structuredClone(inventory); changed.entries.find(entry => entry.classification === "current").classification = "frozen-evidence"; check(changed);
});
mutate("coupled route/classification downgrade survives current guard", false, () => {
  const changed = structuredClone(inventory);
  const entry = changed.entries.find(candidate => candidate.path.endsWith("/leaf-positive.mts"));
  entry.classification = "frozen-evidence"; changed.counts.current--; changed.counts["frozen-evidence"]++;
  check(changed, tracked, current.filter(path => path !== entry.path));
});
mutate("frozen claimed identity can disagree with authenticated evidence", false, () => {
  const changed = structuredClone(inventory); const entry = changed.entries.find(candidate => candidate.freeze);
  entry.freeze.sourceCommit = "0".repeat(40); entry.freeze.packageSha256 = "0".repeat(64); check(changed);
});
mutate("new path under existing excluded prefix is invisible to census", false, () => {
  check(inventory, [...census, `${excludedPrefix}new.test.mts`].filter(path => !path.startsWith(excludedPrefix)));
});
mutate("canonical runtime omission leaves current inventory guard green", false, () => {
  const groups = structuredClone(consumerGroups); groups.find(group => group.name === "webdav-timestamp-independent").runtime = [];
  const paths = [...new Set(groups.flatMap(group => [...group.files, ...group.companions ?? []]))];
  check(inventory, tracked, paths);
});
const canonical = "tests/fs/webdav/release-timestamp-independent/independent.test.mts";
const canonicalRoute = consumerGroups.find(group => group.files.includes(canonical));
assert.deepEqual(canonicalRoute.runtime, ["independent.test.mjs"]);
assert.equal(canonicalRoute.nodeTests, 23);
console.log(JSON.stringify({ revision, capturedAt: new Date().toISOString(), counts, rows,
  census: { allMts: census.filter(path => path.endsWith(".mts")).length, scopedMts: tracked.filter(path => path.endsWith(".mts")).length,
    explicitlyExcluded: census.filter(path => path.endsWith(".mts") && path.startsWith(excludedPrefix)).map(path => ({ path, sha256: hash(read(path)) })) },
  canonicalRoute, mutations, scope: "Read-only frozen config/provenance and independent in-memory guard mutations; runtime omissions need separate execution repro. No product or private-source writes." }, null, 2));
} finally { rmSync(scratch, { recursive: true, force: true }); }
