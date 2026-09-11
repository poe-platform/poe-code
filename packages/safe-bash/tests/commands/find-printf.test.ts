import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, toByteSource } from "../../src/index.js";
import { findCommands } from "../../src/commands/find.js";
import { compileFindFormat, FindFormatBudget } from "../../src/commands/find-format.js";
import { fixture, run } from "./helpers.js";

test("find printf lists basename and byte size without implicit print", async () => {
  const fs = await fixture({ "photos/image.bin": Uint8Array.of(0, 255, 1) });
  const result = await run("find", ["photos", "-type", "f", "-printf", "%f %s bytes\\n"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "image.bin 3 bytes\n");
});

test("find printf y follows the same physical and logical type selection as type predicates", async () => {
  const fs = await fixture({ target: "x" });
  await fs.symlink("target", "/work/link");
  await fs.symlink("missing", "/work/dangling");
  for (const [option, expected] of [["-P", "l:l:"], ["-L", "f:l:"]]) {
    const result = await run("find", [option!, "link", "dangling", "-printf", "%y:"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});

test("find printf preserves byte-valued format arguments through the real shell", async () => {
  const fs = await fixture();
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec("find . -maxdepth 0 -printf $'\\377%f\\n'");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 46, 10));
  } finally { await shell.dispose(); }
});

test("find printf admits all format bytes before traversing even when actions do not match", async () => {
  const result = await run("find", ["missing", "-false", "-printf", "a".repeat(32768), "-printf", "b".repeat(32769)]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /format byte limit/u);
  assert.doesNotMatch(result.stderr, /ENOENT/u);
});

test("find printf refuses an oversized string before UTF-8 byte-length scanning", async t => {
  const { context } = await run("find", [".", "-maxdepth", "0"]);
  const oversized = "x".repeat(65537);
  const byteLength = Buffer.byteLength;
  const scan = t.mock.method(Buffer, "byteLength", (...args: Parameters<typeof Buffer.byteLength>) => {
    if (args[0] === oversized) throw new Error("unadmitted UTF-8 scan");
    return byteLength(...args);
  });
  try {
    await assert.rejects(compileFindFormat(oversized, new FindFormatBudget(context)), /format byte limit/u);
  } finally { scan.mock.restore(); }
});

test("find printf total output exhaustion is terminal rather than repeated per remaining root", async () => {
  const fs = await fixture({ file: "" });
  const result = await run("find", [...Array<string>(140).fill("file"), "-printf", "x".repeat(65536)], { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdoutBytes.length, 8 * 1024 * 1024);
  assert.equal(result.stderr.split("output limit exceeded").length - 1, 1);
});

for (const reason of [false, { cancelled: "format" }]) test(`find printf yields during a long format and retains ${String(reason)} cancellation`, async () => {
  const fs = await fixture();
  const controller = new AbortController();
  const pending = run("find", [".", "-printf", "a".repeat(65536)], { fs, signal: controller.signal });
  setImmediate(() => controller.abort(reason));
  await assert.rejects(pending, error => error === reason);
});

test("find printf awaits a blocked output sink and makes no later writes after cancellation", async () => {
  const fs = await fixture();
  const controller = new AbortController();
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let writes = 0;
  const command = findCommands(async () => ({ exitCode: 0 }))[0]!;
  const pending = Promise.resolve(command.execute({
    command: "find", args: [".", "-maxdepth", "0", "-printf", "x".repeat(8192)],
    fs, cwd: "/work", env: {}, signal: controller.signal, stdin: toByteSource(""),
    stdout: { async write() { writes++; entered(); await held; } },
    stderr: { async write() { assert.fail("unexpected diagnostic"); } },
  }));
  await started;
  assert.equal(writes, 1);
  const reason = { cancelled: "sink" };
  controller.abort(reason);
  release();
  await assert.rejects(pending, error => error === reason);
  assert.equal(writes, 1);
});

test("find printf yields while scanning a long basename even when dirname output is tiny", async () => {
  const name = "a".repeat(16384);
  const { context } = await run("find", [".", "-maxdepth", "0"]);
  const controller = new AbortController();
  const reason = { cancelled: "path scan" };
  const render = await compileFindFormat("%h", new FindFormatBudget({ ...context, signal: controller.signal }));
  const stat = await context.fs.stat("/work");
  const pending = render({ display: name, root: name, relative: "", depth: 0, stat });
  setImmediate(() => controller.abort(reason));
  await assert.rejects(pending, error => error === reason);
});

test("find printf retains ordinary control escapes and rejects unknown escapes explicitly", async () => {
  const good = await run("find", [".", "-maxdepth", "0", "-printf", "\\a\\b\\f\\n\\r\\t\\v\\\\"]);
  assert.equal(good.exitCode, 0, good.stderr);
  assert.deepEqual(good.stdoutBytes, Buffer.from([7, 8, 12, 10, 13, 9, 11, 92]));
  const bad = await run("find", ["missing", "-printf", "\\q"]);
  assert.equal(bad.exitCode, 2);
  assert.match(bad.stderr, /unsupported printf format escape/u);
});

test("find printf retains each starting argument for root and relative path directives", async () => {
  const fs = await fixture({ "a/one": "x", "b/two": "xx" });
  const result = await run("find", ["a/", "b", "-printf", "%H|%P|%p|%d\\n"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "a/||a/|0\na/|one|a/one|1\nb||b|0\nb|two|b/two|1\n");
});

test("find printf dirname handles filesystem root, relative names and trailing slashes", async () => {
  const fs = await fixture({ "a/file": "x" });
  const result = await run("find", ["/", "/work", "a/", "a/file", ".", "-maxdepth", "0", "-printf", "[%h][%f]\\n"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "[][/]\n[][work]\n[.][a]\n[a][file]\n[.][.]\n");
});

test("find printf operand is not interpreted as a global depth option", async () => {
  const result = await run("find", [".", "-maxdepth", "0", "-printf", "-depth"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "-depth");
});

test("find printf emits octal bytes and stops only the current format at backslash c", async () => {
  const fs = await fixture({ a: "x", b: "x" });
  const result = await run("find", ["a", "b", "-printf", "%f%%\\000\\101\\cignored", "-printf", "!"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, Buffer.from([97, 37, 0, 65, 33, 98, 37, 0, 65, 33]));
});

test("find printf respects boolean expressions and empty formats", async () => {
  const fs = await fixture({ a: "x", b: "x" });
  const result = await run("find", ["a", "b", "-name", "a", "-printf", "", "-o", "-printf", "%f"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "b");
});

for (const format of ["%", "%Y", "%999999999999f", "%q"]) test(`find printf refuses unsupported format ${format} before filesystem traversal`, async () => {
  const result = await run("find", ["missing", "-printf", format]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /format/u);
  assert.doesNotMatch(result.stderr, /ENOENT/u);
});
