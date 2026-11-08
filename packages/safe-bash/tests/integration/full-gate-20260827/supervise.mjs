import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function processes() {
  return execFileSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,lstart=,command="], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).split("\n").filter(Boolean).map(line => {
    const parts = line.trim().split(/\s+/); return { pid: Number(parts[0]), parent: Number(parts[1]), group: Number(parts[2]), born: parts.slice(3, 8).join(" "), command: parts.slice(8).join(" ") };
  });
}
export async function supervise(executable, args, options) {
  mkdirSync(dirname(options.stdout), { recursive: true });
  const stdout = createWriteStream(options.stdout, { flags: "wx" }), stderr = createWriteStream(options.stderr, { flags: "wx" });
  const child = spawn(executable, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const known = new Map(), signals = [], listeners = [];
  let bytes = 0, timedOut = false, outputExceeded = false, spawnError, closed = false, rootExitedAt, observerError;
  const started = Date.now();
  const observe = () => {
    const rows = processes();
    let changed;
    do {
      changed = false;
      for (const row of rows) if (row.pid === child.pid || row.group === child.pid || (known.has(row.parent) && known.get(row.parent).born === rows.find(parent => parent.pid === row.parent)?.born)) {
        if (row.pid === process.pid || row.pid === process.ppid) continue;
        if (!known.has(row.pid)) { known.set(row.pid, row); changed = true; }
      }
    } while (changed);
    return rows.filter(row => known.get(row.pid)?.born === row.born);
  };
  const terminate = signal => {
    for (const row of observe()) {
      try { process.kill(row.pid, signal); signals.push({ pid: row.pid, born: row.born, signal }); } catch (error) { if (error.code !== "ESRCH") observerError = String(error); }
    }
  };
  const relay = signal => { observerError = `Supervisor received ${signal}`; terminate("SIGTERM"); };
  const onInterrupt = () => relay("SIGINT"), onTerminate = () => relay("SIGTERM");
  process.once("SIGINT", onInterrupt); process.once("SIGTERM", onTerminate);
  for (const [input, output] of [[child.stdout, stdout], [child.stderr, stderr]]) input.on("data", chunk => {
    bytes += chunk.length;
    if (bytes > (options.maxOutputBytes ?? 256 * 1024 * 1024)) { if (!outputExceeded) { outputExceeded = true; terminate("SIGKILL"); } return; }
    if (!output.write(chunk)) { input.pause(); output.once("drain", () => input.resume()); }
  });
  const completion = new Promise(resolve => {
    child.once("error", error => { spawnError = String(error); });
    child.once("exit", () => { rootExitedAt = Date.now(); });
    child.once("close", (status, signal) => { closed = true; resolve({ status, signal }); });
  });
  let polls = 0;
  const interval = setInterval(() => {
    try {
      const alive = observe(); polls++;
      if (rootExitedAt && Date.now() - rootExitedAt > 300 && alive.length) terminate("SIGKILL");
      if (options.observeSockets && polls % 10 === 0 && alive.length) {
        try {
          const output = execFileSync("/usr/sbin/lsof", ["-nP", "-a", "-p", alive.map(row => row.pid).join(","), "-iTCP", "-sTCP:LISTEN", "-Fpn"], { encoding: "utf8", timeout: 2000, maxBuffer: 1024 * 1024 });
          for (const line of output.split("\n").filter(line => line.startsWith("n"))) {
            const address = line.slice(1); listeners.push(address);
            if (!address.startsWith("127.") && !address.startsWith("[::1]:")) { observerError = `Non-loopback owned TCP listener: ${address}`; terminate("SIGKILL"); }
          }
        } catch (error) { if (error.status !== 1) observerError = `Socket observation: ${error.message}`; }
      }
    } catch (error) { observerError = String(error); }
  }, 100);
  const timeout = setTimeout(() => { timedOut = true; terminate("SIGKILL"); }, options.timeoutMs);
  let result;
  try { observe(); result = await completion; }
  finally {
    clearTimeout(timeout); clearInterval(interval); process.removeListener("SIGINT", onInterrupt); process.removeListener("SIGTERM", onTerminate);
    if (observe().length) { terminate("SIGTERM"); await delay(100); if (observe().length) terminate("SIGKILL"); }
    for (let attempt = 0; attempt < 20 && observe().length; attempt++) await delay(50);
    await Promise.all([new Promise(resolve => stdout.end(resolve)), new Promise(resolve => stderr.end(resolve))]);
  }
  const survivors = observe();
  return { executable, args, cwd: options.cwd, pid: child.pid, ...result, spawnError, timedOut, outputExceeded, observerError, closed,
    elapsedMs: Date.now() - started, timeoutMs: options.timeoutMs, outputBytes: bytes, observed: [...known.values()], signals, survivors, listeners: [...new Set(listeners)],
    cleanupRequired: signals.length > 0,
    clean: !spawnError && !timedOut && !outputExceeded && !observerError && signals.length === 0 && survivors.length === 0 };
}
