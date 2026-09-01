import assert from "node:assert/strict";
import test from "node:test";
import { escapeBytes } from "../../src/commands/internal.js";
import { CommandRegistry, createCommandArguments, toByteSource } from "../../src/contracts/index.js";
import { shellValueFromBytes, type ShellValue } from "../../src/contracts/value.js";
import { Shell } from "../../src/shell/index.js";
import { createStandardCommands, standardCommands } from "../../src/commands/index.js";
import { fixture, run } from "./helpers.js";

const nativeConsumerGoldens = [
  {
    "id": "17-printf-raw-format",
    "script": "printf $'\\xff:%s:\\xfe\\n' '�'",
    "stdoutHex": "ff3aefbfbd3afe0a",
    "stderrHex": "",
    "status": 0
  },
  {
    "id": "18-printf-percent-s",
    "script": "printf '<%s>' $'\\xff' $'\\xfe' '�'; printf '\\n'",
    "stdoutHex": "3cff3e3cfe3e3cefbfbd3e0a",
    "stderrHex": "",
    "status": 0
  },
  {
    "id": "19-printf-percent-b",
    "script": "printf '<%b>' $'\\xff' '\\xff' '\\376' '�'; printf '\\n'",
    "stdoutHex": "3cff3e3cff3e3cfe3e3cefbfbd3e0a",
    "stderrHex": "",
    "status": 0
  },
  {
    "id": "20-printf-double-dash",
    "script": "printf -- '-%s-\\n' $'\\xff'",
    "stdoutHex": "2dff2d0a",
    "stderrHex": "",
    "status": 0
  },
  {
    "id": "21-printf-repeat-and-missing",
    "script": "printf '%s:%s|' $'\\xff' $'\\xfe' '�'; printf '\\n'",
    "stdoutHex": "ff3afe7cefbfbd3a7c0a",
    "stderrHex": "",
    "status": 0
  },
  {
    "id": "22-printf-missing-conversions",
    "script": "printf '<%s>|<%b>|<%d>|<%.2s>\\n'",
    "stdoutHex": "3c3e7c3c3e7c3c303e7c3c3e0a",
    "stderrHex": "",
    "status": 0
  },
  {
    "id": "23-printf-byte-precision",
    "script": "printf '<%.1s><%.2s><%.3s>\\n' '�' '�' '�'",
    "stdoutHex": "3cef3e3cefbf3e3cefbfbd3e0a",
    "stderrHex": "",
    "status": 0
  },
  {
    "id": "24-printf-byte-width",
    "script": "printf '<%3s><%-3s><%3.1s><%3.2s>\\n' $'\\xff' $'\\xfe' '�' '�'",
    "stdoutHex": "3c2020ff3e3cfe20203e3c2020ef3e3c20efbf3e0a",
    "stderrHex": "",
    "status": 0
  },
  {
    "id": "25-printf-b-stop",
    "script": "printf 'A%bZ' $'\\xff\\\\c\\xfe'; printf '|done\\n'",
    "stdoutHex": "41ff7c646f6e650a",
    "stderrHex": "",
    "status": 0
  },
  {
    "id": "26-echo-raw",
    "script": "echo $'\\xff' $'\\xfe' '�'",
    "stdoutHex": "ff20fe20efbfbd0a",
    "stderrHex": "",
    "status": 0
  },
  {
    "id": "27-echo-escapes-no-newline",
    "script": "echo -ne '\\xff\\0\\376'; printf '|end\\n'",
    "stdoutHex": "ff005c3337367c656e640a",
    "stderrHex": "",
    "status": 0
  },
  {
    "id": "28-command-builtin-forwarding",
    "script": "command printf '%s|' $'\\xff'; builtin printf '%s|' $'\\xfe'; command echo '�'; builtin echo $'\\xff'",
    "stdoutHex": "ff7cfe7cefbfbd0aff0a",
    "stderrHex": "",
    "status": 0
  }
];

