import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { FsError, toByteSource, writeText } from "../../src/contracts/index.js";
import type { ByteSource } from "../../src/contracts/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";
import { invocationFixtures } from "./invocation-modes-cases.js";
import { hash, quote, shellHashes, virtualObservation } from "./invocation-modes-native.js";
import type { Reference } from "./invocation-modes-native.js";

const before = shellHashes();
after(() => assert.deepEqual(shellHashes(), before, "owned shell source changed during this run"));
if (process.env.INVOCATION_EXPECT_BASELINE === "1") {
  assert.equal(before.runtime, "dabbb60ffc499a7e64fae8071f12b465b5845e7246510e19da15b406f8481d10");
  assert.equal(before.parser, "73749cb5af6b6affe91014153aa4a6358bc8441807e8ad47fe09f74927c8c7b0");
  assert.equal(before.input, "c7492bb41555d865a0dcda9e3c7e8b2b3f5c5a1e73dc6e1bdb9b3fe6e7ed9a6d");
}
const reference = JSON.parse(readFileSync(new URL("./invocation-modes-reference.json", import.meta.url), "utf8")) as Reference;
assert.equal(reference.fixtureHash, hash(new URL("./invocation-modes-cases.ts", import.meta.url)));
assert.ok(import.meta.resolve("../../src/shell/runtime.js").endsWith("/runtime.ts"));
for (const record of reference.profiles[0]!.records) {
  const fixture = invocationFixtures.find(fixture => fixture.name === record.name)!;
  test(`${fixture.policyDifference ? "explicit diagnostic policy" : "exact primary 5.3"}: ${record.mode} ${record.name}`, async () => {
    const actual = await virtualObservation(fixture, record.mode);
    if (fixture.policyDifference) {
      const diagnostic = record.name.endsWith("binary") ? "cannot execute binary script" : "unsupported interpreter: /missing";
      const expected = { stdout: record.result.stdout, status: record.result.status, files: record.result.files, stderr: Buffer.from(`${record.mode}: line 1: bad/tool: ${diagnostic}\n`).toString("base64") };
      assert.deepEqual(actual, expected, fixture.policyDifference);
    } else assert.deepEqual(actual, record.result);
  });
}

test("native-backed errexit invocation consumes source with exact output and no file effects", async () => {
  const { shell, fs } = setup();
  let reads = 0;
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { reads++; yield Buffer.from("say bad"); } };
  for (const name of ["bash", "sh"]) {
    const readsBefore = reads;
    const result = await shell.exec(`${name} ${quote("-e")}`, { stdin });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "bad\n");
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "6261640a");
    assert.equal(result.stderr, "");
    assert.equal(result.stderrBytes.length, 0);
    assert.equal(reads, readsBefore + 1);
    assert.deepEqual(await fs.readdir("/"), []);
  }
});

test("unimplemented invocation flags reject explicitly before source consumption", async () => {
  const { shell } = setup();
  let reads = 0;
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { reads++; yield Buffer.from("say bad"); } };
  for (const name of ["bash", "sh"]) for (const flag of ["-i", "-l", "-x", "--login", "--norc", "--posix", "+s", "-csx"]) {
    const result = await shell.exec(`${name} ${quote(flag)}`, { stdin });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /unsupported option/u);
  }
  assert.equal(reads, 0);
});

test("new modes isolate cwd, variables, function locals, options and exit", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/other");
  const code = 'args "$0" "${PRIVATE-unset}" "$PUBLIC" "$PREFIX" "$#"; false | true; args "$?"; cd /other; export PUBLIC=child; exit 17';
  const result = await shell.exec(`PRIVATE=secret; export PUBLIC=parent; set -o pipefail; set -- parent; PREFIX=temp sh -c ${quote(code)} child ''; args "$?" "$PWD" "$PUBLIC" "$1" "${'${PREFIX-unset}'}"`);
  assert.equal(result.stdout, '["child","unset","parent","temp","1"]["0"]["17","/","parent","parent","unset"]');
  assert.equal(result.exitCode, 0, result.stderr);
});

test("stdin unit consumption preserves unread bytes across child exit", async () => {
  const { shell } = setup();
  const bytes = Uint8Array.from([...Buffer.from("exit 7\n"), 0, 255, 128]);
  const result = await shell.exec('bash -s; args "$?"; pass', { stdin: bytes });
  assert.deepEqual([...result.stdoutBytes], [...Buffer.from('["7"]'), 0, 255, 128]);
  assert.equal(result.stderr, "");
});

