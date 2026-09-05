import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, FsError, toByteSource, type ByteSink, type CommandContext, type FileStat, type FileSystem } from "../../src/contracts/index.js";
import { filesystemCommands } from "../../src/commands/filesystem.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { registerYieldCheckpoint } from "../../src/contracts/yield.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const originalIterator = Set.prototype[Symbol.iterator];

async function execute(
  fs: FileSystem, command: "cp" | "ls", args: readonly string[],
  signal = new AbortController().signal, stdout?: ByteSink,
) {
  let text = "", diagnostic = "";
  const context: CommandContext = {
    command, args, fs, cwd: "/", env: {}, signal, stdin: toByteSource(new Uint8Array()),
    stdout: stdout ?? { async write(chunk) { text += decoder.decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += decoder.decode(chunk); } },
  };
  const result = await filesystemCommands(8).find(definition => definition.name === command)!.execute(context);
  return { ...result, stdout: text, stderr: diagnostic };
}

// The synthetic host has one generated child per directory, no materialized tree,
// and existing target parents. It isolates traversal from canonicalMissing work.
function chainHost(lastDirectory: number) {
  const fs = createMemoryFileSystem();
  const counts = { reads: 0, deepestRead: -1, copies: 0, mkdirs: 0, deepestHeader: -1, outputBytes: 0 };
  const stat: FileStat = { type: "directory", size: 0, mode: 0o755, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 };
  const depth = (path: string) => (path.length - "/source".length) / 2;
  fs.stat = fs.lstat = async path => {
    if (path.startsWith("/target/source") && !path.endsWith("/file")
      && (path.length - "/target/source".length) / 2 === 1025) throw new FsError("ENOENT", { path });
    return path.endsWith("/file") ? { ...stat, type: "file", size: 1 } : stat;
  };
  fs.realpath = async path => {
    await fs.stat(path);
    return path;
  };
  fs.compareEntry = async (path, _peer, other) => path === other ? "same" : "distinct";
  fs.readdir = async (path, options) => {
    options?.signal?.throwIfAborted();
    assert.equal(options?.maxEntries, 8);
    const current = depth(path);
    assert.ok(Number.isInteger(current) && current >= 0 && current <= lastDirectory);
    counts.reads++;
    counts.deepestRead = Math.max(counts.deepestRead, current);
    return current < lastDirectory ? [{ name: "n", type: "directory" }] : [{ name: "file", type: "file" }];
  };
  fs.mkdir = async () => { counts.mkdirs++; };
  fs.copyFile = async () => { counts.copies++; };
  const stdout: ByteSink = {
    async write(chunk) {
      counts.outputBytes += chunk.byteLength;
      const text = decoder.decode(chunk).trim();
      if (text.endsWith(":")) counts.deepestHeader = Math.max(counts.deepestHeader, depth(text.slice(0, -1)));
    },
  };
  return { fs, counts, stdout };
}

