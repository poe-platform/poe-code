import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const [output, cwd, timeout, cap, executable, ...argv] = process.argv.slice(2);
const deadlineMs = Number(timeout), outputCap = Number(cap);
assert(output && cwd && executable && deadlineMs > 0 && deadlineMs <= 180000 && outputCap > 0 && outputCap <= 8388608);
const startedAt = new Date().toISOString();
const child = spawn(executable, argv, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "", npm_config_offline: "true", npm_config_ignore_scripts: "true", npm_config_cache: "/tmp/safe-bash-column-padding-MmS9An/npm-cache", TMPDIR: "/tmp/safe-bash-column-padding-MmS9An/" } });
const chunks = { stdout: [], stderr: [] }, observedBytes = { stdout: 0, stderr: 0 };
let termination = null, spawnError = null;
function retire(reason) {
  termination ??= reason;
  if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
}
const timer = setTimeout(() => retire("deadline"), deadlineMs);
for (const stream of ["stdout", "stderr"]) child[stream].on("data", (bytes) => {
  const remaining = Math.max(0, outputCap - observedBytes[stream]);
  chunks[stream].push(Buffer.from(bytes.subarray(0, remaining)));
  observedBytes[stream] += bytes.length;
  if (observedBytes[stream] > outputCap) retire(`${stream}-cap`);
});
child.once("error", (error) => { spawnError = String(error); });
const outcome = await new Promise((resolve) => child.once("close", (status, signal) => resolve({ status, signal })));
clearTimeout(timer);
let groupAliveAtClose = false;
if (child.pid) try { process.kill(-child.pid, 0); groupAliveAtClose = true; } catch (error) { if (error.code !== "ESRCH") throw error; }
if (groupAliveAtClose) retire("surviving-process-group");
let groupAliveAfterRetirement = false;
for (let attempt = 0; attempt < 25; attempt++) {
  groupAliveAfterRetirement = false;
  if (child.pid) try { process.kill(-child.pid, 0); groupAliveAfterRetirement = true; } catch (error) { if (error.code !== "ESRCH") throw error; }
  if (!groupAliveAfterRetirement) break;
  await new Promise((resolve) => setTimeout(resolve, 10));
}
const record = { command: [executable, ...argv], cwd, startedAt, endedAt: new Date().toISOString(), pid: child.pid, deadlineMs, outputCap, ...outcome, termination, spawnError, observedBytes, stdoutHex: Buffer.concat(chunks.stdout).toString("hex"), stderrHex: Buffer.concat(chunks.stderr).toString("hex"), groupAliveAtClose, groupAliveAfterRetirement, cleanup: "close-observed-group-checked-and-retired", forcedCleanupIsPass: false };
await writeFile(output, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, ...outcome, termination }));
if (outcome.status !== 0 || termination || spawnError || groupAliveAfterRetirement) process.exitCode = 1;
