import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  CommandRegistry,
  type ByteSource,
  type CommandDefinition,
  type PluginHost,
  type RegisterCommandOptions,
} from "../../../src/contracts/index.js";
import { byteCommands, createByteCommands } from "../../../src/commands/bytes/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../../src/shell/index.js";

const names = ["base64", "base32", "xxd", "od", "sha256sum", "sha1sum", "md5sum", "cksum", "gzip", "gunzip", "zcat"];
const binary = Uint8Array.from({ length: 1025 }, (_, index) => index % 256);

class RecordingRegistry extends CommandRegistry {
  readonly registrations: { name: string; options: RegisterCommandOptions | undefined }[] = [];

  override register(command: CommandDefinition, options?: RegisterCommandOptions): this {
    this.registrations.push({ name: command.name, options });
    return super.register(command, options);
  }
}

function host(commands: CommandRegistry): PluginHost {
  return {
    commands,
    use() { assert.fail("byte commands must not install middleware"); },
    registerFileSystem() { assert.fail("byte commands must not install filesystems"); },
  };
}

function setup(): { fs: ReturnType<typeof createMemoryFileSystem>; shell: Shell } {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, limits: { pipeHighWaterMark: 7 } }).use(byteCommands());
  return { fs, shell };
}

async function* chunks(bytes: Uint8Array): ByteSource {
  for (let offset = 0; offset < bytes.length; offset += 17) yield bytes.subarray(offset, offset + 17);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("byte factory returns all eleven unique commands in family order", () => {
  const definitions = createByteCommands();
  assert.deepEqual(definitions.map((definition) => definition.name), names);
  assert.equal(new Set(definitions.map((definition) => definition.name)).size, 11);
  for (const definition of definitions) assert.equal(typeof definition.execute, "function");
});

test("byte factories return fresh arrays and command definitions", () => {
  const first = createByteCommands();
  const second = createByteCommands();
  assert.notEqual(first, second);
  for (const [index, definition] of first.entries()) assert.notEqual(definition, second[index]);
});

test("byte plugin registers explicitly without replacement or extra host capabilities", async () => {
  const commands = new RecordingRegistry();
  const plugin = byteCommands();
  assert.equal(plugin.name, "byte-commands");
  assert.equal(commands.list().length, 0);
  await plugin.setup(host(commands));
  assert.deepEqual(commands.list().map((definition) => definition.name), names);
  assert.deepEqual(commands.registrations, names.map((name) => ({ name, options: { replace: false } })));
});

test("one byte plugin can install into independent hosts", async () => {
  const plugin = byteCommands();
  const first = new CommandRegistry();
  const second = new CommandRegistry();
  await plugin.setup(host(first));
  await plugin.setup(host(second));
  for (const name of names) {
    assert.ok(first.has(name));
    assert.ok(second.has(name));
  }
  first.unregister("gzip");
  assert.ok(second.has("gzip"));
});

for (const name of names) {
  test(`byte plugin preflights ${name} collisions before any registration`, async () => {
    const commands = new RecordingRegistry();
    commands.register({ name: "unrelated", execute: () => ({ exitCode: 19 }) });
    commands.register({ name, execute: () => ({ exitCode: 23 }) });
    const before = commands.list();
    commands.registrations.length = 0;
    await assert.rejects(async () => byteCommands().setup(host(commands)), {
      message: `Command already registered: ${name}`,
    });
    assert.deepEqual(commands.list(), before);
    assert.equal(commands.registrations.length, 0);
    for (const previous of before) assert.equal(commands.get(previous.name), previous);
  });
}

test("explicit replace false and repeated installation preserve existing commands", async () => {
  const commands = new RecordingRegistry();
  const plugin = byteCommands({ replace: false });
  await plugin.setup(host(commands));
  const before = commands.list();
  commands.registrations.length = 0;
  await assert.rejects(async () => plugin.setup(host(commands)), /Command already registered: base64/u);
  assert.deepEqual(commands.list(), before);
  assert.equal(commands.registrations.length, 0);
});

test("replacement is explicit for every command and preserves unrelated registrations", async () => {
  const commands = new RecordingRegistry();
  for (const name of [...names, "unrelated"]) commands.register({ name, execute: () => ({ exitCode: 23 }) });
  const before = commands.list();
  commands.registrations.length = 0;
  await byteCommands({ replace: true }).setup(host(commands));
  assert.deepEqual(commands.registrations, names.map((name) => ({ name, options: { replace: true } })));
  assert.equal(commands.list().length, 12);
  for (const previous of before) {
    if (previous.name === "unrelated") assert.equal(commands.get(previous.name), previous);
    else assert.notEqual(commands.get(previous.name)?.execute, previous.execute);
  }
});

test("replacement plugin also installs into an empty registry", async () => {
  const commands = new RecordingRegistry();
  await byteCommands({ replace: true }).setup(host(commands));
  assert.deepEqual(commands.registrations, names.map((name) => ({ name, options: { replace: true } })));
});

test("Shell registration remains opt-in and waits for plugin setup", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  assert.equal(shell.commands.has("base64"), false);
  assert.equal((await shell.exec("base64")).exitCode, 127);
  const result = await shell.use(byteCommands()).exec("base64", { stdin: "abc" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "YWJj\n");
  assert.deepEqual(shell.commands.list().map((definition) => definition.name), names);
});

for (const [label, input] of [["empty", new Uint8Array()], ["binary", binary]] as const) {
  test(`gzip/base64/decode/zcat pipeline preserves ${label} stdin bytes`, async () => {
    const { shell } = setup();
    const result = await shell.exec("set -o pipefail; gzip -c | base64 | base64 -d | zcat", {
      stdin: chunks(input), signal: AbortSignal.timeout(5000),
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, input);
  });
}

test("filesystem compression/base32/decode/gunzip pipeline feeds a checksum", async () => {
  const { fs, shell } = setup();
  await fs.mkdir("/work");
  await fs.writeFile("/work/payload", binary);
  const result = await shell.exec("set -o pipefail; gzip -c payload | base32 | base32 -d | gunzip -c | sha256sum", {
    cwd: "/work", signal: AbortSignal.timeout(5000),
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `${createHash("sha256").update(binary).digest("hex")}  -\n`);
  assert.deepEqual(await fs.readFile("/work/payload"), binary);
  assert.deepEqual((await fs.readdir("/work")).map((entry) => entry.name), ["payload"]);
});

test("xxd reverse output remains binary through compression, redirection, and od", async () => {
  const { fs, shell } = setup();
  const bytes = Uint8Array.of(0, 255, 10, 128, 65);
  await fs.writeFile("/input", bytes);
  const result = await shell.exec("set -o pipefail; xxd -p input | xxd -r -p | gzip -c | zcat > restored; od -An -tx1 -v restored", {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(await fs.readFile("/restored"), bytes);
  assert.equal(result.stdout.trim().replace(/\s+/gu, " "), "00 ff 0a 80 41");
});

for (const [command, algorithm] of [["sha1sum", "sha1"], ["md5sum", "md5"]] as const) {
  test(`decoded binary pipeline feeds ${command}`, async () => {
    const { shell } = setup();
    const result = await shell.exec(`set -o pipefail; base64 | base64 -d | ${command}`, { stdin: chunks(binary) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${createHash(algorithm).update(binary).digest("hex")}  -\n`);
  });
}

test("base32 round-trip feeds the POSIX cksum known vector", async () => {
  const { shell } = setup();
  const result = await shell.exec("set -o pipefail; base32 | base32 -d | cksum", { stdin: "123456789" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "930766865 9\n");
});

test("checksum manifests survive encoding and compression before verification", async () => {
  const { fs, shell } = setup();
  await fs.writeFile("/payload", binary);
  const result = await shell.exec("set -o pipefail; sha256sum payload | gzip -c | base64 | base64 -d | zcat | sha256sum -c", {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "payload: OK\n");
});

for (const command of ["base64", "sha256sum", "gzip"]) {
  test(`${command} missing operands report stderr and nonzero status through Shell`, async () => {
    const { shell } = setup();
    const result = await shell.exec(`${command} /missing`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdoutBytes.length, 0);
    assert.match(result.stderr, new RegExp(`^${command}:`, "u"));
    assert.match(result.stderr, /missing/u);
  });
}

for (const [command, input] of [["base64 -d", "!"], ["zcat", "not gzip"]] as const) {
  test(`${command} malformed input propagates pipefail without contaminating stdout`, async () => {
    const { shell } = setup();
    const result = await shell.exec(`set -o pipefail; ${command} | sha256sum`, { stdin: input });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /^(base64|zcat):/u);
    assert.equal(result.stdout, `${createHash("sha256").digest("hex")}  -\n`);
  });
}

test("invalid compression options do not publish or remove files", async () => {
  const { fs, shell } = setup();
  await fs.writeFile("/payload", binary);
  const result = await shell.exec("gzip --not-supported payload");
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdoutBytes.length, 0);
  assert.match(result.stderr, /^gzip:/u);
  assert.deepEqual(await fs.readFile("/payload"), binary);
  assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name), ["payload"]);
});

test("cross-family pipeline awaits external stdout backpressure", { timeout: 5000 }, async () => {
  const { shell } = setup();
  const entered = deferred();
  const release = deferred();
  const received: Uint8Array[] = [];
  let settled = false;
  const task = shell.exec("set -o pipefail; gzip -c | base64 | base64 -d | zcat", {
    stdin: binary,
    stdout: { async write(chunk) { received.push(chunk.slice()); entered.resolve(); await release.promise; } },
  });
  void task.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise;
    assert.equal(settled, false);
  } finally { release.resolve(); }
  const result = await task;
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(new Uint8Array(Buffer.concat(received)), binary);
  assert.deepEqual(result.stdoutBytes, binary);
});

test("cancellation rejects a byte pipeline blocked in external stdout", { timeout: 5000 }, async () => {
  const { shell } = setup();
  const entered = deferred();
  const release = deferred();
  const controller = new AbortController();
  const reason = new Error("byte pipeline cancelled");
  const task = shell.exec("gzip -c | base64 | base64 -d | zcat", {
    stdin: binary, signal: controller.signal,
    stdout: { async write() { entered.resolve(); await release.promise; } },
  });
  try {
    await entered.promise;
    controller.abort(reason);
    await assert.rejects(task, (error) => error === reason);
  } finally { release.resolve(); }
});

test("byte pipelines retain Shell output budgets", async () => {
  const { shell } = setup();
  await assert.rejects(shell.exec("base64 | base64 -d", {
    stdin: binary, limits: { maxOutputBytes: 8 },
  }), (error) => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
});
