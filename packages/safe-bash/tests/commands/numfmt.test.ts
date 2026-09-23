import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CommandRegistry, createCommandArguments, FsError, toByteSource, type ByteSource, type CommandContext, type FileSystem, type InvocationCleanup } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { numfmtCommand } from "../../src/commands/numfmt.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { PublicDiagnostic } from "../../src/diagnostics.js";
import { Shell } from "../../src/shell/index.js";

async function format(args: readonly string[], input: string | Uint8Array | ByteSource = "", overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "numfmt", args, cwd: "/work", env: { LC_ALL: "C" }, fs: new MemoryFileSystem(),
    stdin: typeof input === "string" || input instanceof Uint8Array ? toByteSource(input) : input,
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
    signal: new AbortController().signal, ...overrides,
  };
  const result = await numfmtCommand().execute(context);
  return { exitCode: result.exitCode, stdoutHex: Buffer.concat(stdout).toString("hex"), stderrHex: Buffer.concat(stderr).toString("hex") };
}

for (const entry of [
  { args: ["--to=si", "--unit-separator=_"], input: "2700\n-8100\n", output: "2.7_k\n-8.1_k\n" },
  { args: ["--to=iec-i", "--unit-separator=_"], input: "2816\n-8448\n", output: "2.8_Ki\n-8.3_Ki\n" },
  { args: ["--from=auto", "--unit-separator=_"], input: "2.75_K\n-8.25_Mi\n", output: "2750\n-8650752\n" },
  { args: ["--from=auto", "--unit-separator=_"], input: "2.75K\n12\n", output: "2750\n12\n" },
  { args: ["--from=auto", "--unit-separator="], input: "2.75Ki\n", output: "2816\n" },
  { args: ["--from=auto", "--unit-separator", "·"], input: "2.75·Ki\n-8.25·Mi\n", output: "2816\n-8650752\n" },
  { args: ["--to=si", "--unit-separator="], input: "2700\n-8100\n", output: "2.7k\n-8.1k\n" },
  { args: ["--to=iec", "--unit-separator=units"], input: "1024\n12\n", output: "1.0unitsK\n12\n" },
  { args: ["--to=iec-i", "--unit-separator=·", "-z"], input: "1024\0-2048\0", output: "1.0·Ki\0-2.0·Ki\0" },
  { args: ["--from=auto", "--unit-separator=_", "-d,", "--field=2"], input: "label,2.75_K\n", output: "label,2750\n" },
  { args: ["--to=iec", "--unit-separator=_", "--suffix=B", "--padding=8"], input: "1024\n", output: "  1.0_KB\n" },
]) test(`numfmt unit separator ${JSON.stringify(entry.args)}`, async () => {
  const expected = { exitCode: 0, stdoutHex: Buffer.from(entry.output).toString("hex"), stderrHex: "" };
  assert.deepEqual(await format(entry.args, entry.input), expected);
  const partitioned: ByteSource = { async *[Symbol.asyncIterator]() {
    const reusable = new Uint8Array(1);
    for (const byte of Buffer.from(entry.input)) { reusable[0] = byte; yield reusable; }
  } };
  assert.deepEqual(await format(entry.args, partitioned), expected);
});

test("numfmt unit separator preserves invalid-input diagnostics and required argument", async () => {
  assert.deepEqual(await format(["--from=auto", "--unit-separator=_"], "2__K\n"), { exitCode: 2, stdoutHex: "", stderrHex: Buffer.from("numfmt: invalid suffix in input: '2__K'\n").toString("hex") });
  assert.deepEqual(await format(["--unit-separator"]), { exitCode: 1, stdoutHex: "", stderrHex: Buffer.from("numfmt: option '--unit-separator' requires an argument\nTry 'numfmt --help' for more information.\n").toString("hex") });
});

