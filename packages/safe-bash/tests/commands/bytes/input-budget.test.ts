import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  agentCommands, byteCommands, CommandRegistry, createAgentCommands, createByteCommands,
  createMemoryFileSystem, Shell, toByteSource,
  type ByteSource, type CommandDefinition, type FileSystem,
} from "../../../src/index.js";
import { createEncodingCommands } from "../../../src/commands/bytes/encoding/index.js";
import { createChecksumCommands } from "../../../src/commands/bytes/checksums/index.js";

const encoder = new TextEncoder();

async function run(
  definitions: readonly CommandDefinition[], name: string, args: readonly string[] = [],
  stdin: ByteSource = toByteSource(""), fs: FileSystem = createMemoryFileSystem(),
  signal = new AbortController().signal,
) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await definitions.find(command => command.name === name)!.execute({
    command: name, args, stdin, fs, cwd: "/", env: {}, signal,
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
  });
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

function definitions(maxInputBytes: number) {
  return createByteCommands({ encoding: { limits: { maxInputBytes } }, checksums: { limits: { maxInputBytes } } });
}

for (const name of ["base64", "base32", "xxd", "od", "sha256sum", "sha1sum", "md5sum", "cksum"]) {
  test(`${name} accepts the exact input cap and rejects the next byte before processing`, async () => {
    const args = name === "base64" || name === "base32" ? ["-di"] : name === "xxd" ? ["-p"] : name === "od" ? ["-An", "-tx1"] : [];
    const commands = definitions(8);
    const exact = await run(commands, name, args, toByteSource(new Uint8Array(8).fill(33)));
    assert.equal(exact.exitCode, 0, exact.stderr);
    let closed = false;
    const source = (async function* () {
      try { yield new Uint8Array(9).fill(33); assert.fail("read after overflowing chunk"); }
      finally { closed = true; }
    })();
    const overflow = await run(commands, name, args, source);
    assert.equal(overflow.exitCode, 1);
    assert.match(overflow.stderr, /EFBIG/);
    assert.equal(overflow.stdout.length, 0);
    assert.equal(closed, true);
  });
}

for (const [name, args] of [["xxd", ["-s9", "-l0"]], ["od", ["-j9", "-N0", "-An"]]] as const) {
  test(`${name} counts discarded prefix bytes`, async () => {
    const result = await run(definitions(8), name, args, toByteSource(new Uint8Array(9)));
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /EFBIG/);
    assert.equal(result.stdout.length, 0);
  });
}

test("zero-byte limits accept EOF and zero-count commands do not acquire input", async () => {
  const commands = definitions(0);
  for (const name of ["base64", "base32", "xxd", "od", "sha256sum", "sha1sum", "md5sum", "cksum"]) {
    const empty = (async function* () { yield new Uint8Array(); yield new Uint8Array(); })();
    const result = await run(commands, name, [], empty);
    assert.equal(result.exitCode, 0, result.stderr);
  }
  const fs = createMemoryFileSystem();
  fs.readStream = () => { assert.fail("zero-count command acquired file input"); };
  for (const [name, args] of [["xxd", ["-l0", "/unread"]], ["od", ["-N0", "/unread"]]] as const) {
    assert.equal((await run(commands, name, args, toByteSource(""), fs)).exitCode, 0);
  }
  const overflow = await run(commands, "sha256sum", [], toByteSource("a"));
  assert.equal(overflow.exitCode, 1);
  assert.match(overflow.stderr, /EFBIG/);
});

test("od shares input admission across file operands", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/first", new Uint8Array(4));
  await fs.writeFile("/second", new Uint8Array(5));
  await fs.writeFile("/never", new Uint8Array(1));
  const opened: string[] = [];
  const read = fs.readStream.bind(fs);
  fs.readStream = (path, options) => { opened.push(path); return read(path, options); };
  const result = await run(definitions(8), "od", ["-An", "-tx1", "/first", "/second", "/never"], toByteSource(""), fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EFBIG/);
  assert.deepEqual(opened, ["/first", "/second"]);
});

test("checksum generation stops acquiring operands after cumulative overflow", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/first", new Uint8Array(4));
  await fs.writeFile("/second", new Uint8Array(5));
  await fs.writeFile("/never", new Uint8Array(1));
  const opened: string[] = [];
  const read = fs.readStream.bind(fs);
  fs.readStream = (path, options) => { opened.push(path); return read(path, options); };
  const result = await run(definitions(8), "sha256sum", ["/first", "/second", "/never"], toByteSource(""), fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EFBIG/);
  assert.deepEqual(opened, ["/first", "/second"]);
  assert.equal(result.stdout.toString().split("\n").filter(Boolean).length, 1);
});

