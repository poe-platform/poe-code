import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

const root = "tests/commands/network-stress";
const owned = `${root}/finalization`;
const revision = "aa2da57a5d1be8571f450a27c7b971245c1b7025";
const expectedDigest = "886d7b03e4b280ab90bb1385f199f363c13349e3fe439fee0777bd274a1499a4";
const environment = {
  CURL_VERIFY_AFTER_HANDOFF: "deab14d9f4b3b6f0d73f96587c74a9de23091300",
  CURL_VERIFY_SOURCE_REVISION: revision,
  NODE_OPTIONS: "--unhandled-rejections=strict",
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function git(...args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function files(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (path === owned) continue;
    if (entry.isDirectory()) paths.push(...await files(path));
    else paths.push(path);
  }
  return paths.sort();
}
async function hashes(paths) {
  const result = {};
  for (const path of paths) result[path] = digest(await readFile(path));
  return result;
}
async function network() {
  const pairs = Object.entries(await hashes(await files("src/commands/network")));
  return { at: new Date().toISOString(), hashes: pairs, digest: digest(JSON.stringify(pairs)) };
}
const committed = git("ls-tree", "-r", "--name-only", revision, "--", "src/commands/network").split("\n").sort();
const committedHashes = committed.map((path) => {
  const result = spawnSync("git", ["show", `${revision}:${path}`]);
  assert.equal(result.status, 0);
  return [path, digest(result.stdout)];
});
assert.equal(digest(JSON.stringify(committedHashes)), expectedDigest);
function assertNetwork(snapshot) { assert.deepEqual(snapshot.hashes, committedHashes); assert.equal(snapshot.digest, expectedDigest); }
async function snapshot() {
  const shared = [...await files("src"), ...await files("tests/commands/network"), ...await files("tests/commands/network-policy-stress"), "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"].sort();
  return { at: new Date().toISOString(), head: git("rev-parse", "HEAD"), status: git("status", "--short"), hashes: await hashes(shared), network: await network() };
}
async function save(name, value) {
  const path = `${owned}/${name}.json`;
  await assert.rejects(readFile(path), { code: "ENOENT" });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split("\n").map((line) => `+${line}`).join("\n")}\n*** End Patch\n`;
  const result = spawnSync("apply_patch", { input: patch, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return { path, sha256: digest(await readFile(path)) };
}
function groupMembers(group) {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\n").filter((line) => Number(line.trim().split(/\s+/)[2]) === group);
}
const start = await snapshot();
assertNetwork(start.network);
assert.equal(git("rev-parse", "HEAD:tests/commands/network/http.test.ts"), git("hash-object", "tests/commands/network/http.test.ts"));
assert.equal(git("show", "cbde2fe", "--format=", "--name-only"), "tests/commands/network/http.test.ts");
const originalPaths = await files(root);
const preserved = await hashes(originalPaths);
const policyPaths = await files("tests/commands/network-policy-stress");
const policyPreserved = await hashes(policyPaths);
const acceptedRevision = "77f859182e6bc9d1ea3dbf26852d529e77ea65ff";
const historicalPaths = git("ls-tree", "-r", "--name-only", acceptedRevision, "--", root).split("\n");
for (const path of historicalPaths) {
  const result = spawnSync("git", ["show", `${acceptedRevision}:${path}`], { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0);
  assert.equal(preserved[path], digest(result.stdout), `Historical bytes changed: ${path}`);
}
await save("start", { start, revision, expectedDigest, environment, acceptedRevision, historicalPaths, preserved, policyPreserved, authorTestCommit: git("rev-parse", "cbde2fe"), runnerSha256: digest(await readFile(`${owned}/run.mjs`)), smokeSha256: digest(await readFile(`${owned}/smoke.mjs`)), node: process.version });
const nodeArgs = ["--unhandled-rejections=strict", "--import", "tsx"];
const jobs = [
  { name: "author-81", executable: process.execPath, args: [...nodeArgs, "--test", "tests/commands/network/*.test.ts"], expected: 81 },
  { name: "independent-60", executable: process.execPath, args: [...nodeArgs, `${root}/product-v2.ts`], expected: 60 },
  { name: "supplement-18", executable: process.execPath, args: [...nodeArgs, `${root}/supplement-v2.ts`, "product"], expected: 18 },
  { name: "retry-18", executable: process.execPath, args: [...nodeArgs, `${root}/retry-product.ts`], expected: 18 },
  { name: "lifecycle-15", executable: process.execPath, args: [...nodeArgs, `${root}/retry-lifecycle-v2.ts`], expected: 15 },
  { name: "policy-22", executable: process.execPath, args: [...nodeArgs, "--test", "tests/commands/network-policy-stress/*.test.ts"], expected: 22 },
  { name: "build", executable: "npm", args: ["run", "build"] },
  { name: "typecheck", executable: "npm", args: ["run", "typecheck"] },
];
const captures = [];
let buildPassed = false;
async function run(job) {
  await assert.rejects(readFile(`${owned}/${job.name}.json`), { code: "ENOENT" });
  const before = await snapshot();
  assertNetwork(before.network);
  const started = new Date().toISOString();
  const child = spawn(job.executable, job.args, { detached: true, shell: false, env: { ...process.env, ...environment }, stdio: ["ignore", "pipe", "pipe"] });
  const signals = [];
  function terminate(signal, reason) {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); signals.push({ at: new Date().toISOString(), signal, reason }); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  let forced = false;
  let byteCount = 0;
  const stdoutChunks = [];
  const stderrChunks = [];
  for (const [stream, chunks] of [[child.stdout, stdoutChunks], [child.stderr, stderrChunks]]) stream.on("data", (chunk) => {
    byteCount += chunk.length;
    if (byteCount <= 8 * 1024 * 1024) chunks.push(chunk);
    else { forced = true; terminate("SIGKILL", "output bound"); }
  });
  const samples = [before.network];
  const samplingErrors = [];
  let checking = Promise.resolve();
  const sampler = setInterval(() => {
    checking = checking.then(async () => {
      const sample = await network();
      samples.push(sample);
      assertNetwork(sample);
    }).catch((error) => { samplingErrors.push(String(error)); forced = true; terminate("SIGKILL", "source gate"); });
  }, 100);
  const limitMs = job.name === "package-smoke" ? 20000 : 430000;
  const timer = setTimeout(() => { forced = true; terminate("SIGTERM", "watchdog"); }, limitMs);
  const hardTimer = setTimeout(() => { forced = true; terminate("SIGKILL", "watchdog hard bound"); }, limitMs + 2000);
  const exit = await new Promise((resolveExit) => {
    child.once("error", (error) => resolveExit({ code: null, signal: null, launchError: String(error) }));
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  });
  clearInterval(sampler);
  clearTimeout(timer);
  clearTimeout(hardTimer);
  await checking;
  const remainingBeforeCleanup = child.pid ? groupMembers(child.pid) : [];
  if (remainingBeforeCleanup.length) terminate("SIGKILL", "owned group cleanup");
  if (remainingBeforeCleanup.length) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  const remainingAfterCleanup = child.pid ? groupMembers(child.pid) : [];
  const after = await snapshot();
  samples.push(after.network);
  const stdoutBytes = Buffer.concat(stdoutChunks);
  const stderrBytes = Buffer.concat(stderrChunks);
  const stdout = stdoutBytes.toString();
  const stderr = stderrBytes.toString();
  const records = stdout.split("\n").filter((line) => line.startsWith("{")).map((line) => { try { return JSON.parse(line); } catch { return { unparsable: line }; } });
  const tap = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map((match) => [match[1], Number(match[2])]));
  const summary = records.findLast((record) => record.total !== undefined) ?? (tap.tests !== undefined ? { total: tap.tests, passed: tap.pass, failed: tap.fail, cancelled: tap.cancelled, skipped: tap.skipped, todo: tap.todo } : null);
  const changes = [...new Set([...Object.keys(before.hashes), ...Object.keys(after.hashes)])].filter((path) => before.hashes[path] !== after.hashes[path]);
  const immutableAfter = await hashes(await files(root));
  const immutableChanges = [...new Set([...Object.keys(preserved), ...Object.keys(immutableAfter)])].filter((path) => preserved[path] !== immutableAfter[path]);
  const policyAfter = await hashes(await files("tests/commands/network-policy-stress"));
  const policyChanges = [...new Set([...Object.keys(policyPreserved), ...Object.keys(policyAfter)])].filter((path) => policyPreserved[path] !== policyAfter[path]);
  const networkStable = samplingErrors.length === 0 && samples.every((sample) => sample.digest === expectedDigest);
  const countPassed = job.expected === undefined || (summary?.total === job.expected && summary?.passed === job.expected && summary?.failed === 0 && !(summary.cancelled || summary.skipped || summary.todo || summary.pending));
  const passed = exit.code === 0 && !forced && networkStable && countPassed && immutableChanges.length === 0 && policyChanges.length === 0 && remainingBeforeCleanup.length === 0 && remainingAfterCleanup.length === 0;
  const artifact = { schema: 1, name: job.name, attempt: 1, actualExecution: !exit.launchError, started, finished: new Date().toISOString(), command: [job.executable, ...job.args], environment, node: process.version, revision, expectedDigest, before, after, samples, samplingErrors, networkStable, changes, immutableChanges, policyChanges, childPid: child.pid ?? null, processGroup: child.pid ?? null, watchdogMs: limitMs, outputBoundBytes: 8 * 1024 * 1024, observedOutputBytes: byteCount, exit, forced, signals, cleanup: { remainingBeforeCleanup, remainingAfterCleanup }, stdout, stderr, stdoutBase64: stdoutBytes.toString("base64"), stderrBase64: stderrBytes.toString("base64"), stdoutSha256: digest(stdoutBytes), stderrSha256: digest(stderrBytes), records, summary, expected: job.expected ?? null, passed };
  const saved = await save(job.name, artifact);
  const result = { ...saved, name: job.name, passed, exit, summary, changes, networkStable, samples: samples.length, cleanup: artifact.cleanup };
  captures.push(result);
  console.log(JSON.stringify(result));
  assert(networkStable, "Network source drift: stop bounded finalization");
  assert.deepEqual(immutableChanges, [], "Prior evidence changed");
  assert.deepEqual(policyChanges, [], "Policy sidecar changed");
  assert.deepEqual(remainingAfterCleanup, [], "Owned process group still active");
  if (job.name === "build") buildPassed = passed;
}
for (const job of jobs) await run(job);
if (buildPassed) await run({ name: "package-smoke", executable: process.execPath, args: ["--unhandled-rejections=strict", `${owned}/smoke.mjs`], expected: 5 });
else console.log(JSON.stringify({ name: "package-smoke", status: "blocked", reason: "Fresh global build failed; stale dist is not accepted" }));
const finish = await snapshot();
assertNetwork(finish.network);
const finalPreserved = await hashes(await files(root));
assert.deepEqual(finalPreserved, preserved);
assert.deepEqual(await hashes(await files("tests/commands/network-policy-stress")), policyPreserved);
const ownedGroups = captures.map((capture) => ({ name: capture.name, group: JSON.parse(spawnSync("cat", [capture.path], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).stdout).processGroup }));
const activeOwnedGroups = ownedGroups.flatMap(({ name, group }) => groupMembers(group).map((member) => ({ name, group, member })));
assert.deepEqual(activeOwnedGroups, []);
const retry = JSON.parse(await readFile(`${owned}/retry-18.json`, "utf8"));
const frozen = JSON.parse(await readFile(`${root}/retry-freeze.json`, "utf8"));
const retryComparison = ["retry-stdout-explicit", "retry-file-fail-body", "retry-writeout"].map((id) => {
  const actual = retry.records.find((row) => row.id === id);
  const expected = frozen.records.find((row) => row.id === id);
  assert.equal(actual.stdout, expected.stdout);
  assert.equal(actual.files["result.bin"], expected.files["result.bin"]);
  return { id, stdoutBase64: actual.stdout, stdoutText: Buffer.from(actual.stdout, "base64").toString(), fileBase64: actual.files["result.bin"], fileText: Buffer.from(actual.files["result.bin"], "base64").toString(), status: actual.status };
});
await save("audit", { start: start.at, finished: new Date().toISOString(), source: { revision, expectedDigest, committedHashes }, captures, finalSnapshot: finish, preserved, historicalAcceptanceRevision: acceptedRevision, historicalFilesVerified: historicalPaths.length, policyPreserved, preservedByteIdentically: true, activeOwnedGroups, ownedGroups, retryComparison, buildPassed, smokeBlocked: !buildPassed, limits: "One execution per requested suite/build/typecheck; existing native calls only in author suite; no new native corpus, policy diagnostic, remote or full-shell/filesystem suites" });
process.exitCode = captures.every((capture) => capture.passed) ? 0 : 1;
