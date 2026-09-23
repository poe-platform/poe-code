import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createContext, runInContext } from "node:vm";
import { parseDuration } from "../../src/commands/timeout/duration.js";
import { Shell, CommandRegistry, agentCommands, createAgentCommands, createMemoryFileSystem } from "../../src/index.js";

for (const option of ["-v", "--verbose"]) {
  test(`timeout ${option} preserves immediate child output and status`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/Changed input.txt", new TextEncoder().encode("Changed12\r\n"));
    const shell = new Shell({ fs, commands: new CommandRegistry(createAgentCommands()) });
    try {
      for (const [command, expectedCode, expectedOutput] of [
        [`timeout ${option} 2 cat "Changed input.txt"`, 0, "Changed12\r\n"],
        [`timeout ${option} 2 sh -c 'printf output; exit 9'`, 9, "output"],
        [`timeout ${option} 0 echo disabled`, 0, "disabled\n"],
      ] as const) {
        const result = await shell.exec(command);
        assert.equal(result.exitCode, expectedCode);
        assert.equal(result.stdout, expectedOutput);
        assert.equal(result.stderr, "");
      }
    } finally { await shell.dispose(); }
  });
}

test("verbose timeout reports cooperative expiry only when the deadline expires", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(createAgentCommands()) });
  try {
    const result = await shell.exec("timeout --verbose 0.001 sleep 1");
    assert.equal(result.exitCode, 124);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "timeout: cooperative deadline expired for command ‘sleep’\n");
    assert.equal((await shell.exec("timeout --verbose=yes 2 echo rejected")).exitCode, 125);
  } finally { await shell.dispose(); }
});

test("timeout parses finite GNU floating-point durations with millisecond rounding", () => {
  for (const [token, milliseconds] of [
    ["+0.0", 0], ["-0.0", 0], [" 0.0", 0], ["0E-3", 0], ["0x0p+2", 0],
    ["+3.0", 3000], [" 3.0", 3000], ["3E-0", 3000], ["0x1.8p1", 3000],
    ["3E0s", 3000], ["0x1.8p1s", 3000], ["0.0s", 0],
    ["\t\n+3e0", 3000], ["0X1.8P+1m", 180000], ["0x.8p1h", 3600000],
    ["1e-4", 1], ["0x1p-20", 1], ["1.001e0", 1001],
    ["9007199254740.991", Number.MAX_SAFE_INTEGER],
    ["9007199254740.992", 9007199254740992], ["9.007199254740992e12", 9007199254740992],
    ["9007199254742", 9007199254742000], ["150119987580m", 9007199254800000],
    ["2501999793h", 9007199254800000], ["104249993d", 9007199395200000],
    ["1e308", Number.MAX_VALUE], ["1e308d", Number.MAX_VALUE],
    ["9.007199254740991e12", Number.MAX_SAFE_INTEGER], ["1e-999999", 1],
    ["-0x0p99", 0], ["0e999999", 0], ["0x1d", 29000], ["0x1p0d", 86400000],
  ] as const) assert.deepEqual(parseDuration(token), { kind: "value", milliseconds }, token);
  for (const token of ["", " ", ".", "+", "3 ", "3s ", "-2", "-1e-999999", "NaN", "1e", "1e+", "0x", "0xp1", "0x1p", "0x1.2.3", "1ss", "0b11", "1_0"]) {
    assert.deepEqual(parseDuration(token), { kind: "invalid" }, token);
  }
  for (const token of ["1e999999", "0x1p999999"]) {
    assert.deepEqual(parseDuration(token), { kind: "overflow" }, token);
  }
});

test("timeout large finite durations preserve child bytes and status with the default scheduler", async () => {
  const fs = createMemoryFileSystem();
  const bytes = Uint8Array.of(67, 252, 0, 13, 10);
  await fs.writeFile("/Range.bin", bytes);
  const shell = new Shell({ fs });
  await shell.use(agentCommands());
  try {
    for (const token of ["9007199254740.992", "9007199254741", "9007199254742", "10000000000000", "150119987580m", "2501999793h", "104249992d", "104249993d", "1e308d"]) {
      const chunks: Uint8Array[] = [];
      const result = await shell.exec(`timeout -- '${token}' cat /Range.bin`, {
        stdout: { async write(chunk) { chunks.push(Uint8Array.from(chunk)); } },
      });
      assert.equal(result.exitCode, 0, token);
      assert.equal(result.stderr, "", token);
      assert.deepEqual(Buffer.concat(chunks), Buffer.from(bytes), token);
      const status = await shell.exec(`timeout --kill-after='${token}' -- '${token}' sh -c 'exit 11'`);
      assert.equal(status.exitCode, 11, token);
      assert.equal(status.stderr, "", token);
    }
  } finally { await shell.dispose(); }
});