for (const command of ["ls", "cp"] as const) {
  for (const directories of [4, 8, 16]) {
    test(`${command} keeps active ancestors without copying a ${directories}-directory chain`, async () => {
      const fs = createMemoryFileSystem();
      const leaf = "/source" + "/n".repeat(directories - 1);
      await fs.mkdir(leaf, { recursive: true });
      await fs.writeFile(leaf + "/file", encoder.encode("x"));
      let copiedMembers = 0;
      Set.prototype[Symbol.iterator] = function (this: Set<unknown>) {
        if (this.values().next().value === "/source") copiedMembers += this.size;
        return originalIterator.call(this);
      };
      try {
        const result = await execute(fs, command, command === "ls" ? ["-R", "/source"] : ["-r", "/source", "/target"]);
        assert.equal(result.exitCode, 0, result.stderr);
        const observed = copiedMembers;
        new Set(new Set(["/source", "/source/n"]));
        assert.equal(copiedMembers, observed + 2, "the observer must detect an actual ancestor copy");
        assert.equal(observed, 0, "ancestor membership must not be copied on descent");
      } finally { Set.prototype[Symbol.iterator] = originalIterator; }
    });
  }

  for (const lastDirectory of [1023, 1024, 1025]) {
    test(`${command} admits directory depth ${lastDirectory} against the fixed 1024 bound`, async () => {
      const { fs, counts, stdout } = chainHost(lastDirectory);
      const result = await execute(fs, command, command === "ls" ? ["-R", "/source"] : ["-r", "/source", "/target"], undefined, stdout);
      const accepted = lastDirectory <= 1024;
      assert.equal(result.exitCode, accepted ? 0 : 1, result.stderr);
      if (!accepted) assert.match(result.stderr, new RegExp(`${command}.*depth limit.*1024`, "u"));
      else assert.equal(result.stderr, "");
      assert.equal(counts.deepestRead, Math.min(lastDirectory, 1024));
      assert.equal(counts.reads, (Math.min(lastDirectory, 1024) + 1) * (command === "cp" ? 2 : 1));
      assert.equal(counts.copies, command === "cp" && accepted ? 1 : 0, "files directly inside the deepest admitted directory remain allowed");
      assert.equal(counts.mkdirs, 0, "the over-depth target must not be created");
      if (command === "ls") assert.equal(counts.deepestHeader, Math.min(lastDirectory, 1024));
    });
  }
}

test("recursive ancestor instrumentation restores the original Set iterator", () => {
  assert.equal(Set.prototype[Symbol.iterator], originalIterator);
});