test("numfmt unit separator through Shell operands", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([numfmtCommand()]), env: { LC_ALL: "C" } });
  try {
    const result = await shell.exec("numfmt --from=auto --to=iec-i --unit-separator='·' '2·Ki'");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "2.0·Ki\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

interface NativeCase {
  name: string;
  args: string[];
  locale: string;
  extraEnv: Record<string, string>;
  stdinHex: string;
  stdoutHex: string;
  stderrHex: string;
  exitCode: number;
}
for (const [mode, suffix, output] of [
  ["auto", "k", "3500\n-8500\n"], ["si", "k", "3500\n-8500\n"],
  ["iec", "k", "3584\n-8704\n"], ["iec-i", "ki", "3584\n-8704\n"],
  ["auto", "ki", "3584\n-8704\n"],
] as const) test(`numfmt GNU 9.10 lowercase kilo input ${mode} ${suffix}`, async () => {
  for (const unit of [suffix, suffix.replace("k", "K")]) {
    assert.deepEqual(await format([`--from=${mode}`], `3.5${unit}\n-8.5${unit}\n`), {
      exitCode: 0, stdoutHex: Buffer.from(output!).toString("hex"), stderrHex: "",
    });
  }
});
test("numfmt GNU 9.10 SI kilo output preserves IEC casing", async () => {
  for (const [mode, input, output] of [
    ["si", "2700\n-8100\n999\n999999\n1000000\n", "2.7k\n-8.1k\n999\n1.0M\n1.0M\n"],
    ["iec", "3584\n-8704\n", "3.5K\n-8.5K\n"],
    ["iec-i", "3584\n-8704\n", "3.5Ki\n-8.5Ki\n"],
  ]) assert.deepEqual(await format([`--to=${mode}`], input), {
    exitCode: 0, stdoutHex: Buffer.from(output!).toString("hex"), stderrHex: "",
  });
});
// Preserve the GNU 8.30 captures. These explicit expectation edits select the
// GNU 9.10 kilo vocabulary; they are authored expectations, not new native captures.
const native = ["./numfmt-native.snapshot.json", "./numfmt-extended.snapshot.json"].flatMap(path => (JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as { cases: NativeCase[] }).cases).map(entry => {
  let stdout = Buffer.from(entry.stdoutHex, "hex").toString("latin1");
  let stderr = Buffer.from(entry.stderrHex, "hex").toString("latin1");
  if (entry.name.startsWith("scales ")) {
    const [, from, to] = entry.name.split(" ");
    const lines = stdout.split("\n");
    if (to === "si") for (const index of [4, 5, ...(from !== "none" && from !== "iec-i" ? [7] : []), ...(from === "auto" || from === "iec-i" ? [8] : [])]) lines[index] = lines[index]!.replace("K", "k");
    if (from === "auto" || from === "si" || from === "iec") {
      lines[12] = to === "none" ? from === "iec" ? "1024" : "1000" : to === "si" ? from === "iec" ? "1.1k" : "1.0k" : from === "iec" ? `1.0K${to === "iec-i" ? "i" : ""}` : "1000";
      stderr = stderr.replace("numfmt: invalid suffix in input: '1k'\n", "");
    } else stderr = stderr.replace("numfmt: invalid suffix in input: '1k'", from === "none" ? "numfmt: rejecting suffix in input: '1k' (consider using --from)" : "numfmt: missing 'i' suffix in input: '1k' (e.g Ki/Mi/Gi)");
    stdout = lines.join("\n");
  } else if (entry.args.includes("--to=si")) {
    stdout = stdout.split("K").join("k");
    if (entry.args.includes("---debug")) stderr = stderr.split("K").join("k");
  }
  return { ...entry, stdoutHex: Buffer.from(stdout, "latin1").toString("hex"), stderrHex: Buffer.from(stderr, "latin1").toString("hex") };
});
// Preserve the historical oracle captures while accounting for the new option
// in the virtual command's help output.
for (const entry of native) {
  const stdout = Buffer.from(entry.stdoutHex, "hex").toString();
  if (stdout.startsWith("Usage: numfmt")) entry.stdoutHex = Buffer.from(stdout.replace("      --to=UNIT", "      --unit-separator=SEP  insert SEP between number and unit on output,\n                         and accept optional SEP in input numbers\n      --to=UNIT")).toString("hex");
}
const current = new Map((JSON.parse(readFileSync(new URL("./numfmt-coreutils910.snapshot.json", import.meta.url), "utf8")) as { cases: Pick<NativeCase, "name" | "stdoutHex" | "stderrHex" | "exitCode">[] }).cases.map(entry => [entry.name, entry]));
const compatibility = new Map((JSON.parse(readFileSync(new URL("./numfmt-compatibility.snapshot.json", import.meta.url), "utf8")) as { cases: (Partial<NativeCase> & { name: string })[] }).cases.map(entry => [entry.name, entry]));
for (const entry of native) Object.assign(entry, current.get(entry.name), compatibility.get(entry.name));
for (const entry of native) test(`numfmt ${compatibility.has(entry.name) ? "compatibility" : "native"} ${entry.name}`, async () => {
  const result = await format(entry.args, Buffer.from(entry.stdinHex, "hex"), { env: { LC_ALL: entry.locale, ...entry.extraEnv } });
  assert.deepEqual(result, { stdoutHex: entry.stdoutHex, stderrHex: entry.stderrHex, exitCode: entry.exitCode });
});

for (const entry of native.filter(entry => entry.stdinHex && entry.args.length < 20)) test(`numfmt partitioned ${entry.name}`, async () => {
  const bytes = Buffer.from(entry.stdinHex, "hex");
  const source: ByteSource = { async *[Symbol.asyncIterator]() {
    const reusable = Buffer.alloc(3);
    for (let offset = 0; offset < bytes.length; offset += reusable.length) {
      reusable.fill(255);
      const length = Math.min(reusable.length, bytes.length - offset);
      reusable.set(bytes.subarray(offset, offset + length));
      yield reusable.subarray(0, length);
    }
    reusable.fill(254);
  } };
  assert.deepEqual(await format(entry.args, source, { env: { LC_ALL: entry.locale, ...entry.extraEnv } }), { stdoutHex: entry.stdoutHex, stderrHex: entry.stderrHex, exitCode: entry.exitCode });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("numfmt uses immutable raw argv, suffix, delimiter and diagnostics", async () => {
  const argumentValues = createCommandArguments([
    shellValueFromBytes(Buffer.from("--invalid=fail")),
    shellValueFromBytes(Buffer.concat([Buffer.from("--suffix="), Buffer.from([255])])),
    shellValueFromBytes(Buffer.from([49, 48, 48, 48, 255])),
    shellValueFromBytes(Buffer.from([98, 97, 100, 255])),
  ]);
  const result = await format(argumentValues.args, "", { argumentValues });
  assert.deepEqual(result, { exitCode: 2, stdoutHex: Buffer.from([49, 48, 48, 48, 255, 10, 98, 97, 100, 10]).toString("hex"), stderrHex: Buffer.from("numfmt: invalid number: 'bad'\n").toString("hex") });
});

test("numfmt no-work paths do not read stdin or VFS metadata or allocate padding", async () => {
  const fs: FileSystem = new MemoryFileSystem();
  fs.capabilitiesFor = () => { throw new Error("metadata forbidden"); };
  fs.stat = () => { throw new Error("metadata forbidden"); };
  const stdin: ByteSource = { [Symbol.asyncIterator]() { throw new Error("stdin forbidden"); } };
  assert.equal((await format(["--padding=9223372036854775807", "--field=2", "1000"], stdin, { fs })).stdoutHex, Buffer.from("1000\n").toString("hex"));
  assert.equal((await format(["--padding=9223372036854775807", "--header=2"], "one\ntwo\n", { fs })).stdoutHex, Buffer.from("one\ntwo\n").toString("hex"));
  assert.equal((await format(["--to=si", "--format=%.9223372036854775807f"], "", { fs })).exitCode, 0);
  assert.equal((await format(["--padding=9223372036854775807", "--help"], stdin, { fs })).exitCode, 0);
});

test("numfmt retires a producer once after early conversion failure", async () => {
  let reads = 0;
  let returns = 0;
  const cleanup: InvocationCleanup[] = [];
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { reads++; return { done: false, value: Buffer.from("bad\n1000\n") }; },
    async return() { returns++; return { done: true, value: undefined }; },
  }; } };
  const result = await format([], source, { registerCleanup(callback) { cleanup.push(callback); } });
  assert.equal(result.exitCode, 2);
  assert.equal(reads, 1);
  assert.equal(returns, 1);
  await Promise.all(cleanup.map(callback => callback()));
  assert.equal(returns, 1);
});