test("timeout GNU duration spellings preserve file and raw stdin bytes through Shell", async () => {
  const fs = createMemoryFileSystem();
  const bytes = Uint8Array.of(67, 249, 0, 13, 10);
  await fs.writeFile("/Changed duration.txt", bytes);
  const shell = new Shell({ fs });
  await shell.use(agentCommands());
  try {
    for (const token of ["+0.0", "-0.0", " 0.0", "0E-3", "0x0p+2", "+3.0", " 3.0", "3E-0", "0x1.8p1", "3E0s", "0x1.8p1s", "0.0s"]) {
      for (const file of [false, true]) {
        const chunks: Uint8Array[] = [];
        const result = await shell.exec(`timeout -- '${token}' cat${file ? " '/Changed duration.txt'" : ""}`, {
          stdin: bytes,
          stdout: { async write(chunk) { chunks.push(Uint8Array.from(chunk)); } },
        });
        assert.equal(result.exitCode, 0, token);
        assert.equal(result.stderr, "", token);
        assert.deepEqual(Buffer.concat(chunks), Buffer.from(bytes), token);
      }
    }
  } finally { await shell.dispose(); }
});

test("timeout scheduler browser graph has no Node clock or timer dependency", async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../../src/commands/timeout/scheduler.ts", import.meta.url))],
    bundle: true, write: false, metafile: true, platform: "browser", format: "cjs", target: "es2022",
    conditions: ["workerd", "worker", "browser"], logLevel: "silent",
  });
  assert.deepEqual(Object.values(result.metafile!.outputs).flatMap(output => output.imports), []);
  let now = 0;
  let nextHandle = 0;
  let clockCalls = 0;
  const active = new Map<number, () => void>();
  const delays: number[] = [];
  const cleared: number[] = [];
  const performance = { now() { assert.equal(this, performance); clockCalls++; return now; } };
  const sandbox = createContext({
    AbortController, performance,
    setTimeout(this: unknown, callback: () => void, milliseconds: number) {
      assert.equal(this, globalObject);
      delays.push(milliseconds);
      active.set(nextHandle, callback);
      return nextHandle++;
    },
    clearTimeout(this: unknown, handle: number) {
      assert.equal(this, globalObject);
      cleared.push(handle);
      active.delete(handle);
    },
  });
  const globalObject: unknown = runInContext("globalThis", sandbox);
  const scheduler = runInContext(`(function(){ const module = { exports: {} }; ${result.outputFiles![0]!.text}; return module.exports; })()`, sandbox) as typeof import("../../src/commands/timeout/scheduler.js");
  const deadline = scheduler.createDeadline(scheduler.defaultSchedulerBinding, 25, 10);
  deadline.start();
  assert.ok(active.has(0));
  now = 7;
  active.get(0)!();
  now = 20;
  active.get(1)!();
  now = 25;
  active.get(2)!();
  assert.equal(deadline.signal.reason, deadline.deadlineReason);
  assert.deepEqual(delays, [10, 10, 5]);
  const retirement = deadline.retire();
  assert.equal(deadline.retire(), retirement);
  await retirement;
  assert.deepEqual(cleared, [0, 1, 2]);
  assert.equal(active.size, 0);
  const early = scheduler.createDeadline(scheduler.defaultSchedulerBinding, Number.MAX_VALUE, 10);
  early.start();
  assert.equal(delays.at(-1), 10);
  const lateWake = active.get(3)!;
  await early.retire();
  const beforeWake = clockCalls;
  lateWake();
  assert.equal(clockCalls, beforeWake);
  assert.equal(early.signal.aborted, false);
  assert.equal(active.size, 0);
});
