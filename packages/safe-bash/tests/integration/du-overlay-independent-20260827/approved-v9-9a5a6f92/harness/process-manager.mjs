import { spawn } from "node:child_process";

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function targetExists(target) {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function waitUntilGone(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (targetExists(target) && Date.now() < deadline) await delay(25);
  return !targetExists(target);
}

function checkedDuration(value, fallback, name) {
  const answer = value ?? fallback;
  if (!Number.isSafeInteger(answer) || answer < 1) throw new Error(`${name} must be a positive safe integer`);
  return answer;
}

export function pidExists(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("pid must be a positive safe integer");
  return targetExists(pid);
}

export async function waitForPidExit(pid, timeoutMs = 2_000) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("pid must be a positive safe integer");
  return waitUntilGone(pid, checkedDuration(timeoutMs, 2_000, "timeoutMs"));
}

export class ProcessManager {
  constructor({ defaultTimeoutMs = 120_000, termGraceMs = 750, closureTimeoutMs = 2_000 } = {}) {
    if (process.platform === "win32") throw new Error("the frozen replay process manager requires POSIX process groups");
    this.defaultTimeoutMs = checkedDuration(defaultTimeoutMs, 120_000, "defaultTimeoutMs");
    this.termGraceMs = checkedDuration(termGraceMs, 750, "termGraceMs");
    this.closureTimeoutMs = checkedDuration(closureTimeoutMs, 2_000, "closureTimeoutMs");
    this.active = new Map();
    this.history = [];
    this.interruptedBy = undefined;
    this.signalHandlers = new Map();
  }

  installSignalHandlers() {
    if (this.signalHandlers.size) return;
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const handler = () => {
        if (!this.interruptedBy) this.interruptedBy = signal;
        process.exitCode = SIGNAL_EXIT_CODES[signal];
        void this.shutdown(signal);
      };
      this.signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
  }

  removeSignalHandlers() {
    for (const [signal, handler] of this.signalHandlers) process.off(signal, handler);
    this.signalHandlers.clear();
  }

