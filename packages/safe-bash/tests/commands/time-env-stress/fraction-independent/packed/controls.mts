import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { getEventListeners } from "node:events";
import * as api from "virtual-bash";
import { Shell, MemoryFileSystem, CommandRegistry, agentCommands, type CommandContext } from "virtual-bash";
import { createTimeEnvCommands, timeEnvCommands, type TimeEnvCommandsOptions,
  type SleepScheduler } from "./node_modules/virtual-bash/dist/commands/time-env/index.js";

const rows: Record<string, unknown>[] = [];
const hostEnvironment = { ...process.env };
const hostNow = Date.now;
async function check(name: string, scope: string, action: (row: Record<string, unknown>) => Promise<void>) {
  const row: Record<string, unknown> = { name, scope };
  try { await action(row); row.result = "pass"; }
  catch (error) { row.result = "fail"; row.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error); }
  rows.push(row);
}
async function capture(args: string[], options: TimeEnvCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = { command: "date", args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr.push(bytes.slice()); } }, ...overrides };
  try {
    const result = await createTimeEnvCommands(options)[0]!.execute(context);
    return { status: result.exitCode, stdoutHex: Buffer.concat(stdout).toString("hex"), stderrHex: Buffer.concat(stderr).toString("hex") };
  } catch (error) {
    return { thrown: error instanceof Error ? { name: error.name, message: error.message,
      code: "code" in error ? String(error.code) : undefined } : String(error),
    stdoutHex: Buffer.concat(stdout).toString("hex"), stderrHex: Buffer.concat(stderr).toString("hex") };
  }
}
await check("public export absence is a capability gap, not public leaf acceptance", "public-root-boundary", async row => {
  row.timeEnvRootExport = "timeEnvCommands" in api;
  assert.equal(row.timeEnvRootExport, false);
  const missing = "virtual-bash/commands/time-env";
  await assert.rejects(import(missing), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  row.subpathError = "ERR_PACKAGE_PATH_NOT_EXPORTED";
  const registry = new CommandRegistry();
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: registry }).use(agentCommands());
  try {
    await shell.exec(":"); row.names = registry.list().map(command => command.name).sort();
    assert.equal(registry.list().length, 65);
    for (const name of ["date", "sleep", "printenv", "curl", "safejs"]) assert.equal(registry.has(name), false);
    const result = await shell.exec("date -d@0 +%N");
    row.missingCommand = { status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") };
    assert.equal(result.exitCode, 127);
  } finally { await shell.dispose(); }
});
await check("public Shell counts repeated identical byte writes without deduplication", "public-root-limits", async row => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxOutputBytes: 3 } }).use({ name: "repeated", setup(host) {
    host.commands.register({ name: "repeated", async execute(context) {
      const bytes = new Uint8Array([120, 121]);
      await context.stdout.write(bytes); await context.stdout.write(bytes);
      return { exitCode: 0 };
    } });
  } });
  try {
    await assert.rejects(shell.exec("repeated"), error => {
      row.error = { name: (error as Error).name, message: (error as Error).message };
      return error instanceof api.ShellLimitError;
    });
  } finally { await shell.dispose(); }
});
await check("public registry rejects collisions without partial family registration", "public-root-with-internal-leaf", async row => {
  const registry = new CommandRegistry();
  registry.register({ name: "sleep", async execute() { return { exitCode: 0 }; } });
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: registry }).use(timeEnvCommands());
  try {
    await assert.rejects(shell.exec(":"), /already registered/);
    row.names = registry.list().map(command => command.name);
    assert.deepEqual(row.names, ["sleep"]);
  } finally { await shell.dispose(); }
});
await check("runtime invalid clock, scheduler and limit definitions reject", "internal-packed-leaf", async row => {
  const errors: string[] = [];
  for (const options of [{ clock: 1 }, { scheduler: { now: () => 0 } }, { limits: { maxOutputBytes: 0 } },
    { limits: { maxFormatWidth: -1 } }, { maxTimerMilliseconds: 0 }]) {
    assert.throws(() => createTimeEnvCommands(options as unknown as TimeEnvCommandsOptions), error => {
      errors.push((error as Error).message); return error instanceof TypeError || error instanceof RangeError;
    });
  }
  row.errors = errors; assert.equal(errors.length, 5);
});
await check("clock milliseconds are sampled once; explicit fraction samples zero times", "internal-packed-leaf-host", async row => {
  let samples = 0;
  const options = { clock: () => { samples++; return 1704164645123; } };
  row.now = await capture(["+%N|%17N|%-N"], options);
  assert.deepEqual(row.now, { status: 0, stdoutHex: Buffer.from("123000000|12300000000000000|123\n").toString("hex"), stderrHex: "" });
  assert.equal(samples, 1);
  row.explicit = await capture(["-d@0.123456789", "+%N|%-N"], options);
  assert.deepEqual(row.explicit, { status: 0, stdoutHex: Buffer.from("123456789|123456789\n").toString("hex"), stderrHex: "" });
  assert.equal(samples, 1); row.samples = samples;
});
for (const specimen of [
  { name: "width-default-rejection", args: ["-d@0", "+%4097N"], options: {} },
  { name: "width-admitted-but-output-rejected", args: ["-d@0", "+%4096N"], options: { limits: { maxOutputBytes: 4096 } } },
  { name: "UTF8-and-newline-budget", args: ["-d@0.123", "+雪%3N|%6N"], options: { limits: { maxOutputBytes: 13 } } },
  { name: "repeated-fractions-budget", args: ["-d@0.123", "+%3N%3N"], options: { limits: { maxOutputBytes: 6 } } },
]) await check(specimen.name, "internal-packed-leaf-limits", async row => {
  const actual = await capture(specimen.args, specimen.options); row.actual = actual;
  assert.ok("thrown" in actual); assert.equal(typeof actual.thrown, "object");
  assert.equal((actual.thrown as { code: string }).code, "EFBIG");
  assert.equal(actual.stdoutHex, ""); assert.equal(actual.stderrHex, "");
});
await check("output budget exact positive boundary", "internal-packed-leaf-limits", async row => {
  row.actual = await capture(["-d@0.123", "+雪%3N|%6N"], { limits: { maxOutputBytes: 14 } });
  assert.deepEqual(row.actual, { status: 0, stdoutHex: Buffer.from("雪123|123000\n").toString("hex"), stderrHex: "" });
});
await check("clock setting and invalid grammar refuse without clock access", "internal-packed-leaf-capability", async row => {
  let samples = 0;
  const outcomes = [];
  for (const args of [["--set=@0"], ["-d@0", "+%EN"], ["--unknown-option"]]) {
    const actual = await capture(args, { clock: () => { samples++; return 0; } }); outcomes.push({ args, actual });
    assert.equal("status" in actual && actual.status, 1); assert.equal(actual.stdoutHex, ""); assert.notEqual(actual.stderrHex, "");
  }
  assert.equal(samples, 0); row.samples = samples; row.outcomes = outcomes;
});
await check("preabort precedes clock sampling and sink publication", "internal-packed-leaf-cancellation", async row => {
  const controller = new AbortController(); const reason = Object.freeze({ independentAbort: true }); controller.abort(reason);
  let samples = 0, writes = 0;
  const definition = createTimeEnvCommands({ clock: () => { samples++; return 0; } })[0]!;
  const context: CommandContext = { command: "date", args: ["+%N"], cwd: "/", env: {}, fs: new MemoryFileSystem(),
    signal: controller.signal, stdin: (async function* () {})(), stdout: { async write() { writes++; } }, stderr: { async write() { writes++; } } };
  await assert.rejects(async () => await definition.execute(context), error => error === reason);
  row.samples = samples; row.writes = writes; assert.equal(samples, 0); assert.equal(writes, 0);
});
await check("public Shell cancellation removes injected sleep timer and listeners", "public-root-with-internal-leaf", async row => {
  const pending = new Set<ReturnType<typeof setTimeout>>(); const signals: AbortSignal[] = [];
  let admitted!: () => void; const admission = new Promise<void>(resolve => { admitted = resolve; });
  const scheduler: SleepScheduler = { now: () => performance.now(), setTimeout(callback, milliseconds) {
    const timer = setTimeout(callback, milliseconds); pending.add(timer); admitted(); return timer;
  }, clearTimeout(handle) { clearTimeout(handle as ReturnType<typeof setTimeout>); pending.delete(handle as ReturnType<typeof setTimeout>); } };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(timeEnvCommands({ scheduler })).use({ name: "signal-capture", setup(host) {
    host.use(async (context, next) => { signals.push(context.signal); return await next(); });
  } });
  const controller = new AbortController(); const reason = Object.freeze({ cancellation: "owned" });
  try {
    const rejection = assert.rejects(shell.exec("sleep 600", { signal: controller.signal }), error => error === reason);
    await admission; controller.abort(reason); assert.equal(pending.size, 0); await rejection;
    row.pending = pending.size; row.listeners = signals.map(signal => getEventListeners(signal, "abort").length);
    assert.ok(signals.every(signal => getEventListeners(signal, "abort").length === 0));
  } finally { controller.abort(reason); await shell.dispose(); for (const timer of pending) clearTimeout(timer); }
});
await check("host environment and Date.now binding are unchanged", "host-isolation", async row => {
  assert.deepEqual({ ...process.env }, hostEnvironment); assert.equal(Date.now, hostNow);
  row.hostTZ = process.env.TZ; row.actual = await capture(["-d@0", "+%T %z"]);
  assert.deepEqual(row.actual, { status: 0, stdoutHex: Buffer.from("00:00:00 +0000\n").toString("hex"), stderrHex: "" });
});
await writeFile(`${process.env.REVIEW_OUTPUT}/controls.json`, JSON.stringify({ rows }, null, 2));
console.log(JSON.stringify({ total: rows.length, pass: rows.filter(row => row.result === "pass").length, failures: rows.filter(row => row.result === "fail") }));
if (rows.some(row => row.result === "fail")) process.exitCode = 1;
