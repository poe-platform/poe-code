import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { isolatedSpawn } from "./process.js";
import { hardDeadlineMs, runVirtualBatch, sourceEvidence } from "./helpers.js";
import { maxBatchCases } from "./model.js";
import type { Observation, StressCase } from "./model.js";

const emptyObservation: Observation = {
  stdout: "", stderr: "", stdoutBase64: "", stderrBase64: "", exitCode: 0, files: {},
};

function batchHarness() {
  const calls: string[] = [];
  let aggregate = "unchanged";
  const dependencies = {
    sourceEvidence(): ReturnType<typeof sourceEvidence> {
      calls.push("source");
      return {
        time: "2026-09-01T00:00:00.000Z", revision: "test-revision", node: process.version,
        platform: `${process.platform}/${process.arch}`, aggregate, hashes: {},
        sourceAdmission: { qualification: "mock census", heldSourceFiles: [], heldEvidenceDirectories: [] },
      };
    },
    async isolatedSpawn(...[command, args, options]: Parameters<typeof isolatedSpawn>): ReturnType<typeof isolatedSpawn> {
      calls.push("spawn");
      assert.equal(command, process.execPath);
      assert.ok(args.includes("--unhandled-rejections=strict"));
      assert.equal(options.timeout, hardDeadlineMs);
      assert.equal(options.maxBuffer, 1024 * 1024);
      assert.ok(args.includes("--request-fd=3"));
      assert.ok(!args.includes("tsx"));
      assert.equal(typeof options.input, "string");
      const request = JSON.parse(String(options.extraInput)) as { kind: string; fixtures: StressCase[] };
      assert.equal(request.kind, "batch");
      return {
        pid: 123, error: undefined, status: 0, signal: null,
        stdout: Buffer.from(JSON.stringify(request.fixtures.map(fixture => ({ name: fixture.name, status: "fulfilled", observation: emptyObservation })))),
        stderr: Buffer.alloc(0),
      };
    },
  };
  return { calls, dependencies, changeSource() { aggregate = "changed"; } };
}

test("virtual batch uses one bounded child and fresh before/after source censuses", async () => {
  const harness = batchHarness();
  const fixtures = Array.from({ length: maxBatchCases }, (_, index) => ({ name: `case-${index}`, script: ":" }));
  for (let iteration = 0; iteration < 2; iteration++) {
    const result = await runVirtualBatch(fixtures, harness.dependencies);
    assert.deepEqual(result.outcomes, fixtures.map(fixture => ({ name: fixture.name, status: "fulfilled", observation: emptyObservation })));
    assert.equal(result.before.aggregate, "unchanged");
    assert.equal(result.after.aggregate, "unchanged");
  }
  assert.deepEqual(harness.calls, ["source", "spawn", "source", "source", "spawn", "source"]);
});

test("virtual batch rejects empty and oversized requests before source reads or launch", async () => {
  const harness = batchHarness();
  for (const length of [0, maxBatchCases + 1]) {
    await assert.rejects(runVirtualBatch(Array.from({ length }, (_, index) => ({ name: `case-${index}`, script: ":" })), harness.dependencies));
  }
  assert.deepEqual(harness.calls, []);
});

test("virtual batch rejects changed source without retrying or caching evidence", async () => {
  const harness = batchHarness();
  const spawn = harness.dependencies.isolatedSpawn;
  harness.dependencies.isolatedSpawn = async (...args) => {
    const result = await spawn(...args);
    harness.changeSource();
    return result;
  };
  await assert.rejects(runVirtualBatch([{ name: "source-changing", script: ":" }], harness.dependencies), error => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes("source changed during execution"));
    assert.ok(error.message.includes("source-changing"));
    return true;
  });
  assert.deepEqual(harness.calls, ["source", "spawn", "source"]);
});

