import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { FsError, type ByteSource } from "../../../src/contracts/index.js";
import { csplitCommands } from "../../../src/commands/csplit/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", Buffer.from("aa\nbb\ncc\n"));
  await fs.writeFile("/work/xx00", Buffer.from("previous first"));
  await fs.writeFile("/work/xx01", Buffer.from("previous second"));
  await fs.writeFile("/work/xx99", Buffer.from("foreign"));
  return fs;
}

for (const phase of ["input next", "second output append"] as const) {
  for (const reason of [false, 0, "", null, "dispose"] as const) test(`actual Shell drains ${phase} before settling ${JSON.stringify(reason)}`, async () => {
    const fs = await fixture();
    const gate = deferred(), admitted = deferred(), finished = deferred();
    const controller = new AbortController();
    let operationSignal: AbortSignal | undefined;
    let completed = false, settled = false, disposed = false;
    let returns = 0;
    if (phase === "input next") {
      const readStream = fs.readStream.bind(fs);
      fs.readStream = (path, options) => ({ [Symbol.asyncIterator]() {
        const iterator = readStream(path, options)[Symbol.asyncIterator]();
        return {
          async next() {
            operationSignal = options?.signal;
            admitted.resolve();
            try {
              await gate.promise;
              options?.signal?.throwIfAborted();
              return await iterator.next();
            } finally { completed = true; finished.resolve(); }
          },
          async return() {
            returns++;
            return await iterator.return?.() ?? { done: true, value: undefined };
          },
        };
      } });
    } else {
      const appendFile = fs.appendFile.bind(fs);
      fs.appendFile = async (path, bytes, options) => {
        if (path !== "/work/xx01") return appendFile(path, bytes, options);
        operationSignal = options?.signal;
        admitted.resolve();
        try {
          await gate.promise;
          options?.signal?.throwIfAborted();
          await appendFile(path, bytes, options);
        } finally { completed = true; finished.resolve(); }
      };
    }
    const shell = new Shell({ fs, cwd: "/work" }).use(csplitCommands());
    const execution = shell.exec("csplit input 2", { signal: controller.signal });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    let disposal: Promise<void> | undefined;
    try {
      await Promise.race([admitted.promise, execution.then(() => assert.fail("operation was not admitted"))]);
      if (reason === "dispose") {
        disposal = shell.dispose();
        void disposal.then(() => { disposed = true; }, () => { disposed = true; });
      } else controller.abort(reason);
      for (let turn = 0; turn < 12; turn++) await setImmediate();
      assert.equal(operationSignal?.aborted, true);
      assert.deepEqual({ completed, settled, disposed }, { completed: false, settled: false, disposed: false });
      gate.resolve();
      await assert.rejects(execution, error => Object.is(error, reason === "dispose" ? operationSignal?.reason : reason));
      assert.equal(completed, true);
      if (phase === "input next") assert.equal(returns, 1);
      if (disposal) await disposal;
      else assert.equal((await shell.exec(":")).exitCode, 0);
      assert.deepEqual(await fs.readFile("/work/input"), Uint8Array.from(Buffer.from("aa\nbb\ncc\n")));
      assert.deepEqual(await fs.readFile("/work/xx99"), Uint8Array.from(Buffer.from("foreign")));
      const expected = phase === "input next" ? ["input", "xx01", "xx99"] : ["input", "xx99"];
      assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), expected);
    } finally {
      gate.resolve();
      await execution.catch(() => {});
      await finished.promise;
      await shell.dispose();
    }
  });
}

for (const keep of [false, true]) test(`partial second append after first publication, keep=${keep}`, async () => {
  const fs = await fixture();
  const appendFile = fs.appendFile.bind(fs);
  fs.appendFile = async (path, bytes, options) => {
    if (path !== "/work/xx01") return appendFile(path, bytes, options);
    await appendFile(path, bytes.subarray(0, 1), options);
    throw new FsError("ENOSPC");
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(csplitCommands());
  try {
    const result = await shell.exec(`csplit ${keep ? "-k " : ""}input 2`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "3\n");
    assert.deepEqual(await fs.readFile("/work/input"), Uint8Array.from(Buffer.from("aa\nbb\ncc\n")));
    assert.deepEqual(await fs.readFile("/work/xx99"), Uint8Array.from(Buffer.from("foreign")));
    if (keep) {
      assert.deepEqual(await fs.readFile("/work/xx00"), Uint8Array.from(Buffer.from("aa\n")));
      assert.deepEqual(await fs.readFile("/work/xx01"), Uint8Array.from(Buffer.from("b")));
    } else assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["input", "xx99"]);
  } finally { await shell.dispose(); }
});

