import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";

const owned = "tests/shell-stress/invocation-closure";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const read = async name => JSON.parse(await readFile(`${owned}/${name}`, "utf8"));
const native = await read("native-preparation.json");
const types = await read("preparation-type-evidence.json");
const wait = await read("ready-wait.json");
const frozen = [];
for (const [revision, path] of [
  ["c440c1a", "tests/shell-stress/invocation-modes/cases.ts"],
  ["c440c1a", "tests/shell-stress/invocation-modes/holdout.test.ts"],
  ["21a6b91", "tests/shell/invocation-modes.test.ts"],
]) {
  const before = hash(execFileSync("git", ["show", `${revision}:${path}`]));
  const current = hash(await readFile(path));
  assert.equal(current, before);
  frozen.push({ revision, path, sha256: current, unchanged: true });
}
assert.equal(native.cohortHash, hash(await readFile(`${owned}/cases.ts`)));
assert.equal(native.profiles.length, 2);
const processes = [];
for (const profile of native.profiles) {
  assert.equal(profile.rows.length, 26);
  assert.equal(profile.expectedHash, hash(await readFile(profile.executable)));
  assert.deepEqual(profile.rows.map(row => row.id), native.definitions.map(row => row.id));
  for (const result of [...profile.versions, ...profile.rows.map(row => row.result)]) {
    assert.equal(result.timedOut, false);
    assert.equal(result.overflow, false);
    processes.push(result.pid);
  }
}
for (const record of types.records) {
  assert.equal(record.run.code, 0);
  assert.equal(record.stable, true);
  processes.push(record.startingList.pid, record.run.pid);
}
processes.push(wait.pid);
const alive = [];
for (const pid of processes) {
  try { process.kill(pid, 0); alive.push(pid); } catch (error) { if (error.code !== "ESRCH") throw error; }
}
assert.deepEqual(alive, []);
const leftovers = (await readdir(owned)).filter(name => /^\.(?:native|verify)-/u.test(name));
assert.deepEqual(leftovers, []);
const rawProfileDifferences = native.profiles[0].rows.flatMap((primary, index) => {
  const historical = native.profiles[1].rows[index];
  const fields = ["code", "stdoutHex", "stderrHex"].filter(field => primary.result[field] !== historical.result[field]);
  return fields.length ? [{ id: primary.id, fields }] : [];
});
const inputHashes = {};
for (const name of (await readdir(owned)).filter(name => /\.(?:ts|mjs)$/u.test(name))) inputHashes[`${owned}/${name}`] = hash(await readFile(`${owned}/${name}`));
const gnuReadSource = "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/bash-5.3/builtins/read.def";
const audit = {
  timestamp: new Date().toISOString(), observedHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: "PREPARATION ONLY; READY absent at bounded wait endpoint; no source acceptance",
  nativeCasesPerProfile: 26, nativeCasesTotal: 52, nativeMetadataProcesses: 4, hostRowsPrepared: 8, virtualRowsPrepared: 34,
  nativeEvidenceHash: hash(await readFile(`${owned}/native-preparation.json`)), frozen, inputHashes,
  gnuReadSource: { path: gnuReadSource, sha256: hash(await readFile(gnuReadSource)) },
  nativeProfileHashes: native.profiles.map(({ id, executable, expectedHash }) => ({ id, executable, sha256: expectedHash })),
  rawProfileDifferences, rawDifferencesIncludeIsolatedPathnames: true,
  preparationTypeEvidenceHash: hash(await readFile(`${owned}/preparation-type-evidence.json`)),
  preparationCompilerInputs: types.records[0].imports.length,
  readyWait: wait, cleanup: { checkedPids: processes, stillAlive: alive, temporaryDirectories: leftovers },
  foreignWorktree: execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=no"], { encoding: "utf8" }),
  indexAtAudit: execFileSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8" }),
  notRun: ["new virtual 34", "unchanged 72", "unchanged 132", "fresh original 57 native x2", "virtual comparisons", "prior regressions", "global/build/benchmark noEmit"],
};
await writeFile(`${owned}/preparation-audit.json`, `${JSON.stringify(audit, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ observedHead: audit.observedHead, frozenUnchanged: frozen.length, nativeRows: 52, rawProfileDifferences: rawProfileDifferences.length, checkedStoppedPids: processes.length, virtualRuns: 0 }));
