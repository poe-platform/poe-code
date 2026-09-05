import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { Duplex, PassThrough, Readable, Writable } from "node:stream";
import test from "node:test";
import { authenticateOracle, nativeOptions } from "../trap/oracle.js";
import { jobsNativeCases, jobsNativeProfile, type JobsNativeCase } from "./cases.js";

interface OracleChild extends EventEmitter {
  readonly pid: number | undefined;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly control: Duplex;
}

interface NativeResult {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

function collectChild(child: OracleChild, input: Pick<JobsNativeCase, "input" | "releaseOn">,
  terminate: (pid: number) => void,
  deadline: (callback: () => void) => () => void = callback => {
    const timer = setTimeout(callback, jobsNativeProfile.timeoutMs);
    return () => clearTimeout(timer);
  }): Promise<NativeResult> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const marker = input.releaseOn === undefined ? undefined : Buffer.from(input.releaseOn);
    let markerTail = Buffer.alloc(0);
    let total = 0;
    let ended = 0;
    let released = false;
    let closed = false;
    let terminating = false;
    let failure: { reason: unknown } | undefined;
    let cleanupDeadline: ReturnType<typeof setTimeout> | undefined;
    const fail = (reason: unknown): void => {
      if (closed) return;
      failure ??= { reason };
      if (terminating) return;
      terminating = true;
      cleanupDeadline = setTimeout(() => {
        closed = true;
        cancelDeadline();
        child.stdin.destroy();
        child.control.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        reject(new AggregateError([failure!.reason], "Native oracle cleanup did not reach complete close before its deadline"));
      }, jobsNativeProfile.cleanupTimeoutMs);
      if (child.pid !== undefined) {
        try { terminate(child.pid); }
        catch (error) { failure = { reason: new AggregateError([failure.reason, error], "Native oracle termination failed") }; }
      }
    };
    const cancelDeadline = deadline(() => fail(new Error("Native jobs oracle exceeded execution deadline")));
    const releaseInput = (): void => {
      if (released || failure || closed) return;
      released = true;
      child.stdin.end(input.input ?? "");
    };
    const append = (target: Buffer[], chunk: Buffer, isOutput: boolean): void => {
      if (closed || failure) return;
      if (chunk.byteLength > jobsNativeProfile.outputBytes - total) { fail(new Error("Native jobs oracle exceeded output limit")); return; }
      total += chunk.byteLength;
      target.push(Buffer.from(chunk));
      if (isOutput && marker && !released) {
        const window = Buffer.concat([markerTail, chunk]);
        if (window.includes(marker)) releaseInput();
        else markerTail = Buffer.from(window.subarray(Math.max(0, window.length - marker.length + 1)));
      }
    };
    const end = (): void => {
      if (++ended !== 2 || failure || closed) return;
      if (!released) { fail(new Error("Native oracle output ended before the required input handshake")); return; }
      child.control.end("release\n");
    };
    child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk, true));
    child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk, false));
    child.stdout.once("end", end);
    child.stderr.once("end", end);
    for (const stream of [child.stdin, child.stdout, child.stderr, child.control]) stream.on("error", fail);
    child.once("error", fail);
    child.once("close", (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (closed) return;
      closed = true;
      cancelDeadline();
      if (cleanupDeadline !== undefined) clearTimeout(cleanupDeadline);
      child.stdin.destroy();
      child.control.destroy();
      if (failure) reject(failure.reason);
      else if (exitCode === null || signal !== null) reject(new Error(`Native jobs oracle terminated without a status: ${signal}`));
      else if (ended !== 2 || !released) reject(new Error("Native jobs oracle closed before its output/input protocol completed"));
      else resolve({ exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
    if (!marker) releaseInput();
  });
}

async function runCase(entry: JobsNativeCase): Promise<NativeResult> {
  assert.ok(Buffer.byteLength(entry.source) <= 32768);
  assert.ok(Buffer.byteLength(entry.input ?? "") <= 65536);
  assert.ok(entry.releaseOn === undefined || entry.releaseOn.length > 0 && Buffer.byteLength(entry.releaseOn) <= 256);
  const environment = {
    SAFE_BASH_TEST_BASH: process.env.SAFE_BASH_TEST_BASH,
    SAFE_BASH_TEST_BASH_SHA256: process.env.SAFE_BASH_TEST_BASH_SHA256,
  };
  assert.equal(environment.SAFE_BASH_TEST_BASH_SHA256, jobsNativeProfile.sha256, "Qualification requires the pinned Bash build");
  const executable = authenticateOracle(environment);
  let failure: { reason: unknown } | undefined;
  let result: NativeResult | undefined;
  try {
    const supervisor = '"$2" --noprofile --norc -c "$1" shell 3<&-\nstatus=$?\nexec 1>&- 2>&-\nIFS= read -r release <&3\nexit "$status"';
    const child = spawn(executable, ["--noprofile", "--norc", "-c", supervisor, "jobs-oracle-supervisor", entry.source, executable], {
      detached: true, stdio: ["pipe", "pipe", "pipe", "pipe"], env: { PATH: "/__safe_bash_oracle_no_path__", LC_ALL: "C" },
    });
    const owned = Object.assign(child, { control: child.stdio[3] as Duplex }) as OracleChild;
    result = await collectChild(owned, entry, pid => { process.kill(-pid, "SIGKILL"); });
  } catch (reason) { failure = { reason }; }
  try { assert.equal(authenticateOracle(environment), executable); }
  catch (error) {
    if (failure) throw new AggregateError([failure.reason, error], "Native run and post-run authentication failed");
    throw error;
  }
  if (failure) throw failure.reason;
  return result!;
}

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    pid: 777, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), control: new PassThrough(),
  });
}