for (const entry of nativeConsumerGoldens) test(`fixed Bash byte golden: ${entry.id}`, async () => {
  const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(createStandardCommands()), env: { LC_ALL: "C", LANG: "C" } });
  try {
    const result = await shell.exec(entry.script);
    assert.equal(result.exitCode, entry.status);
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), entry.stdoutHex);
    assert.equal(Buffer.from(result.stderrBytes).toString("hex"), entry.stderrHex);
  } finally { await shell.dispose(); }
});


async function runByteArguments(command: string, values: readonly ShellValue[]) {
  const argumentValues = createCommandArguments(values);
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createStandardCommands().find(entry => entry.name === command)!.execute({
    command, args: argumentValues.args, argumentValues, cwd: "/work", env: {}, fs: await fixture(),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
  });
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

for (const command of ["printf", "echo"]) {
  test(`basic byte ${command} awaits backpressure and retains its input snapshot`, async () => {
    const input = Uint8Array.of(255);
    const raw = shellValueFromBytes(input);
    const argumentValues = createCommandArguments(command === "printf" ? ["%s!", raw] : [raw]);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const written: Uint8Array[] = [];
    let settled = false;
    const running = Promise.resolve(createStandardCommands().find(entry => entry.name === command)!.execute({
      command, args: argumentValues.args, argumentValues, cwd: "/work", env: {}, fs: await fixture(),
      signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(bytes) { enter(); await released; written.push(new Uint8Array(bytes)); } },
      stderr: { async write() { assert.fail("unexpected diagnostic"); } },
    })).finally(() => { settled = true; });
    try {
      await entered;
      input.fill(0);
      await Promise.resolve();
      assert.equal(settled, false);
      assert.equal(written.length, 0);
    } finally { release(); }
    assert.equal((await running).exitCode, 0);
    assert.deepEqual(Array.from(Buffer.concat(written)), command === "printf" ? [255, 33] : [255, 10]);
  });

  for (const reason of [false, 0, null]) test(`basic byte ${command} preserves cancellation ${String(reason)} during output`, async () => {
    const controller = new AbortController();
    const raw = shellValueFromBytes(Uint8Array.of(255));
    const argumentValues = createCommandArguments(command === "printf" ? ["%s!", raw] : [raw]);
    let writes = 0;
    const context = {
      command, args: argumentValues.args, argumentValues, cwd: "/work", env: {}, fs: await fixture(),
      signal: controller.signal, stdin: toByteSource(""),
      stdout: { async write() { writes++; controller.abort(reason); throw reason; } },
      stderr: { async write() { assert.fail("cancellation must not become a diagnostic"); } },
    };
    await assert.rejects(async () => createStandardCommands().find(entry => entry.name === command)!.execute(context), error => error === reason);
    assert.equal(writes, 1);
  });
}

test("printf percent-b accepts bare octal while echo retains its zero prefix requirement", async () => {
  assert.deepEqual(Array.from((await runByteArguments("printf", ["%b", "\\376"])).stdout), [254]);
  assert.deepEqual(Array.from((await runByteArguments("printf", ["%b", shellValueFromBytes(Uint8Array.of(92, 51, 55, 54))])).stdout), [254]);
  assert.deepEqual(Array.from((await runByteArguments("echo", ["-ne", "\\376"])).stdout), [92, 51, 55, 54]);
});