test("virtual batch rejects child timeout, stderr, truncation and reordered outcomes without retries", async context => {
  for (const failure of ["timeout", "stderr", "truncation", "reordered"] as const) {
    await context.test(failure, async () => {
      const harness = batchHarness();
      const spawn = harness.dependencies.isolatedSpawn;
      harness.dependencies.isolatedSpawn = async (...args) => {
        const result = await spawn(...args);
        if (failure === "timeout") return { ...result, error: new Error("hard deadline"), signal: "SIGKILL", status: null };
        if (failure === "stderr") return { ...result, stderr: Buffer.from("unexpected diagnostic") };
        if (failure === "truncation") return { ...result, stdout: Buffer.from("[]") };
        return { ...result, stdout: Buffer.from(JSON.stringify([{ name: "wrong-case", status: "fulfilled", observation: emptyObservation }])) };
      };
      await assert.rejects(runVirtualBatch([{ name: "original-case", script: ":" }], harness.dependencies));
      assert.deepEqual(harness.calls, ["source", "spawn", "source"]);
    });
  }
});

test("virtual batch preserves fresh Shell/FS, rejected cases and raw independent observations", async () => {
  const result = await runVirtualBatch([
    { name: "mutate", script: "export STRESS_LEAK=present; set -- dirty; mkdir changed; cd changed; printf saved > marker" },
    { name: "reject", script: ":", limits: { maxCommands: 0 } },
    { name: "fresh", script: 'printf "<%s>:%s:%s" "$STRESS_LEAK" "$#" "$PWD"' },
    { name: "bytes-and-status", script: "printf '\\377\\000'; printf diagnostic >&2; exit 7", initialFiles: { input: "kept" } },
  ]);
  const [mutated, rejected, fresh, bytes] = result.outcomes;
  assert.ok(mutated && mutated.status === "fulfilled");
  assert.deepEqual(mutated.observation.files, { changed: { type: "directory" }, "changed/marker": { type: "file", base64: Buffer.from("saved").toString("base64") } });
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.error.includes("maxCommands"));
  assert.ok(fresh && fresh.status === "fulfilled");
  assert.deepEqual(fresh.observation, { ...emptyObservation, stdout: "<>:0:/work", stdoutBase64: Buffer.from("<>:0:/work").toString("base64") });
  assert.ok(bytes && bytes.status === "fulfilled");
  assert.deepEqual(bytes.observation, {
    stdout: Buffer.from([255, 0]).toString(), stdoutBase64: Buffer.from([255, 0]).toString("base64"),
    stderr: "diagnostic", stderrBase64: Buffer.from("diagnostic").toString("base64"), exitCode: 7,
    files: { input: { type: "file", base64: Buffer.from("kept").toString("base64") } },
  });
});

