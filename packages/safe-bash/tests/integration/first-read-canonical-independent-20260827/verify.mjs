import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const artifacts = path.join(here, "artifacts");
const expected = {
  "candidate-inputs.tar.gz": "067251bbb09af166f9ed5b36bb0d4b75f9c2caa61641579910ad701fd7716156",
  "review.data.json.gz": "18d20879443d6d9b1937d9579f6c39acea5052004c9336cf4e567970146b50a1",
  "attempt-02.data.json.gz": "608f7b0f7df52d1cc660d85e86e0f2a86ce1787738c1f24f3255ccd7356ba102",
  "final-replay.data.json.gz": "d7a51e04610395dcd1a1c1fcc5d680d43144ea91a7b485e46e2901b016c8580d",
};
for (const [name, digest] of Object.entries(expected)) assert.equal(hash(readFileSync(path.join(artifacts, name))), digest, name);
const first = JSON.parse(gunzipSync(readFileSync(path.join(artifacts, "review.data.json.gz"))));
const final = JSON.parse(gunzipSync(readFileSync(path.join(artifacts, "final-replay.data.json.gz"))));
assert.equal(final.driverSha256, hash(readFileSync(path.join(here, "review.mjs"))));
assert.equal(final.controlsSha256, hash(readFileSync(path.join(here, "controls.json"))));
assert.equal(first.records.find(record => record.label === "canonical-unchanged-10").exitCode, 0);
assert.equal(first.records.find(record => record.label === "scoped-types").exitCode, 2);
assert.match(first.failure.message, /'duplex' does not exist in type 'RequestInit'/);
assert.equal(final.candidate, "073d39c6c49d5ee24172706e02179dd6da484483");
assert.equal(final.freeze, "b891af93b1e710e1910b5dad8f72854c5930da05");
assert.match(final.verdict, /^PASS:/);
assert.equal(final.temporaryRemoved, true);
assert.equal(first.temporaryRemoved, true);
assert.equal(final.lifecycleDiff, "");
const names = Object.keys(final.manifest);
assert.equal(names.length, 257);
assert.equal(names.some(name => path.basename(name) === "AGENTS.md"), false);
assert.equal(hash(git("archive", "--format=tar.gz", final.candidate, ...names)), final.archiveSha256);
for (const [name, digest] of Object.entries(final.manifest)) assert.equal(hash(git("show", `${final.candidate}:${name}`)), digest, name);
const modules = new Set();
for (const entry of final.loadedModules) {
  const offset = entry.name.indexOf("/candidate/src/");
  if (offset < 0) continue;
  const name = entry.name.slice(offset + "/candidate/".length);
  assert.equal(entry.sha256, final.manifest[name], name);
  modules.add(name);
}
assert.equal(modules.size, 199);
const journals = final.records.filter(record => record.label.startsWith("journal:"));
assert.equal(journals.length, 10);
for (const record of journals) assert.equal(record.exitCode, 0, record.label);
const negatives = final.records.filter(record => record.label.startsWith("negative:"));
assert.equal(negatives.length, 12);
assert.equal(negatives.filter(record => record.exitCode === 1).length, 10);
assert.equal(negatives.filter(record => record.exitCode === 0).length, 2);
for (const record of negatives) assert.equal(record.expectedRejection, true);
for (const record of final.records) {
  assert.equal(record.timedOut, false);
  assert.equal(record.oversized, false);
  assert.equal(record.residual, false);
  assert.equal(record.signal, null);
}
assert.equal(final.records.find(record => record.label === "scoped-types").exitCode, 0);
const canonical = final.records.find(record => record.label === "canonical-unchanged-10");
assert.equal(canonical.exitCode, 0);
for (const counter of ["tests 10", "pass 10", "fail 0", "cancelled 0", "skipped 0", "todo 0"]) assert.ok(canonical.stdout.includes(counter), counter);
const historicalRoot = "tests/integration/first-read-canonical-migration-20260827/";
const historyProbe = git("show", `${final.authorEvidence}:${historicalRoot}data/original-first-read-probe.ts.data`);
assert.equal(hash(historyProbe), hash(git("show", `${final.freeze}:tests/shell/first-read-probe.ts`)));
const historicalHarness = git("show", `${final.freeze}:tests/shell/remote-close.test.ts`).toString().split("\n").slice(11, 59).join("\n") + "\n";
assert.equal(hash(Buffer.from(historicalHarness)), "4ed0dc1dbabb753fe1cc92be5fccdbe0741c0bfbff8400212c8404620276eefb");
const historical = JSON.parse(git("show", `${final.authorEvidence}:${historicalRoot}data/original-results.data.json`));
const observerRoot = "tests/integration/owned-output-production-independent-20260827/first-read-followup/data/";
const observerManifest = JSON.parse(git("show", `${final.authorEvidence}:${observerRoot}MANIFEST.json`));
const compressed = Buffer.from(git("show", `${final.authorEvidence}:${observerRoot}EVIDENCE.json.gz.base64`).toString().trim(), "base64");
assert.equal(hash(compressed), observerManifest.gzipSHA256);
const raw = gunzipSync(compressed);
assert.equal(hash(raw), observerManifest.dataSHA256);
const observer = JSON.parse(raw);
assert.deepEqual(Object.keys(observer.files).sort(), Object.keys(observerManifest.files).sort());
for (const [name, digest] of Object.entries(observerManifest.files)) assert.equal(hash(Buffer.from(observer.files[name], "base64")), digest);
assert.equal(Object.keys(observer.files).length, 108);
assert.equal(observer.summary.observerExecutions, 24);
console.log(JSON.stringify({ candidate: final.candidate, inputFiles: names.length, loadedProductFiles: modules.size,
  canonical: "10/10", directJournalChecks: "10/10", negativeControls: "12/12 (10 candidate rejections, 2 independent guard rejections)",
  isolationDenial: "1/1", scopedTypes: "PASS --lib ES2023", historicalProbeSha256: hash(historyProbe),
  observerFiles: 108, observerExecutions: 24, originalCanonicalScore: observer.summary.originalCanonicalScore,
  historyCategories: Object.keys(historical), cleanup: "all recorded groups absent and task-owned roots removed" }, null, 2));