test("numfmt honors backpressure before advancing its producer", async () => {
  let reads = 0;
  const entered = deferred();
  const release = deferred();
  const pending = format([], { async *[Symbol.asyncIterator]() { reads++; yield Buffer.from("1000\n"); reads++; yield Buffer.from("2000\n"); } }, { stdout: { async write() { entered.resolve(); await release.promise; } } });
  await entered.promise;
  assert.equal(reads, 1);
  release.resolve();
  assert.equal((await pending).exitCode, 0);
  assert.equal(reads, 2);
});

for (const reason of [undefined, null, false, 0, "", new Error("opaque failure")]) for (const side of ["read", "write", "return"] as const) test(`numfmt preserves falsey ${side} failure ${String(reason)}`, async () => {
  let returned = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { if (side === "read") throw reason; return { done: false, value: Buffer.from(side === "return" ? "bad\n" : "1000\n") }; },
    async return() { returned++; if (side === "return") throw reason; return { done: true, value: undefined }; },
  }; } };
  let caught = false;
  try { await format([], source, side === "write" ? { stdout: { async write() { throw reason; } } } : {}); }
  catch (error) { caught = true; assert.equal(error, reason); }
  assert.equal(caught, true);
  assert.equal(returned, 1);
});

test("numfmt cancellation drains admitted producer retirement, not opaque next", async () => {
  const controller = new AbortController();
  const acquired = deferred();
  const retiring = deferred();
  const retired = deferred();
  const cleanup: InvocationCleanup[] = [];
  const reason = new Error("cancel numfmt");
  let settled = false;
  let returns = 0;
  const pending = format([], { [Symbol.asyncIterator]() { assert.ok(cleanup.length > 0); return {
    next() { acquired.resolve(); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
    async return() { returns++; retiring.resolve(); await retired.promise; return { done: true, value: undefined }; },
  }; } }, { signal: controller.signal, registerCleanup(callback) { cleanup.push(callback); } });
  const outcome = pending.then(() => { settled = true; return "resolved"; }, error => { settled = true; return error; });
  await acquired.promise;
  controller.abort(reason);
  await retiring.promise;
  assert.equal(settled, false);
  const closes = Promise.all(cleanup.map(callback => callback()));
  retired.resolve();
  assert.equal(await outcome, reason);
  await closes;
  assert.equal(returns, 1);
});

test("numfmt cancellation does not drain opaque output promises", async () => {
  const controller = new AbortController();
  const admitted = deferred();
  const reason = new Error("cancel output");
  let writes = 0;
  const callbacks: InvocationCleanup[] = [];
  let rejectOpaque!: (reason: unknown) => void;
  const pending = format(["1000"], "", { signal: controller.signal,
    stdout: { write() { writes++; admitted.resolve(); return new Promise<void>((_resolve, reject) => { rejectOpaque = reject; }); } },
    registerCleanup(callback) { callbacks.push(callback); },
  });
  const outcome = pending.then(() => "resolved", error => error);
  await admitted.promise;
  controller.abort(reason);
  await Promise.all(callbacks.map(callback => callback()));
  assert.equal(writes, 1);
  assert.equal(await outcome, reason);
  rejectOpaque(false);
});

test("numfmt yields while scanning and cancels without exhausting input", async () => {
  const controller = new AbortController();
  let produced = 0;
  const reason = new Error("cooperative cancellation");
  const scheduled = setImmediate(() => { controller.abort(reason); });
  try {
    await assert.rejects(format([], { async *[Symbol.asyncIterator]() { while (produced++ < 10000) yield Buffer.from("0000000000000000000000001\n"); } }, { signal: controller.signal }), error => error === reason);
    assert.ok(produced < 10000);
  } finally { clearImmediate(scheduled); }
});

test("numfmt bounds argv before acquiring input", async () => {
  let acquired = false;
  const source: ByteSource = { [Symbol.asyncIterator]() { acquired = true; throw new Error("not admitted"); } };
  for (const args of [Array.from({ length: 4097 }, () => "1"), ["1".repeat(65537)]]) {
    assert.equal((await format(args, source)).exitCode, 1);
    assert.equal(acquired, false);
  }
});

test("numfmt bounds oversized input chunks before copying", async () => {
  let returns = 0;
  const chunk = new Uint8Array(32 * 1024 * 1024 + 1);
  const result = await format([], { async *[Symbol.asyncIterator]() { try { yield chunk; } finally { returns++; } } });
  assert.equal(result.exitCode, 1);
  assert.equal(returns, 1);
});

test("numfmt bounds actual padding output and infinite empty producers", async () => {
  assert.equal((await format(["--padding=33554433", "1"])).exitCode, 1);
  let chunks = 0;
  const result = await format([], { async *[Symbol.asyncIterator]() { while (true) { chunks++; yield new Uint8Array(); } } });
  assert.equal(result.exitCode, 1);
  assert.equal(chunks, 4097);
});

test("numfmt preserves GNU directory-stdin diagnostic and zero status", async () => {
  const source: ByteSource = { [Symbol.asyncIterator]() { return { async next() { throw new FsError("EISDIR"); } }; } };
  assert.deepEqual(await format([], source), { exitCode: 0, stdoutHex: "", stderrHex: Buffer.from("numfmt: error reading input: Is a directory\n").toString("hex") });
});

const readErrors = JSON.parse(readFileSync(new URL("./numfmt-read-error.snapshot.json", import.meta.url), "utf8")) as { input: string; args: string[]; stdoutHex: string; stderrHex: string; exitCode: number }[];
for (const [index, entry] of readErrors.entries()) test(`numfmt native read fault ${index}`, async () => {
  const source: ByteSource = { async *[Symbol.asyncIterator]() { yield Buffer.from(entry.input); throw new FsError("EIO"); } };
  assert.deepEqual(await format(entry.args, source), { exitCode: entry.exitCode, stdoutHex: entry.stdoutHex, stderrHex: entry.stderrHex });
});

test("numfmt bounds record allocation before materialization", async () => {
  let returns = 0;
  const result = await format([], { async *[Symbol.asyncIterator]() { try { yield new Uint8Array(1024 * 1024 + 1).fill(49); } finally { returns++; } } });
  assert.equal(result.exitCode, 1);
  assert.equal(returns, 1);
});

for (const name of ["scales auto iec-i", "quotes C.UTF-8", "raw stdin", "options --to=i", "format %%x%f%%end"]) test(`numfmt without global Buffer: ${name}`, async () => {
  const entry = native.find(candidate => candidate.name === name)!;
  assert.ok(entry);
  const input = new Uint8Array(Buffer.from(entry.stdinHex, "hex"));
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const fs = new MemoryFileSystem();
  const saved = globalThis.Buffer;
  let result: { exitCode: number };
  try {
    Reflect.set(globalThis, "Buffer", undefined);
    result = await numfmtCommand().execute({ command: "numfmt", args: entry.args, cwd: "/", env: { LC_ALL: entry.locale, ...entry.extraEnv }, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield input; } },
      stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
      stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
    });
  } finally { Reflect.set(globalThis, "Buffer", saved); }
  assert.deepEqual({ exitCode: result.exitCode, stdoutHex: Buffer.concat(stdout).toString("hex"), stderrHex: Buffer.concat(stderr).toString("hex") }, { exitCode: entry.exitCode, stdoutHex: entry.stdoutHex, stderrHex: entry.stderrHex });
});