test("process harness preserves raw stdin/stdout/stderr and nonzero status", async () => {
  const input = Buffer.from([0, 255, 10, 128]);
  const result = await isolatedSpawn(process.execPath, ["-e", 'process.stdin.pipe(process.stdout); process.stdin.on("end", () => { process.stderr.write(Buffer.from([255, 0])); process.exitCode = 7; });'], {
    input, timeout: 2000, maxBuffer: 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 7);
  assert.deepEqual(result.stdout, input);
  assert.deepEqual(result.stderr, Buffer.from([255, 0]));
});

test("process harness preserves child status with unread ordinary stdin", async context => {
  for (const status of [0, 7]) {
    await context.test(`exit ${status}`, async () => {
      const result = await isolatedSpawn(process.execPath, ["--eval", `process.exit(${status})`], {
        input: "x".repeat(1024 * 1024), timeout: 2000, maxBuffer: 1024,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, status);
      assert.equal(result.signal, null);
    });
  }
});

test("process harness scopes benign pipe errors to stdin and preserves cleanup", async context => {
  const spawn = childProcess.spawn;
  const cases = [
    { stream: "stdin", code: "EPIPE", benign: true },
    { stream: "stdin", code: "ECONNRESET", benign: true },
    { stream: "stdin", code: "EIO", benign: false },
    { stream: "stdin", code: undefined, benign: false },
    { stream: "stdout", code: "EPIPE", benign: false },
    { stream: "stdout", code: "ECONNRESET", benign: false },
    { stream: "stderr", code: "EPIPE", benign: false },
    { stream: "stderr", code: "ECONNRESET", benign: false },
  ] as const;
  for (const { stream, code, benign } of cases) {
    await context.test(`${stream} ${code ?? "uncoded"}`, async subtest => {
      const error = Object.assign(new Error(`injected ${stream} ${code}`), { code });
      const mockedSpawn = subtest.mock.method(childProcess, "spawn", (...args: Parameters<typeof spawn>) => {
        const child = spawn(...args);
        queueMicrotask(() => child[stream]!.destroy(error));
        return child;
      });
      syncBuiltinESMExports();
      try {
        const result = await isolatedSpawn(process.execPath, ["--eval", 'process.stdout.write("out"); process.stderr.write("err"); process.exitCode = 7;'], {
          input: "x".repeat(1024 * 1024), timeout: 2000, maxBuffer: 1024,
        });
        assert.equal(result.error, benign ? undefined : error);
        assert.equal(result.status, benign ? 7 : null);
        assert.equal(result.signal, benign ? null : "SIGKILL");
        if (benign) {
          assert.equal(result.stdout.toString(), "out");
          assert.equal(result.stderr.toString(), "err");
        }
        assert.ok(result.pid);
        assert.throws(() => process.kill(-result.pid!, 0), { code: "ESRCH" });
        const child = mockedSpawn.mock.calls[0]!.result!;
        assert.ok(child.stdin!.destroyed && child.stdout!.destroyed && child.stderr!.destroyed);
      } finally {
        mockedSpawn.mock.restore();
        syncBuiltinESMExports();
      }
    });
  }
});

test("process harness retains deadline and output limits after stdin reset", async context => {
  const spawn = childProcess.spawn;
  for (const { code, script, timeout, bytes } of [
    { code: "ETIMEDOUT", script: "while (true) {}", timeout: 150, bytes: 0 },
    { code: "ENOBUFS", script: 'process.stdout.write(Buffer.alloc(2048)); setInterval(() => {}, 1000);', timeout: 2000, bytes: 1024 },
  ]) {
    await context.test(code, async subtest => {
      const mockedSpawn = subtest.mock.method(childProcess, "spawn", (...args: Parameters<typeof spawn>) => {
        const child = spawn(...args);
        queueMicrotask(() => child.stdin!.destroy(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })));
        return child;
      });
      syncBuiltinESMExports();
      try {
        const result = await isolatedSpawn(process.execPath, ["--eval", script], {
          input: "x".repeat(1024 * 1024), timeout, maxBuffer: 1024,
        });
        assert.equal((result.error as NodeJS.ErrnoException | undefined)?.code, code);
        assert.equal(result.status, null);
        assert.equal(result.signal, "SIGKILL");
        assert.equal(result.stdout.length + result.stderr.length, bytes);
        assert.ok(result.pid);
        assert.throws(() => process.kill(-result.pid!, 0), { code: "ESRCH" });
      } finally {
        mockedSpawn.mock.restore();
        syncBuiltinESMExports();
      }
    });
  }
});

test("process harness hard-kills a synchronous infinite loop", async () => {
  const started = performance.now();
  const result = await isolatedSpawn(process.execPath, ["-e", "while (true) {}"], { timeout: 150, maxBuffer: 1024 });
  assert.match(result.error?.message ?? "", /hard deadline/u);
  assert.equal(result.signal, "SIGKILL");
  assert.ok(performance.now() - started < 2000, "Hard deadline must settle promptly");
  assert.ok(result.pid);
  assert.throws(() => process.kill(result.pid!, 0), error => error instanceof Error && "code" in error && error.code === "ESRCH");
});

test("Bash waits for a no-write upstream even after the consumer exits", async () => {
  const result = await isolatedSpawn("/bin/bash", ["--noprofile", "--norc", "-c", "sleep 30 | { printf consumed >&2; :; }"], {
    cwd: tmpdir(), env: { PATH: "/usr/bin:/bin", HOME: tmpdir(), LANG: "C", LC_ALL: "C", TZ: "UTC" },
    timeout: 200, maxBuffer: 1024,
  });
  assert.match(result.error?.message ?? "", /hard deadline/u);
  assert.equal(result.signal, "SIGKILL");
  assert.equal(result.stdout.length, 0);
  assert.equal(result.stderr.toString(), "consumed");
});

test("process harness applies one combined stdout/stderr byte ceiling", async () => {
  const result = await isolatedSpawn(process.execPath, ["-e", 'process.stdout.write(Buffer.alloc(80)); process.stderr.write(Buffer.alloc(80)); setInterval(() => {}, 1000);'], {
    timeout: 2000, maxBuffer: 128,
  });
  assert.match(result.error?.message ?? "", /output ceiling/u);
  assert.equal(result.signal, "SIGKILL");
  assert.equal(result.stdout.length + result.stderr.length, 128);
});

