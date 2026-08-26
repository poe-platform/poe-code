import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { diffPatchCommands, type DiffPatchOptions } from "../../../../src/commands/diff-patch/index.js";
import { Shell } from "../../../../src/shell/index.js";
import { assertBytes, cwd, exactUpdate, instrument, invoke, memory, quoted, section, snapshot } from "./helpers.js";

test("bounded 4079-byte path accepts 16318-character octal quoted header", { timeout: 4000 }, async () => {
  const name = Array.from({ length: 16 }, () => "a".repeat(254)).join("/");
  const encoded = `"${[...Buffer.from(name)].map(byte => `\\${byte.toString(8).padStart(3, "0")}`).join("")}"`;
  assert.equal(name.length, 4079);
  assert.equal(encoded.length, 16318);
  await exactUpdate(name, section(encoded), ["-p0"]);
});

for (const [name, header] of [
  ["quoted source length", `"${"\\141".repeat(4096)}"`],
  ["decoded path length", quoted("x".repeat(4097))],
  ["decoded depth", quoted(`${"d/".repeat(257)}target`)],
] as const) {
  test(`decoder limit ${name} rejects before earlier section writes`, { timeout: 4000 }, async () => {
    const backing = await memory({ first: "old\n", target: "old\n" });
    const before = await snapshot(backing);
    const observed = instrument(backing);
    const result = await invoke(observed.fs, "patch", { input: section("first") + section(header) });
    assert.deepEqual(observed.mutations(), []);
    assert.deepEqual(await snapshot(backing), before);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /(?:path length|depth) limit/u);
  });
}

for (const budget of ["input", "work", "files"] as const) {
  test(`encoded headers obey ${budget} budget before mutations`, async () => {
    const backing = await memory({ first: "old\n", "caféteria": "old\n", sentinel: "untouched\n" });
    const before = await snapshot(backing);
    const observed = instrument(backing);
    const input = section("first") + section(quoted("caféteria"));
    const options: DiffPatchOptions = budget === "input" ? { maxInputBytes: Buffer.byteLength(input) - 1 }
      : budget === "work" ? { maxWork: 8 } : { maxFiles: 1 };
    const result = await invoke(observed.fs, "patch", { input, options });
    assert.deepEqual(observed.mutations(), []);
    assert.deepEqual(await snapshot(backing), before);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /(?:limit|exceed)/iu);
  });
}

test("bounded bulk quoted decoding yields to cancellation before committing", { timeout: 5000 }, async () => {
  const files = Object.fromEntries(Array.from({ length: 384 }, (_, index) => [`file-${index}-${"漢字".repeat(16)}`, "old\n"]));
  const backing = await memory({ ...files, sentinel: "untouched\n" });
  const before = await snapshot(backing);
  const observed = instrument(backing);
  const controller = new AbortController();
  const reason = new Error("bounded quoted path batch cancellation");
  const input = Object.keys(files).map(name => section(quoted(name))).join("");
  assert(Buffer.byteLength(input) < 1024 * 1024);
  const cancellation = setImmediate().then(() => controller.abort(reason));
  await assert.rejects(invoke(observed.fs, "patch", { input, signal: controller.signal }), error => error === reason);
  await cancellation;
  assert.deepEqual(observed.mutations(), []);
  assert.deepEqual(await snapshot(backing), before);
  assert(observed.calls.every(operation => operation.signal === controller.signal));
});

test("Shell uses explicit diff -u headers through quoted-filename patch pipeline", { timeout: 4000 }, async () => {
  const name = 'shell 漢字\t"file"';
  const backing = await memory({ left: "old\n", right: "new\n", [name]: "old\n", sentinel: "untouched\n" });
  const beforeIdentity = (await backing.lstat(`${cwd}/${name}`)).ino;
  const observed = instrument(backing);
  const shell = new Shell({ fs: observed.fs, cwd }).use(diffPatchCommands());
  const normal = await shell.exec("diff left right");
  assert.equal(normal.exitCode, 1, normal.stderr);
  assert.match(normal.stdout, /^1c1\n/u);
  assert.doesNotMatch(normal.stdout, /^--- /u);
  const header = quoted(name);
  const result = await shell.exec(`diff -u -L '${header}' -L '${header}' left right | patch`, { signal: AbortSignal.timeout(3000) });
  assert.equal(result.exitCode, 0, result.stderr);
  await assertBytes(backing, name, "new\n");
  await assertBytes(backing, "left", "old\n");
  await assertBytes(backing, "right", "new\n");
  await assertBytes(backing, "sentinel", "untouched\n");
  assert.equal((await backing.lstat(`${cwd}/${name}`)).ino, beforeIdentity);
  assert.deepEqual(observed.mutations().map(operation => operation.path), [`${cwd}/${name}`]);
});
