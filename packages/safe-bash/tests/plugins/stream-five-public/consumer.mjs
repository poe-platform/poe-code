import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  Shell, CommandRegistry, agentCommands, createAgentCommands, createMemoryFileSystem,
  createStreamFormatCommands, streamFormatCommands, createSplitCommands, splitCommands,
  createStreamInspectionCommands, streamInspectionCommands,
} from "virtual-bash";
import * as format from "virtual-bash/commands/stream-format";
import * as split from "virtual-bash/commands/split";
import * as inspection from "virtual-bash/commands/stream-inspection";

const pause = () => new Promise(resolve => setImmediate(resolve));
const newNames = ["seq", "nl", "rev", "unexpand", "split"];

test("moved package resolves only compiled public root and subpaths", () => {
  const entry = fileURLToPath(import.meta.resolve("virtual-bash"));
  assert.ok(entry.startsWith(fileURLToPath(new URL("./node_modules/virtual-bash/dist/", import.meta.url))));
  const packageRoot = new URL("./node_modules/virtual-bash/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("package.json", packageRoot)));
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.equal(existsSync(new URL("src", packageRoot)), false);
  assert.equal(format.createStreamFormatCommands, createStreamFormatCommands);
  assert.equal(format.streamFormatCommands, streamFormatCommands);
  assert.equal(split.createSplitCommands, createSplitCommands);
  assert.equal(split.splitCommands, splitCommands);
  assert.equal(inspection.createStreamInspectionCommands, createStreamInspectionCommands);
  assert.equal(inspection.streamInspectionCommands, streamInspectionCommands);
  assert.deepEqual(createStreamFormatCommands().map(command => command.name), ["seq", "nl", "rev", "unexpand"]);
  assert.deepEqual(createSplitCommands().map(command => command.name), ["split"]);
  const names = createAgentCommands().map(command => command.name);
  assert.equal(names.length, 80);
  assert.equal(new Set(names).size, 80);
  assert.ok([...newNames, "tac", "expand", "fold", "strings"].every(name => names.includes(name)));
  assert.ok(!names.includes("curl") && !names.includes("safejs"));
});

for (const [command, stdin, expected] of [
  ["seq 1 3", "", "1\n2\n3\n"],
  ["nl -ba -w1 -s: -", "a\n\nb\n", "1:a\n2:\n3:b\n"],
  ["rev", "abc\n", "cba\n"],
  ["unexpand -a", "        x\n", "\tx\n"],
  ["tac", "a\nb\n", "b\na\n"],
  ["expand", "\tx\n", "        x\n"],
  ["fold -w2", "abcd\n", "ab\ncd\n"],
  ["strings -n3", "abc\u0000def\n", "abc\ndef\n"],
]) {
  test(`compiled default dispatch: ${command}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(agentCommands());
    try {
      const result = await shell.exec(command, { stdin });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
    } finally { await shell.dispose(); }
  });
}

test("compiled default split preserves binary VFS data in a live pipeline", async () => {
  const fs = createMemoryFileSystem();
  const input = Uint8Array.of(0, 255, 128, 65, 10, 0, 66);
  await fs.writeFile("/input", input);
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec("cat /input | split -b3 - /part.");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.deepEqual(await fs.readFile("/part.aa"), input.slice(0, 3));
    assert.deepEqual(await fs.readFile("/part.ab"), input.slice(3, 6));
    assert.deepEqual(await fs.readFile("/part.ac"), input.slice(6));
    assert.deepEqual(await fs.readFile("/input"), input);
    const merged = await shell.exec("cat /part.aa /part.ab /part.ac");
    assert.deepEqual(merged.stdoutBytes, input);
    const pipeline = await shell.exec("seq 1 3 | nl -ba -w1 -s: | rev | unexpand -a | split -l2 - /lines.");
    assert.equal(pipeline.exitCode, 0, pipeline.stderr);
    assert.equal(Buffer.from(await fs.readFile("/lines.aa")).toString(), "1:1\n2:2\n");
    assert.equal(Buffer.from(await fs.readFile("/lines.ab")).toString(), "3:3\n");
  } finally { await shell.dispose(); }
});

test("default output awaits slow sinks and preserves chunk ownership", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { pipeHighWaterMark: 8 } }).use(agentCommands());
  const retained = [];
  let active = 0;
  try {
    const result = await shell.exec("seq 1 40 | rev", { stdout: { async write(chunk) {
      active++;
      assert.equal(active, 1);
      retained.push({ chunk, copy: chunk.slice() });
      await pause();
      assert.deepEqual(chunk, retained.at(-1).copy);
      active--;
    } } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(active, 0);
    assert.ok(retained.length > 1);
    for (const entry of retained) assert.deepEqual(entry.chunk, entry.copy);
    assert.equal(Buffer.concat(retained.map(entry => entry.copy)).toString(), Array.from({ length: 40 }, (_, index) => `${index + 1}`.split("").reverse().join("") + "\n").join(""));
  } finally { await shell.dispose(); }
});

test("default pipeline cancellation retains exact reason and completed bytes", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { pipeHighWaterMark: 1 } }).use(agentCommands());
  const controller = new AbortController();
  const reason = new Error("author cancellation");
  let writes = 0;
  try {
    await assert.rejects(shell.exec("seq 1 100000 | rev", { signal: controller.signal, stdout: { async write() {
      writes++;
      controller.abort(reason);
      await pause();
    } } }), error => error === reason);
    assert.equal(writes, 1);
  } finally { await shell.dispose(); }
});

for (const name of newNames) {
  test(`aggregate collision preflight and shared replacement: ${name}`, async () => {
    const sentinel = { name, execute: () => ({ exitCode: 19 }) };
    const commands = new CommandRegistry([sentinel]);
    const host = { commands, use() { throw new Error("unexpected middleware"); }, registerFileSystem() { throw new Error("unexpected filesystem"); } };
    assert.throws(() => agentCommands().setup(host), /already registered/u);
    assert.deepEqual(commands.list(), [sentinel]);
    await agentCommands({ replace: true }).setup(host);
    assert.equal(commands.list().length, 80);
    assert.notEqual(commands.get(name), sentinel);
  });
}

for (const [options, command, stdin] of [
  [{ streamFormat: { limits: { maxOutputBytes: 1 } } }, "seq 1 2", ""],
  [{ split: { limits: { maxFiles: 1 } } }, "split -b1 - /bounded.", "ab"],
  [{ streamInspection: { limits: { maxInputBytes: 1 } } }, "tac", "ab\n"],
]) {
  test(`independent family limit forwarding: ${Object.keys(options)[0]}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands(options));
    try {
      const result = await shell.exec(command, { stdin });
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /limit/iu);
    } finally { await shell.dispose(); }
  });
}

test("default split follows an existing dangling output symlink", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("abc"));
  await fs.symlink("target", "/out.aa");
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec("split -b2 /input /out.");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await fs.readlink("/out.aa"), "target");
    assert.equal(Buffer.from(await fs.readFile("/target")).toString(), "ab");
    assert.equal(Buffer.from(await fs.readFile("/out.ab")).toString(), "c");
  } finally { await shell.dispose(); }
});
