import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileHash, json } from "./common.mjs";

export async function supervise(output, executable, args, { cwd, env, timeoutMs = 15000 }) {
  mkdirSync(output);
  const pre = { at: new Date().toISOString(), executable, executableSha256: fileHash(executable), args, cwd, env, timeoutMs, stdoutLimit: 8 * 1024 ** 2, stderrLimit: 8 * 1024 ** 2 };
  json(join(output, "PRE.json"), pre);
  const child = spawn(executable, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const raw = { started: new Date().toISOString(), pid: child.pid, events: [], stdout: "", stderr: "", stdoutBytes: 0, stderrBytes: 0, signals: [], closed: false };
  const chunks = { stdout: [], stderr: [] };
  let killTimer;
  function stop(reason) {
    if (raw.stopReason) return;
    raw.stopReason = reason;
    for (const [signal, delay] of [["SIGTERM", 0], ["SIGKILL", 1000]]) {
      const send = () => { try { process.kill(-child.pid, signal); raw.signals.push({ signal, at: new Date().toISOString() }); } catch (error) { if (error.code !== "ESRCH") raw.events.push({ signalError: error.message }); } };
      if (delay) killTimer = setTimeout(send, delay); else send();
    }
  }
  const timer = setTimeout(() => stop("external-deadline-not-product-pass"), timeoutMs);
  for (const name of ["stdout", "stderr"]) child[name].on("data", bytes => {
    raw[`${name}Bytes`] += bytes.length;
    if (raw[`${name}Bytes`] > pre[`${name}Limit`]) stop(`${name}-overflow`);
    else chunks[name].push(Buffer.from(bytes));
  });
  child.on("error", error => { raw.error = { message: error.message, code: error.code }; });
  child.on("exit", (code, signal) => raw.events.push({ event: "exit", code, signal, at: new Date().toISOString() }));
  await new Promise(resolve => child.once("close", (code, signal) => { raw.closed = true; raw.code = code; raw.signal = signal; raw.events.push({ event: "close", code, signal, at: new Date().toISOString() }); resolve(); }));
  clearTimeout(timer); clearTimeout(killTimer);
  for (const name of ["stdout", "stderr"]) {
    const bytes = Buffer.concat(chunks[name]);
    writeFileSync(join(output, `${name}.data`), bytes, { flag: "wx" });
    raw[name] = bytes.toString();
    raw[`${name}Sha256`] = fileHash(join(output, `${name}.data`));
  }
  const ps = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8", timeout: 5000, maxBuffer: 2 * 1024 ** 2 });
  raw.ps = { status: ps.status, signal: ps.signal, error: ps.error?.message, members: ps.stdout?.split("\n").filter(line => Number(line.trim().split(/\s+/u)[2]) === child.pid) ?? [] };
  raw.finished = new Date().toISOString();
  json(join(output, "RAW.json"), raw);
  assert.equal(ps.error, undefined); assert.equal(ps.status, 0); assert.equal(ps.signal, null);
  assert.equal(raw.ps.members.length, 0, "BOUNDARY:UNREAPED_GROUP");
  assert.equal(raw.closed, true); assert.equal(raw.error, undefined, "BOUNDARY:LAUNCH_FAILURE");
  assert.equal(raw.stopReason, undefined, "BOUNDARY:SUPERVISOR_STOP");
  assert.equal(raw.signal, null, "BOUNDARY:UNNATURAL_SIGNAL");
  return raw;
}