  async terminate(record, reason) {
    if (record.terminationPromise) return record.terminationPromise;
    record.terminationReason = reason;
    record.terminationPromise = (async () => {
      const groupTarget = -record.pgid;
      if (!this.active.has(record.pid) || record.pid !== record.pgid) {
        throw new Error(`refusing unauthenticated process group termination for ${record.pid}/${record.pgid}`);
      }
      if (!targetExists(groupTarget)) return { termSent: false, killSent: false, groupGone: true };
      let termSent = false;
      let killSent = false;
      try {
        process.kill(groupTarget, "SIGTERM");
        termSent = true;
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
      let groupGone = await waitUntilGone(groupTarget, record.termGraceMs);
      if (!groupGone) {
        try {
          process.kill(groupTarget, "SIGKILL");
          killSent = true;
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
        }
        groupGone = await waitUntilGone(groupTarget, record.closureTimeoutMs);
      }
      return { termSent, killSent, groupGone };
    })();
    return record.terminationPromise;
  }

  async run(command, args, options = {}) {
    if (this.interruptedBy) throw new Error(`process manager interrupted by ${this.interruptedBy}`);
    if (typeof command !== "string" || !command || !Array.isArray(args) || args.some(arg => typeof arg !== "string")) {
      throw new Error("run requires a command string and literal string argv array");
    }
    const timeoutMs = checkedDuration(options.timeoutMs, this.defaultTimeoutMs, "timeoutMs");
    const termGraceMs = checkedDuration(options.termGraceMs, this.termGraceMs, "termGraceMs");
    const closureTimeoutMs = checkedDuration(options.closureTimeoutMs, this.closureTimeoutMs, "closureTimeoutMs");
    const cwd = options.cwd ?? process.cwd();
    const startedAt = new Date().toISOString();
    const startedNs = process.hrtime.bigint();
    return new Promise((resolvePromise, rejectPromise) => {
      let child;
      try {
        child = spawn(command, args, {
          cwd,
          env: options.env ?? process.env,
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        rejectPromise(error);
        return;
      }
      const pid = child.pid;
      if (!Number.isSafeInteger(pid) || pid < 1) {
        const stdout = [];
        const stderr = [];
        let finished = false;
        let fallback;
        const finish = (status = null, signal = null, spawnError = `spawn did not return an authenticated pid for ${command}`, timedOut = false) => {
          if (finished) return;
          finished = true;
          clearTimeout(fallback);
          const result = {
            command,
            args: [...args],
            cwd,
            status,
            signal,
            pid: null,
            pgid: null,
            timedOut,
            interruptedBy: this.interruptedBy,
            spawnError,
            terminationReason: "no-process-created",
            termination: { termSent: false, killSent: false, groupGone: true },
            closure: { noProcessCreated: true, descendantGroupDetected: false, rootPidGone: true, groupGone: true },
            timeoutMs,
            startedAt,
            finishedAt: new Date().toISOString(),
            durationMs: Number(process.hrtime.bigint() - startedNs) / 1_000_000,
            stdout: Buffer.concat(stdout),
            stderr: Buffer.concat(stderr),
          };
          this.history.push(result);
          resolvePromise(result);
        };
        child.stdout?.on("data", chunk => stdout.push(Buffer.from(chunk)));
        child.stderr?.on("data", chunk => stderr.push(Buffer.from(chunk)));
        child.on("error", error => setImmediate(() => finish(null, null, `${error.name}: ${error.message}`)));
        child.on("close", (status, signal) => finish(status, signal));
        child.stdin?.end(options.input);
        fallback = setTimeout(() => finish(null, null, "spawn without pid did not settle", true), Math.min(timeoutMs, 1_000));
        return;
      }
      const record = {
        pid,
        pgid: pid,
        command,
        args: [...args],
        cwd,
        timeoutMs,
        termGraceMs,
        closureTimeoutMs,
        startedAt,
        stdout: [],
        stderr: [],
        timedOut: false,
        spawnError: undefined,
        terminationPromise: undefined,
        terminationReason: undefined,
      };
      this.active.set(pid, record);
      let completed = false;
      let timeout;
      const finalize = async (status, signal) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        try {
          let descendantGroupDetected = targetExists(-record.pgid);
          let termination = record.terminationPromise ? await record.terminationPromise : undefined;
          if (descendantGroupDetected && !termination) termination = await this.terminate(record, "descendant-group-after-root-close");
          const groupGone = await waitUntilGone(-record.pgid, record.closureTimeoutMs);
          const rootPidGone = await waitUntilGone(record.pid, record.closureTimeoutMs);
          const result = {
            command,
            args: [...args],
            cwd,
            status,
            signal,
            pid: record.pid,
            pgid: record.pgid,
            timedOut: record.timedOut,
            interruptedBy: this.interruptedBy,
            spawnError: record.spawnError,
            terminationReason: record.terminationReason,
            termination: termination ?? { termSent: false, killSent: false, groupGone },
            closure: { descendantGroupDetected, rootPidGone, groupGone },
            timeoutMs,
            startedAt,
            finishedAt: new Date().toISOString(),
            durationMs: Number(process.hrtime.bigint() - startedNs) / 1_000_000,
            stdout: Buffer.concat(record.stdout),
            stderr: Buffer.concat(record.stderr),
          };
          this.active.delete(pid);
          this.history.push(result);
          resolvePromise(result);
        } catch (error) {
          this.active.delete(pid);
          rejectPromise(error);
        }
      };
      child.stdout.on("data", chunk => record.stdout.push(Buffer.from(chunk)));
      child.stderr.on("data", chunk => record.stderr.push(Buffer.from(chunk)));
      child.on("error", error => {
        record.spawnError = `${error.name}: ${error.message}`;
      });
      child.on("close", (status, signal) => void finalize(status, signal));
      child.stdin.on("error", error => {
        if (error?.code !== "EPIPE") record.spawnError ??= `${error.name}: ${error.message}`;
      });
      child.stdin.end(options.input);
      timeout = setTimeout(() => {
        record.timedOut = true;
        void this.terminate(record, "timeout").catch(error => {
          record.spawnError ??= `${error.name}: ${error.message}`;
        });
      }, timeoutMs);
    });
  }

  async shutdown(reason = "manager-shutdown") {
    const records = [...this.active.values()];
    await Promise.all(records.map(record => this.terminate(record, reason)));
    const groupsGone = await Promise.all(records.map(record => waitUntilGone(-record.pgid, record.closureTimeoutMs)));
    const deadline = Date.now() + Math.max(1, ...records.map(record => record.closureTimeoutMs));
    while (records.some(record => this.active.has(record.pid)) && Date.now() < deadline) await delay(25);
    return {
      reason,
      ownedGroups: records.map(record => record.pgid),
      groupsGone,
      childCloseEventsSettled: records.every(record => !this.active.has(record.pid)),
    };
  }

  assertClosed() {
    if (this.active.size) throw new Error(`owned process groups remain active: ${[...this.active.keys()].join(", ")}`);
    for (const result of this.history) {
      if (!result.closure.rootPidGone || !result.closure.groupGone) {
        throw new Error(`owned process closure failed for pid/group ${result.pid}`);
      }
    }
    return {
      spawnedRootPids: this.history.map(result => result.pid),
      spawnedProcessGroups: this.history.map(result => result.pgid),
      everyRootPidGone: true,
      everyOwnedGroupGone: true,
      active: [],
      interruptedBy: this.interruptedBy,
    };
  }
}