test("process harness kills descendants holding inherited pipes after parent exit", async () => {
  const script = 'const {spawn} = require("node:child_process"); const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], {stdio: "inherit"}); console.log(child.pid); child.unref();';
  const result = await isolatedSpawn(process.execPath, ["-e", script], { timeout: 2000, maxBuffer: 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  const descendant = Number(result.stdout.toString().trim());
  assert.ok(Number.isSafeInteger(descendant) && descendant > 0);
  let exists = true;
  for (let attempt = 0; attempt < 100 && exists; attempt++) {
    try { process.kill(descendant, 0); await delay(10); }
    catch (error) {
      assert.ok(error instanceof Error && "code" in error && error.code === "ESRCH");
      exists = false;
    }
  }
  assert.equal(exists, false, `Descendant ${descendant} survived group cleanup`);
});

test("isolated child receives independent script and request input channels", async () => {
  const result = await isolatedSpawn(process.execPath, ["--input-type=module", "-"], {
    input: 'import {readFileSync} from "node:fs";process.stdout.write(readFileSync(3));',
    extraInput: "owned request", timeout: 2000, maxBuffer: 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.toString(), "owned request");
});

test("isolated child safely closes an unread extra input pipe", async () => {
  const result = await isolatedSpawn(process.execPath, ["--eval", "process.exit(0)"], {
    extraInput: "x".repeat(1024 * 1024), timeout: 2000, maxBuffer: 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
});

test("isolated request input drains beyond pipe capacity", async () => {
  const request = "payload".repeat(32768);
  const result = await isolatedSpawn(process.execPath, ["--input-type=module", "-"], {
    input: 'import {readFileSync} from "node:fs";const value=readFileSync(3,"utf8");console.log(value.length);',
    extraInput: request, timeout: 2000, maxBuffer: 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), `${request.length}\n`);
});

test("bundled virtual batches retain native regex worker asset resolution", async () => {
  const result = await runVirtualBatch([
    { name: "native grep", script: "printf 'alpha\\nbeta\\n' | grep '^a.*a$'" },
    { name: "native extended grep", script: "printf 'alpha\\nbeta\\n' | grep -E '^b.+a$'" },
  ]);
  assert.deepEqual(result.outcomes.map(outcome => outcome.status === "fulfilled" ? [outcome.observation.exitCode, outcome.observation.stdout] : outcome), [
    [0, "alpha\n"], [0, "beta\n"],
  ]);
});

test("isolated output overflow retires a blocked extra input pipe", async () => {
  const result = await isolatedSpawn(process.execPath, ["--eval", 'process.stdout.write(Buffer.alloc(2048));setInterval(() => {},1000);'], {
    extraInput: "x".repeat(1024 * 1024), timeout: 2000, maxBuffer: 1024,
  });
  assert.equal((result.error as NodeJS.ErrnoException).code, "ENOBUFS");
  assert.equal(result.stdout.length + result.stderr.length, 1024);
  assert.ok(result.pid);
  assert.throws(() => process.kill(-result.pid!, 0), { code: "ESRCH" });
});

for (const [channel, code, exitStatus] of [
  [0, "ECONNRESET", 0], [3, "ECONNRESET", 0],
  [1, "ECONNRESET", 0], [2, "ECONNRESET", 0],
  [3, "ECONNRESET", 7], [3, "EIO", 0],
] as const) test(`isolated pipe ${channel} ${code} preserves exit ${exitStatus} ownership`, async context => {
  const spawn = childProcess.spawn;
  const reason = Object.assign(new Error(`read ${code}`), { code });
  context.mock.method(childProcess, "spawn", (...args: Parameters<typeof spawn>) => {
    const child = spawn(...args);
    queueMicrotask(() => child.stdio[channel]!.emit("error", reason));
    return child;
  });
  syncBuiltinESMExports();
  context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
  const result = await isolatedSpawn(process.execPath, ["--eval", `process.exit(${exitStatus})`], {
    extraInput: "request", timeout: 2000, maxBuffer: 1024,
  });
  const inputReset = (channel === 0 || channel === 3) && code === "ECONNRESET";
  assert.equal(result.error, inputReset ? undefined : reason);
  if (inputReset) assert.equal(result.status, exitStatus);
  assert.ok(result.pid);
  assert.throws(() => process.kill(-result.pid!, 0), { code: "ESRCH" });
});
