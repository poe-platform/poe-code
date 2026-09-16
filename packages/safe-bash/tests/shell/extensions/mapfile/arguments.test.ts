import assert from "node:assert/strict";
import test from "node:test";
import { MapfileArgumentError, mapfileExtension, parseMapfileArguments } from "../../../../src/shell/extensions/mapfile/index.js";
import { shellValueBytes, shellValueFromBytes } from "../../../../src/contracts/value.js";
import { primaryReference } from "./primary-reference.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";

const defaults = { array: "MAPFILE", clear: true, count: 0, delimiter: 10, descriptor: 0, origin: 0, quantum: 5000, skip: 0, trim: false };

test("mapfile parser defaults and explicit zero origin differ", async () => {
  assert.deepEqual(await parseMapfileArguments([], async () => {}), defaults);
  assert.deepEqual(await parseMapfileArguments(["-O0"], async () => {}), { ...defaults, clear: false });
});

test("all mapfile options combine and descriptor validation happens during parsing", async () => {
  const selected: number[] = [];
  assert.deepEqual(await parseMapfileArguments(["-td:", "-n2", "-O", "+3", "-s1", "-u4", "-C", "callback prefix", "-c", "7", "a", "ignored"], async descriptor => { selected.push(descriptor); }), { ...defaults, array: "a", clear: false, count: 2, delimiter: 58, descriptor: 4, origin: 3, quantum: 7, skip: 1, trim: true, callback: "callback prefix" });
  assert.deepEqual(selected, [4]);
});

test("attached callback and delimiter retain original bytes", async () => {
  const callback = shellValueFromBytes(Uint8Array.of(45, 67, 255, 32, 39));
  const delimiter = shellValueFromBytes(Uint8Array.of(45, 100, 254, 253));
  const options = await parseMapfileArguments([callback, delimiter], async () => {});
  assert.notEqual(options, "help");
  if (options === "help") return;
  assert.deepEqual(Buffer.from(shellValueBytes(options.callback!)), Buffer.from([255, 32, 39]));
  assert.equal(options.delimiter, 254);
});

for (const text of ["0", "-0", "+2", "0002", " 2 \t", "4294967295"]) test(`mapfile decimal count accepts ${JSON.stringify(text)}`, async () => {
  assert.deepEqual(await parseMapfileArguments(["-n", text], async () => {}), { ...defaults, count: Number(text) || 0 });
});

const invalid = [
  [["-n", "-1"], 1, "-1: invalid line count", false],
  [["-n", "4294967296"], 1, "4294967296: invalid line count", false],
  [["-n", "0x10"], 1, "0x10: invalid line count", false],
  [["-n", "2x"], 1, "2x: invalid line count", false],
  [["-n", ""], 1, ": invalid line count", false],
  [["-O", "-1"], 1, "-1: invalid array origin", false],
  [["-s", "-1"], 1, "-1: invalid line count", false],
  [["-c", "0"], 1, "0: invalid callback quantum", false],
  [["-c", "4294967296"], 1, "4294967296: invalid callback quantum", false],
  [["-u", "-1"], 1, "-1: invalid file descriptor specification", false],
  [["-u", "2147483648"], 1, "2147483648: invalid file descriptor specification", false],
  [["-Q"], 2, "-Q: invalid option", true],
  [["--hel"], 2, "--: invalid option", true],
  [["-n"], 2, "-n: option requires an argument", true],
  [[""], 2, "empty array variable name", false],
  [["a[0]"], 1, "`a[0]': not a valid identifier", false],
  [["-t", "--", "-a"], 1, "`-a': not a valid identifier", false],
  [["-t", "-"], 1, "`-': not a valid identifier", false],
] as const;
for (const [args, status, detail, usage] of invalid) test(`mapfile argument refusal: ${JSON.stringify(args)}`, async () => {
  await assert.rejects(parseMapfileArguments(args, async () => {}), error => {
    assert.ok(error instanceof MapfileArgumentError);
    assert.equal(error.status, status);
    assert.equal(error.detail, detail);
    assert.equal(error.usage, usage);
    return true;
  });
});

