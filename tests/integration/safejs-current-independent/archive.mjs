import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const owned = dirname(fileURLToPath(import.meta.url)), repository = resolve(owned, "../../..");
assert.equal(process.argv.length, 7, "archive.mjs INITIAL_BASELINE INITIAL_FIXED CORRECTED_BASELINE FINAL INITIAL_PROBE_JSON");
const labels = ["initial-baseline", "initial-fixed", "baseline", "final"];
const inputs = process.argv.slice(2, 6).map(value => resolve(value));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const reports = Object.fromEntries(labels.map((label, index) => [label, JSON.parse(readFileSync(join(inputs[index], "report.json"), "utf8"))]));
const final = reports.final, baseline = reports.baseline;
const childEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { env: childEnv, encoding: "utf8" });
const write = (name, value) => {
  const path = join(owned, "evidence", name); assert.equal(existsSync(path), false, "Never overwrite captured evidence");
  const text = JSON.stringify(value, null, 2) + "\n";
  execFileSync("apply_patch", [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
};
assert.deepEqual(baseline.cohorts["author-public"].counts, { pass: 24, fail: 2, skip: 0 });
assert.deepEqual(baseline.cohorts["independent-public"].counts, { pass: 31, fail: 7, skip: 0 });
assert.deepEqual(final.cohorts["author-public"].counts, { pass: 26, fail: 0, skip: 0 });
assert.deepEqual(final.cohorts["independent-public"].counts, { pass: 38, fail: 0, skip: 0 });
assert.equal(baseline.ownInputs["boundary.probe.mjs"].sha256, final.ownInputs["boundary.probe.mjs"].sha256);
const originalState = reports["initial-baseline"].privateBefore;
for (const report of Object.values(reports)) {
  assert.equal(report.status, "captured"); assert.equal(report.privateUnchanged, true); assert.equal(report.temporaryRemoved, true); assert.equal(existsSync(report.temporary), false);
  assert.deepEqual(report.privateBefore, originalState); assert.deepEqual(report.privateAfter, originalState);
  assert.deepEqual(report.engineCopy, originalState.engine); assert.deepEqual(report.authorHarness, final.authorHarness);
  assert.equal(report.types.baseline.diagnostics.length, 111); assert.equal(report.types.integration.diagnostics.length, 111);
  assert.deepEqual(report.types.introduced, []); assert.deepEqual(report.types.removed, []); assert.equal(report.engineTypes.diagnostics.length, 8);
  assert.deepEqual(report.engineTypes.diagnostics, final.engineTypes.diagnostics);
}
for (const name of ["run.mjs", "boundary.probe.mjs"]) assert.equal(sha(readFileSync(join(owned, name))), final.ownInputs[name].sha256, name);
const get = (revision, path) => git(repository, "show", `${revision}:${path}`);
const beforeStress = get("034a5f0^", "tests/commands/safejs-stress/upstream-limitations.test.ts"), afterStress = get("034a5f0", "tests/commands/safejs-stress/upstream-limitations.test.ts");
const marker = 'test("KNOWN UPSTREAM LIMITATION: raw ordinary env loses __proto__';
assert.equal(beforeStress.slice(beforeStress.indexOf(marker)), afterStress.slice(afterStress.indexOf(marker)));
const beforeLocal = get("034a5f0^", "tests/commands/safejs/local-safejs.test.ts"), afterLocal = get("034a5f0", "tests/commands/safejs/local-safejs.test.ts");
const startBefore = 'test("upstream observation, not constructor support:', startAfter = 'test("actual current engine preserves constructed Error messages', end = 'test("real SafeJS cancellation stops a pending guest read';
assert.equal(beforeLocal.slice(0, beforeLocal.indexOf(startBefore)) + beforeLocal.slice(beforeLocal.indexOf(end)), afterLocal.slice(0, afterLocal.indexOf(startAfter)) + afterLocal.slice(afterLocal.indexOf(end)));
assert.equal(git(repository, "diff", "034a5f0^", "034a5f0", "--", "src"), "");
assert.deepEqual(final.cohorts["eight-before"].counts, { pass: 0, fail: 8, skip: 0 });
assert.deepEqual(final.cohorts["eight-after"].counts, { pass: 8, fail: 0, skip: 0 });
const unavailable = new Map(final.cohorts["unavailable-engine"].cases.map(entry => [entry.name, entry.outcome]));
const classification = {};
for (const label of ["conventional", "bridges"]) {
  const groups = {};
  for (const entry of final.cohorts[label].cases) {
    const kind = entry.name.startsWith("KNOWN UPSTREAM LIMITATION:") ? "defect-characterization" : /structurally assignable/u.test(entry.name) ? "structural-type-probe" : unavailable.get(entry.name) === "skip" ? "actual-engine-behavior" : "fixture-or-configuration";
    (groups[kind] ??= []).push({ name: entry.name, outcome: entry.outcome });
  }
  classification[label] = groups;
}
const proposal = JSON.parse(readFileSync(join(repository, "docs/upstream-patches/safejs/patch-manifest.json"), "utf8"));
const proposalHashes = Object.fromEntries(Object.entries(proposal.files).map(([path, expected]) => {
  const actual = final.engineCopy[path.replace("packages/safejs/", "")].sha256;
  return [path, { actual, proposed: expected.after, equalsProposal: actual === expected.after }];
}));
const processes = [];
for (let index = 0; index < labels.length; index++) {
  const pids = new Set();
  for (const name of readdirSync(inputs[index]).filter(name => name.endsWith(".imports.ndjson"))) {
    for (const line of readFileSync(join(inputs[index], name), "utf8").trim().split("\n")) pids.add(JSON.parse(line).pid);
  }
  for (const pid of pids) {
    let absent = false; try { process.kill(pid, 0); } catch (error) { assert.equal(error.code, "ESRCH"); absent = true; }
    assert.equal(absent, true, `Review child PID still exists: ${pid}`); processes.push({ cohort: labels[index], pid, absent });
  }
}
const privateRoot = final.privateRoot;
const privateAfter = { head: git(privateRoot, "rev-parse", "HEAD").trim(), status: git(privateRoot, "status", "--porcelain=v1"), index: sha(readFileSync(resolve(privateRoot, git(privateRoot, "rev-parse", "--git-path", "index").trim()))), metadata: {}, engine: {} };
for (const path of Object.keys(originalState.metadata)) privateAfter.metadata[path] = sha(readFileSync(join(privateRoot, path)));
const visit = directory => {
  for (const name of readdirSync(directory).sort()) {
    if (["node_modules", ".git", "dist", ".cache", ".turbo"].includes(name)) continue;
    const path = join(directory, name), stat = lstatSync(path); assert.equal(stat.isSymbolicLink(), false);
    if (stat.isDirectory()) visit(path); else { assert.ok(stat.isFile()); privateAfter.engine[relative(join(privateRoot, "packages/safejs"), path)] = { sha256: sha(readFileSync(path)), mode: stat.mode & 0o777 }; }
  }
};
visit(join(privateRoot, "packages/safejs")); assert.deepEqual(privateAfter, originalState);
const artifacts = {};
for (let index = 0; index < labels.length; index++) {
  const label = labels[index], directory = inputs[index];
  write(label + "/report.json", reports[label]);
  const raw = {}, hashes = {};
  for (const name of readdirSync(directory).sort()) {
    if (name === "report.json") continue;
    const bytes = readFileSync(join(directory, name)); raw[name] = bytes.toString("base64"); hashes[name] = sha(bytes);
  }
  const bytes = Buffer.from(JSON.stringify(raw)), compressed = gzipSync(bytes, { level: 9 });
  assert.deepEqual(gunzipSync(compressed), bytes);
  write(label + "/raw-artifacts.json", { format: "gzip-base64 of JSON mapping filename to base64 original bytes", fileHashes: hashes, jsonSha256: sha(bytes), gzipSha256: sha(compressed), payload: compressed.toString("base64") });
  artifacts[label] = { reportSha256: sha(readFileSync(join(directory, "report.json"))), rawFileCount: Object.keys(raw).length, gzipSha256: sha(compressed) };
}
write("initial-probe.json", JSON.parse(readFileSync(process.argv[6], "utf8")));
write("fixture-delta.json", { commit: git(repository, "rev-parse", "034a5f0").trim(), fullDiff: git(repository, "show", "--format=", "034a5f0", "--", "tests/commands/safejs-stress/upstream-limitations.test.ts", "tests/commands/safejs/local-safejs.test.ts"), hashes: final.eightFixtureDelta,
  unchangedTwoCharacterizations: true, unchangedOtherLocalCases: true, productionDelta: false, before: final.cohorts["eight-before"], after: final.cohorts["eight-after"] });
write("CHECKPOINT.json", { capturedAt: new Date().toISOString(), authorHarnessRevision: git(repository, "rev-parse", final.authorRevision).trim(), sourceFix: git(repository, "rev-parse", "866a6a5").trim(),
  baseline: baseline.revision, final: final.revision, packageSha256: final.packageSha256, probeSha256: final.ownInputs["boundary.probe.mjs"].sha256, classification,
  reports: Object.fromEntries(Object.entries(reports).map(([label, report]) => [label, { startedAt: report.startedAt, finishedAt: report.finishedAt, revision: report.revision, counts: Object.fromEntries(Object.entries(report.cohorts).map(([name, cohort]) => [name, cohort.counts])) }])),
  artifacts, privateIntervalBefore: originalState, privateIntervalAfter: privateAfter, privateIntervalUnchanged: true, privateScope: "HEAD, index, status, selected metadata and all 264 copied engine files; excludes node_modules/dist/caches and unrelated untracked file contents", processes,
  proposalApplied: false, proposalHashes, productionChangesByReviewer: [], behavioralScope: "Bounded supported public command/bridge acceptance only; raw failures and defect characterizations remain separate." });
console.log(JSON.stringify({ archived: labels, absentReviewChildren: processes.length, copiedEngineFiles: Object.keys(originalState.engine).length, privateIntervalUnchanged: true, classification: Object.fromEntries(Object.entries(classification).map(([label, groups]) => [label, Object.fromEntries(Object.entries(groups).map(([name, rows]) => [name, rows.length]))])) }, null, 2));
