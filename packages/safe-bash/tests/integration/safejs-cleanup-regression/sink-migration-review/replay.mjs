import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, "../../../..");
const provenance = JSON.parse(readFileSync(join(root, "PROVENANCE.json")));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const evidence = join(root, "evidence");
const driverReport = join(evidence, "independent-replays.json");
assert.equal(existsSync(driverReport), false, "Do not overwrite any review attempt");
for (const copy of provenance.copies) assert.equal(hash(readFileSync(join(repository, copy.destination))), copy.sha256, copy.destination);
for (const profile of ["revised", "original"]) assert.equal(existsSync(join(evidence, profile)), false, profile);
const report = { reviewer: provenance.reviewer, startedAt: new Date().toISOString(), node: process.version, driverSha256: hash(readFileSync(fileURLToPath(import.meta.url))), attempts: [] };
const save = () => writeFileSync(driverReport, JSON.stringify(report, null, 2) + "\n");
save();

async function replay(profile) {
  const output = join(evidence, profile);
  const args = ["--unhandled-rejections=strict", join(root, "migrations/sink-v2/run.mjs"), output, ...(profile === "original" ? ["--original"] : [])];
  const entry = { profile, executable: process.execPath, args, startedAt: new Date().toISOString(), outerDeadlineMs: 180000, rescue: false };
  report.attempts.push(entry);
  save();
  const child = spawn(process.execPath, args, {
    cwd: repository, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: process.env.HOME, GIT_OPTIONAL_LOCKS: "0" },
  });
  entry.pid = child.pid;
  const stdout = [];
  const stderr = [];
  let bytes = 0;
  const contain = reason => {
    if (entry.rescue) return;
    entry.rescue = true;
    entry.rescueReason = reason;
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  const timer = setTimeout(() => contain("outer-deadline"), entry.outerDeadlineMs);
  function capture(target, chunk) {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) { contain("outer-output-bound"); return; }
    target.push(chunk);
  }
  child.stdout.on("data", chunk => capture(stdout, chunk));
  child.stderr.on("data", chunk => capture(stderr, chunk));
  child.on("error", error => { entry.spawnError = error.message; });
  await new Promise(resolve => child.once("close", (status, signal) => { entry.status = status; entry.signal = signal; resolve(); }));
  clearTimeout(timer);
  entry.waitedForClose = true;
  entry.parentAlive = true;
  let groupAlive = false;
  try { process.kill(-child.pid, 0); groupAlive = true; } catch (error) { assert.equal(error.code, "ESRCH"); }
  if (groupAlive) {
    contain("owned-process-group-remained-after-close");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  try { process.kill(-child.pid, 0); entry.groupGone = false; }
  catch (error) { assert.equal(error.code, "ESRCH"); entry.groupGone = true; }
  writeFileSync(join(evidence, `${profile}.runner.stdout.txt`), Buffer.concat(stdout));
  writeFileSync(join(evidence, `${profile}.runner.stderr.txt`), Buffer.concat(stderr));
  entry.finishedAt = new Date().toISOString();
  const result = JSON.parse(readFileSync(join(output, "report.json")));
  entry.captureStatus = result.status;
  entry.cases = result.cases.length;
  entry.accepted = result.cases.filter(test => test.accepted).length;
  entry.failed = result.cases.filter(test => !test.accepted).map(test => test.id);
  entry.guards = result.strictFinalGuards;
  entry.scratchRemoved = result.cleanup?.removed;
  save();
  console.log(JSON.stringify(entry));
  assert.equal(entry.rescue, false, "Containment never counts as acceptance");
  assert.equal(entry.groupGone, true);
  assert.equal(entry.signal, null);
  assert.equal(entry.status, profile === "original" ? 1 : 0);
  assert.equal(entry.cases, 19);
  assert.equal(entry.accepted, profile === "original" ? 18 : 19);
  assert.deepEqual(entry.failed, profile === "original" ? ["literal-grep-caller-sink-error"] : []);
  assert.equal(entry.guards, true);
  assert.equal(entry.scratchRemoved, true);
  assert.equal(result.finalizationError, undefined);
}

try {
  await replay("revised");
  await replay("original");
  report.status = "both-whole-cohorts-captured";
} catch (error) {
  report.status = "review-blocked-no-retry";
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  save();
}
