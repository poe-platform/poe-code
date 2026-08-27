import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { candidate, cases } from "./cases.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const hash = value => createHash("sha256").update(value).digest("hex");
const read = name => JSON.parse(readFileSync(join(root, name)));
const artifacts = read("evidence/ARTIFACTS.json");
for (const [name, expected] of Object.entries(artifacts.files)) {
  const filename = join(root, "evidence", name);
  assert.equal(lstatSync(filename).isFile(), true, name);
  assert.equal(hash(readFileSync(filename)), expected, name);
}
const initial = read("evidence/attempt-01/report.json");
const final = read("evidence/attempt-02/report.json");
for (const [attempt, report] of [["01", initial], ["02", final]]) {
  assert.equal(report.candidate, candidate);
  assert.deepEqual(report.privateBefore, report.privateAfter);
  assert.equal(report.privateUnchanged, true);
  assert.equal(report.frozenInputsUnchanged, true);
  assert.equal(report.temporaryRemoved, true);
  assert.equal(report.parentAliveAfterRealEngine, true);
  assert.ok(report.children.every(child => child.waitedForClose && child.groupGone && !child.groupRemainingAfterClose));
  assert.ok(report.commands.every(command => !command.killedReason && !command.signal));
  assert.equal(report.commands.find(command => command.label === "public-package-build").status, 0);
  const imports = readFileSync(join(root, `evidence/attempt-${attempt}/imports.ndjson`), "utf8").trim().split("\n").map(line => JSON.parse(line));
  for (const entry of imports) {
    if (entry.kind === "actual-engine-source-copy") assert.equal(entry.sha256, report.engineCopy[entry.path.slice("engine/".length)].sha256);
    if (entry.kind === "packed-public-product") assert.equal(entry.sha256, report.installedFiles[entry.path.slice("consumer/node_modules/virtual-bash/".length)].sha256);
  }
  assert.ok(report.loadedEngineFiles["src/run.ts"] && report.loadedEngineFiles["src/interp/interpreter.ts"]);
  assert.ok(report.loadedPublicFiles["dist/index.js"]);
}
assert.equal(initial.status, "bounded-cases-fail");
assert.deepEqual(initial.counts, { pass: 0, fail: 13, frozen: 13 });
assert.equal(final.status, "bounded-cases-pass");
assert.deepEqual(final.counts, { pass: 13, fail: 0, frozen: 13 });
assert.equal(final.guestProcessStatus.status, 0);
assert.equal(initial.guestProcessStatus.status, 1);
assert.equal(initial.fullArchiveSha256, final.fullArchiveSha256);
assert.equal(initial.package.sha256, final.package.sha256);
assert.deepEqual(initial.productSources, final.productSources);
assert.deepEqual(initial.engineCopy, final.engineCopy);
for (const [name, digest] of Object.entries(final.harnessFiles)) assert.equal(hash(readFileSync(join(root, name))), digest, name);
for (const [name, digest] of Object.entries(initial.harnessFiles)) assert.equal(hash(readFileSync(join(root, "evidence/attempt-01/inputs", name + ".txt"))), digest, name);
assert.deepEqual(final.events.filter(event => event.type === "pass").map(event => event.name), cases.map(testCase => testCase.name));
const observations = final.events.filter(event => event.type === "observation");
assert.equal(observations.reduce((sum, event) => sum + event.effects.runnerCalls, 0), 17);
assert.equal(observations.reduce((sum, event) => sum + event.effects.hostCleanups, 0), 15);
for (const event of final.events.filter(event => event.type === "cleanup")) {
  assert.equal(event.hostCleanups, event.admittedContexts);
  assert.deepEqual(event.effects.writes, []);
  assert.deepEqual(event.resources, ["PipeWrap", "PipeWrap"]);
}
console.log("Evidence verified: both attempts retained; corrected 13/13, 17 real runner entries, 15 host-only cleanup markers; source/import hashes and owned process retirement match.");