test("invalid argument diagnostics retain bytes instead of replacement aliases", async () => {
  await assert.rejects(parseMapfileArguments([shellValueFromBytes(Uint8Array.of(255))], async () => {}), error => {
    assert.ok(error instanceof MapfileArgumentError);
    assert.deepEqual(Buffer.from(shellValueBytes(error.detail)), Buffer.concat([Buffer.from("`"), Buffer.from([255]), Buffer.from("': not a valid identifier")]));
    return true;
  });
});

test("first operand ends parsing and ignores subsequent operands", async () => {
  assert.deepEqual(await parseMapfileArguments(["a", "-Q"], async () => {}), { ...defaults, array: "a" });
  assert.deepEqual(await parseMapfileArguments(["--", "a", "extra"], async () => {}), { ...defaults, array: "a" });
});

test("help stops parsing but does not override an earlier option failure", async () => {
  assert.equal(await parseMapfileArguments(["--help", "-Q"], async () => {}), "help");
  await assert.rejects(parseMapfileArguments(["-Q", "--help"], async () => {}), MapfileArgumentError);
});

test("descriptor validation failures precede later syntax errors and preserve falsey reasons", async () => {
  for (const reason of [false, 0, "", null]) await assert.rejects(parseMapfileArguments(["-u9", "-Q"], async () => { throw reason; }), error => Object.is(error, reason));
  let selected = false;
  await assert.rejects(parseMapfileArguments(["-Q", "-u9"], async () => { selected = true; }), MapfileArgumentError);
  assert.equal(selected, false);
});

test("repeated options use their last values without losing explicit-origin state", async () => {
  const selected: number[] = [];
  assert.deepEqual(await parseMapfileArguments(["-n1", "-n0", "-O2", "-O0", "-d:", "-d", "", "-u3", "-u0", "-c1", "-c4294967295"], async descriptor => { selected.push(descriptor); }), { ...defaults, clear: false, delimiter: 0, quantum: 4294967295 });
  assert.deepEqual(selected, [3, 0]);
});

test("pinned native confirms parser diagnostic and help status expectations", {}, () => {
  const usage = "mapfile: usage: mapfile [-d delim] [-n count] [-O origin] [-s count] [-t] [-u fd] [-C callback] [-c quantum] [array]\n";
  for (const [args, status, detail, showUsage] of invalid) {
    const script = `mapfile ${args.map(argument => `'${argument.replaceAll("'", "'\\''")}'`).join(" ")}`;
    const result = primaryReference(import.meta.url, script, "one\ntwo\n");
    assert.equal(result.status, status, script);
    assert.deepEqual(result.stdout, Buffer.alloc(0), script);
    assert.deepEqual(result.stderr, Buffer.from(`shell: line 1: mapfile: ${detail}\n${showUsage ? usage : ""}`), script);
  }
  const help = primaryReference(import.meta.url, "mapfile --help");
  assert.equal(help.status, 2);
  assert.deepEqual(help.stderr, Buffer.alloc(0));
  assert.ok(help.stdout.toString().startsWith("mapfile: mapfile [-d delim]"));
});

test("actual Shell option refusals match the authenticated native parser", {}, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [mapfileExtension({ replace: true })] });
  context.after(() => shell.dispose());
  for (const [args] of invalid) {
    const script = `mapfile ${args.map(argument => `'${argument.replaceAll("'", "'\\''")}'`).join(" ")}`;
    const expected = primaryReference(import.meta.url, script, "one\ntwo\n");
    const actual = await shell.exec(script, { stdin: Buffer.from("one\ntwo\n") });
    assert.equal(actual.exitCode, expected.status, script);
    assert.deepEqual(Buffer.from(actual.stdoutBytes), expected.stdout, script);
    assert.deepEqual(Buffer.from(actual.stderrBytes), expected.stderr, script);
  }
});