test("cp depth refusal retains an earlier copied file and verbose output after preflight retry", async () => {
  const { fs, counts } = chainHost(1025);
  const read = fs.readdir.bind(fs);
  fs.readdir = async (path, options) => {
    const entries = await read(path, options);
    return path === "/source" ? [{ name: "file", type: "file" }, ...entries] : entries;
  };
  const result = await execute(fs, "cp", ["-rv", "/source", "/target"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /cp.*depth limit.*1024/u);
  assert.equal(result.stdout, "'/source/file' -> '/target/source/file'\n");
  assert.equal(counts.copies, 1);
  assert.equal(counts.reads, 2050);
  assert.equal(counts.mkdirs, 0);
});

for (const command of ["ls", "cp"] as const) {
  test(`${command} public Shell/registry traversal permits sibling aliases and fresh operands`, async context => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/source");
    await fs.mkdir("/shared");
    await fs.mkdir("/target");
    const bytes = new Uint8Array([0, 255, 128, 10]);
    await fs.writeFile("/shared/file", bytes);
    await fs.symlink("/shared", "/source/a");
    await fs.symlink("/shared", "/source/b");
    const shell = new Shell({ fs, commands: new CommandRegistry(filesystemCommands(8)) });
    context.after(() => shell.dispose());
    const result = await shell.exec(command === "ls" ? "ls -RL /source /source" : "cp -rL /source /target");
    assert.equal(result.exitCode, 0, result.stderr);
    if (command === "ls") {
      assert.equal(result.stdout, "/source:\na\nb\n\n/source/a:\nfile\n\n/source/b:\nfile\n\n/source:\na\nb\n\n/source/a:\nfile\n\n/source/b:\nfile\n");
    } else {
      for (const alias of ["a", "b"]) assert.deepEqual(await fs.readFile(`/target/source/${alias}/file`), bytes);
      const repeated = await shell.exec("cp -rL /source/a /source/b /target");
      assert.equal(repeated.exitCode, 0, repeated.stderr);
      for (const alias of ["a", "b"]) assert.deepEqual(await fs.readFile(`/target/${alias}/file`), bytes);
    }
  });

  test(`${command} retains cycle diagnostics and earlier effects through public Shell execution`, async context => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/source");
    await fs.writeFile("/source/a", encoder.encode("kept"));
    await fs.symlink(".", "/source/z");
    const read = fs.readdir.bind(fs);
    let reads = 0;
    fs.readdir = async (path, options) => { reads++; return read(path, options); };
    const shell = new Shell({ fs, commands: new CommandRegistry(filesystemCommands(8)) });
    context.after(() => shell.dispose());
    const result = await shell.exec(command === "ls" ? "ls -RL /source" : "cp -rvL /source /target");
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /ELOOP/u);
    assert.doesNotMatch(result.stderr, /depth limit/u);
    assert.equal(reads, command === "cp" ? 2 : 1, "cp must retry ordinary preflight failures in its effectful walk");
    if (command === "cp") {
      assert.deepEqual(await fs.readFile("/target/a"), encoder.encode("kept"));
      assert.equal(result.stdout, "'/source/a' -> '/target/a'\n");
    } else assert.equal(result.stdout, "/source:\na\nz\n");
  });

  test(`${command} keeps actual cycle error priority at the depth boundary`, async () => {
    const { fs, counts, stdout } = chainHost(1025);
    const realpath = fs.realpath.bind(fs);
    fs.realpath = async (path, options) => path === "/source" + "/n".repeat(1025) ? "/source" : realpath(path, options);
    const result = await execute(fs, command, command === "ls" ? ["-R", "/source"] : ["-r", "/source", "/target"], undefined, stdout);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /ELOOP/u);
    assert.doesNotMatch(result.stderr, /depth limit/u);
    assert.equal(counts.deepestRead, 1024);
    assert.equal(counts.mkdirs, 0);
  });

  test(`${command} preserves falsey cancellation ahead of depth refusal`, async () => {
    const { fs, counts, stdout } = chainHost(1025);
    const controller = new AbortController();
    const realpath = fs.realpath.bind(fs);
    const rejected = "/source" + "/n".repeat(1025);
    fs.realpath = async (path, options) => {
      const result = await realpath(path, options);
      if (path === rejected) controller.abort(false);
      return result;
    };
    await assert.rejects(execute(fs, command, command === "ls" ? ["-R", "/source"] : ["-r", "/source", "/target"], controller.signal, stdout), error => Object.is(error, false));
    assert.equal(counts.deepestRead, 1024);
    assert.equal(counts.mkdirs, 0);
  });

  test(`${command} waits for output backpressure before advancing the walk`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/source");
    await fs.writeFile("/source/a", encoder.encode("a"));
    await fs.writeFile("/source/b", encoder.encode("b"));
    const read = fs.readdir.bind(fs), copy = fs.copyFile.bind(fs);
    let reads = 0, copies = 0, writes = 0;
    fs.readdir = async (path, options) => { reads++; return read(path, options); };
    fs.copyFile = async (source, target, options) => { copies++; return copy(source, target, options); };
    let markEntered!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { markEntered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const work = execute(fs, command, command === "ls" ? ["-R", "/source"] : ["-rv", "/source", "/target"], undefined, {
      async write() {
        if (++writes === 1) { markEntered(); await blocked; }
      },
    });
    try {
      await entered;
      assert.equal(reads, command === "cp" ? 2 : 0);
      assert.equal(copies, command === "cp" ? 1 : 0);
      assert.equal(writes, 1);
    } finally { release(); }
    const result = await work;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(copies, command === "cp" ? 2 : 0);
  });

  for (const failure of ["read", "cancel"] as const) {
    test(`${command} releases active ancestors after ${failure}`, async () => {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/source/child", { recursive: true });
      const controller = new AbortController();
      const read = fs.readdir.bind(fs);
      fs.readdir = async (path, options) => {
        if (path === "/source/child" && failure === "read") throw new FsError("EIO", { path });
        return read(path, options);
      };
      const active: Set<unknown>[] = [];
      registerYieldCheckpoint(controller.signal, () => {
        if (failure === "cancel" && active.some(ancestors => ancestors.has("/source") && ancestors.has("/source/child"))) controller.abort(false);
      });
      const add = Set.prototype.add;
      Set.prototype.add = function (value: unknown) {
        const result = add.call(this, value);
        if (value === "/source") active.push(this);
        return result;
      };
      try {
        const work = execute(fs, command, command === "ls" ? ["-R", "/source"] : ["-r", "/source", "/target"], controller.signal);
        if (failure === "cancel") await assert.rejects(work, error => Object.is(error, false));
        else {
          const result = await work;
          assert.equal(result.exitCode, 1);
          assert.match(result.stderr, /EIO/u);
        }
        assert.equal(active.length, command === "cp" && failure === "read" ? 2 : 1);
        assert.ok(active.every(ancestors => ancestors.size === 0), "every acquired active path must unwind");
      } finally { Set.prototype.add = add; }
    });
  }

  for (const reason of [false, null, 0, ""]) {
    test(`${command} retains queued cancellation identity ${JSON.stringify(reason)} at the first directory yield`, async context => {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/source/child", { recursive: true });
      const controller = new AbortController();
      const read = fs.readdir.bind(fs);
      let reads = 0;
      let abort: ReturnType<typeof setImmediate> | undefined;
      context.after(() => { if (abort) clearImmediate(abort); });
      fs.readdir = async (path, options) => {
        const entries = await read(path, options);
        if (++reads === 1) abort = setImmediate(() => controller.abort(reason));
        return entries;
      };
      await assert.rejects(execute(fs, command, command === "ls" ? ["-R", "/source"] : ["-r", "/source", "/target"], controller.signal), error => Object.is(error, reason));
      assert.equal(reads, 1);
    });
  }
}

