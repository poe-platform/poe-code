import assert from "node:assert/strict";
import { lstatSync } from "node:fs";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { mapfileExtension } from "../../../../src/shell/extensions/mapfile/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { primaryReference } from "./primary-reference.js";

function setup() {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, extensions: [mapfileExtension({ replace: true })] });
  for (const command of basicCommands()) shell.register(command);
  return { fs, shell };
}

const cases = [
  { name: "default array and unterminated final line", source: `mapfile; printf '<%s>' "\${MAPFILE[@]}"`, input: "one\ntwo\ntail", output: "<one\n><two\n><tail>" },
  { name: "readarray synonym", source: `readarray -t a; printf '<%s>' "\${a[@]}"`, input: "one\ntwo\n", output: "<one><two>" },
  { name: "empty input clears", source: `a=(old tail); mapfile a; printf '%s' "\${#a[@]}"`, input: "", output: "0" },
  { name: "explicit origin retains old cells", source: `a=(old tail keep); mapfile -tn1 -s1 -O1 a; printf '<%s>' "\${a[@]}"; read -r rest; printf '<%s>' "$rest"`, input: "skip\none\nrest\n", output: "<old><one><keep><rest>" },
  { name: "delimiter selection and trimming", source: `mapfile -td:: a; printf '<%s>' "\${a[@]}"`, input: "one:two::tail", output: "<one><two><><tail>" },
  { name: "NUL records", source: `mapfile -d '' a; printf '<%s>' "\${a[@]}"`, input: "one\0two\0tail", output: "<one><two><tail>" },
  { name: "embedded NUL truncates assigned value only", source: `mapfile a; printf '<%s>' "\${a[@]}"`, input: "a\0b\nc\n", output: "<a><c\n>" },
  { name: "callback observes earlier publication and current index", source: `a=(old); cb() { printf 'cb:%s:<%s>:<%s>\\n' "$1" "$2" "\${a[*]}"; }; mapfile -t -C cb -c1 a; printf '<%s>' "\${a[@]}"`, input: "one\ntwo\n", output: "cb:0:<one>:<>\ncb:1:<two>:<one>\n<one><two>" },
  { name: "callback ordinary failure is ignored", source: `cb() { false; }; mapfile -t -C cb -c1 a; printf '%s:<%s>' "$?" "\${a[*]}"`, input: "one\ntwo\n", output: "0:<one two>" },
  { name: "callback marks admitted target readonly", source: `cb() { readonly a; }; mapfile -t -C cb -c1 a; printf '<%s>' "\${a[@]}"`, input: "one\ntwo\n", output: "<one><two>" },
  { name: "callback replaces target", source: `cb() { a=(callback); }; mapfile -t -C cb -c1 a; printf '<%s>' "\${a[@]}"`, input: "one\ntwo\n", output: "<callback><two>" },
  { name: "callback reads from current shared cursor", source: `cb() { read -r consumed; printf '%s:%s;' "$2" "$consumed"; }; mapfile -t -C cb -c1 a; printf '<%s>' "\${a[@]}"`, input: "one\ntwo\nthree\nfour\n", output: "one:two;three:four;<one><three>" },
  { name: "exported scalar promotion", source: `export a=old; mapfile -t a; printf '<%s>' "\${a[@]}"`, input: "one\ntwo\n", output: "<one><two>" },
  { name: "uint32 origin wrap", source: `mapfile -t -O4294967295 a; printf '<%s>' "\${!a[@]}"`, input: "one\ntwo\n", output: "<0><4294967295>" },
] as const;

for (const entry of cases) test(`mapfile VFS script: ${entry.name}`, async context => {
  const { fs, shell } = setup();
  context.after(() => shell.dispose());
  await fs.writeFile("/input", Buffer.from(entry.input));
  await fs.writeFile("/script", Buffer.from(`{ ${entry.source}; } </input`));
  const result = await shell.exec("source /script");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, entry.output);
});

test("live native confirms VFS script expectations", {}, () => {
  for (const entry of cases) {
    const result = primaryReference(import.meta.url, entry.source, entry.input);
    assert.equal(result.status, 0, entry.name);
    assert.deepEqual(result.stdout, Buffer.from(entry.output), entry.name);
    assert.deepEqual(result.stderr, Buffer.alloc(0), entry.name);
  }
});

test("explicit descriptor and its alias retain one shared cursor", async context => {
  const { fs, shell } = setup();
  context.after(() => shell.dispose());
  await fs.writeFile("/input", Buffer.from("one\ntwo\nthree\n"));
  const result = await shell.exec(`{ mapfile -t -u3 -n1 a; mapfile -t -u4 -n1 b; read -r tail <&3; printf '<%s>' "\${a[@]}" "\${b[@]}" "$tail"; } 3</input 4<&3`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "<one><two><three>");
  assert.equal(result.stderr, "");
});

test("invalid UTF-8 record and callback bytes remain canonical", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec(`cb() { printf '%s' "$2"; }; mapfile -t -C cb -c1 a; printf '%s' "\${a[@]}"`, { stdin: Buffer.from([255, 39, 36, 40, 41, 10]) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from([255, 39, 36, 40, 41, 255, 39, 36, 40, 41]));
  assert.equal(result.stderr, "");
});

for (const command of ["mapfile", "readarray"]) test(`${command} help matches native bytes and status`, {}, async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const expected = primaryReference(import.meta.url, `${command} --help`);
  const actual = await shell.exec(`${command} --help`);
  assert.equal(actual.exitCode, expected.status);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), expected.stdout);
  assert.deepEqual(Buffer.from(actual.stderrBytes), expected.stderr);
});

