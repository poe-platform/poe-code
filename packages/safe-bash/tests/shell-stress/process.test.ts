import assert from "node:assert/strict";
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
      const request = JSON.parse(String(options.input)) as { kind: string; fixtures: StressCase[] };
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
  assert.deepEqual(fresh.observation, { ...emptyObservation, stdout: "<>:0:/", stdoutBase64: Buffer.from("<>:0:/").toString("base64") });
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