test("numfmt no-Buffer plain argv and owned byte carriers retain portable admission", async () => {
  const fs = new MemoryFileSystem();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const saved = globalThis.Buffer;
  const results: { exitCode: number; stdout: string; stderr: string }[] = [];
  try {
    Reflect.set(globalThis, "Buffer", undefined);
    for (const args of [["--to=si", "1000"], ["--suffix=é", "1000é"], ["--padding=33554433", "1"], ["1".repeat(65537)], ["é".repeat(32769)]]) {
      for (const raw of [false, true]) {
        const carrier = raw ? createCommandArguments(args.map(argument => shellValueFromBytes(encoder.encode(argument)))) : undefined;
        let stdout = "";
        let stderr = "";
        const result = await numfmtCommand().execute({ command: "numfmt", args: carrier?.args ?? args, ...(carrier ? { argumentValues: carrier } : {}), cwd: "/", env: { LC_ALL: "C" }, fs, signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield new Uint8Array(); } },
          stdout: { async write(bytes) { stdout += decoder.decode(bytes); } },
          stderr: { async write(bytes) { stderr += decoder.decode(bytes); } },
        });
        results.push({ exitCode: result.exitCode, stdout, stderr });
      }
    }
  } finally { Reflect.set(globalThis, "Buffer", saved); }
  assert.deepEqual(results, [
    ...Array.from({ length: 2 }, () => ({ exitCode: 0, stdout: "1.0k\n", stderr: "" })),
    ...Array.from({ length: 2 }, () => ({ exitCode: 0, stdout: "1000é\n", stderr: "" })),
    ...Array.from({ length: 2 }, () => ({ exitCode: 1, stdout: "", stderr: "numfmt: numfmt output limit exceeded\n" })),
    ...Array.from({ length: 4 }, () => ({ exitCode: 1, stdout: "", stderr: "numfmt: argument limit exceeded\n" })),
  ]);
});

