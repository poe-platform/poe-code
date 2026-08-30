import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { isolatedSpawn } from "./process.js";

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
