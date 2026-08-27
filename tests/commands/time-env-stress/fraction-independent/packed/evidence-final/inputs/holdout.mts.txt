import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { getEventListeners } from "node:events";
import { writeFile } from "node:fs/promises";
import { Shell, MemoryFileSystem, CommandRegistry, agentCommands, type CommandContext } from "virtual-bash";
import { createTimeEnvCommands, timeEnvCommands, type SleepScheduler, type TimeEnvCommandsOptions } from "./node_modules/virtual-bash/dist/commands/time-env/index.js";

type Capture = { status: number; stdoutHex: string; stderrHex: string };
const rows: Record<string, unknown>[] = [];
const environmentBefore = { ...process.env };
const output = process.env.REVIEW_OUTPUT!;
async function check(name: string, category: string, test: (record: Record<string, unknown>) => Promise<void>) {
  const record: Record<string, unknown> = { name, category };
  try { await test(record); record.result = "pass"; }
  catch (error) { record.result = "fail"; record.error = error instanceof Error ? { message: error.message, stack: error.stack } : error; }
  rows.push(record);
  if (record.result === "fail") console.log(JSON.stringify(record));
}
async function direct(name: string, args: readonly string[], options: TimeEnvCommandsOptions = {}, overrides: Partial<CommandContext> = {}): Promise<Capture> {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = { command: name, args, cwd: "/", env: Object.create(null) as Record<string, string>, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } }, ...overrides };
  const result = await createTimeEnvCommands(options).find(command => command.name === name)!.execute(context);
  return { status: result.exitCode, stdoutHex: Buffer.concat(stdout).toString("hex"), stderrHex: Buffer.concat(stderr).toString("hex") };
}
function native(args: string[], zone: string): Capture {
  const result = spawnSync(`${process.env.GNU_DIR}/date`, args, { cwd: process.env.TMPDIR, env: { LC_ALL: "C", TZ: zone }, timeout: 3000, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error); assert.equal(result.signal, null); assert.notEqual(result.status, null);
  return { status: result.status!, stdoutHex: result.stdout.toString("hex"), stderrHex: result.stderr.toString("hex") };
}
const flags = ["2", "5", "7", "8", "10", "17", "_07", "0_7", "-_7", "_-7", "-07", "0-7", "^^#7", "##^17", "#^_17"];
const codes = ["F", "D", "c", "r", "P", "p", "a", "A", "B", "Y", "y", "C", "G", "g", "s", "z", ":z", "::z", ":::z"];
for (const instant of ["0000-06-02T12:34:56Z", "0099-12-30T12:34:56Z", "0100-03-01T12:34:56Z", "9999-06-30T12:34:56Z", "@-0.000000001", "2020-12-31T23:59:59.999999999Z"]) {
  for (const zone of ["UTC", "UTC+0:01:59", "UTC-12:59:59", "America/New_York"]) {
    await check(`format neighbors ${instant} ${zone}`, "GNU9.7-Darwin-required-format", async record => {
      const directives = codes.flatMap(code => flags.map(flag => `%${flag}${code}`));
      const args = ["-d", instant, `+${directives.join("|")}`];
      const expected = native(args, zone), actual = await direct("date", args, {}, { env: { TZ: zone } });
      Object.assign(record, { args, zone, directives: directives.length, expected, actual });
      assert.equal(expected.status, 0);
      const expectedFields = Buffer.from(expected.stdoutHex, "hex").toString().trimEnd().split("|");
      const actualFields = Buffer.from(actual.stdoutHex, "hex").toString().trimEnd().split("|");
      record.differences = directives.flatMap((directive, index) => expectedFields[index] === actualFields[index] ? [] : [{ directive, expected: expectedFields[index], actual: actualFields[index] }]);
      assert.deepEqual(actual, expected);
    });
  }
}
for (const precision of ["", "1", "2", "3", "4", "5", "6", "7", "8", "9", ...flags.filter(flag => !["2", "5", "7", "8"].includes(flag))]) {
  const supported = precision === "" || /^[1-9]$/.test(precision);
  await check(`nanoseconds %${precision}N`, supported ? "GNU9.7-Darwin-required-nanoseconds" : "declared-N-format-gap-not-parity", async record => {
    const args = ["-d@-0.000000001", `+%${precision}N`];
    const expected = native(args, "UTC"), actual = await direct("date", args);
    Object.assign(record, { args, expected, actual, declaredSupported: supported });
    assert.equal(expected.status, 0); assert.deepEqual(actual, expected);
  });
}
for (const instant of ["0000-01-01T12:00:00Z", "0000-01-02T12:00:00Z", "0099-01-01T12:00:00Z"]) {
  await check(`ISO year boundary ${instant}`, "GNU9.7-Darwin-required-calendar", async record => {
    const args = ["-d", instant, "+%Y|%G|%g|%V|%07G|%_7G|%-g"];
    const expected = native(args, "UTC"), actual = await direct("date", args);
    Object.assign(record, { args, expected, actual }); assert.equal(expected.status, 0); assert.deepEqual(actual, expected);
  });
}
class Timers implements SleepScheduler {
  time = 0;
  delays: number[] = [];
  pending = new Map<number, () => void>();
  next = 1;
  now() { return this.time; }
  setTimeout(callback: () => void, milliseconds: number) { const handle = this.next++; this.delays.push(milliseconds); this.pending.set(handle, callback); return handle; }
  clearTimeout(handle: unknown) { this.pending.delete(handle as number); }
  advance(milliseconds: number) { this.time += milliseconds; const callbacks = [...this.pending.values()]; this.pending.clear(); for (const callback of callbacks) callback(); }
}
function exactMilliseconds(args: string[]): bigint {
  const terms = args.map(value => {
    const match = /^\+?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?([smhd]?)$/.exec(value)!;
    const fraction = match[2] ?? "";
    const coefficient = BigInt(`${match[1]}${fraction}`) * ({ s: 1000n, m: 60000n, h: 3600000n, d: 86400000n }[match[4] || "s"]!);
    return { coefficient, scale: Number(match[3] ?? 0) - fraction.length };
  });
  const denominatorExponent = Math.max(0, ...terms.map(term => -term.scale));
  const denominator = 10n ** BigInt(denominatorExponent);
  const sum = terms.reduce((total, term) => total + term.coefficient * 10n ** BigInt(term.scale + denominatorExponent), 0n);
  return (sum + denominator - 1n) / denominator;
}
async function sleepCheck(args: string[], expected: bigint, record: Record<string, unknown>) {
  const scheduler = new Timers(), controller = new AbortController(), reason = Object.freeze({ reviewAbort: args });
  const valid = expected <= BigInt(Number.MAX_SAFE_INTEGER);
  const execution = direct("sleep", args, { scheduler, maxTimerMilliseconds: 997 }, { signal: controller.signal });
  Object.assign(record, { args, exactMilliseconds: String(expected), delays: scheduler.delays });
  if (!valid) { assert.equal((await execution).status, 1); assert.deepEqual(scheduler.delays, []); }
  else if (expected > 997n) {
    const rejected = assert.rejects(execution, error => error === reason);
    assert.deepEqual(scheduler.delays, [997]); controller.abort(reason); await rejected;
  } else {
    assert.deepEqual(scheduler.delays, expected ? [Number(expected)] : []);
    scheduler.advance(Number(expected)); assert.deepEqual(await execution, { status: 0, stdoutHex: "", stderrHex: "" });
  }
  assert.equal(scheduler.pending.size, 0); assert.equal(getEventListeners(controller.signal, "abort").length, 0);
}
let seed = 0x4921da7;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
for (let iteration = 0; iteration < 240; iteration++) {
  const args = Array.from({ length: 1 + random() % 11 }, () => {
    const digits = String(random() % 99999999 + 1), split = random() % (digits.length + 1);
    return `${random() % 2 ? "+" : ""}${digits.slice(0, split) || "0"}.${digits.slice(split)}e-${random() % 115}${["s", "m", "h", "d"][random() % 4]}`;
  });
  await check(`exact rational mixed units ${iteration}`, "sleep-independent-rational", record => sleepCheck(args, exactMilliseconds(args), record));
}
for (const args of [
  ["9007199254740.990", ".0009999999999999999999999999999999999"],
  ["9007199254740.990", ".0010000000000000000000000000000000001"],
  ["150119987579.016516666666666666666666m"],
  ["150119987579.016516666666666666666667m"],
  ["0.000000000000000000000000000001h", "0.0009999999999999999999964"],
  ["+0E+12d", "+.000000000001E+9s"],
  ["1e-110d", "0.00099999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999136"],
]) await check(`sleep boundary ${args.join(" ")}`, "sleep-cap-carry-neighbors", record => sleepCheck(args, exactMilliseconds(args), record));
await check("sparse exponent carry and tiny residual", "sleep-sparse-boundary", async record => {
  await sleepCheck(["1e-9999999999999999999999999999999999999999", ".001"], 2n, record);
  await sleepCheck(["0e+9999999999999999999999999999999999999999"], 0n, record);
});
await check("packed registration is optional; export map unchanged", "packed-boundary", async record => {
  const namespace = await import("virtual-bash");
  assert.equal("timeEnvCommands" in namespace, false);
  const missing = "virtual-bash/commands/time-env";
  await assert.rejects(import(missing), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  const registry = new CommandRegistry(), shell = new Shell({ fs: new MemoryFileSystem(), commands: registry }).use(agentCommands());
  try {
    await shell.exec(":"); const names = registry.list().map(command => command.name).sort(); record.names = names;
    const expectedNames = "[ awk base32 base64 basename cat chmod cksum comm cp cut diff dirname echo env expand false find fold grep gunzip gzip head join jq ln ls md5sum mkdir mktemp mv nl od paste patch printf pwd readlink realpath rev rg rm rmdir sed seq sha1sum sha256sum sort split stat strings tac tail tar tee test touch tr true unexpand uniq wc xargs xxd zcat".split(" ");
    assert.deepEqual(names, expectedNames); for (const name of ["date", "sleep", "printenv"]) assert.equal(registry.has(name), false);
  } finally { await shell.dispose(); }
});
await check("packed public Shell.use VFS pipeline and own-key bytes", "packed-boundary", async record => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/work");
  const env = Object.assign(Object.create(null) as Record<string, string>, { EMPTY: "", VALUE: "雪", constructor: "ctor", toString: "string" });
  Object.defineProperty(env, "__proto__", { value: "proto", enumerable: true });
  const shell = new Shell({ fs, cwd: "/work", env }).use(agentCommands()).use(timeEnvCommands({ clock: () => -1 }));
  try {
    const first = await shell.exec("date '+%s.%N' >stamp; cat stamp | cat");
    assert.equal(first.exitCode, 0); assert.equal(first.stdout, "-1.999000000\n"); assert.equal(Buffer.from(await fs.readFile("/work/stamp")).toString(), first.stdout);
    const second = await shell.exec("printenv -0 __proto__ constructor toString EMPTY VALUE > values; cat values");
    record.stdoutHex = Buffer.from(second.stdoutBytes).toString("hex");
    assert.equal(second.exitCode, 0); assert.deepEqual(Buffer.from(second.stdoutBytes), Buffer.from("proto\0ctor\0string\0\0雪\0"));
    assert.equal((await shell.exec("printenv DOES_NOT_EXIST")).exitCode, 1);
    const defaultShell = new Shell({ fs }).use(timeEnvCommands());
    try { const before = Date.now(); const result = await defaultShell.exec("date +%s"); const after = Date.now(); assert.equal(result.exitCode, 0); assert.ok(Number(result.stdout) >= Math.floor(before / 1000) && Number(result.stdout) <= Math.floor(after / 1000)); }
    finally { await defaultShell.dispose(); }
  } finally { await shell.dispose(); }
});
for (let iteration = 0; iteration < 5; iteration++) await check(`packed public cancellation ${iteration}`, "packed-resource-cleanup", async record => {
  let admit!: () => void; const admission = new Promise<void>(resolve => { admit = resolve; });
  const pending = new Set<ReturnType<typeof setTimeout>>(), signals: AbortSignal[] = [];
  const scheduler: SleepScheduler = { now: () => performance.now(), setTimeout(callback, milliseconds) { const timer = setTimeout(callback, milliseconds); pending.add(timer); admit(); return timer; },
    clearTimeout(handle) { clearTimeout(handle as ReturnType<typeof setTimeout>); pending.delete(handle as ReturnType<typeof setTimeout>); } };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(timeEnvCommands({ scheduler })).use({ name: "review-signal", setup(host) { host.use((context, next) => { signals.push(context.signal); return next(); }); } });
  const controller = new AbortController(), reason = Object.freeze({ packedAbort: iteration });
  try {
    const rejection = assert.rejects(shell.exec("sleep 600", { signal: controller.signal }), error => error === reason);
    await admission; controller.abort(reason); assert.equal(pending.size, 0); await rejection; await shell.dispose();
    record.pending = pending.size; record.listeners = signals.map(signal => getEventListeners(signal, "abort").length);
    assert.equal(pending.size, 0); assert.ok(signals.every(signal => getEventListeners(signal, "abort").length === 0));
  } finally { controller.abort(reason); await shell.dispose(); for (const timer of pending) clearTimeout(timer); }
});
await check("host environment unchanged and default virtual timezone UTC", "packed-host-isolation", async () => {
  const result = await direct("date", ["-d@0", "+%T %z"]);
  assert.deepEqual(result, { status: 0, stdoutHex: Buffer.from("00:00:00 +0000\n").toString("hex"), stderrHex: "" });
  assert.deepEqual({ ...process.env }, environmentBefore);
});
const summary = Object.fromEntries([...new Set(rows.map(row => String(row.category)))].map(category => {
  const selected = rows.filter(row => row.category === category);
  return [category, { total: selected.length, pass: selected.filter(row => row.result === "pass").length, fail: selected.filter(row => row.result === "fail").length }];
}));
await writeFile(`${output}/hidden-rows.json`, JSON.stringify({ capturedAt: new Date().toISOString(), versions: process.versions, root: import.meta.resolve("virtual-bash"), leaf: import.meta.resolve("./node_modules/virtual-bash/dist/commands/time-env/index.js"), summary, rows }, null, 2));
console.log(JSON.stringify(summary));
if (rows.some(row => row.result === "fail")) process.exitCode = 1;
