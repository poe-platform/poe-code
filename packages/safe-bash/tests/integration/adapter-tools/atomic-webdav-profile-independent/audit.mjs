import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const cohort = join(here, "evidence/independent-second");
const json = name => JSON.parse(readFileSync(join(cohort, name), "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(existsSync(join(here, "ARTIFACTS.sha256")), false, "do not overwrite an evidence seal");
assert.equal(json("gate.json").passed, true);
const summary = json("summary.json");
for (const [name, tests, pass] of [["original-stock79", 79, 78], ["packed-stock79", 79, 78], ["configured79", 79, 79],
  ["author-controls22", 22, 22], ["independent-hidden", 27, 27], ["hidden-restored", 27, 27]]) {
  assert.deepEqual(summary.counts[name], { tests, pass, fail: tests - pass, cancelled: 0, skipped: 0, todo: 0 });
}
for (const name of ["verify.mjs", "observe.mjs", "hidden.ts"]) {
  assert.deepEqual(readFileSync(join(here, name)), readFileSync(join(cohort, "verifier-inputs", `${name}.txt`)));
}
for (const name of ["independent-first", "independent-second"]) {
  const cleanup = JSON.parse(readFileSync(join(here, "evidence", name, "cleanup.json")));
  assert.equal(cleanup.removed, true);
  assert.equal(existsSync(cleanup.scratch), false);
}
assert.deepEqual(readdirSync(here).filter(name => name.startsWith(".isolated-")), []);
const capture = json("capture.json");
assert.equal(sha256(readFileSync(join(cohort, "frozen-inputs.tar.gz"))), capture.archiveSha256);
assert.equal(sha256(readFileSync(join(cohort, "virtual-bash-0.0.0.tgz"))), summary.seals.packSha256);
assert.equal(sha256(JSON.stringify(json("built-manifest.json"))), summary.seals.generatedBuildSha256);
for (const [name, closure] of Object.entries(json("module-closures.json"))) {
  const raw = readFileSync(join(cohort, `${name}.modules.jsonl`));
  assert.equal(sha256(raw), closure.eventLogSha256);
  const events = raw.toString().trim().split("\n").map(line => JSON.parse(line));
  assert.equal(events.length, closure.events);
  assert.equal(new Set(events.filter(event => event.kind === "load").map(event => event.path)).size, closure.loadedFiles);
}
const mutations = json("mutation-results.json");
assert.equal(mutations.length, 10);
for (const mutant of mutations) {
  assert.equal(mutant.status, 1);
  assert.equal(mutant.counts.tests, 27);
  assert.ok(mutant.counts.fail > 0);
  assert.equal(mutant.counts.cancelled + mutant.counts.skipped + mutant.counts.todo, 0);
  assert.equal(sha256(readFileSync(join(cohort, "mutants", `${mutant.name}.js.txt`))), mutant.inputSha256);
}
const originalPaths = ["tests/integration/adapter-tools/matrix.test.ts", "tests/integration/adapter-tools/fixtures.ts",
  "tests/integration/adapter-tools/preflight-review/preflight.ts", "tests/fs/webdav/mock.ts",
  "tests/integration/adapter-tools/atomic-webdav-profile/atomic-mock.ts", "tests/integration/adapter-tools/atomic-webdav-profile/controls.ts"];
execFileSync("git", ["diff", "--exit-code", summary.frozen, "--", ...originalPaths], { cwd: root });
execFileSync("git", ["diff", "--exit-code", summary.checkpoint, "--", "tests/integration/adapter-tools/atomic-webdav-profile"], { cwd: root });
const result = {
  completedAt: new Date().toISOString(), currentHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  currentSourceTree: execFileSync("git", ["rev-parse", "HEAD:src"], { cwd: root, encoding: "utf8" }).trim(),
  frozenSourceTree: capture.sourceTree, successfulCaptureHead: capture.liveHead,
  originalInputsAndEntireAuthorSubtreeUnchanged: true, executableVerifierInputsMatchSuccessfulRun: true,
  artifactsAndModuleLogSealsVerified: true, allOwnedScratchRemoved: true,
  scope: "audit of recorded frozen qualification; current HEAD and live source are not retested by this audit",
};
writeFileSync(join(here, "FINAL_AUDIT.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
const files = readdirSync(here, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
  .map(entry => join(entry.parentPath, entry.name)).sort();
const manifest = files.map(path => `${sha256(readFileSync(path))}  ${relative(here, path)}`).join("\n");
writeFileSync(join(here, "ARTIFACTS.sha256"), `${manifest}\n`, { flag: "wx" });
console.log(JSON.stringify({ ...result, sealedArtifacts: files.length }, null, 2));
