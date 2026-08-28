import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function processes(timeoutMs = 2000) {
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2000);
  return execFileSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,lstart=,command="], { encoding: "utf8", timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }).split("\n").filter(Boolean).map(line => {
    const parts = line.trim().split(/\s+/); return { pid: Number(parts[0]), parent: Number(parts[1]), group: Number(parts[2]), born: parts.slice(3, 8).join(" "), command: parts.slice(8).join(" ") };
  });
}
export async function supervise(executable, args, options) {
  if (options.signal?.aborted) throw options.signal.reason;
  assert.ok(Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0);
  const known = new Map(), signals = [], listeners = [], faults = [], faultCauses = [], captures = [], inputListeners = [], sent = new Set();
  let child, result, completion, timeout, interval, bytes = 0, timedOut = false, outputExceeded = false, spawnError, closed = false, rootExitedAt, observerError;
  let cleaning = false, teardownAttempted = false, cleanupDeadline, faultCount = 0, lastObservation = { known: false, alive: [] }, wake;
  const faultNotice = new Promise(resolve => { wake = resolve; });
  const started = Date.now();
  const describe = value => {
    const type = value === null ? "null" : typeof value;
    if (type === "undefined" || type === "null") return { type, message: type };
    try {
      if (type === "object" || type === "function") return { type, name: typeof value.name === "string" ? value.name : undefined, message: typeof value.message === "string" ? value.message : "Thrown object", stack: typeof value.stack === "string" ? value.stack : undefined };
      return { type, message: String(value) };
    } catch { return { type, message: "Uninspectable thrown value" }; }
  };
  const record = (stage, value) => {
    faultCount++;
    const description = describe(value);
    observerError ??= `${stage}: ${description.message}`;
    if (faults.length < 256) { faults.push({ stage, ...description }); faultCauses.push(value); }
    wake();
  };
  const remaining = () => Math.max(0, cleanupDeadline - Date.now());
  const observe = stage => {
    if (!child?.pid) return lastObservation = { known: true, alive: [] };
    try {
      const available = cleaning ? remaining() : 2000;
      assert.ok(available > 0, "process observation cleanup deadline");
      const rows = processes(Math.min(2000, available));
      let changed;
      do {
        changed = false;
        for (const row of rows) if (row.pid === child.pid || row.group === child.pid || (known.has(row.parent) && known.get(row.parent).born === rows.find(parent => parent.pid === row.parent)?.born)) {
          if (row.pid === process.pid || row.pid === process.ppid) continue;
          assert.ok(Number.isSafeInteger(row.pid) && row.pid > 0 && row.born, "observed child identity required");
          if (!known.has(row.pid)) { known.set(row.pid, row); changed = true; }
        }
      } while (changed);
      return lastObservation = { known: true, alive: rows.filter(row => known.get(row.pid)?.born === row.born) };
    } catch (error) {
      record(stage, error);
      return lastObservation = { known: false, alive: [...known.values()].filter(row => !(closed && row.pid === child.pid)) };
    }
  };
  const terminate = (signal, snapshot) => {
    if (child?.pid && !closed && rootExitedAt === undefined && !sent.has(`child:${signal}`)) {
      sent.add(`child:${signal}`);
      const entry = { pid: child.pid, born: known.get(child.pid)?.born ?? null, signal, target: "owned-child-handle", delivered: false };
      signals.push(entry);
      try { entry.delivered = child.kill(signal); } catch (error) { record("signal-child", error); }
    }
    if (snapshot?.known) for (const row of snapshot.alive) {
      if (row.pid === child?.pid || row.pid === process.pid || row.pid === process.ppid) continue;
      const key = `${row.pid}:${row.born}:${signal}`;
      if (sent.has(key)) continue;
      sent.add(key);
      const entry = { pid: row.pid, born: row.born, signal, target: "freshly-observed-owned-descendant", delivered: false };
      signals.push(entry);
      try { process.kill(row.pid, signal); entry.delivered = true; } catch (error) { if (error?.code !== "ESRCH") record("signal-descendant", error); }
    }
  };
  const relay = signal => { record("interrupt", `Supervisor received ${signal}`); terminate("SIGTERM"); };
  const onInterrupt = () => relay("SIGINT"), onTerminate = () => relay("SIGTERM");
  const onAbort = () => { record("abort", options.signal.reason); terminate("SIGTERM"); };
  const attempt = (stage, action) => { try { return action(); } catch (error) { record(stage, error); } };
  const closeCapture = async capture => {
    const { stream, label } = capture;
    if (stream.closed) { capture.closed = true; return; }
    await new Promise(resolve => {
      let timer, finished = false;
      const finish = () => { if (finished) return; finished = true; clearTimeout(timer); stream.removeListener("close", onClose); capture.closed = stream.closed === true; resolve(); };
      const onClose = () => { capture.closed = true; finish(); };
      stream.once("close", onClose);
      timer = setTimeout(() => { record(`${label}-drain-deadline`, new Error("owned capture did not close within cleanup allowance")); attempt(`${label}-destroy`, () => stream.destroy()); finish(); }, remaining());
      attempt(`${label}-end`, () => stream.end());
      if (stream.closed) onClose();
    });
  };
  let polls = 0, finalObservation = { known: false, alive: [] };
  try {
    mkdirSync(dirname(options.stdout), { recursive: true });
    for (const [label, path] of [["stdout", options.stdout], ["stderr", options.stderr]]) {
      const stream = createWriteStream(path, { flags: "wx" });
      captures.push({ label, stream, closed: false });
      stream.on("error", error => { record(`${label}-capture`, error); terminate("SIGKILL"); });
    }
    child = spawn(executable, args, { cwd: options.cwd, env: options.env, detached: true, stdio: options.ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"] });
    completion = new Promise(resolve => {
      child.once("error", error => { spawnError = describe(error).message; record("spawn", error); });
      child.once("exit", () => { rootExitedAt = Date.now(); });
      child.once("close", (status, signal) => { closed = true; result = { status, signal }; resolve(); });
    });
    process.once("SIGINT", onInterrupt); process.once("SIGTERM", onTerminate);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    for (const [input, capture] of [[child.stdout, captures[0]], [child.stderr, captures[1]]]) {
      const onData = chunk => {
        try {
          bytes += chunk.length;
          if (bytes > (options.maxOutputBytes ?? 256 * 1024 * 1024)) { if (!outputExceeded) { outputExceeded = true; record("output-limit", new Error("owned output bound exceeded")); terminate("SIGKILL"); } return; }
          if (!capture.stream.write(chunk)) { input.pause(); const resume = () => input.resume(); capture.stream.once("drain", resume); inputListeners.push([capture.stream, "drain", resume]); }
        } catch (error) { record(`${capture.label}-write`, error); terminate("SIGKILL"); }
      };
      const onError = error => { record(`${capture.label}-input`, error); terminate("SIGKILL"); };
      input.on("data", onData); input.on("error", onError); inputListeners.push([input, "data", onData], [input, "error", onError]);
    }
    interval = setInterval(() => {
      if (cleaning) return;
      attempt("poll", () => {
        const snapshot = observe("poll-observation"); polls++;
        if (options.setupSentinel && !existsSync(options.setupSentinel) && Date.now() - started > options.setupTimeoutMs) { record("setup-deadline", new Error("setup deadline exceeded before first phase")); terminate("SIGKILL", snapshot); }
        if (rootExitedAt !== undefined && Date.now() - rootExitedAt > 300 && snapshot.alive.length) terminate("SIGKILL", snapshot);
        if (options.observeSockets && polls % 10 === 0 && snapshot.known && snapshot.alive.length) {
          try {
            const output = execFileSync("/usr/sbin/lsof", ["-nP", "-a", "-p", snapshot.alive.map(row => row.pid).join(","), "-iTCP", "-sTCP:LISTEN", "-Fpn"], { encoding: "utf8", timeout: 2000, maxBuffer: 1024 * 1024 });
            for (const line of output.split("\n").filter(line => line.startsWith("n"))) {
              const address = line.slice(1); listeners.push(address);
              if (!address.startsWith("127.") && !address.startsWith("[::1]:")) { record("socket-listener", new Error(`Non-loopback owned TCP listener: ${address}`)); terminate("SIGKILL", snapshot); }
            }
          } catch (error) { if (error?.status !== 1) record("socket-observation", error); }
        }
      });
    }, 100);
    timeout = setTimeout(() => { timedOut = true; record("total-deadline", new Error("supervisor deadline exceeded")); terminate("SIGKILL"); }, options.timeoutMs);
    observe("initial-observation");
    if (!faultCount) options.onSpawn?.(child);
    if (options.signal?.aborted) onAbort();
    await Promise.race([completion, faultNotice]);
  } catch (error) { record("supervision", error); }
  finally {
    cleaning = true; cleanupDeadline = Date.now() + 5000; teardownAttempted = true;
    try {
      let snapshot = observe("cleanup-observation");
      if (!closed || snapshot.alive.length || !snapshot.known) terminate("SIGTERM", snapshot);
      const escalationAt = Date.now() + 300;
      while (child && remaining() > 0 && (!closed || snapshot.known && snapshot.alive.length)) {
        if (Date.now() >= escalationAt) terminate("SIGKILL", snapshot);
        await delay(Math.min(50, remaining()));
        snapshot = observe("cleanup-poll-observation");
      }
      if (child && !closed) { record("child-close-deadline", new Error("owned child close not established")); terminate("SIGKILL", snapshot); }
    } catch (error) { record("teardown", error); terminate("SIGKILL"); }
    finally {
      for (const [emitter, event, listener] of inputListeners) attempt("remove-input-listener", () => emitter.removeListener(event, listener));
      if (child && !closed) for (const input of [child.stdout, child.stderr]) attempt("input-destroy", () => input.destroy());
      for (const capture of captures) { try { await closeCapture(capture); } catch (error) { record(`${capture.label}-drain`, error); attempt(`${capture.label}-destroy`, () => capture.stream.destroy()); } }
      finalObservation = observe("final-observation");
      clearTimeout(timeout); clearInterval(interval);
      attempt("remove-interrupt-listener", () => process.removeListener("SIGINT", onInterrupt));
      attempt("remove-terminate-listener", () => process.removeListener("SIGTERM", onTerminate));
      attempt("remove-abort-listener", () => options.signal?.removeEventListener("abort", onAbort));
    }
  }
  const captureClosed = captures.length === 2 && captures.every(capture => capture.closed);
  const receipt = { executable, args, cwd: options.cwd, pid: child?.pid, ...result, spawnError, timedOut, outputExceeded, observerError, closed,
    faults, faultCount, faultsTruncated: faultCount > faults.length, observability: finalObservation.known ? "FINAL_SNAPSHOT_OBSERVED" : "UNKNOWN", survivorsKnown: finalObservation.known,
    teardownAttempted, cleanupAllowanceMs: 5000, captureClosed, captures: captures.map(({label,closed: captureComplete}) => ({label,closed: captureComplete})),
    elapsedMs: Date.now() - started, timeoutMs: options.timeoutMs, outputBytes: bytes, observed: [...known.values()], signals, survivors: finalObservation.alive, listeners: [...new Set(listeners)],
    cleanupRequired: signals.length > 0,
    clean: Boolean(child && closed && captureClosed && !spawnError && !timedOut && !outputExceeded && !faultCount && signals.length === 0 && finalObservation.known && finalObservation.alive.length === 0),
    qualification: "Known child handle teardown does not depend on process observation. Only freshly observed matching descendants are signaled; unknown/stale identities are not guessed. Unknown observability and capture/reporting faults never qualify clean. Bounded cooperative attempts are not kernel-hard drain guarantees." };
  Object.defineProperty(receipt, "faultCauses", { value: faultCauses, enumerable: false });
  return receipt;
}
