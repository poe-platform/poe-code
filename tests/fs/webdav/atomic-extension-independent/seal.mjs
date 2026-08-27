import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const own = dirname(import.meta.filename);
const json = async path => JSON.parse(await readFile(join(own, path), "utf8"));
const freeze = await json("evidence/freeze/manifest.json");
const commands = await json("evidence/final/commands.json");
const loaded = await json("evidence/final/loaded-verification.json");
const cohorts = commands.filter(record => /# tests \d+/u.test(record.stdout ?? "")).map(record => ({
  name: record.name, tests: Number(record.stdout.match(/# tests (\d+)/u)[1]),
  passed: Number(record.stdout.match(/# pass (\d+)/u)[1]), failed: Number(record.stdout.match(/# fail (\d+)/u)[1]),
}));
assert.equal(commands.length, 13);
assert.ok(commands.every(record => record.status === 0));
assert.equal(cohorts.length, 8);
assert.equal(cohorts.reduce((total, cohort) => total + cohort.tests, 0), 775);
assert.ok(cohorts.every(cohort => cohort.tests === cohort.passed && cohort.failed === 0));
assert.equal(loaded.loadedModules, 157);
for (const [name, archive] of Object.entries(freeze.archives)) {
  const bytes = await readFile(join(own, `evidence/freeze/${name}.tar.gz`));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), archive.sha256);
}
await writeFile(join(own, "CHECKPOINT.json"), JSON.stringify({
  sealedAt: new Date().toISOString(), candidate: freeze.candidate, approvedPredecessor: freeze.predecessor,
  sourceStatus: "scoped-source-checkpoint-passed", concreteCandidateSourceDefectsReproduced: [],
  serviceStatus: "not-executed-await-frozen-author-evidence-and-explicit-RESUME", blanketApiAcceptance: false,
  originalStockProfile: "78/79 unchanged, not rerun or relabeled", cohorts, packageLoadedModuleVerification: loaded,
  harnessCorrections: [{ cohort: "first", failure: "TS2339 in own capability assertions", correction: "public FileSystem type view; runtime assertion unchanged", originalInputsPreserved: true }],
  authorFiles: "read-only dirty observations only", serviceDownloads: 0, serviceInstalls: 0, servicesStarted: 0,
  primarySourceTextFilesRetrieved: 6, sharedDistWritten: false, ownedTemporaryWorkspacesRemoved: true,
  next: "SERVICE-HOLDOUTS.md: actual authentication, early provider hook/native rmdir, real manager mutation serialization, probes and aliased binding",
}, null, 2) + "\n");
async function walk(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".work-")) throw new Error("owned temporary workspace remains");
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await walk(join(directory, entry.name), `${relative}/`));
    else if (relative !== "ARTIFACTS.sha256") result.push(relative);
  }
  return result;
}
const artifacts = [];
for (const path of (await walk(own)).sort()) artifacts.push(`${createHash("sha256").update(await readFile(join(own, path))).digest("hex")}  ${path}`);
await writeFile(join(own, "ARTIFACTS.sha256"), artifacts.join("\n") + "\n");
console.log({ artifacts: artifacts.length, runtimeTests: 775, loadedModules: 157, servicesStarted: 0 });
