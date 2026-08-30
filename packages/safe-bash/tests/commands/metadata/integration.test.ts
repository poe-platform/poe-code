import assert from "node:assert/strict";
import test from "node:test";
import {
  Shell, CommandRegistry, agentCommands, createAgentCommands, metadataCommands,
  createMetadataCommands, createMemoryFileSystem, createReadOnlyFileSystem,
  MockS3Client, S3FileSystem, type PluginHost,
} from "../../../src/index.js";
import { runMetadata } from "./helpers.js";

test("metadata root API preflights collisions and excludes optional network/runtime plugins", () => {
  assert.deepEqual(createMetadataCommands().map(command => command.name), ["chmod", "stat", "mktemp"]);
  const names = createAgentCommands().map(command => command.name);
  for (const name of ["chmod", "stat", "mktemp"]) assert.ok(names.includes(name), `${name} must be available in the aggregate`);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.includes("curl"), false);
  assert.equal(names.includes("safejs"), false);
  const commands = new CommandRegistry([{ name: "stat", execute: () => ({ exitCode: 23 }) }]);
  const host: PluginHost = { commands, use() {}, registerFileSystem() {} };
  const initial = commands.list();
  assert.throws(() => metadataCommands().setup(host), /already registered/u);
  assert.deepEqual(commands.list(), initial);
  metadataCommands({ replace: true }).setup(host);
  assert.equal(commands.list().length, 3);
  assert.notEqual(commands.get("stat"), initial[0]);
  assert.throws(() => createMetadataCommands({ umask: 0o1000 }), /umask/u);
  assert.throws(() => createMetadataCommands({ limits: { maxAttempts: 0 } }), /limit/u);
});

test("aggregate shell uses mktemp, chmod, stat, command substitution and a real pipeline", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec("file=$(mktemp); printf payload > \"$file\"; chmod u=rw,go= \"$file\"; env stat -c '%a:%s' \"$file\" | cat");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "600:7\n");
    const entries = await fs.readdir("/tmp");
    assert.equal(entries.length, 1);
    assert.equal(Buffer.from(await fs.readFile(`/tmp/${entries[0]!.name}`)).toString(), "payload");
  } finally { await shell.dispose(); }
});

test("metadata options are forwarded through the aggregate without enabling host state", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs }).use(agentCommands({ metadata: { umask: 0o200 } }));
  try {
    const result = await shell.exec("file=$(mktemp); stat -c '%a' \"$file\"");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "400\n");
  } finally { await shell.dispose(); }
});

test("readonly VFS mutation failures do not prevent metadata reads", async () => {
  const backing = createMemoryFileSystem();
  await backing.mkdir("/work");
  await backing.writeFile("/work/file", Uint8Array.of(7));
  const fs = createReadOnlyFileSystem(backing);
  const result = await runMetadata("stat", ["-c%s", "file"], fs);
  assert.equal(result.stdout, "1\n");
  assert.equal((await runMetadata("stat", ["-c%a", "file"], fs)).stdout, `${((await backing.stat("/work/file")).mode & 0o7777).toString(8)}\n`);
  for (const [name, args] of [["chmod", ["777", "file"]], ["mktemp", ["private.XXXXXX"]]] as const) {
    const mutation = await runMetadata(name, args, fs);
    assert.equal(mutation.exitCode, 1);
    assert.match(mutation.stderr, /EROFS/u);
  }
  assert.deepEqual((await backing.readdir("/work")).map(entry => entry.name), ["file"]);
});

test("actual S3 metadata is readable but private-mode creation is not fabricated", async () => {
  const transport = new MockS3Client({ buckets: ["bucket"] });
  const fs = new S3FileSystem({ bucket: "bucket", transport });
  await fs.mkdir("/work");
  await fs.writeFile("/work/file", Uint8Array.of(1, 2, 3));
  const read = await runMetadata("stat", ["-c%s:%n", "file"], fs);
  assert.equal(read.exitCode, 0, read.stderr);
  assert.equal(read.stdout, "3:file\n");
  const before = transport.requests.length;
  for (const [name, args] of [["chmod", ["777", "file"]], ["mktemp", ["private.XXXXXX"]]] as const) {
    const result = await runMetadata(name, args, fs);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /ENOTSUP/u);
  }
  assert.equal(transport.requests.length, before);
  assert.deepEqual(await fs.readFile("/work/file"), Uint8Array.of(1, 2, 3));
});

test("stat awaits output backpressure and remains cancellable", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/file", Uint8Array.of(1));
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const controller = new AbortController();
  const reason = new Error("cancel blocked stat output");
  const result = runMetadata("stat", ["-c%s", "file"], fs, {}, controller.signal, {}, async () => { entered(); await new Promise(() => {}); });
  const rejected = assert.rejects(result, error => error === reason);
  await started;
  controller.abort(reason);
  await rejected;
});