test("stdin command effects happen before requesting another source chunk", async () => {
  const { shell, fs } = setup();
  let reads = 0;
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() {
    reads++;
    yield Buffer.from("say ready >marker\n");
    assert.equal(new TextDecoder().decode(await fs.readFile("/marker")), "ready\n");
    reads++;
    yield Buffer.from("say done\n");
  } };
  const result = await shell.exec("sh", { stdin });
  assert.equal(result.stdout, "done\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(reads, 2);
});

test("UTF-8 source splits and binary data stay distinct", async () => {
  const { shell } = setup();
  const bytes = [...Buffer.from('args "é😀"\npass\n'), 0, 255, 128];
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { for (const byte of bytes) yield Uint8Array.of(byte); } };
  const result = await shell.exec("bash -s", { stdin });
  assert.deepEqual([...result.stdoutBytes], [...Buffer.from('["é😀"]'), 0, 255, 128]);
  assert.equal(result.exitCode, 0, result.stderr);
});

test("existing read -n consumes only its byte before source parsing resumes", async () => {
  const { shell } = setup();
  const result = await shell.exec("bash -s", { stdin: 'read -r -n 1 value\nZargs "$value"\n' });
  assert.equal(result.stdout, '["Z"]');
  assert.equal(result.exitCode, 0, result.stderr);
});

test("strict source decoding rejects NUL, invalid UTF-8 and controls without executing that unit", async () => {
  const { shell, fs } = setup();
  for (const invalid of [[0], [255], [127], [1], [0xc3]]) {
    const stdin = Uint8Array.from([...Buffer.from('say good >before\n'), ...Buffer.from('say bad >after '), ...invalid, 10]);
    const result = await shell.exec("bash -s", { stdin });
    assert.equal(result.exitCode, 126, result.stderr);
    assert.match(result.stderr, /binary|UTF-8/u);
    assert.equal(new TextDecoder().decode(await fs.readFile("/before")), "good\n");
    await assert.rejects(fs.stat("/after"), { code: "ENOENT" });
  }
});

test("code-string and stdin aggregate source budgets count UTF-8 bytes, not UTF-16", async () => {
  const { shell } = setup();
  const code = 'args "é😀"';
  const source = `bash -c ${quote(code)}`;
  const bytes = Buffer.byteLength(source) + Buffer.byteLength(code);
  assert.equal((await shell.exec(source, { limits: { maxSourceBytes: bytes } })).exitCode, 0);
  await assert.rejects(shell.exec(source, { limits: { maxSourceBytes: bytes - 1 } }), error => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
  const stdin = Buffer.concat([Buffer.from("pass\n"), Buffer.alloc(1000, 255)]);
  assert.equal((await shell.exec("bash", { stdin, limits: { maxSourceBytes: 9 } })).stdoutBytes.length, 1000);
  await assert.rejects(shell.exec("bash", { stdin, limits: { maxSourceBytes: 8 } }), error => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
});

test("all modes share command/output/loop budgets", async () => {
  const { shell } = setup();
  for (const source of [`bash -c 'say a; say b'`, "bash -s"]) {
    for (const [limits, limit] of [[{ maxCommands: 2 }, "maxCommands"], [{ maxOutputBytes: 3 }, "maxOutputBytes"]] as const) {
      await assert.rejects(shell.exec(source, { stdin: "say a\nsay b\n", limits }), error => error instanceof ShellLimitError && error.limit === limit);
    }
  }
  await assert.rejects(shell.exec("sh -s", { stdin: "for item in a b c; do true; done\n", limits: { maxLoopIterations: 2 } }), error => error instanceof ShellLimitError && error.limit === "maxLoopIterations");
});

test("stdin provenance and invoke byte overrides reach parsed commands", async () => {
  const { shell, commands, fs } = setup();
  const origins: (boolean | undefined)[] = [];
  const bytes: number[] = [];
  commands.register({ name: "origin", execute(context) { origins.push(context.stdinIsDefault); return { exitCode: 0 }; } });
  commands.register({ name: "delegate", async execute(context) {
    assert.ok(context.invoke);
    await context.invoke("bash", ["-c", "origin; pass"], { stdin: toByteSource(Uint8Array.of(0, 255)), stdinIsDefault: true, stdout: { async write(chunk) { bytes.push(...chunk); } } });
    return context.invoke("sh", ["-s"], { stdin: toByteSource("origin\n"), stdinIsDefault: false });
  } });
  await fs.writeFile("/empty", new Uint8Array());
  const result = await shell.exec('bash -c origin; delegate; sh -c origin <empty');
  assert.deepEqual(origins, [true, true, false, false]);
  assert.deepEqual(bytes, [0, 255]);
  assert.equal(result.exitCode, 0, result.stderr);
});

test("stdin nested invocation inherits descriptor cursor without a new budget", async () => {
  const { shell, fs } = setup();
  const source = 'sh -s\nread -r value\nDATA\nargs "$value"\nexit 3\nargs "outer" "$?"\n';
  const result = await shell.exec("bash -s 3>out", { stdin: source });
  assert.equal(result.stdout, '["DATA"]["outer","3"]');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.readFile("/out")).length, 0);
});

