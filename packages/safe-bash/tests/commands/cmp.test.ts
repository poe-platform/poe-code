import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Shell } from "../../src/shell/index.js";
import { standardCommands } from "../../src/commands/index.js";
import type { FileSystem } from "../../src/contracts/index.js";
import { fixture, run } from "./helpers.js";

const binary = new Uint8Array([0, 10, 255]);

for (const [name, script, left, right, status, stdout, stderr] of [
  ["equal binary", "cmp left right", binary, binary, 0, "", ""],
  ["first differing byte and line", "cmp left right", binary, new Uint8Array([0, 10, 254]), 1, "left right differ: char 3, line 2\n", ""],
  ["silent difference", "cmp -s left right", "a", "b", 1, "", ""],
  ["long silent equal", "cmp --silent left right", binary, binary, 0, "", ""],
  ["all octal differences", "cmp -l left right", binary, new Uint8Array([1, 11, 254]), 1, "1   0   1\n2  12  13\n3 377 376\n", ""],
  ["bounded prefix", "cmp -n2 left right", binary, new Uint8Array([0, 10, 254]), 0, "", ""],
  ["zero prefix", "cmp -n0 left right", "a", "b", 0, "", ""],
  ["left EOF", "cmp left right", "a\n", "a\nb", 1, "", "cmp: EOF on left after byte 2, line 1\n"],
  ["unterminated EOF", "cmp left right", "a", "ab", 1, "", "cmp: EOF on left after byte 1, in line 1\n"],
  ["right EOF", "cmp left right", "a\nb", "a\n", 1, "", "cmp: EOF on right after byte 2, line 1\n"],
  ["empty EOF", "cmp left right", "", "b", 1, "", "cmp: EOF on left which is empty\n"],
  ["verbose EOF", "cmp -l left right", "a\n", "a\nb", 1, "", "cmp: EOF on left after byte 2\n"],
  ["silent EOF", "cmp --silent left right", "", "b", 1, "", ""],
  ["verbose differences before EOF", "cmp -l left right", "ax", "byz", 1, "1 141 142\n2 170 171\n", "cmp: EOF on left after byte 2\n"],
] as const) test(`cmp ${name}`, async () => {
  const shell = new Shell({ fs: await fixture({ left, right }), cwd: "/work" }).use(standardCommands());
  try {
    const result = await shell.exec(script);
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [status, stdout, stderr]);
  } finally { await shell.dispose(); }
});

test("cmp compares stdin on either side and supports the implicit second stdin operand", async () => {
  const shell = new Shell({ fs: await fixture({ file: binary }), cwd: "/work" }).use(standardCommands());
  try {
    for (const script of ["cmp - file", "cmp file -", "cmp file", "cmp - -"]) {
      const result = await shell.exec(script, { stdin: binary });
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "", ""]);
    }
  } finally { await shell.dispose(); }
});

test("cmp invalid invocations return status two", async () => {
  const shell = new Shell({ fs: await fixture({ left: "a", right: "b" }), cwd: "/work" }).use(standardCommands());
  try {
    for (const script of ["cmp", "cmp -sl left right", "cmp --unknown left right", "cmp -n -1 left right", "cmp -n", "cmp left right extra", "cmp missing right", "cmp -n0 missing right", "cmp . right"]) {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 2, script);
      assert.notEqual(result.stderr, "", script);
    }
    const silent = await shell.exec("cmp -s missing right");
    assert.deepEqual([silent.exitCode, silent.stdout, silent.stderr], [2, "", ""]);
  } finally { await shell.dispose(); }
});

test("cmp -n parses native byte-count bases, suffixes, aliases and repeated options", async () => {
  const fs = await fixture({ left: "abcdefghij", right: "abcdefghXj" });
  for (const args of [["-n", "010"], ["--bytes=0x8"], ["-n+8"], ["-n", " \t8"], ["-n1", "-n10"], ["-n10", "-n1"], ["-n0K"], ["-n0KiB"], ["--quiet", "-n8"]]) {
    assert.equal((await run("cmp", [...args, "left", "right"], { fs })).exitCode, 0, args.join(" "));
  }
  for (const count of ["011", "0x9", "1K", "1kB", "1KB", "1MiB", "9007199254740992", "18446744073709551615"]) {
    assert.equal((await run("cmp", ["-n", count, "left", "right"], { fs })).exitCode, 1, count);
  }
  for (const count of ["", "08", "-1", "1b", "1w", "1m", "1g", "1t", "1 ", "1.5", "0x", "NaN", "18446744073709551616"]) {
    assert.equal((await run("cmp", ["-n", count, "left", "right"], { fs })).exitCode, 2, count);
  }
  const verbose = await run("cmp", ["left", "--verbose", "right"], { fs });
  assert.deepEqual([verbose.exitCode, verbose.stdout], [1, " 9 151 130\n"]);
});

test("cmp preserves explicit C diagnostic wording without changing byte positions", async () => {
  const fs = await fixture({ left: binary, right: new Uint8Array([0, 10, 254]) });
  const result = await run("cmp", ["left", "right"], { fs, env: { LC_ALL: "C" } });
  assert.equal(result.stdout, "left right differ: char 3, line 2\n");
});

test("cmp preserves the first per-path capability failure without retrying it away", async () => {
  const fs: FileSystem = await fixture({ left: "a", right: "a" });
  let calls = 0;
  const errors: unknown[] = [];
  fs.capabilitiesFor = async () => { if (++calls === 1) throw undefined; return fs.capabilities; };
  const result = await run("cmp", ["left", "right"], { fs, onInternalError(error) { errors.push(error); } });
  assert.equal(result.exitCode, 2);
  assert.deepEqual(errors, [undefined]);
  assert.equal(calls, 1);
});

