import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { getEventListeners } from "node:events";
import test from "node:test";
import { CommandRegistry, type PluginHost } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { Shell, ShellLimitError } from "../../../src/shell/index.js";
import { timeEnvCommands, createTimeEnvCommands } from "../../../src/commands/time-env/index.js";
import { run, Timers } from "./helpers.js";

test("time-env definitions and plugin collision preflight are atomic", () => {
  assert.deepEqual(createTimeEnvCommands().map(command => command.name), ["date", "sleep", "printenv"]);
  const existing = { name: "printenv", execute: () => ({ exitCode: 42 }) };
  const host: PluginHost = { commands: new CommandRegistry([existing]), use() {}, registerFileSystem() {} };
  assert.throws(() => timeEnvCommands().setup(host), /already registered/);
  assert.deepEqual(host.commands.list().map(command => command.name), ["printenv"]);
  timeEnvCommands({ replace: true }).setup(host);
  assert.equal(host.commands.list().length, 3);
  assert.notEqual(host.commands.get("printenv")?.execute, existing.execute);
});

test("actual Shell pipelines, virtual files, command substitutions and replaced environments", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, env: { LEAK: "host-independent parent" } }).use(standardCommands()).use(timeEnvCommands({ clock: () => 1709210096123 }));
  try {
    const result = await shell.exec("stamp=$(date -u +%F); printf '%s\\n' \"$stamp\" > stamp; env -i A=hello EMPTY= printenv -0 A EMPTY > values; sleep .001; cat stamp; env -i A=hello printenv A | tr a-z A-Z");
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, ""); assert.equal(result.stdout, "2024-02-29\nHELLO\n");
    assert.equal(Buffer.from(await fs.readFile("/values")).toString("hex"), "68656c6c6f0000");
    assert.equal((await shell.exec("env -i printenv LEAK")).exitCode, 1);
    assert.equal((await shell.exec("printenv LEAK")).stdout, "host-independent parent\n");
    assert.equal((await shell.exec("env TZ=UTC-05:30 date -d@0 +%T")).stdout, "05:30:00\n");
  } finally { await shell.dispose(); }
});

test("actual shell propagates own prototype-shaped environment data through printenv", async () => {
  const env = Object.create(null) as Record<string, string>;
  env.__proto__ = "prototype data"; Object.defineProperty(env, "constructor", { value: "constructor data", enumerable: true });
  const shell = new Shell({ fs: createMemoryFileSystem(), env }).use(timeEnvCommands());
  try {
    const result = await shell.exec("printenv __proto__ constructor");
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, "prototype data\nconstructor data\n");
  } finally { await shell.dispose(); }
});

test("sleep output is zero under a zero shared output budget; real writes still charge", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { A: "value" } }).use(timeEnvCommands({ clock: () => 0 }));
  try {
    const result = await shell.exec("sleep 0", { limits: { maxOutputBytes: 0 } });
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, "");
    await assert.rejects(shell.exec("printenv A", { limits: { maxOutputBytes: 2 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    await assert.rejects(shell.exec("date +%s", { limits: { maxOutputBytes: 1 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  } finally { await shell.dispose(); }
});

test("actual Shell cancellation stops sleep before following command and clears the timer", async () => {
  const scheduler = new Timers(), controller = new AbortController();
  const reason = new Error("cancel sleep pipeline");
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(timeEnvCommands({ scheduler }));
  try {
    const execution = shell.exec("sleep 100; date +%s", { signal: controller.signal });
    for (let attempts = 0; attempts < 100 && !scheduler.pending.size; attempts++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(scheduler.pending.size, 1);
    controller.abort(reason);
    await assert.rejects(execution, error => error === reason);
    assert.equal(scheduler.pending.size, 0);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  } finally { controller.abort(reason); await shell.dispose(); }
});

test("default long timer cancellation permits its isolated process to exit", () => {
  const source = `import { createTimeEnvCommands } from './src/commands/time-env/index.ts';
import { createMemoryFileSystem } from './src/fs/memory/index.ts';
const controller = new AbortController();
const reason = new Error('owned abort');
const command = createTimeEnvCommands().find(entry => entry.name === 'sleep');
const result = command.execute({ command:'sleep', args:['3600'], cwd:'/', env:{}, fs:createMemoryFileSystem(), signal:controller.signal,
stdin:(async function*(){})(), stdout:{async write(){throw new Error('unexpected output')}}, stderr:{async write(){throw new Error('unexpected output')}} });
setTimeout(() => controller.abort(reason), 10);
try { await result; throw new Error('missing abort'); } catch(error) { if(error !== reason) throw error; }
`;
  const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--input-type=module", "-e", source], {
    cwd: new URL("../../../", import.meta.url), env: { LC_ALL: "C", TZ: "not/a/real/zone" }, timeout: 3000, maxBuffer: 65536,
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr.toString()); assert.equal(result.signal, null);
});

test("date and printenv await sink backpressure and preserve cancellation", async () => {
  for (const name of ["date", "printenv"]) {
    const controller = new AbortController(), reason = new Error("cancel held output");
    let started!: () => void;
    const gate = new Promise<void>(resolve => { started = resolve; });
    let finish!: () => void;
    const held = new Promise<void>(resolve => { finish = resolve; });
    const result = run(name, name === "date" ? ["-d@0", "+%s"] : ["A"], {}, {
      env: { A: "雪" }, signal: controller.signal, stdout: { async write() { started(); await held; } },
    });
    await gate; controller.abort(reason);
    await assert.rejects(result, error => error === reason); finish();
  }
});

test("all three validate bounded arguments and factory settings", async () => {
  for (const name of ["date", "sleep", "printenv"]) {
    await assert.rejects(run(name, ["x".repeat(9)], { limits: { maxArgumentBytes: 8 } }), { code: "EFBIG" });
    await assert.rejects(run(name, ["", ""], { limits: { maxArguments: 1 } }), { code: "EFBIG" });
  }
  assert.throws(() => createTimeEnvCommands({ maxTimerMilliseconds: 0 }), RangeError);
  assert.throws(() => createTimeEnvCommands({ maxTimerMilliseconds: 2147483648 }), RangeError);
  assert.throws(() => createTimeEnvCommands({ limits: { maxOutputBytes: NaN } }), RangeError);
  assert.throws(() => createTimeEnvCommands({ defaultTimeZone: "not/a/timezone" }), /unsupported virtual TZ/);
});

test("VFS reference decimal millisecond precision and empty operands are explicit", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Buffer.from("bytes"));
  for (const [time, expected] of [[123.456, "0 123456000\n"], [-0.001, "-1 999999000\n"], [-123.456, "-1 876544000\n"]] as const) {
    await fs.utimes!("/file", time, time);
    assert.equal((await run("date", ["-r/file", "+%s %N"], {}, { fs })).stdout, expected);
  }
  assert.equal((await run("date", ["-r", ""], {}, { fs })).exitCode, 1);
});
