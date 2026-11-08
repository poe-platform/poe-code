import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cases } from "./cases.js";
import { boundedProcess, head, immutableJson, owned, sanitizedEnv, sha256, sourceHashes } from "./harness.js";

const evidence = JSON.parse(await readFile(`${owned}/native-corrected-evidence.json`, "utf8"));
assert.equal(evidence.cohortHash, sha256(await readFile(`${owned}/cases.ts`)));
assert.equal(cases.length, 57);
assert.equal(evidence.profiles.length, 2);
const pids: number[] = [];
for (const profile of evidence.profiles) {
  assert.equal(profile.rows.length, cases.length);
  assert.deepEqual(profile.rows.map((row: { id: string }) => row.id), cases.map(row => row.id));
  assert.equal(profile.interpreterHash, sha256(await readFile(profile.executable)));
  assert.equal(profile.version.argv0, "sh");
  assert.match(profile.version.stdout, /posix\s+on/u);
  pids.push(profile.version.pid);
  for (const row of profile.rows) {
    assert.equal(row.sourceHash, sha256(row.source));
    assert.equal(row.result.timedOut, false);
    assert.equal(row.result.overflow, false);
    assert.equal(row.result.signal, null);
    for (const fixture of row.renderedFixtures) assert.equal(fixture.sha256, sha256(Buffer.from(fixture.hex, "hex")));
    for (const fragment of cases.find(candidate => candidate.id === row.id)?.diagnostic ?? []) assert.ok(row.result.stderr.includes(fragment));
    pids.push(row.result.pid);
  }
}
const baseline = JSON.parse(await readFile(`${owned}/baseline-evidence.json`, "utf8"));
assert.deepEqual(baseline.changedImported, []);
assert.ok(baseline.imports.includes("src/shell/runtime.ts"));
assert.ok(baseline.imports.every((path: string) => path.endsWith(".ts")));
for (const run of baseline.runs) pids.push(run.pid);
const survivingGroups = pids.filter(pid => {
  try { process.kill(-pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
});
assert.deepEqual(survivingGroups, []);
const before = await sourceHashes();
const args = ["node_modules/typescript/bin/tsc", "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck",
  ...["audit-preparation", "capture-native", "cases", "harness", "holdout.test", "verify", "virtual-child"].map(name => `${owned}/${name}.ts`)];
const typecheck = await boundedProcess(process.execPath, args, { cwd: process.cwd(), env: sanitizedEnv(), deadlineMs: 30000 });
const after = await sourceHashes();
const changedSource = Object.keys(before).filter(path => before[path] !== after[path]);
await immutableJson(process.argv[2] ?? "preparation-audit.json", { timestamp: new Date().toISOString(), head: head(),
  nativeRows: 114, profiles: 2, frozenCohortHash: evidence.cohortHash,
  integrity: "Exact complete row sets, source/fixture hashes, executable hashes, sh provenance and diagnostic fragments checked",
  checkedProcessGroups: pids, survivingGroups, typecheck, changedSource });
assert.equal(typecheck.code, 0, typecheck.stdout + typecheck.stderr);
assert.equal(typecheck.timedOut, false);
assert.deepEqual(changedSource, []);
console.log("Preparation integrity, process cleanup, and scoped typecheck passed; NOT acceptance.");
