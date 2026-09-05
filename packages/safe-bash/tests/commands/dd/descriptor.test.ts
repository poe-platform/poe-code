import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem, FsError, type FileSystem } from "poe-code/safe-fs";
import { createCommandArguments, commandRuntimeIdentity } from "../../../src/contracts/command.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { createDdCommand, ddCommands } from "../../../src/commands/dd/index.js";
import { openDdFile, type DdFileHandle } from "../../../src/commands/dd/io.js";
import { Shell, ShellLimitError } from "../../../src/shell/index.js";
import { bytes, run } from "./helpers.js";

test("dd carries the current command runtime identity", () => {
  assert.equal(createDdCommand().runtimeIdentity, commandRuntimeIdentity);
});

for (const [operands, expected] of [
  [["bs=1", "count=2", "seek=2", "conv=notrunc,nocreat"], "abXYef"],
  [["bs=1", "count=2", "seek=2"], "abXY"],
  [["bs=1", "count=0", "seek=8"], "abcdef\0\0"],
  [["bs=1", "count=2", "conv=notrunc,fdatasync"], "XYcdef"],
  [["bs=1", "count=2", "conv=notrunc,fsync"], "XYcdef"],
  [["bs=1", "count=2", "oflag=append", "conv=notrunc"], "abcdefXY"],
  [["bs=1", "count=2", "oflag=append"], "XY"],
] as const) {
  test(`canonical named workflow: ${operands.join(" ")}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/file", bytes("abcdef"));
    const inode = (await fs.stat("/file")).ino;
    const result = await run(["of=/file", ...operands, "status=none"], bytes("XYZ"), { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/file"), bytes(expected));
    assert.equal((await fs.stat("/file")).ino, inode);
  });
}

for (const [name, operands, input, expected, records] of [
  ["notrunc", ["bs=1", "seek=2", "conv=notrunc"], "XY", "abcdefXY", 2],
  ["truncate", ["bs=1", "seek=2"], "XY", "abXY", 2],
  ["notrunc beyond EOF", ["bs=1", "seek=8", "conv=notrunc"], "XY", "abcdefXY", 2],
  ["truncate beyond EOF", ["bs=1", "seek=8"], "XY", "abcdef\0\0XY", 2],
  ["zero count notrunc", ["bs=1", "seek=8", "count=0", "conv=notrunc"], "", "abcdef", 0],
  ["zero count truncate", ["bs=1", "seek=8", "count=0"], "", "abcdef\0\0", 0],
  ["sparse leading", ["bs=2", "seek=1", "conv=notrunc,sparse"], "\0\0XY", "abcdefXY", 2],
  ["sparse trailing", ["bs=2", "seek=1", "conv=notrunc,sparse"], "XY\0\0", "abcdefXY\0\0", 2],
  ["sparse mixed", ["bs=2", "seek=1", "conv=notrunc,sparse"], "\0\0XY\0\0", "abcdefXY\0\0", 3],
  ["sparse only", ["bs=2", "seek=1", "conv=notrunc,sparse"], "\0\0\0\0", "abcdef", 2],
  ["sparse beyond EOF", ["bs=2", "seek=5", "conv=notrunc,sparse"], "\0\0", "abcdef\0\0\0\0\0\0", 1],
] as const) {
  test(`GNU 9.7 named append plus seek: ${name}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", bytes(input));
    await fs.writeFile("/output", bytes("abcdef"));
    const originalOpen = fs.open.bind(fs);
    const positions: (number | null)[] = [];
    fs.open = async (path, options) => {
      if (path === "/output") assert.equal(options.append, true);
      const descriptor = await originalOpen(path, options);
      const write = descriptor.write.bind(descriptor);
      descriptor.write = async (chunk, position, forwarded) => { positions.push(position); return write(chunk, position, forwarded); };
      return descriptor;
    };
    const shell = new Shell({ fs }).use(ddCommands());
    try {
      const result = await shell.exec(["dd", "if=/input", "of=/output", "oflag=append", ...operands, "status=noxfer"].join(" "));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await fs.readFile("/output"), bytes(expected));
      assert.equal(result.stderr, `${records}+0 records in\n${records}+0 records out\n`);
      assert.ok(positions.every(position => position === null), "append must not become positioned overwrite");
    } finally { await shell.dispose(); }
  });
}