test("readonly refusal leaves input unread and the previous value intact", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec(`a=(old); readonly a; mapfile a; status=$?; read -r rest; printf '%s:<%s>:<%s>' "$status" "$a" "$rest"`, { stdin: Buffer.from("one\ntwo\n") });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "1:<old>:<one>");
  assert.equal(result.stderr, "shell: line 1: a: readonly variable\n");
});

test("raw invalid array name keeps diagnostic bytes and runtime prefix", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec("mapfile $'\\xff'");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.concat([Buffer.from("shell: line 1: mapfile: `"), Buffer.from([255]), Buffer.from("': not a valid identifier\n")]));
});

test("an open write-only descriptor is distinct from a missing descriptor", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec(`a=(old); mapfile -u3 a 3>/output; printf 'status=%s,count=%s' "$?" "\${#a[@]}"`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "status=0,count=0");
  assert.equal(result.stderr, "");
});

const descriptorCases = [
  ["write-only intermediate descriptor", "mapfile -u3 -u0 -tn1 a 3>/dev/null"],
  ["write-only final descriptor", "mapfile -u0 -u3 a 3>/dev/null"],
  ["write-only descriptor with explicit origin", "mapfile -u3 -O1 a 3>/dev/null"],
  ["write-only descriptor before invalid count", "mapfile -u3 -n-1 a 3>/dev/null"],
  ["write-only descriptor before invalid array name", "mapfile -u3 bad-name 3>/dev/null"],
  ["write-only descriptor before help", "mapfile -u3 --help 3>/dev/null"],
  ["write-only descriptor with readonly array", "readonly a; mapfile -u3 a 3>/dev/null"],
  ["closed intermediate descriptor", "mapfile -u9 -u0 a 9<&-"],
  ["closed default descriptor", "mapfile a 0<&-"],
  ["closed explicit descriptor", "mapfile -u0 a 0<&-"],
  ["write-only default descriptor", "mapfile a 0>/dev/null"],
  ["raw invalid descriptor diagnostic", "mapfile -u $'\\xff' a"],
] as const;

for (const [name, command] of descriptorCases) test(`native descriptor admission and read-stage effects: ${name}`, {}, async context => {
  assert.ok(lstatSync("/dev/null").isCharacterDevice(), "native write-only sink must be the existing null device");
  const { fs, shell } = setup();
  context.after(() => shell.dispose());
  await fs.mkdir("/dev");
  const source = `a=(old tail); ${command}; status=$?; read -r remainder; printf 'status:%s,count:%s,rest:<%s>' "$status" "\${#a[@]}" "$remainder"`;
  const input = "one\ntwo\n";
  const expected = primaryReference(import.meta.url, source, input);
  const actual = await shell.exec(source, { stdin: Buffer.from(input) });
  assert.equal(actual.exitCode, expected.status, source);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), expected.stdout, source);
  assert.deepEqual(Buffer.from(actual.stderrBytes), expected.stderr, source);
});

test("origin wrapping writes the exact sparse indices without key-list expansion", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec(`mapfile -t -O4294967295 a; printf '<%s>' "\${a[0]}" "\${a[4294967295]}"`, { stdin: Buffer.from("one\ntwo\n") });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "<two><one>");
});

test("streamed reusable chunks are copied before the producer advances", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  let finalized = false;
  const stdin = { async *[Symbol.asyncIterator]() {
    const bytes = Buffer.from("a\n");
    try {
      yield bytes;
      bytes[0] = 98;
      yield bytes;
    } finally { bytes.fill(120); finalized = true; }
  } };
  const result = await shell.exec(`mapfile -t a; printf '<%s>' "\${a[@]}"`, { stdin });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "<a><b>");
  assert.equal(finalized, true);
});

for (const reason of [false, 0, "", null]) test(`empty-chunk producer yields to cancellation and is finalized: ${String(reason)}`, { timeout: 5000 }, async context => {
  const { shell } = setup();
  const controller = new AbortController();
  let entered!: () => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  let finalized = false;
  const stdin = { async *[Symbol.asyncIterator]() {
    try { entered(); for (;;) yield new Uint8Array(); }
    finally { finalized = true; }
  } };
  context.after(() => shell.dispose());
  const pending = shell.exec("mapfile a", { stdin, signal: controller.signal });
  const rejected = assert.rejects(pending, error => Object.is(error, reason));
  await admitted;
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await rejected; } finally { clearTimeout(timer); }
  assert.equal(finalized, true);
});

test("skipping short streamed records remains cancellable before consuming them all", { timeout: 5000 }, async context => {
  const { shell } = setup();
  const controller = new AbortController();
  let entered!: () => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  let produced = 0;
  let finalized = false;
  const stdin = { async *[Symbol.asyncIterator]() {
    try {
      entered();
      for (let index = 0; index < 512; index++) { produced++; yield Uint8Array.of(10); }
    } finally { finalized = true; }
  } };
  context.after(() => shell.dispose());
  const pending = shell.exec("mapfile -s512 a", { stdin, signal: controller.signal });
  const rejected = assert.rejects(pending, error => error === false);
  await admitted;
  const handle = setImmediate(() => controller.abort(false));
  try { await rejected; } finally { clearImmediate(handle); }
  assert.ok(produced < 512);
  assert.equal(finalized, true);
});
