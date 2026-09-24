import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Shell, cloudflareWorkerLimits } from "../../src/shell/index.js";
import { archiveCommands, type ArchiveCommandsOptions } from "../../src/commands/archive/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import type { FileSystem } from "../../src/contracts/index.js";

async function streamingArchive(t: TestContext, size: number, actualSize = size, backingSize = 64 * 1024) {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input.zip", new Uint8Array());
  const observed = { opened: 0, bytes: 0, closed: 0 };
  const fs: FileSystem = new Proxy(memory, { get(target, key) {
    if (key === "stat" || key === "lstat") return async (...args: Parameters<FileSystem["stat"]>) => {
      const stat = await target[key](...args);
      return args[0] === "/input.zip" ? { ...stat, size } : stat;
    };
    if (key === "readStream") return async function* () {
      observed.opened++;
      // A remote provider can reuse a small slab without holding the entire file.
      const slab = new Uint8Array(backingSize).subarray(0, 64 * 1024);
      try {
        if (!actualSize) yield slab.subarray(0, 0);
        for (let offset = 0; offset < actualSize; offset += slab.length) {
          const chunk = slab.subarray(0, Math.min(slab.length, actualSize - offset));
          observed.bytes += chunk.length;
          yield chunk;
        }
      } finally { observed.closed++; }
    };
    if (key === "readFile") return () => assert.fail("archive must use the supplied stream");
    const member = Reflect.get(target, key);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const shell = new Shell({ fs, limits: cloudflareWorkerLimits });
  t.after(() => shell.dispose());
  return { fs, shell, observed };
}

for (const plugin of [archiveCommands, agentCommands]) {
  for (const mode of ["-t", "-l", "-p"]) {
    test(`Worker ${plugin.name} unzip ${mode} rejects oversized metadata before reading`, async t => {
      const { shell, observed } = await streamingArchive(t, 40 * 1024 * 1024);
      shell.use(plugin());
      const result = await shell.exec(`unzip ${mode} /input.zip`);
      assert.equal(result.exitCode, 2, result.stderr);
      assert.deepEqual(observed, { opened: 0, bytes: 0, closed: 0 });
      assert.match(result.stderr, /archive byte limit exceeded/);
    });
  }
}

test("Worker unzip bounds a stream that grows beyond its admitted metadata and closes it", async t => {
  const { shell, observed } = await streamingArchive(t, 1024, 40 * 1024 * 1024);
  shell.use(archiveCommands());
  const result = await shell.exec("unzip -t /input.zip");
  assert.equal(result.exitCode, 2, result.stderr);
  assert.match(result.stderr, /archive byte limit exceeded/);
  assert.ok(observed.bytes <= 4 * 1024 * 1024 + 64 * 1024, String(observed.bytes));
  assert.equal(observed.closed, 1);
});

test("explicit archive ceilings reject metadata outside the Worker profile too", async t => {
  const { fs, observed } = await streamingArchive(t, 1024);
  const shell = new Shell({ fs }).use(archiveCommands({ limits: { maxArchiveBytes: 512 } }));
  t.after(() => shell.dispose());
  const result = await shell.exec("unzip -t /input.zip");
  assert.equal(result.exitCode, 2);
  assert.equal(observed.opened, 0);
  assert.match(result.stderr, /archive byte limit exceeded/);
});

test("Worker limits cannot be raised by archive registration options", async t => {
  const { shell, observed } = await streamingArchive(t, 5 * 1024 * 1024);
  const options: ArchiveCommandsOptions = { limits: { maxArchiveBytes: 64 * 1024 * 1024 } };
  shell.use(archiveCommands(options));
  assert.equal((await shell.exec("unzip -t /input.zip")).exitCode, 2);
  assert.equal(observed.opened, 0);
});

test("Worker unzip accounts for a small view retaining a large provider slab", async t => {
  const { shell, observed } = await streamingArchive(t, 22, 22, 9 * 1024 * 1024);
  shell.use(archiveCommands());
  const result = await shell.exec("unzip -t /input.zip");
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /memory budget/);
  assert.equal(observed.closed, 1);
});

test("Worker unzip admits backing storage even for an empty producer chunk", async t => {
  const { shell, observed } = await streamingArchive(t, 0, 0, 9 * 1024 * 1024);
  shell.use(archiveCommands());
  const result = await shell.exec("unzip -t /input.zip");
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /memory budget/);
  assert.equal(observed.closed, 1);
});

test("Worker admits an exact-limit input without weakening the stream ceiling", async t => {
  const { shell, observed } = await streamingArchive(t, 4 * 1024 * 1024);
  shell.use(archiveCommands());
  const result = await shell.exec("unzip -t /input.zip");
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /missing end record/);
  assert.equal(observed.bytes, 4 * 1024 * 1024);
});

test("concurrent Worker invocations independently stop oversized growing streams", async t => {
  const fixtures = await Promise.all(Array.from({ length: 4 }, () => streamingArchive(t, 1024, 8 * 1024 * 1024)));
  const results = await Promise.all(fixtures.map(({ shell }) => shell.use(archiveCommands()).exec("unzip -t /input.zip")));
  for (const [index, result] of results.entries()) {
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /archive byte limit exceeded/);
    assert.ok(fixtures[index]!.observed.bytes <= 4 * 1024 * 1024 + 64 * 1024);
    assert.equal(fixtures[index]!.observed.closed, 1);
  }
});

