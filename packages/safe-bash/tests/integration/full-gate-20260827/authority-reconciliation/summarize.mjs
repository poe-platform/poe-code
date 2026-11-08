import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, "../../../..");
const evidence = join(owned, "evidence");
const json = async path => JSON.parse(await readFile(path, "utf8"));
const hash = data => createHash("sha256").update(data).digest("hex");
const save = (path, data) => writeFile(path, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
const state = await json(join(evidence, "session.json"));
const historical = await json(join(owned, "original/full-gate-25.json"));
const originalText = await readFile(join(evidence, "baseline-original.stdout"), "utf8");
const finalText = await readFile(join(evidence, "final.stdout"), "utf8");
const passed = text => [...text.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]);
const originalPasses = passed(originalText);
const finalPasses = passed(finalText);
assert.equal(originalPasses.length, 58);
for (const name of originalPasses) assert.ok(finalPasses.includes(name), name);

const replacements = new Map([
  ["S3 unrecognized custom transport aliasing local memory remains unknown before destructive copy", "S3 honest local-data remapper strips unrelated HEAD authority before destructive copy"],
  ["S3 metadata-forwarding client with unrelated data routing cannot inherit private-store authority", "S3 faithful subclass and late content decorator retain fresh backing authority"],
  ["S3 two custom clients returning private mock metadata cannot claim distinctness for shared local data", "S3 two honest clients omit unrelated mock authority for shared local data"],
  ["WebDAV custom fetch returning genuine MockDav metadata but local data is unrecognized, not disjoint", "WebDAV honest local-data fetch omits unrelated private and protocol identity"],
  ["WebDAV mixed metadata/data transport cannot authorize truncating an aliased local source", "WebDAV honest remapper cannot authorize truncating an unproven aliased local source"],
  ["WebDAV pre-construction data-method overrides cannot inherit resource authority over another backing store", "WebDAV data-method remapper strips inherited authority at its public filesystem view"],
]);
const rows = historical.rows.map((row, index) => {
  let category, replacement, reason;
  if (row.name.includes("changed writer cannot redirect")) {
    category = "obsolete-content-method-screening";
    replacement = row.name.replace("changed writer cannot redirect qualified target into source", "faithful writer preserves qualified copy and alias rejection");
    reason = "The old host writer retains native/provider authority but writes to another backing resource. No method-table sandbox is promised. The replacement forwards the actual writer with the same receiver/arguments, requires exact source/target bytes and one writer call, then rejects a readonly-view alias without another write.";
  } else if (row.name.includes("changed content acquisition invalidates")) {
    category = "obsolete-content-method-screening";
    replacement = row.name.replace("changed content acquisition invalidates authority before opening source or target", "faithful content acquisition retains authority without reading during comparison");
    reason = "The old readStream returns unrelated target bytes under source identity. The replacement forwards the actual stream, requires zero acquisitions for comparison, exactly one acquisition for copy, and exact source/target bytes.";
  } else if (replacements.has(row.name)) {
    category = "noncompliant-provider-binding-assumption";
    replacement = replacements.get(row.name);
    reason = replacement.includes("faithful subclass")
      ? "The old client combines private HEAD authority with unrelated local data routing, then changes PUT binding. The replacement preserves all actual backing operations through subclass/late decorators, requires a successful existing-target copy, and still rejects a shared-store alias."
      : "The old host forwards another store's authority while routing data into shared local memory. The replacement omits changed identity at the HEAD/Response/public-FS boundary and retains unknown/ENOTSUP, zero content effects and source preservation. A host violating that omission can still damage source; those old failures are retained, not safety passes.";
  } else {
    assert.equal(row.name, "WebDAV resource-id protocol fixture supports pairwise proof without content or numeric inode IDs");
    category = "obsolete-helper-property-augmentation";
    replacement = row.name;
    reason = "The current MockDav already emits one DAV:resource-id. The old fixture appends another, so its unchanged exact-one resolver properly returns unknown. Replace the known helper property before injecting the fixture map; retain successful distinct copies, alias rejection, missing-property refusal and a new deliberate duplicate-property refusal.";
  }
  assert.ok(finalPasses.includes(replacement), replacement);
  return { number: index + 1, originalName: row.name, path: row.path, originalSourceLine: row.originalSourceLine,
    originalStatus: "fail", classification: category, replacementName: replacement,
    replacementStatus: "pass-with-explicit-fixture-input-delta-not-original-acceptance", reason,
    historicalInputSha256: state.inputs[row.path] };
});
const counts = Object.fromEntries([...new Set(rows.map(row => row.classification))].map(category => [category, rows.filter(row => row.classification === category).length]));
assert.deepEqual(counts, { "obsolete-content-method-screening": 18, "noncompliant-provider-binding-assumption": 6, "obsolete-helper-property-augmentation": 1 });
await save(join(owned, "classification.json"), { historicalCommit: historical.revision, frozenProductCommit: state.commit,
  counts, compliantProviderFailuresReproduced: 0, originalPassingCasesRetained: originalPasses.length, rows });

