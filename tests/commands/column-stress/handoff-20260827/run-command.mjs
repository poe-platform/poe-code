import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const [output, cwd, milliseconds, executable, ...args] = process.argv.slice(2);
const deadlineMs = Number(milliseconds);
assert(output && cwd && executable && deadlineMs > 0 && deadlineMs <= 180000);
const startedAt = new Date().toISOString();
const child = spawn(executable, args, { cwd, detached: true, env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "", npm_config_offline: "true", npm_config_ignore_scripts: "true", npm_config_cache: `${cwd}/.verification-npm-cache` }, stdio: ["ignore", "pipe", "pipe"] });
const streams = { stdout: [], stderr: [] };
const sizes = { stdout: 0, stderr: 0 };
let termination = null;
let spawnError = null;
function retire(reason) {
  termination ??= reason;
  if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
}
const timer = setTimeout(() => retire("deadline"), deadlineMs);
for (const name of ["stdout", "stderr"]) child[name].on("data", (chunk) => {
  const left = Math.max(0, 8 * 1024 * 1024 - sizes[name]);
  sizes[name] += chunk.length;
  streams[name].push(Buffer.from(chunk.subarray(0, left)));
  if (sizes[name] > 8 * 1024 * 1024) retire(`${name}-cap`);
});
child.on("error", (error) => { spawnError = String(error); });
const outcome = await new Promise((resolve) => child.on("close", (status, signal) => resolve({ status, signal })));
clearTimeout(timer);
if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
const result = { command: [executable, ...args], cwd, startedAt, finishedAt: new Date().toISOString(), deadlineMs, ...outcome, termination, spawnError, observedBytes: sizes, stdoutHex: Buffer.concat(streams.stdout).toString("hex"), stderrHex: Buffer.concat(streams.stderr).toString("hex"), cleanup: "child-close-observed-owned-process-group-retired", isolationEnvironment: { NODE_OPTIONS: "", NODE_PATH: "", npm_config_offline: "true", npm_config_ignore_scripts: "true" } };
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ output, status: outcome.status, signal: outcome.signal, termination, spawnError }));
if (outcome.status !== 0 || termination || spawnError) process.exitCode = 1;