test("nested shell and literal invocations inherit Worker archive admission", async t => {
  const { shell, observed } = await streamingArchive(t, 5 * 1024 * 1024);
  shell.use(archiveCommands()).use({ name: "delegate", setup(host) {
    host.commands.register({ name: "delegate", execute(context) {
      return context.invoke!("unzip", ["-t", "/input.zip"]);
    } });
  } });
  for (const source of ["bash -c 'unzip -t /input.zip'", "eval 'unzip -t /input.zip'", "delegate"]) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /archive byte limit exceeded/);
  }
  assert.equal(observed.opened, 0);
});

test("execution family overrides merge with Worker ceilings and remain local", async t => {
  const { shell, observed } = await streamingArchive(t, 1024);
  shell.use(archiveCommands());
  const capped = await shell.exec("unzip -t /input.zip", { limits: { commandLimits: { archive: { maxArchiveBytes: 512 } } } });
  assert.match(capped.stderr, /archive byte limit exceeded/);
  assert.equal(observed.opened, 0);
  const original = await shell.exec("unzip -t /input.zip");
  assert.match(original.stderr, /missing end record/);
  assert.equal(observed.bytes, 1024);
  const large = await streamingArchive(t, 5 * 1024 * 1024);
  large.shell.use(archiveCommands());
  const merged = await large.shell.exec("unzip -t /input.zip", { limits: { commandLimits: { archive: { maxMembers: 2 } } } });
  assert.match(merged.stderr, /archive byte limit exceeded/);
  assert.equal(large.observed.opened, 0);
});

test("non-Worker hosts retain configurable archive limits and per-exec Worker selection", async t => {
  const { fs, observed } = await streamingArchive(t, 5 * 1024 * 1024);
  for (const limits of [undefined, { maxArchiveBytes: 6 * 1024 * 1024 }]) {
    const shell = new Shell({ fs }).use(archiveCommands(limits ? { limits } : {}));
    t.after(() => shell.dispose());
    const before = observed.bytes;
    const capped = await shell.exec("unzip -t /input.zip", { limits: cloudflareWorkerLimits });
    assert.match(capped.stderr, /archive byte limit exceeded/);
    assert.equal(observed.bytes, before);
    const uncapped = await shell.exec("unzip -t /input.zip");
    assert.match(uncapped.stderr, /missing end record/);
    assert.equal(observed.bytes - before, 5 * 1024 * 1024);
  }
});

test("family limits are snapshotted and validated before invocation", async t => {
  const { fs, observed } = await streamingArchive(t, 1024);
  const archive = { maxArchiveBytes: 512 };
  const shell = new Shell({ fs, limits: { commandLimits: { archive } } }).use(archiveCommands());
  t.after(() => shell.dispose());
  archive.maxArchiveBytes = 2048;
  assert.match((await shell.exec("unzip -t /input.zip")).stderr, /archive byte limit exceeded/);
  assert.equal(observed.opened, 0);
  for (const invalid of [0, -1, NaN, Infinity, 1.5]) {
    const limits = { commandLimits: { archive: { maxArchiveBytes: invalid } } };
    assert.throws(() => new Shell({ fs, limits }), RangeError);
    await assert.rejects(shell.exec(":", { limits }), RangeError);
  }
});

test("an independent archive ceiling preserves the registered stream chunk size", async t => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.zip", new Uint8Array(22));
  const requested: (number | undefined)[] = [];
  const read = fs.readStream!.bind(fs);
  fs.readStream = (path, options) => { requested.push(options?.chunkSize); return read(path, options); };
  const shell = new Shell({ fs, limits: { commandLimits: { archive: { maxArchiveBytes: 1024 } } } })
    .use(archiveCommands({ limits: { chunkSize: 256 * 1024 } }));
  t.after(() => shell.dispose());
  assert.match((await shell.exec("unzip -t /input.zip")).stderr, /missing end record/);
  assert.deepEqual(requested, [256 * 1024]);
});

test("Worker archive profile preserves valid zip, unzip and tar workflows", async t => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/source", Buffer.from("archive payload\n"));
  const shell = new Shell({ fs, limits: cloudflareWorkerLimits }).use(archiveCommands());
  t.after(() => shell.dispose());
  for (const source of ["zip -q -0 /input.zip /source", "unzip -t /input.zip", "tar -cf /input.tar /source", "tar -tf /input.tar"]) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
  }
  assert.equal((await shell.exec("unzip -p /input.zip")).stdout, "archive payload\n");
  for (const source of ["zip -q -0 /other.zip /source", "tar -cf /other.tar /source"]) {
    const result = await shell.exec(source, { limits: { commandLimits: { archive: { maxEntryBytes: 1 } } } });
    assert.notEqual(result.exitCode, 0, source);
    await assert.rejects(fs.stat(source.includes("other.zip") ? "/other.zip" : "/other.tar"), { code: "ENOENT" });
  }
});