const outputLimitDiagnostic = "numfmt: numfmt output limit exceeded\n";
const preparationDiagnostic = "numfmt: failed to prepare value '1.000000' for printing\n";
for (const profile of [
  { name: "full stderr direct", gap: 0, last: "x", tail: "", status: 1 },
  { name: "full stderr public", gap: 0, last: "x", tail: "", status: 1, public: true },
  { name: "full ordinary warnings without a reserved diagnostic margin", gap: 0, tail: "", status: 0 },
  { name: "PublicDiagnostic one byte over remaining space", gap: outputLimitDiagnostic.length - 1, last: "x".repeat(128), tail: "", status: 1 },
  { name: "PublicDiagnostic exactly fits remaining space", gap: outputLimitDiagnostic.length, last: "x".repeat(128), tail: outputLimitDiagnostic, status: 1 },
  { name: "NumfmtDiagnostic with full stderr", gap: 0, last: "1", format: true, tail: "", status: 1 },
  { name: "NumfmtDiagnostic one byte over remaining space", gap: preparationDiagnostic.length - 1, last: "1", format: true, tail: "", status: 1 },
  { name: "NumfmtDiagnostic exactly fits remaining space", gap: preparationDiagnostic.length, last: "1", format: true, tail: preparationDiagnostic, status: 1 },
  { name: "UTF-8 outer diagnostic bytes without Buffer", gap: new TextEncoder().encode(`é${outputLimitDiagnostic}`).length - 1, last: "x".repeat(128), command: "énumfmt", noBuffer: true, tail: "", status: 1 },
]) test(`numfmt fixed real output cap: ${profile.name}`, async () => {
  const maximum = 32 * 1024 * 1024;
  const recordSize = 1024 * 1024;
  const lastContentBytes = maximum - profile.gap - 7 * (4 * recordSize + 27) - 27;
  const escapedBytes = Math.floor(lastContentBytes / 4);
  const asciiBytes = lastContentBytes % 4;
  const prefixStdout = 7 * (recordSize + 1) + escapedBytes + asciiBytes + 1;
  let reads = 0, returns = 0, stdoutBytes = 0, stderrBytes = 0;
  let tail = "";
  const decoder = new TextDecoder();
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() {
    try {
      for (let index = 0; index < 8; index++) {
        const length = index < 7 ? recordSize : escapedBytes + asciiBytes;
        const bytes = new Uint8Array(length + 1).fill(255);
        if (index === 7) bytes.fill(120, escapedBytes, length);
        bytes[length] = 10;
        reads++;
        yield bytes;
      }
      if (profile.last !== undefined) { reads++; yield new TextEncoder().encode(`${profile.last}\n`); }
    } finally { returns++; }
  } };
  const stdout = { async write(bytes: Uint8Array) { stdoutBytes += bytes.length; } };
  const stderr = { async write(bytes: Uint8Array) { stderrBytes += bytes.length; tail = (tail + decoder.decode(bytes.subarray(Math.max(0, bytes.length - 128)))).slice(-128); } };
  const args = ["--invalid=warn", ...(profile.format ? ["--format=%0128f"] : [])];
  const fs = new MemoryFileSystem();
  const saved = globalThis.Buffer;
  let shell: Shell | undefined;
  let result: { exitCode: number };
  try {
    if (profile.noBuffer) Reflect.set(globalThis, "Buffer", undefined);
    if (profile.public) {
      shell = new Shell({ fs, commands: new CommandRegistry([numfmtCommand()]), env: { LC_ALL: "C" }, limits: { maxInputBytes: 64 * 1024 * 1024, maxOutputBytes: 96 * 1024 * 1024, maxCpuMs: 30000, maxWallClockMs: 30000 } });
      result = await shell.exec("numfmt --invalid=warn", { stdin, stdout, stderr });
    } else result = await numfmtCommand().execute({ command: profile.command ?? "numfmt", args, cwd: "/", env: { LC_ALL: "C" }, fs, stdin, stdout, stderr, signal: new AbortController().signal });
  } finally { Reflect.set(globalThis, "Buffer", saved); await shell?.dispose(); }
  assert.equal(result.exitCode, profile.status);
  assert.equal(stderrBytes, maximum - profile.gap + new TextEncoder().encode(profile.tail).length);
  assert.ok(stderrBytes <= maximum);
  assert.equal(stdoutBytes, prefixStdout);
  assert.equal(reads, profile.last === undefined ? 8 : 9);
  assert.equal(returns, 1);
  assert.ok(profile.tail ? tail.endsWith(profile.tail) : tail.endsWith(`${"x".repeat(asciiBytes)}'\n`));
});

for (const reason of [false, 0, "", null, undefined, NaN, new PublicDiagnostic("numfmt output limit exceeded")]) test(`numfmt outer diagnostic keeps sink failure identity: ${String(reason)}`, async () => {
  let returns = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false, value: new TextEncoder().encode("bad\n") }; },
    async return() { returns++; throw new Error("secondary cleanup failure"); },
  }; } };
  const result = await format([], source, { stderr: { async write() { throw reason; } } }).then(value => ({ value }), error => ({ error }));
  assert.ok("error" in result);
  assert.ok(Object.is(result.error, reason));
  assert.equal(returns, 1);
});