test("PATH respects effective nonexported variables, literal invoke and registry precedence", async () => {
  const { shell, fs, commands } = setup();
  await fs.mkdir("/bin");
  await fs.writeFile("/bin/tool", Buffer.from('#!/bin/bash\nargs "$0" "$@" "${PATH-unset}"'), { mode: 0o755 });
  commands.register({ name: "delegate", execute(context) { assert.ok(context.invoke); return context.invoke("tool", ["", "$(bad)"], { env: { PATH: "/bin" } }); } });
  const result = await shell.exec('PATH=/bin; tool first; delegate');
  assert.equal(result.stdout, '["/bin/tool","first","unset"]["/bin/tool","","$(bad)","/bin"]');
  assert.equal(result.exitCode, 0, result.stderr);
  commands.register({ name: "tool", async execute(context) { await writeText(context.stdout, "registry"); return { exitCode: 0 }; } });
  assert.equal((await shell.exec("PATH=/bin; tool")).stdout, "registry");
});

test("PATH lookup is middleware-authorized and accepts cwd/environment overlays", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/other");
  await fs.writeFile("/other/tool", Buffer.from('#!/bin/bash\nargs "$0" "$PWD"'), { mode: 0o755 });
  shell.use(async (context, next) => {
    if (context.command === "deny") return { exitCode: 42 };
    if (context.command === "tool") { context.cwd = "/other"; context.env.PATH = ""; }
    return next();
  });
  let calls = 0;
  const stat = fs.stat.bind(fs);
  fs.stat = async (...args) => { calls++; return stat(...args); };
  assert.equal((await shell.exec("deny")).exitCode, 42);
  assert.equal(calls, 0);
  const result = await shell.exec("tool; pwd");
  assert.equal(result.stdout, '["./tool","/other"]/\n');
  assert.equal(result.exitCode, 0, result.stderr);
});

test("PATH rejects unknown permission capability and never probes host fallback", async () => {
  const { fs, commands } = setup();
  await fs.writeFile("/tool", Buffer.from("#!/bin/bash\nsay bad"), { mode: 0o755 });
  const backend = new Proxy(fs, { get(target, property) {
    if (property === "capabilities") return { ...target.capabilities, permissions: false };
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const shell = new Shell({ fs: backend, commands });
  const result = await shell.exec("PATH=; tool");
  assert.equal(result.exitCode, 126, result.stderr);
  assert.match(result.stderr, /execution permissions.*not supported/u);
  assert.equal((await shell.exec("PATH=/usr/bin:/bin; node")).exitCode, 127);
});

test("PATH propagates backend denials and does not try a second readable interpreter", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/first");
  await fs.mkdir("/second");
  for (const path of ["/first/tool", "/second/tool"]) await fs.writeFile(path, Buffer.from("#!/bin/bash\nsay bad"), { mode: 0o755 });
  const access = fs.access.bind(fs);
  fs.access = async (path, mode, options) => {
    if (path === "/first/tool" && mode === 5) throw new FsError("EACCES", { path });
    return access(path, mode, options);
  };
  const result = await shell.exec("PATH=/first:/second; tool");
  assert.equal(result.exitCode, 126, result.stderr);
  assert.equal(result.stdout, "");
});

for (const scenario of ["recursive-c", "recursive-stdin", "recursive-path", "cancel-lookup", "cancel-source", "cancel-drain", "cancel-command", "cancel-empty-chunks", "cancel-incomplete-unit", "late-source", "source-limit", "output-limit", "syntax-without-eof"]) {
  test(`hard-bounded invocation regression: ${scenario}`, () => {
    const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./invocation-modes-probe.ts", import.meta.url)), scenario], { encoding: "utf8", timeout: 5000, maxBuffer: 1048576 });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /passed/u);
  });
}
