import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { owned, save, sha256 } from "./support.ts";

const preparation = JSON.parse(await readFile(`${owned}/v2-preparation-audit.json`, "utf8"));
for (const [path, hash] of Object.entries(preparation.originals)) assert.equal(sha256(await readFile(path)), hash);
for (const [name, hash] of Object.entries(preparation.guardedFiles)) assert.equal(sha256(await readFile(`${owned}/${name}`)), hash);
assert.equal(sha256(await readFile(`${owned}/v2-native.json`)), preparation.nativeHash);
const wait = JSON.parse(await readFile(`${owned}/v2-ready-wait.json`, "utf8"));
assert.equal(wait.ready, false); assert.ok(wait.elapsedMs <= wait.maximumRequestedMs);
const pids = [...preparation.cleanup.pids];
const typeResults = [];
for (const file of ["v2-final-preparation-types.json", "v2-handoff-types.json"]) {
  const evidence = JSON.parse(await readFile(`${owned}/${file}`, "utf8"));
  for (const record of evidence.records) {
    assert.equal(record.run.code, 0); assert.equal(record.stable, true);
    pids.push(record.startingList.pid, record.run.pid);
    typeResults.push({ file, hash: sha256(await readFile(`${owned}/${file}`)), code: record.run.code, stable: record.stable, inputs: record.imports.length });
  }
}
for (const pid of pids) for (const target of [pid, -pid]) {
  let absent = false;
  try { process.kill(target, 0); } catch (error) { assert.equal(error.code, "ESRCH"); absent = true; }
  assert.equal(absent, true);
}
assert.throws(() => process.kill(wait.pid, 0), { code: "ESRCH" });
assert.deepEqual((await readdir(owned)).filter(name => /^\.(?:native|verify)-/u.test(name)), []);
const readyAtSeal = await readFile("/tmp/safe-bash-shell-discovery-fixes-ready.txt", "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
await save("v2-handoff-audit.json", {
  timestamp: new Date().toISOString(), observedHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  fixtureCommit: "225f992f0dde918c1a3e169fccb81d547d783cb2", status: "PREPARATION ONLY; bounded wait expired, no runtime acceptance",
  originalsUnchanged: preparation.originals, v2DefinitionsAndNativeUnchanged: true,
  nativeCasesCaptured: 52, metadataChecks: 4, unchangedOtherProfileRows: 48, preparedHoldouts: 34, supplementalRegistryTest: 1,
  typeResults, readyWait: wait, readyAtSeal,
  cleanup: { nativeAndCompilerPidsAndGroups: pids, watcherPid: wait.pid, allAbsent: true, temporaryDirectories: [] },
  sourceState: execFileSync("git", ["status", "--porcelain=v1", "--", "src/shell"], { encoding: "utf8" }),
  foreignStagingObserved: execFileSync("git", ["diff", "--cached", "--name-status"], { encoding: "utf8" }),
  ownedHashes: Object.fromEntries(await Promise.all([...(await readdir(owned)).filter(name => name.startsWith("v2-")), "V2_README.md", "verify.ts"].map(async name => [name, sha256(await readFile(`${owned}/${name}`))]))),
  deferred: ["original34", "corrected34 + registry1", "legacy72+132", "prior58 + selected173", "author211 + author discovery fixes", "fresh virtual original57 comparisons", "postfix raw original26/v2-26 comparisons", "global/build/benchmark noEmit"],
});
console.log(JSON.stringify({ originalsUnchanged: 12, capturedNativeRows: 52, scopedTypes: typeResults, checkedGroups: pids.length, watcherStopped: true, runtimeRuns: 0, readyAtSeal: readyAtSeal !== null }));