test("cmp admits read permissions before same-file, zero-byte and silent shortcuts", async () => {
  const fs = await fixture({ secret: Uint8Array.of(1), readable: Uint8Array.of(1) });
  await fs.chmod("/work/secret", 0);
  for (const args of [["secret", "secret"], ["-n0", "secret", "secret"], ["-n0", "secret", "readable"], ["-s", "secret", "readable"]]) {
    const result = await run("cmp", args, { fs });
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [2, "", args.includes("-s") ? "" : "cmp: secret: Permission denied\n"], args.join(" "));
  }
});

interface NativeCase {
  args: string[];
  files: Record<string, string>;
  directories: string[];
  stdin: string;
  env: Record<string, string>;
  profile: string;
  expected: { exitCode: number; stdout: string; stderr: string };
}

const nativeSnapshot = JSON.parse(readFileSync(new URL("./cmp-native.snapshot.json", import.meta.url), "utf8")) as {
  version: number; oracle: string; cases: NativeCase[]; seekableStdinCases: NativeCase[];
  shellCases: { script: string; files: Record<string, string>; symlinks?: Record<string, string>; env?: Record<string, string>; expected: NativeCase["expected"] }[];
};

test("cmp matches versioned GNU native stdout, stderr and status bytes using only in-memory fixtures", async context => {
  assert.equal(nativeSnapshot.version, 1);
  assert.equal(nativeSnapshot.oracle, "cmp (GNU diffutils) 3.7");
  const failures: string[] = [];
  for (const sample of nativeSnapshot.cases) {
    const fs = await fixture(Object.fromEntries(Object.entries(sample.files).map(([name, bytes]) => [name, Buffer.from(bytes, "base64")])));
    for (const name of sample.directories) await fs.mkdir(`/work/${name}`, { recursive: true });
    const actual = await run("cmp", sample.args, { fs, stdin: Buffer.from(sample.stdin, "base64"), env: sample.env });
    try {
      assert.deepEqual([actual.exitCode, actual.stdoutBytes, actual.stderrBytes], [sample.expected.exitCode, Buffer.from(sample.expected.stdout, "base64"), Buffer.from(sample.expected.stderr, "base64")]);
    } catch (error) { failures.push(`${JSON.stringify({ args: sample.args, env: sample.env, profile: sample.profile })}\n${String(error)}`); }
  }
  context.diagnostic(`${nativeSnapshot.cases.length} exact GNU snapshot comparisons; ${failures.length} differences; ${nativeSnapshot.shellCases.length} additional required shell regressions`);
  assert.equal(failures.length, 0, failures.join("\n\n"));
});

for (const sample of nativeSnapshot.shellCases) test(`cmp GNU shell bytes and input provenance: ${sample.script}`, async () => {
  const fs = await fixture(Object.fromEntries(Object.entries(sample.files).map(([name, bytes]) => [name, Buffer.from(bytes, "base64")])));
  for (const [name, target] of Object.entries(sample.symlinks ?? {})) await fs.symlink(target, `/work/${name}`);
  const shell = new Shell({ fs, cwd: "/work", ...(sample.env ? { env: sample.env } : {}) }).use(standardCommands());
  try {
    const result = await shell.exec(sample.script);
    assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], [sample.expected.exitCode, Buffer.from(sample.expected.stdout, "base64"), Buffer.from(sample.expected.stderr, "base64")]);
  } finally { await shell.dispose(); }
});

test("cmp reads a declared metadata-free backend without calling disabled stat", async () => {
  const backing = await fixture({ left: "a", right: "b" });
  let statCalls = 0;
  const fs = new Proxy(backing, { get(target, key) {
    if (key === "capabilities") return { ...target.capabilities, stat: false };
    if (key === "stat") return async () => { statCalls++; throw new Error("disabled stat"); };
    const member: unknown = Reflect.get(target, key);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const result = await run("cmp", ["left", "right"], { fs });
  assert.deepEqual([result.exitCode, result.stdout, result.stderr], [1, "left right differ: char 1, line 1\n", ""]);
  assert.equal(statCalls, 0);
});

test("cmp preserves productive one-byte chunking beyond the empty-input work allowance", async () => {
  const fs = await fixture({ right: new Uint8Array(65537) });
  const stdin = { async *[Symbol.asyncIterator]() { for (let index = 0; index < 65537; index++) yield Uint8Array.of(0); } };
  const result = await run("cmp", ["-", "right"], { fs, stdin });
  assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "", ""]);
});

test("cmp reports cleanup failure once as trouble and awaits both stream retirements", async () => {
  const fs = await fixture({ left: "a", right: "b" });
  let closes = 0;
  const original = new Error("owned input retirement failed");
  fs.readStream = () => ({ [Symbol.asyncIterator]() { return {
    async next() { return { done: false, value: Uint8Array.of(0) }; },
    async return() { closes++; if (closes === 1) throw original; return { done: true, value: undefined }; },
  }; } });
  const errors: unknown[] = [];
  const shell = new Shell({ fs, cwd: "/work", onInternalError(error) { errors.push(error); } }).use(standardCommands());
  try {
    const result = await shell.exec("cmp -n1 left right");
    assert.equal(result.exitCode, 2);
    assert.deepEqual(errors, [original]);
    assert.equal(closes, 2);
  } finally { await shell.dispose(); }
});