test("oracle guard: successful complete close never signals the process group", async () => {
  const child = fakeChild();
  let kills = 0;
  const result = collectChild(child, {}, () => { kills++; });
  child.control.once("finish", () => { child.emit("close", 3, null); });
  child.stdout.end("complete\n");
  child.stderr.end();
  assert.deepEqual(await result, { exitCode: 3, stdout: Buffer.from("complete\n"), stderr: Buffer.alloc(0) });
  assert.equal(kills, 0);
});

test("oracle guard: binary stdout and stderr retain independent exact lengths", async () => {
  const child = fakeChild();
  const result = collectChild(child, {}, () => { assert.fail("successful close must not signal"); });
  child.control.once("finish", () => { child.emit("close", 0, null); });
  child.stdout.end(Buffer.from([255, 0]));
  child.stderr.end(Buffer.from([254]));
  assert.deepEqual(await result, { exitCode: 0, stdout: Buffer.from([255, 0]), stderr: Buffer.from([254]) });
});

test("oracle guard: output overflow signals once and waits for complete close", async () => {
  const child = fakeChild();
  let kills = 0;
  let settled = false;
  const result = collectChild(child, {}, pid => { assert.equal(pid, 777); kills++; });
  const rejected = assert.rejects(result, /output limit/u).finally(() => { settled = true; });
  child.stdout.write(Buffer.alloc(jobsNativeProfile.outputBytes + 1));
  await Promise.resolve();
  assert.equal(kills, 1);
  assert.equal(settled, false);
  child.emit("close", null, "SIGKILL");
  await rejected;
  assert.equal(kills, 1);
});

test("oracle guard: timeout drains close and cannot signal after ownership ends", async () => {
  const child = fakeChild();
  let expire!: () => void;
  let cancelled = false;
  let kills = 0;
  const result = collectChild(child, {}, () => { kills++; }, callback => { expire = callback; return () => { cancelled = true; }; });
  const rejected = assert.rejects(result, /deadline/u);
  expire();
  expire();
  assert.equal(kills, 1);
  child.emit("close", null, "SIGKILL");
  await rejected;
  expire();
  assert.equal(kills, 1);
  assert.equal(cancelled, true);
});

test("oracle guard: signalling errors stay failures rather than being suppressed", async () => {
  const child = fakeChild();
  const failure = new Error("stream failed");
  const denied = Object.assign(new Error("signal denied"), { code: "EPERM" });
  const result = collectChild(child, {}, () => { throw denied; });
  const rejected = assert.rejects(result, error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [failure, denied]);
    return true;
  });
  child.stdout.emit("error", failure);
  child.emit("close", null, "SIGKILL");
  await rejected;
});

test("oracle guard: actual output overflow closes the supervised group including a blocked background reader", nativeOptions(), async () => {
  await assert.rejects(runCase({
    name: "owned group overflow",
    source: '{ read -r gate; } <&0 & printf "%70000s" x; wait',
    releaseOn: "never-release-input\n",
    stdout: "",
  }), /output limit/u);
});

for (const entry of jobsNativeCases) test(`Bash 5.2.37 jobs qualification: ${entry.name}`, nativeOptions(), async () => {
  const result = await runCase(entry);
  assert.equal(result.exitCode, entry.exitCode ?? 0, entry.source);
  assert.deepEqual(result.stdout, Buffer.from(entry.stdout), entry.source);
  const stderr = entry.stderrHex === undefined ? Buffer.from(entry.stderr ?? "") : Buffer.from(entry.stderrHex, "hex");
  assert.deepEqual(result.stderr, stderr, entry.source);
});