for (const entry of [
  { name: "opaque percent-s", command: "printf", values: ["%s", [255]], expected: [255] },
  { name: "delimiter and repeated equal text", command: "printf", values: ["--", "-%s", [255], [254]], expected: [45, 255, 45, 254] },
  { name: "missing repeated operand", command: "printf", values: ["%s:%s", [255]], expected: [255, 58] },
  { name: "raw format literals", command: "printf", values: [[255, 37, 115, 254], [128]], expected: [255, 128, 254] },
  { name: "left byte padding and precision", command: "printf", values: ["%-4.2s", [255, 254, 65]], expected: [255, 254, 32, 32] },
  { name: "right byte padding and zero precision", command: "printf", values: ["%4.0s", [255]], expected: [32, 32, 32, 32] },
  { name: "precision can cut UTF-8 bytes", command: "printf", values: ["%.1s", [226, 130, 172]], expected: [226] },
  { name: "escaped percent consumes no operand", command: "printf", values: ["%%:%s", [255], [254]], expected: [37, 58, 255, 37, 58, 254] },
  { name: "raw percent-b and stop", command: "printf", values: ["%bafter", [255, 92, 48, 51, 55, 54, 92, 99, 65]], expected: [255, 254] },
  { name: "echo joins opaque operands", command: "echo", values: ["-n", [255], [254]], expected: [255, 32, 254] },
  { name: "echo escape and separator", command: "echo", values: ["-e", [255, 92, 116], [254]], expected: [255, 9, 32, 254, 10] },
]) test(`basic byte arguments preserve ${entry.name}`, async () => {
  const values = entry.values.map(value => typeof value === "string" ? value : shellValueFromBytes(Uint8Array.from(value)));
  const result = await runByteArguments(entry.command, values);
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(Array.from(result.stdout), entry.expected);
});

for (const entry of [
  { name: "invalid octets surrounding an ASCII escape", source: [255, 92, 110, 195, 40], expected: [255, 10, 195, 40], zeroOctal: false, stop: false },
  { name: "unknown escaped octet", source: [92, 255], expected: [92, 255], zeroOctal: false, stop: false },
  { name: "zero-prefixed octal and stop", source: [255, 92, 48, 51, 55, 55, 92, 48, 92, 99, 97], expected: [255, 255, 0], zeroOctal: true, stop: true },
  { name: "format octal and hexadecimal", source: [92, 51, 55, 55, 92, 120, 48, 48, 65], expected: [255, 0, 65], zeroOctal: false, stop: false },
  { name: "UTF-8 octets after unknown escape", source: [92, 240, 159, 146, 169], expected: [92, 240, 159, 146, 169], zeroOctal: false, stop: false },
]) test(`byte escape parsing preserves ${entry.name}`, () => {
  const input = Uint8Array.from(entry.source);
  const escaped = escapeBytes(input, entry.zeroOctal);
  assert.deepEqual(Array.from(escaped.bytes), entry.expected);
  assert.equal(escaped.stop, entry.stop);
  input.fill(42);
  assert.deepEqual(Array.from(escaped.bytes), entry.expected);
});

test("byte escape parsing respects view offsets and returns owned output", () => {
  const backing = Uint8Array.of(11, 255, 92, 116, 128, 12);
  const escaped = escapeBytes(backing.subarray(1, 5));
  assert.deepEqual(Array.from(escaped.bytes), [255, 9, 128]);
  escaped.bytes.fill(1);
  assert.deepEqual(Array.from(backing), [11, 255, 92, 116, 128, 12]);
});

test("string escape parsing retains legacy unknown supplementary escape behavior", () => {
  assert.deepEqual(Array.from(escapeBytes("\\\u{1f4a9}").bytes), [92, 239, 191, 189, 239, 191, 189]);
  assert.deepEqual(Array.from(escapeBytes(Uint8Array.of(92, 240, 159, 146, 169)).bytes), [92, 240, 159, 146, 169]);
});
test("standard plugin exports real handlers and detects collisions before registration", async () => {
  assert(createStandardCommands().some(command => command.name === "printf"));
  const commands = new CommandRegistry([{ name: "echo", execute: () => ({ exitCode: 9 }) }]);
  const host = { commands, use() {}, registerFileSystem() {} };
  assert.throws(() => standardCommands().setup(host), /already registered/u);
  assert.equal(commands.list().length, 1);
  await standardCommands({ replace: true }).setup(host);
  assert(commands.has("printf"));
});