test("canonical nocreat refuses a missing output without creating it", async () => {
  const fs = createMemoryFileSystem();
  const result = await run(["of=/absent", "conv=nocreat", "status=none"], bytes("abc"), { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "dd: failed to open '/absent': No such file or directory\n");
  await assert.rejects(fs.stat("/absent"), { code: "ENOENT" });
});

for (const [initial, replacement, expected] of [
  ["a", "abcdef", "abcdef"],
  ["abcdef", "a", "a\0\0\0"],
] as const) {
  test(`sparse final extension uses retained current size: ${initial} becomes ${replacement}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/output", bytes(initial));
    const editor = await fs.open("/output", { access: "write", creation: "never" });
    const stdin = (async function* () {
      yield bytes("\0\0\0\0");
      await editor.truncate(bytes(replacement).length);
      await editor.write(bytes(replacement), 0);
    })();
    try {
      const result = await run(["of=/output", "bs=4", "conv=notrunc,sparse", "status=none"], undefined, { fs, stdin });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await fs.readFile("/output"), bytes(expected));
    } finally { await editor.close(); }
  });
}

test("canonical logical seek refuses a closed DD handle", async () => {
  let output: DdFileHandle | undefined;
  const result = await run(["of=/output", "count=0", "status=none"], undefined, {}, {
    async openFile(context, request) {
      const handle = await openDdFile(context, request);
      if (request.direction === "output") output = handle;
      return handle;
    },
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(output?.seek);
  await assert.rejects(output.seek(1n, {}), { code: "EBADF" });
});

test("a positioned DD handle reports its own cursor rather than the retained descriptor's unchanged cursor", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", bytes("abcdef"));
  const open = fs.open.bind(fs);
  fs.open = async (...args) => {
    const descriptor = await open(...args);
    Object.defineProperty(descriptor, "capabilities", { value: { ...descriptor.capabilities, position: true } });
    Object.defineProperty(descriptor, "getPosition", { value: async () => 0 });
    return descriptor;
  };
  const positions: bigint[] = [];
  let input: DdFileHandle | undefined;
  const result = await run(["if=/input", "count=0", "status=none"], undefined, { fs }, {
    async openFile(context, request) {
      const handle = await openDdFile(context, request);
      if (request.direction === "input") {
        input = handle;
        positions.push(await handle.getPosition!({}));
        await handle.read!(2, {});
        positions.push(await handle.getPosition!({}));
        await handle.seek!(4n, {});
        positions.push(await handle.getPosition!({}));
      }
      return handle;
    },
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(positions, [0n, 2n, 4n]);
  await assert.rejects(input!.getPosition!({}), { code: "EBADF" });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("real Shell cancellation drains late canonical acquisition and preserves the root reason", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", bytes("abc"));
  const opened = deferred(), releaseOpen = deferred(), closing = deferred(), releaseClose = deferred();
  const originalOpen = fs.open.bind(fs);
  let closed = 0, writes = 0;
  fs.open = async (path, options) => {
    const descriptor = await originalOpen(path, options);
    if (path !== "/output") return descriptor;
    const close = descriptor.close.bind(descriptor);
    descriptor.write = async () => { writes++; return 1; };
    descriptor.close = async () => {
      closed++; closing.resolve(); await releaseClose.promise; await close(); throw new FsError("EIO");
    };
    opened.resolve();
    await releaseOpen.promise;
    return descriptor;
  };
  const controller = new AbortController();
  const shell = new Shell({ fs }).use(ddCommands());
  let settled = false;
  const operation = shell.exec("dd if=/input of=/output conv=notrunc status=none", { signal: controller.signal });
  const rejected = assert.rejects(operation, reason => reason === false);
  void operation.then(() => { settled = true; }, () => { settled = true; });
  try {
    await opened.promise;
    controller.abort(false);
    await Promise.resolve();
    assert.equal(settled, false);
    releaseOpen.resolve();
    await closing.promise;
    assert.equal(settled, false);
    releaseClose.resolve();
    await rejected;
    assert.equal(closed, 1);
    assert.equal(writes, 0);
  } finally { releaseOpen.resolve(); releaseClose.resolve(); await shell.dispose(); }
});

test("real Shell cancellation drains admitted partial writes without retry or premature close", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", bytes("abc"));
  const entered = deferred(), releaseWrite = deferred();
  const originalOpen = fs.open.bind(fs);
  let closed = 0, writes = 0;
  let borrowed: Uint8Array | undefined;
  fs.open = async (path, options) => {
    const descriptor = await originalOpen(path, options);
    if (path !== "/output") return descriptor;
    const write = descriptor.write.bind(descriptor), close = descriptor.close.bind(descriptor);
    descriptor.write = async (chunk, position, forwarded) => {
      writes++; borrowed = chunk;
      await write(chunk.subarray(0, 1), position, forwarded);
      entered.resolve();
      await releaseWrite.promise;
      return 1;
    };
    descriptor.close = async () => { closed++; await close(); };
    return descriptor;
  };
  const controller = new AbortController();
  const shell = new Shell({ fs, limits: { maxOutputBytes: 3 } }).use(ddCommands());
  let settled = false;
  const operation = shell.exec("dd if=/input of=/output bs=3 status=none", { signal: controller.signal });
  const rejected = assert.rejects(operation, reason => reason === 0);
  void operation.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise;
    controller.abort(0);
    await Promise.resolve();
    assert.equal(closed, 0);
    assert.equal(settled, false);
    assert.deepEqual(borrowed, bytes("abc"));
    releaseWrite.resolve();
    await rejected;
    assert.equal(writes, 1);
    assert.equal(closed, 1);
    assert.deepEqual(await fs.readFile("/output"), bytes("a"));
  } finally { releaseWrite.resolve(); await shell.dispose(); }
});

test("named input skip retains the opened inode when output acquisition renames and replaces it", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", bytes("abcdef"));
  const originalOpen = fs.open.bind(fs);
  const acquisitions: string[] = [];
  fs.open = async (path, options) => {
    acquisitions.push(path);
    if (path === "/output") {
      await fs.rename("/input", "/old");
      await fs.writeFile("/input", bytes("xxxxxx"));
      await fs.rm("/old");
    }
    return originalOpen(path, options);
  };
  const result = await run(["if=/input", "of=/output", "bs=2", "skip=1", "status=none"], undefined, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(acquisitions, ["/input", "/output"]);
  assert.deepEqual(await fs.readFile("/output"), bytes("cdef"));
});

test("real Shell keeps output writes and sync on the retained inode after pathname replacement", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", bytes("XYZ"));
  await fs.writeFile("/output", bytes("abcdef"));
  const inode = (await fs.stat("/output")).ino;
  const originalOpen = fs.open.bind(fs);
  const acquisitions: string[] = [];
  const positions: (number | null)[] = [];
  const synchronized: boolean[] = [];
  fs.open = async (path, options) => {
    acquisitions.push(path);
    const descriptor = await originalOpen(path, options);
    if (path !== "/output") return descriptor;
    const write = descriptor.write.bind(descriptor), sync = descriptor.sync.bind(descriptor);
    descriptor.write = async (chunk, position, forwarded) => {
      positions.push(position);
      const count = await write(chunk, position, forwarded);
      if (positions.length === 1) {
        await fs.rename("/output", "/retained");
        await fs.writeFile("/output", bytes("replacement"));
      }
      return count;
    };
    descriptor.sync = async (dataOnly, forwarded) => {
      assert.equal((await descriptor.stat()).ino, inode);
      synchronized.push(dataOnly);
      await sync(dataOnly, forwarded);
    };
    return descriptor;
  };
  const shell = new Shell({ fs }).use(ddCommands());
  try {
    const result = await shell.exec("dd if=/input of=/output bs=1 seek=2 conv=nocreat,notrunc,fdatasync,fsync status=noxfer");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "3+0 records in\n3+0 records out\n");
    assert.deepEqual(acquisitions, ["/input", "/output"]);
    assert.deepEqual(positions, [2, 3, 4]);
    assert.deepEqual(synchronized, [true, false]);
    assert.deepEqual(await fs.readFile("/retained"), bytes("abXYZf"));
    assert.deepEqual(await fs.readFile("/output"), bytes("replacement"));
  } finally { await shell.dispose(); }
});

test("canonical successful partial prefixes are reported when a later write fails", async () => {
  const fs = createMemoryFileSystem();
  const originalOpen = fs.open.bind(fs);
  let writes = 0;
  fs.open = async (...args) => {
    const descriptor = await originalOpen(...args);
    const write = descriptor.write.bind(descriptor);
    descriptor.write = async (chunk, position, options) => {
      if (++writes === 2) throw new FsError("ENOSPC");
      return write(chunk.subarray(0, 1), position, options);
    };
    return descriptor;
  };
  const result = await run(["of=/output", "bs=3"], bytes("abc"), { fs }, { now: () => 0 });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "dd: error writing '/output': No space left on device\n1+0 records in\n0+0 records out\n1 byte copied, 0 s, Infinity B/s\n");
  assert.equal(writes, 2);
  assert.deepEqual(await fs.readFile("/output"), bytes("a"));
});

test("real Shell sparse blocks cannot bypass the shared output budget", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new Uint8Array(3));
  await fs.writeFile("/output", bytes("old"));
  const shell = new Shell({ fs, limits: { maxOutputBytes: 2 } }).use(ddCommands());
  try {
    await assert.rejects(shell.exec("dd if=/input of=/output bs=3 conv=sparse,notrunc status=none"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.deepEqual(await fs.readFile("/output"), bytes("old"));
  } finally { await shell.dispose(); }
});

test("sparse notrunc retains existing nonzero contents and counts the accepted zero blocks", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new Uint8Array(3));
  await fs.writeFile("/output", bytes("old"));
  const shell = new Shell({ fs, limits: { maxOutputBytes: 3 } }).use(ddCommands());
  try {
    const result = await shell.exec("dd if=/input of=/output bs=3 conv=sparse,notrunc status=none");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/output"), bytes("old"));
  } finally { await shell.dispose(); }
});

test("zero-progress canonical writes fail once without inflating records or byte statistics", async () => {
  const fs = createMemoryFileSystem();
  const originalOpen = fs.open.bind(fs);
  let writes = 0;
  fs.open = async (...args) => {
    const fd = await originalOpen(...args);
    fd.write = async () => { writes++; return 0; };
    return fd;
  };
  const result = await run(["of=/output", "bs=2", "status=noxfer"], bytes("ab"), { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(writes, 1);
  assert.equal(result.stderr, "dd: error writing '/output': No space left on device\n1+0 records in\n0+0 records out\n");
});

test("raw invalid UTF-8 paths are refused rather than selecting a lossy replacement filename", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/�", bytes("untouched"));
  const argumentsValue = createCommandArguments([shellValueFromBytes(Uint8Array.of(111, 102, 61, 47, 255)), "status=none"]);
  const result = await run(argumentsValue.args, bytes("bad"), { fs, argumentValues: argumentsValue });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(await fs.readFile("/�"), bytes("untouched"));
});

function partialFilesystem(count: (size: number) => number) {
  const fs = createMemoryFileSystem();
  const originalOpen = fs.open.bind(fs);
  const requests: number[] = [];
  let closed = 0;
  fs.open = async (...args) => {
    const fd = await originalOpen(...args);
    const write = fd.write.bind(fd), close = fd.close.bind(fd);
    fd.write = async (chunk, position, options) => {
      requests.push(chunk.length);
      const accepted = count(chunk.length);
      if (Number.isSafeInteger(accepted) && accepted > 0 && accepted <= chunk.length) await write(chunk.subarray(0, accepted), position, options);
      return accepted;
    };
    fd.close = async () => { closed++; await close(); };
    return fd;
  };
  return { fs, requests, closed: () => closed };
}

test("real Shell shares stdout and named descriptor output admission", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", bytes("abc"));
  const shell = new Shell({ fs, limits: { maxOutputBytes: 4 } }).use(ddCommands());
  try {
    const result = await shell.exec("dd if=/input bs=1 count=1 status=none; dd if=/input of=/output bs=3 conv=notrunc status=none");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "a");
    assert.deepEqual(await fs.readFile("/output"), bytes("abc"));
    await assert.rejects(shell.exec("dd if=/input bs=1 count=2 status=none; dd if=/input of=/output bs=3 conv=notrunc status=none"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  } finally { await shell.dispose(); }
});

test("real Shell partial retries charge accepted bytes without charging the request twice", async () => {
  const fixture = partialFilesystem(() => 1);
  await fixture.fs.writeFile("/input", bytes("abc"));
  const shell = new Shell({ fs: fixture.fs, limits: { maxOutputBytes: 3 } }).use(ddCommands());
  try {
    const result = await shell.exec("dd if=/input of=/output bs=3 status=none");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(fixture.requests, [3, 2, 1]);
    assert.deepEqual(await fixture.fs.readFile("/output"), bytes("abc"));
  } finally { await shell.dispose(); }
  assert.equal(fixture.closed(), 2);
});

for (const invalid of [NaN, -1, 4]) {
  test(`real Shell retains full admission for invalid count ${invalid}`, async () => {
    const fixture = partialFilesystem(() => invalid);
    await fixture.fs.writeFile("/input", bytes("abc"));
    const shell = new Shell({ fs: fixture.fs, limits: { maxOutputBytes: 3 } }).use(ddCommands());
    try {
      await assert.rejects(shell.exec("dd if=/input of=/output bs=3 status=none"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
      assert.deepEqual(fixture.requests, [3]);
      assert.deepEqual(await fixture.fs.readFile("/output"), new Uint8Array());
    } finally { await shell.dispose(); }
  });
}

test("canonical provider refusal has no read-modify-replace fallback", async () => {
  const backing = createMemoryFileSystem();
  await backing.writeFile("/file", bytes("original"));
  const fs: FileSystem = new Proxy(backing, { get(target, key) {
    if (key === "capabilities") return { ...target.capabilities, open: false };
    if (key === "open") return async () => { throw new FsError("EIO"); };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  for (const operands of [["conv=notrunc"], ["conv=nocreat"], ["seek=1"], ["conv=fsync"], ["conv=fdatasync"], ["oflag=append"]]) {
    const result = await run(["of=/file", ...operands, "status=none"], bytes("x"), { fs });
    assert.equal(result.exitCode, 1, operands.join(" "));
    assert.deepEqual(await backing.readFile("/file"), bytes("original"));
  }
});
