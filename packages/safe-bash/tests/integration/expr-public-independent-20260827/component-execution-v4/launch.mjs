import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { openSync, writeSync, fsyncSync, closeSync, lstatSync, existsSync } from "node:fs";
import { join } from "node:path";
import { directory, repository, json, read, digest, putJson } from "./common.mjs";
import { pinsForRun } from "./history.mjs";
import { sealEvidence } from "./evidence.mjs";

const commit = process.argv[2]; assert.match(commit ?? "", /^[a-f0-9]{40}$/u);
const seal = json(join(directory, "RECIPE-SEAL.json"));
for (const row of seal.entries) { const filename = join(directory, row.path); assert.equal(lstatSync(filename).mode & 0o777, row.mode); assert.equal(read(filename).length, row.bytes); assert.equal(digest(read(filename)), row.sha256); }
const pins = pinsForRun();
for (const tool of pins.tools) { assert.equal(digest(read(tool.path)), tool.sha256); assert.equal(lstatSync(tool.path).mode & 0o777, tool.mode); }
for (const group of pins.history) for (const row of group.entries) assert.equal(digest(read(join(repository, row.path))), row.sha256);
assert.equal(process.execPath, pins.tools[1].path);
assert.equal(existsSync(join(directory, "work")), false, "one fresh invocation only");
const descriptor = openSync(join(directory, "EXECUTION.raw.txt"), "wx", 0o644);
let bytes = 0, supervision, launchError;
const startedAt = new Date().toISOString();
const child = spawn(process.execPath, [join(directory, "entry.mjs"), commit], { cwd: repository, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
let hardTimer;
const stop = reason => {
  if (supervision) return;
  supervision = reason;
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  hardTimer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 60000);
};
const timer = setTimeout(() => stop("900s outer deadline"), 900000);
const collect = chunk => {
  bytes += chunk.length;
  if (bytes > 16 * 1024 * 1024) { stop("16MiB outer output limit"); return; }
  writeSync(descriptor, chunk); fsyncSync(descriptor);
  process.stdout.write(chunk);
};
child.stdout.on("data", collect); child.stderr.on("data", collect);
child.once("error", error => { launchError = error.stack; });
const outcome = await new Promise(resolve => child.once("close", (status, signal) => resolve({ status, signal, closed: true })));
clearTimeout(timer); clearTimeout(hardTimer); fsyncSync(descriptor); closeSync(descriptor);
const verdict = existsSync(join(directory, "VERDICT.json")) ? json(join(directory, "VERDICT.json")) : undefined;
const exitCode = outcome.status === 0 && outcome.signal === null && !supervision && !launchError && verdict?.exitCode === 0 ? 0 : 1;
const outer = { schema: "expr-v4-outer-receipt/1", commit, startedAt, finishedAt: new Date().toISOString(), executable: process.execPath, executableSha256: digest(read(process.execPath)), pid: child.pid,
  childStatus: outcome.status, signal: outcome.signal, closed: outcome.closed, supervision: supervision ?? null, error: launchError, outputBytes: bytes, aggregateExitCode: verdict?.exitCode, exitCode, rawFlushedBeforeExit: true };
putJson(join(directory, "OUTER.json"), outer);
await sealEvidence(commit, outer);
console.log(JSON.stringify({ checkpoint: "v4-evidence-sealed-before-outer-exit", childStatus: outcome.status, exitCode, evidenceSealSha256: digest(read(join(directory, "EVIDENCE-SEAL.json"))) }));
process.exitCode = exitCode;