test("checksum manifests and referenced bytes count once toward one exact invocation cap", async () => {
  const fs = createMemoryFileSystem();
  const payload = encoder.encode("data");
  const manifest = encoder.encode(`${createHash("sha256").update(payload).digest("hex")}  /data\n`);
  await fs.writeFile("/data", payload);
  await fs.writeFile("/manifest", manifest);
  const total = manifest.length + payload.length;
  const exact = await run(definitions(total), "sha256sum", ["-c", "/manifest"], toByteSource(""), fs);
  assert.equal(exact.exitCode, 0, exact.stderr);
  assert.equal(exact.stdout.toString(), "/data: OK\n");
  const overflow = await run(definitions(total - 1), "sha256sum", ["-c", "/manifest"], toByteSource(""), fs);
  assert.equal(overflow.exitCode, 1);
  assert.match(overflow.stderr, /EFBIG/);
});

test("checksum budget failure closes paused manifests without pulling or opening later inputs", async () => {
  const fs = createMemoryFileSystem();
  const payload = encoder.encode("data");
  const entry = encoder.encode(`${createHash("sha256").update(payload).digest("hex")}  /data\n`);
  let closed = false;
  let resumed = false;
  const opened: string[] = [];
  fs.readStream = path => {
    opened.push(path);
    if (path === "/data") return toByteSource(payload);
    if (path !== "/manifest") assert.fail(`unexpected acquisition ${path}`);
    return (async function* () {
      try { yield entry; resumed = true; yield entry; }
      finally { closed = true; }
    })();
  };
  const result = await run(definitions(entry.length + payload.length - 1), "sha256sum", ["-c", "/manifest", "/never"], toByteSource(""), fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EFBIG/);
  assert.deepEqual(opened, ["/manifest", "/data"]);
  assert.equal(resumed, false);
  assert.equal(closed, true);
});

test("input limits are validated eagerly through direct, family, and aggregate factories", () => {
  for (const maxInputBytes of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createEncodingCommands({ limits: { maxInputBytes } }), RangeError);
    assert.throws(() => createChecksumCommands({ limits: { maxInputBytes } }), RangeError);
    assert.throws(() => createByteCommands({ encoding: { limits: { maxInputBytes } } }), RangeError);
    assert.throws(() => createAgentCommands({ bytes: { checksums: { limits: { maxInputBytes } } } }), RangeError);
  }
});

test("family and aggregate options route independently without limiting compression or later invocations", async () => {
  const options = { encoding: { limits: { maxInputBytes: 2 } }, checksums: { limits: { maxInputBytes: 4 } } };
  for (const route of ["factory", "plugin", "aggregate factory", "aggregate plugin"]) {
    const fs = createMemoryFileSystem();
    const commands = route === "factory" ? createByteCommands(options) : route === "aggregate factory" ? createAgentCommands({ bytes: options }) : [];
    const shell = new Shell({ fs, commands: new CommandRegistry(commands), limits: { maxInputBytes: 1 } });
    if (route === "plugin") shell.use(byteCommands(options));
    if (route === "aggregate plugin") shell.use(agentCommands({ bytes: options }));
    try {
      assert.equal((await shell.exec("base64", { stdin: "abc" })).exitCode, 1, route);
      for (let index = 0; index < 2; index++) assert.equal((await shell.exec("sha256sum", { stdin: "abcd" })).exitCode, 0, route);
      assert.equal((await shell.exec("gzip -c", { stdin: "abc" })).exitCode, 0, route);
      await fs.writeFile("/data", encoder.encode("abcd"));
      const redirected = await shell.exec("sha256sum < /data");
      assert.equal(redirected.exitCode, 1, route);
      assert.match(redirected.stderr, /EFBIG/);
    } finally { await shell.dispose(); }
  }
});

test("caller cancellation outranks input-budget failure during source finalization", async () => {
  const controller = new AbortController();
  let closed = false;
  const source = (async function* () {
    try { yield new Uint8Array(2); }
    finally { closed = true; controller.abort(0); }
  })();
  await assert.rejects(run(definitions(1), "sha256sum", [], source, createMemoryFileSystem(), controller.signal), error => Object.is(error, 0));
  assert.equal(closed, true);
});