test("echo handles option groups, literal unknown options, escapes and stop", async () => {
  assert.equal((await run("echo", ["-n", "one", "two"])).stdout, "one two");
  assert.equal((await run("echo", ["--", "-x"])).stdout, "-- -x\n");
  assert.equal((await run("echo", ["-e", "one\\ttwo\\cignored"])).stdout, "one\ttwo");
  assert.deepEqual((await run("echo", ["-ne", "\\0377"])).stdoutBytes, Buffer.from([255]));
  assert.equal((await run("echo", ["-eE", "\\n"])).stdout, "\\n\n");
});

test("printf repeats formats, defaults missing fields, and preserves empty strings", async () => {
  assert.equal((await run("printf", ["<%s>:%d\n", "one", "2", ""])).stdout, "<one>:2\n<>:0\n");
  assert.equal((await run("printf", ["literal %%\n", "unused"])).stdout, "literal %\n");
  assert.equal((await run("printf", ["%s", "no newline"])).stdout, "no newline");
  assert.equal((await run("printf", ["--", "-%s", "literal"])).stdout, "-literal");
});

test("printf formats common numbers, padding, precision, and byte escapes", async () => {
  assert.equal((await run("printf", ["%05d|%-5.3s|%#x|%.2f|%o\n", "-3", "abcdef", "15", "1.25", "8"])).stdout, "-0003|abc  |0xf|1.25|10\n");
  assert.deepEqual((await run("printf", ["%b", "\\0377\\0\\n"])).stdoutBytes, Buffer.from([255, 0, 10]));
  assert.equal((await run("printf", ["%bafter", "before\\cignored"])).stdout, "before");
  assert.equal((await run("printf", ["%d", "010"])).stdout, "8");
  assert.equal((await run("printf", ["%d", "9007199254740993"])).stdout, "9007199254740993");
  assert.deepEqual((await run("printf", ["%.1s", "é"])).stdoutBytes, Buffer.from([195]));
  assert.equal((await run("printf", ["%4b", "x"])).stdout, "   x");
  const invalid = await run("printf", ["%d", "oops"]);
  assert.equal(invalid.exitCode, 1);
  assert.match(invalid.stderr, /invalid number/u);
  assert.equal((await run("printf", ["%99999999s", "x"])).exitCode, 2);
  assert.equal((await run("printf", ["%j", "x"])).exitCode, 2);
});

test("pwd logical and physical paths stay inside virtual filesystem", async () => {
  const fs = await fixture();
  await fs.symlink("/work", "/alias");
  assert.equal((await run("pwd", [], { fs, cwd: "/alias" })).stdout, "/alias\n");
  assert.equal((await run("pwd", ["-P"], { fs, cwd: "/alias" })).stdout, "/work\n");
  assert.equal((await run("pwd", ["unexpected"])).exitCode, 2);
});

test("basename and dirname handle roots, suffixes, multiple names and zero output", async () => {
  assert.equal((await run("basename", ["/a/name.txt/", ".txt"])).stdout, "name\n");
  assert.equal((await run("basename", ["-s", ".txt", "a.txt", "b.txt"])).stdout, "a\nb\n");
  assert.equal((await run("basename", ["///"])).stdout, "/\n");
  assert.equal((await run("basename", ["same", "same"])).stdout, "same\n");
  assert.equal((await run("dirname", ["-z", "/a/b///", "name", "/"])).stdout, "/a\0.\0/\0");
});

test("true and false ignore arguments and cancellation propagates", async () => {
  assert.equal((await run("true", ["--anything"])).exitCode, 0);
  assert.equal((await run("false")).exitCode, 1);
  const reason = new Error("cancelled");
  await assert.rejects(run("echo", ["not written"], { signal: AbortSignal.abort(reason) }), error => error === reason);
});