const finalInputs = await json(join(evidence, "final-inputs.json"));
const testCommits = {};
for (const [path, expected] of Object.entries(finalInputs)) {
  assert.equal(hash(await readFile(join(root, path))), expected);
  const commit = execFileSync("git", ["log", "-1", "--format=%H", "--", path], { cwd: root }).toString().trim();
  assert.equal(hash(execFileSync("git", ["show", `${commit}:${path}`], { cwd: root })), expected);
  testCommits[path] = { commit, sha256: expected };
}
const cohorts = {};
for (const name of ["baseline-original", "candidate", "corrected", "final", "final-guards53", "final-adjacent", "final-scoped-types", "post-mutants"]) {
  const result = await json(join(evidence, `${name}.json`));
  cohorts[name] = { status: result.status, counts: result.counts, failures: result.failures };
}
const mutants = [];
for (const name of (await readdir(evidence)).filter(name => /^mutant-.*-input\.json$/.test(name)).sort()) {
  const input = await json(join(evidence, name));
  const result = await json(join(evidence, `mutant-${input.name}.json`));
  assert.equal(result.status, 1);
  assert.equal(result.counts.tests, 85);
  assert.ok(result.failures.some(name => name.includes(input.catches)));
  mutants.push({ name: input.name, path: input.path, status: result.status, counts: result.counts, requiredGuard: input.catches, failures: result.failures });
}
assert.equal(mutants.length, 10);
const sourceHashes = Object.fromEntries(Object.entries(state.inputs).filter(([path]) => path.startsWith("src/")));
const observations = [...originalText.matchAll(/^# IMPLEMENTATION_OBSERVATION (\S+)$/gm)].map(match => JSON.parse(Buffer.from(match[1], "base64").toString()));
await save(join(evidence, "baseline-observations.json"), { classification: "historical-observation-not-safety-acceptance", observations });
const results = [];
for (const name of (await readdir(evidence)).filter(name => name.endsWith(".json"))) {
  const item = await json(join(evidence, name));
  if (!Array.isArray(item.observed)) continue;
  assert.equal(item.timedOut, false);
  assert.equal(item.outputExceeded, false);
  assert.deepEqual(item.survivors, []);
  results.push(item);
}
const supervisor = "tests/integration/full-gate-20260827/supervise.mjs";
assert.equal(hash(await readFile(join(root, supervisor))), hash(execFileSync("git", ["show", `${state.commit}:${supervisor}`], { cwd: root })));
await save(join(owned, "summary.json"), { recordedAt: new Date().toISOString(), productCommit: state.commit,
  historicalGateCommit: historical.revision, sourceSetSha256: hash(JSON.stringify(sourceHashes)), sourceHashes,
  inputCount: Object.keys(state.inputs).length, dependencyCount: Object.keys(state.dependencyHashes).length,
  helperSha256: state.inputs["tests/fs/webdav/mock.ts"], proposalSha256: state.inputs["tests/fs/mount/identity-authority-review/proposal.ts"],
  supervisorSha256: hash(await readFile(join(root, supervisor))), testCommits, counts, cohorts, mutants,
  childInvocations: results.length, observedProcessIdentities: new Set(results.flatMap(result => result.observed.map(row => `${row.pid}:${row.born}`))).size,
  childTimeouts: 0, outputLimitHits: 0, residualObservedChildren: 0, fullGateRerun: false,
  characterizationPassesIncluded: 0, pendingDifferentVerifier: true });
