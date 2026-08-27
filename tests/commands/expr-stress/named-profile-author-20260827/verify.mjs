import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: owned, encoding: "utf8" }).trim();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async path => JSON.parse(await readFile(join(owned, path), "utf8"));
const initial = process.argv.length === 3 && process.argv[2] === "--seal";
assert(initial || process.argv.length === 2, "only explicit --seal writes; default verifies read-only");
async function inventory(directory, prefix = "") {
  const entries = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (path === "SEAL.json") continue;
    if (entry.isDirectory()) entries.push({ path, kind: "directory" }, ...await inventory(join(directory, entry.name), path));
    else {
      assert(entry.isFile(), `unexpected entry ${path}`);
      entries.push({ path, kind: "file", sha256: hash(await readFile(join(directory, entry.name))) });
    }
  }
  return entries;
}
const before = await inventory(owned);
const inputs = await json("candidate-03/inputs.json");
const summary = await json("candidate-03/summary.json");
const archive = execFileSync("git", ["archive", inputs.source, ...inputs.paths], { cwd: root, maxBuffer: 32_000_000 });
assert.equal(hash(archive), inputs.archiveSha256, "immutable candidate Git archive");
for (const binding of inputs.harness) assert.equal(hash(await readFile(join(owned, binding.path))), binding.sha256, binding.path);
const design = "tests/commands/expr-stress/named-profile-design-20260827";
execFileSync("git", ["diff", "--exit-code", inputs.designCommit, "--", design], { cwd: root });
execFileSync(process.execPath, [join(root, design, "verify.mjs")], { cwd: root, timeout: 60_000 });
assert.equal(hash(await readFile(join(owned, "candidate-03/historical10.json"))), hash(await readFile(join(root, design, "HISTORICAL10.json"))));
const history = await json("candidate-03/historical10.json");
assert.equal(history.rows.length, 10);
assert(history.rows.every(row => row.comparison.semantic === false && row.comparison.strict === false));
assert.deepEqual(summary.named, { tests: 86, pass: 86, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
assert.deepEqual(summary.legacyNonnative, { tests: 308, pass: 307, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
assert.deepEqual(summary.shared, { tests: 85, pass: 85, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
assert.deepEqual(summary.overlapSubsetNotAdditive, { tests: 48, pass: 47, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
for (const file of ["runtime-C.json", "runtime-named.json"]) {
  const runtime = await json(`candidate-03/${file}`);
  assert.equal(runtime.scalarSuccesses.length, 9);
  assert.equal(runtime.continuedCollationRefusals.length, 1);
  assert.equal(runtime.admissionControls.length, 517);
  assert.equal(runtime.cleanup.activeBeforeSafetyCleanup, 0);
  for (const row of runtime.admissionControls.filter(row => row.id.startsWith("name:"))) {
    if (row.id.endsWith(":substr")) assert.equal(row.argv[0], "substr");
    if (row.id.endsWith(":index")) assert.equal(row.argv[0], "index");
  }
}
const legacy = await json("candidate-03/commands.json");
const failed = legacy.filter(command => command.status !== 0);
assert.deepEqual(failed.map(command => command.name), ["legacy-nonnative-tests", "overlap-tests"]);
assert.equal(hash(await readFile(join(owned, "candidate-02/runtime.mjs.data"))), (await json("candidate-02/inputs.json")).harness.find(binding => binding.path === "runtime.mjs").sha256);
const seal = { source: inputs.source, designCommit: inputs.designCommit, qualification: "author-only named scalar candidate, stale canonical failure retained, independent final review pending", inventory: before };
if (initial) await writeFile(join(owned, "SEAL.json"), JSON.stringify(seal, null, 2) + "\n", { flag: "wx" });
else assert.deepEqual(await json("SEAL.json"), seal, "complete sealed evidence inventory");
assert.deepEqual(await inventory(owned), before, "postcheck detects modifications, removals and new files/directories");
console.log(JSON.stringify({ source: inputs.source, verified: true, sealed: initial,
  inventoryMode: "complete pre/post file and directory inventory; additions detected", staleCanonicalFailures: 1,
  separateOutputContract: "RED; unchanged", independentFinalReview: "pending" }));