test("cleanup failure for the first output does not abandon later owned cleanup", async () => {
  const fs = await fixture();
  const failures: unknown[] = [];
  const appendFile = fs.appendFile.bind(fs), remove = fs.rm.bind(fs);
  const primary = new FsError("ENOSPC");
  const cleanup = new Error("first output cleanup failed");
  fs.appendFile = async (path, bytes, options) => {
    if (path !== "/work/xx01") return appendFile(path, bytes, options);
    await appendFile(path, bytes.subarray(0, 1), options);
    throw primary;
  };
  fs.rm = async (path, options) => {
    if (path === "/work/xx00") throw cleanup;
    await remove(path, options);
  };
  const shell = new Shell({ fs, cwd: "/work", onInternalError(error) { failures.push(error); } }).use(csplitCommands());
  try {
    await assert.rejects(shell.exec("csplit input 2"), error => error === cleanup);
    const aggregate = failures.find(error => error instanceof AggregateError);
    assert.ok(aggregate instanceof AggregateError);
    assert.ok(aggregate.errors.includes(primary));
    assert.ok(aggregate.errors.includes(cleanup));
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["input", "xx00", "xx99"]);
    assert.deepEqual(await fs.readFile("/work/xx00"), Uint8Array.from(Buffer.from("aa\n")));
  } finally { await shell.dispose(); }
});

test("input symlink backing identity is excluded before truncating the output", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/xx00", Buffer.from("aa\nbb\n"));
  await fs.symlink("xx00", "/work/input");
  let writes = 0;
  const writeFile = fs.writeFile.bind(fs);
  fs.writeFile = async (...args) => { writes++; return writeFile(...args); };
  const shell = new Shell({ fs, cwd: "/work" }).use(csplitCommands());
  try {
    assert.equal((await shell.exec("csplit input 2")).exitCode, 1);
    assert.equal(writes, 0);
    assert.deepEqual(await fs.readFile("/work/xx00"), Uint8Array.from(Buffer.from("aa\nbb\n")));
    assert.equal((await fs.lstat("/work/input")).type, "symlink");
  } finally { await shell.dispose(); }
});

for (const source of ["xx00", "./xx00", "source-link"]) test(`source/output alias ${source} is protected even if input stat omits backing identity`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/xx00", Buffer.from("aa\nbb\n"));
  if (source === "source-link") await fs.symlink("xx00", "/work/source-link");
  const stat = fs.stat.bind(fs), writeFile = fs.writeFile.bind(fs);
  let writes = 0;
  fs.stat = async (path, options) => {
    const value = await stat(path, options);
    const { identityScope: ignoredScope, ino: ignoredInode, dev: ignoredDevice, ...unknown } = value;
    return unknown;
  };
  fs.writeFile = async (...args) => { writes++; return writeFile(...args); };
  const shell = new Shell({ fs, cwd: "/work" }).use(csplitCommands());
  try {
    assert.equal((await shell.exec(`csplit ${source} 2`)).exitCode, 1);
    assert.equal(writes, 0);
    assert.deepEqual(await fs.readFile("/work/xx00"), Uint8Array.from(Buffer.from("aa\nbb\n")));
  } finally { await shell.dispose(); }
});

test("actual Shell raw bytes and borrowed stdin chunks retain their original ownership", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const borrowed = Uint8Array.of(255, 10);
  const input: ByteSource = { async *[Symbol.asyncIterator]() {
    yield borrowed;
    borrowed[0] = 65;
    yield borrowed;
    borrowed.fill(0);
  } };
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(csplitCommands());
  try {
    const result = await shell.exec("csplit - $'/\\xff/'", { stdin: input });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: "0\n4\n", stderr: "", status: 0 });
    assert.deepEqual(await fs.readFile("/work/xx01"), Uint8Array.of(255, 10, 65, 10));
    assert.equal((await fs.readFile("/work/xx00")).length, 0);
  } finally { await shell.dispose(); }
});

for (const keep of [false, true]) test(`native preexisting output bytes and modes after a later range failure, keep=${keep}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", Buffer.from("aa\nbb\ncc\n"), { mode: 0o664 });
  await fs.writeFile("/work/xx00", Buffer.from("old-first"), { mode: 0o604 });
  await fs.writeFile("/work/xx01", Buffer.from("old-second"), { mode: 0o640 });
  await fs.writeFile("/work/xx02", Buffer.from("foreign-next"), { mode: 0o600 });
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(csplitCommands());
  try {
    const result = await shell.exec(`csplit ${keep ? "-k " : ""}-- input 2 99`);
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "3\n6\n", stderr: "csplit: '99': line number out of range\n", status: 1,
    });
    const files: Record<string, { bytes: string; mode: number }> = {};
    for (const entry of await fs.readdir("/work")) files[entry.name] = {
      bytes: Buffer.from(await fs.readFile(`/work/${entry.name}`)).toString("base64"),
      mode: (await fs.stat(`/work/${entry.name}`)).mode! & 0o777,
    };
    assert.deepEqual(files, {
      input: { bytes: "YWEKYmIKY2MK", mode: 0o664 },
      ...(keep ? { xx00: { bytes: "YWEK", mode: 0o604 }, xx01: { bytes: "YmIKY2MK", mode: 0o640 } } : {}),
      xx02: { bytes: "Zm9yZWlnbi1uZXh0", mode: 0o600 },
    });
  } finally { await shell.dispose(); }
});