test("cp preserves top-level/default nested symlink policy, -L, -P, and unsupported -H", async context => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/source/deep", { recursive: true });
  await fs.writeFile("/source/deep/file", encoder.encode("payload"));
  await fs.symlink("deep", "/source/link");
  await fs.symlink("source", "/alias");
  const shell = new Shell({ fs, commands: new CommandRegistry(filesystemCommands(8)) });
  context.after(() => shell.dispose());
  for (const source of ["cp -r /alias /default", "cp -rL /alias /followed", "cp -rP /alias /preserved"]) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
  }
  assert.equal((await fs.lstat("/default")).type, "directory");
  assert.equal(await fs.readlink!("/default/link"), "deep");
  assert.equal((await fs.lstat("/followed/link")).type, "directory");
  assert.equal(await fs.readlink!("/preserved"), "source");
  const unsupported = await shell.exec("cp -rH /alias /unsupported");
  assert.equal(unsupported.exitCode, 2);
  assert.match(unsupported.stderr, /invalid option.*H/u);
  await assert.rejects(fs.lstat("/unsupported"), { code: "ENOENT" });
});

test("cp verbose output stays postorder and ls recursive output keeps reverse sibling ordering", async context => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/source/a", { recursive: true });
  await fs.mkdir("/source/z");
  await fs.writeFile("/source/a/file", encoder.encode("a"));
  await fs.writeFile("/source/z/file", encoder.encode("z"));
  const shell = new Shell({ fs, commands: new CommandRegistry(filesystemCommands(8)) });
  context.after(() => shell.dispose());
  const copied = await shell.exec("cp -rv /source /target");
  assert.equal(copied.exitCode, 0, copied.stderr);
  assert.equal(copied.stdout, "'/source/a/file' -> '/target/a/file'\n'/source/a' -> '/target/a'\n'/source/z/file' -> '/target/z/file'\n'/source/z' -> '/target/z'\n'/source' -> '/target'\n");
  const listed = await shell.exec("ls -Rr /source");
  assert.equal(listed.exitCode, 0, listed.stderr);
  assert.equal(listed.stdout, "/source:\nz\na\n\n/source/z:\nfile\n\n/source/a:\nfile\n");
  const directoryOnly = await shell.exec("ls -Rd /source");
  assert.equal(directoryOnly.exitCode, 0, directoryOnly.stderr);
  assert.equal(directoryOnly.stdout, "/source\n");
});
