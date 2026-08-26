import assert from "node:assert/strict";
import { test } from "node:test";
import { bashResult } from "./bash-bugfix-helpers.js";
import { setup } from "./helpers.js";

const prelude = 'say() { printf "%s\\n" "$*"; }; pass() { cat; }; ';
for (const source of [
  "{ say moved >&4; } 3>out 4>&3-",
  "{ say first >&4; say second >&5; } 3>out 5>&3 4>&3-",
  "func() { say moved >&4; }; func 3>out 4>&3-",
  "{ say moved >&4 | pass; } 3>out 4>&3-",
  "{ read -r first <&4; say \"$first\"; pass <&5; } 3<input 5<&3 4<&3-",
  "{ pass <&4; } 3<input 4<&3-",
  "{ pass <&4; } 3<input 4>&3-",
  "{ say moved >&4; } 3>out 4<&3-",
  "{ say moved; } 3>out 1>&3-",
]) {
  test(`descriptor moves preserve ordering, shared offsets and scope: ${source}`, async () => {
    const files = { input: "one\ntwo\n" };
    const expected = bashResult(prelude + source, { files });
    const { shell, fs } = setup();
    await fs.writeFile("/input", new TextEncoder().encode(files.input));
    const actual = await shell.exec(source, { signal: AbortSignal.timeout(2000) });
    const actualFiles = Object.fromEntries(await Promise.all((await fs.readdir("/")).map(async (entry) => [entry.name, new TextDecoder().decode(await fs.readFile(`/${entry.name}`))])));
    assert.deepEqual({ stdout: actual.stdout, stderr: actual.stderr, exitCode: actual.exitCode, files: actualFiles }, expected);
  });
}

test("moves close their source and reject closed descriptors", async () => {
  for (const source of [": 3>out 4>&3- 5>&3", ": 3<input 4<&3- 5<&3", ": 4>&3-"]) {
    const expected = bashResult(source, { files: { input: "one\n" } });
    const { shell, fs } = setup();
    await fs.writeFile("/input", new TextEncoder().encode("one\n"));
    const actual = await shell.exec(source);
    assert.equal(expected.exitCode, 1, source);
    assert.equal(actual.exitCode, 1, source);
    assert.match(actual.stderr, /Bad file descriptor/u, source);
  }
});

test("expanded moves reject before running their body and preserve source", async () => {
  const { shell, fs } = setup();
  const result = await shell.exec('target=3-; { say outer >&3; { say inner >&4; } 4>&$target; say restored >&3; } 3>out');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stderr, /3-: ambiguous redirect/u);
  assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "outer\nrestored\n");
});

for (const command of [
  ': 4>&3-', '4>&3-', '{ say inner >&4; } 4>&3-',
  'func() { say inner >&4; }; func 4>&3-',
  'func() { : 4>&3-; }; func',
  '(say inner >&4) 4>&3-', ': 4>&3- | :', 'value=$(: 4>&3-)',
  ': 3>other 4>&3-', ': 3>&3-', ': 4>&3- 5>&6', ': 4>&"3-"', String.raw`: 4>&3\-`,
  'fd=3; : 4>&$fd-', ": 4>&'3'-", ": 4>&3'-'",
]) {
  test(`descriptor move scope follows paired native evidence: ${command}`, async () => {
    const source = `{ say before >&3; ${command}; say after >&3; } 3>out`;
    const expected = bashResult(prelude + source);
    const { shell, fs } = setup();
    const result = await shell.exec(source);
    const files = Object.fromEntries(await Promise.all((await fs.readdir("/")).map(async (entry) => [entry.name, new TextDecoder().decode(await fs.readFile(`/${entry.name}`))])));
    assert.equal(result.exitCode, expected.exitCode, expected.stderr);
    assert.equal(result.stdout, expected.stdout);
    assert.deepEqual(files, expected.files);
    assert.equal(result.stderr.split("\n").length, expected.stderr.split("\n").length);
  });
}

test("moved input closes only the source slot, not duplicate offsets", async () => {
  const { shell, fs } = setup();
  await fs.writeFile("/input", new TextEncoder().encode("one\ntwo\n"));
  const result = await shell.exec('{ : 5<&3; { read -r first <&4; say "$first"; } 4<&3-; : 6<&3; pass <&5; } 3<input 5<input');
  assert.equal(result.stdout, "one\none\ntwo\n");
  assert.match(result.stderr, /3: Bad file descriptor/u);
});

test("moving standard input closes the parent slot and updates origin", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "origin", execute(context) { assert.equal(context.stdinIsDefault, false); return { exitCode: 0 }; } });
  const result = await shell.exec(': 4<&0-; origin; : 5<&0');
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /0: Bad file descriptor/u);
});

test("moved stdin preserves provenance and cancellation", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "origin", execute(context) { assert.equal(context.stdinIsDefault, false); return { exitCode: 0 }; } });
  assert.equal((await shell.exec("origin 3<&0 0<&3-", { stdin: "" })).exitCode, 0);
  const controller = new AbortController();
  const reason = new Error("stop moved input");
  const stdin = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<Uint8Array>>(() => {}), return: async () => ({ done: true as const, value: undefined }) }; } };
  const pending = shell.exec("read value 3<&0 0<&3-", { stdin, signal: controller.signal });
  setTimeout(() => controller.abort(reason), 20);
  await assert.rejects(pending, (error) => error === reason);
});
