import assert from "node:assert/strict";
import { test } from "node:test";
import { browserCommands } from "../../../src/browser.js";
import { FsError, type ByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { networkCommands, type NetworkCommandsOptions } from "../../../src/commands/network/index.js";
import { Shell } from "../../../src/shell/index.js";

function buffered(backing: FileSystem): FileSystem {
  return {
    capabilities: { ...backing.capabilities, streamingRead: false, streamingWrite: false },
    ...Object.fromEntries([
      "stat", "lstat", "readdir", "readFile", "writeFile", "appendFile",
      "mkdir", "rmdir", "rm", "rename", "realpath", "access"
    ].map(name => [name, (backing[name as keyof FileSystem] as (...args: unknown[]) => unknown).bind(backing)]))
  } as FileSystem;
}

function shellFor(fs: FileSystem, body: ByteSource, options: Partial<NetworkCommandsOptions> = {}): Shell {
  return new Shell({ fs }).use(browserCommands()).use(networkCommands({
    authorize: () => true,
    transport: async () => ({ status: 200, statusText: "OK", headers: [], body, async dispose() {} }),
    ...options
  }));
}

test("curl selects streaming and buffered writers within the same mixed mount", async () => {
  const fast = createMemoryFileSystem();
  const slow = buffered(createMemoryFileSystem());
  let streams = 0;
  const stream = fast.writeStream.bind(fast);
  fast.writeStream = async (...args) => { streams++; return stream(...args); };
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/fast": fast, "/slow": slow } });
  assert.equal(fs.capabilities.streamingWrite, undefined);
  for (const destination of ["/slow/out", "/fast/out"]) {
    const shell = shellFor(fs, (async function* () { yield new Uint8Array([1, 255]); })());
    try {
      const result = await shell.exec(`curl https://example.invalid/file -o ${destination}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await fs.readFile(destination), new Uint8Array([1, 255]));
    } finally { await shell.dispose(); }
  }
  assert.equal(streams, 1);
});

test("curl honors an explicit streaming opt-out even when the method exists", async () => {
  const fs = buffered(createMemoryFileSystem());
  let streams = 0;
  fs.writeStream = async () => { streams++; throw new FsError("EIO"); };
  const shell = shellFor(fs, (async function* () { yield new Uint8Array([7]); })());
  try {
    const result = await shell.exec("curl https://example.invalid/file -o /out");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(streams, 0);
    assert.deepEqual(await fs.readFile("/out"), new Uint8Array([7]));
  } finally { await shell.dispose(); }
});

for (const stage of ["before", "acquired", "consumed"] as const) {
  test(`curl only falls back for typed ENOTSUP before iterator acquisition: ${stage}`, async () => {
    const backing = createMemoryFileSystem();
    const fs: FileSystem = { ...buffered(backing), capabilities: {} };
    await backing.writeFile("/out", new Uint8Array([9]));
    let bufferedWrites = 0;
    let produced = 0;
    fs.writeFile = async (...args) => { bufferedWrites++; return backing.writeFile(...args); };
    fs.writeStream = async (_path, source) => {
      if (stage !== "before") {
        const iterator = source[Symbol.asyncIterator]();
        try {
          if (stage === "consumed") {
            const chunk = await iterator.next();
            assert.equal(chunk.done, false);
            await backing.writeFile("/out", chunk.value);
          }
        } finally { await iterator.return?.(); }
      }
      throw new FsError("ENOTSUP");
    };
    const shell = shellFor(fs, (async function* () {
      produced++; yield new Uint8Array([1]);
      produced++; yield new Uint8Array([2]);
    })());
    try {
      const result = await shell.exec("curl https://example.invalid/file -o /out");
      assert.equal(result.exitCode, stage === "before" ? 0 : 23, result.stderr);
      assert.equal(bufferedWrites, stage === "before" ? 1 : 0);
      assert.equal(produced, stage === "before" ? 2 : stage === "consumed" ? 1 : 0);
      assert.deepEqual(await backing.readFile("/out"), new Uint8Array(stage === "before" ? [1, 2] : stage === "consumed" ? [1] : [9]));
    } finally { await shell.dispose(); }
  });
}

for (const failure of [new FsError("EACCES"), new FsError("EROFS"), new FsError("EIO"), { code: "ENOTSUP" }]) {
  test(`curl preserves stream failure without replay: ${failure.code}`, async () => {
    const backing = createMemoryFileSystem();
    const fs: FileSystem = { ...buffered(backing), capabilities: {} };
    let writes = 0;
    let produced = 0;
    fs.writeFile = async (...args) => { writes++; return backing.writeFile(...args); };
    fs.writeStream = async () => { throw failure; };
    const shell = shellFor(fs, (async function* () { produced++; yield new Uint8Array([1]); })());
    try {
      const result = await shell.exec("curl https://example.invalid/file -o /out");
      assert.equal(result.exitCode, 23);
      assert.equal(result.stderr, "curl: (23) Failed writing virtual output file\n");
      assert.equal(writes, 0);
      assert.equal(produced, 0);
      await assert.rejects(backing.readFile("/out"), { code: "ENOENT" });
    } finally { await shell.dispose(); }
  });
}

for (const mounted of [false, true]) {
  test(`curl preserves read-only ${mounted ? "mounted" : "direct"} buffered contents`, async () => {
    const backing = createMemoryFileSystem();
    await backing.writeFile("/out", new Uint8Array([9]));
    const destination = createReadOnlyFileSystem(buffered(backing));
    const fs = mounted ? createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/scratch": destination } }) : destination;
    let produced = 0;
    const shell = shellFor(fs, (async function* () { produced++; yield new Uint8Array([1]); })());
    try {
      const result = await shell.exec(`curl https://example.invalid/file -o ${mounted ? "/scratch/out" : "/out"}`);
      assert.equal(result.exitCode, 23);
      assert.equal(produced, 0);
      assert.deepEqual(await backing.readFile("/out"), new Uint8Array([9]));
    } finally { await shell.dispose(); }
  });

  test(`curl cancellation stops ${mounted ? "mounted" : "direct"} buffered writes`, async () => {
    const backing = createMemoryFileSystem();
    const destination = buffered(backing);
    const controller = new AbortController();
    const reason = new Error("stop output");
    let produced = 0;
    let appended = 0;
    let disposed = 0;
    destination.appendFile = async (...args) => {
      await backing.appendFile(...args);
      appended++;
      controller.abort(reason);
    };
    const fs = mounted ? createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/scratch": destination } }) : destination;
    const body = (async function* () {
      produced++; yield new Uint8Array([1]);
      produced++; yield new Uint8Array([2]);
    })();
    const shell = shellFor(fs, body, { transport: async () => ({
      status: 200, statusText: "OK", headers: [], body, async dispose() { disposed++; }
    }) });
    try {
      await assert.rejects(shell.exec(`curl https://example.invalid/file -o ${mounted ? "/scratch/out" : "/out"}`, { signal: controller.signal }), error => error === reason);
      assert.equal(produced, 1);
      assert.equal(appended, 1);
      assert.deepEqual(await backing.readFile("/out"), new Uint8Array([1]));
      await shell.dispose();
      assert.equal(disposed, 1);
    } finally { await shell.dispose(); }
  });
}

test("curl writes many buffered chunks with backpressure rather than collecting the response", async () => {
  const backing = createMemoryFileSystem();
  const destination = buffered(backing);
  let produced = 0;
  let appended = 0;
  destination.appendFile = async (...args) => {
    assert.equal(produced, appended + 1);
    await backing.appendFile(...args);
    appended++;
  };
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/scratch": destination } });
  const shell = shellFor(fs, (async function* () {
    for (let index = 0; index < 300; index++) {
      assert.equal(produced, appended);
      produced++;
      yield new Uint8Array([index % 256]);
    }
  })(), { limits: { maxBufferBytes: 128, maxDownloadBytes: 300 } });
  try {
    const result = await shell.exec("curl https://example.invalid/file -o /scratch/out");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(appended, 300);
    assert.deepEqual(await backing.readFile("/out"), Uint8Array.from({ length: 300 }, (_value, index) => index % 256));
  } finally { await shell.dispose(); }
});

test("curl download limits stop buffered output without replay or overconsumption", async () => {
  const backing = createMemoryFileSystem();
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/scratch": buffered(backing) } });
  let produced = 0;
  const shell = shellFor(fs, (async function* () {
    produced++; yield new Uint8Array([1, 2]);
    produced++; yield new Uint8Array([3, 4]);
    produced++; yield new Uint8Array([5, 6]);
  })(), { limits: { maxDownloadBytes: 3 } });
  try {
    const result = await shell.exec("curl https://example.invalid/file -o /scratch/out");
    assert.equal(result.exitCode, 63);
    assert.equal(result.stderr, "curl: (63) Response exceeds download byte limit\n");
    assert.equal(produced, 2);
    assert.deepEqual(await backing.readFile("/out"), new Uint8Array([1, 2]));
  } finally { await shell.dispose(); }
});

test("curl does not retry failed buffered appends after a partial mounted write", async () => {
  const backing = createMemoryFileSystem();
  const destination = buffered(backing);
  let appended = 0;
  let produced = 0;
  destination.appendFile = async (...args) => {
    if (++appended === 2) throw new FsError("EIO");
    await backing.appendFile(...args);
  };
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/scratch": destination } });
  const shell = shellFor(fs, (async function* () {
    for (const byte of [1, 2, 3]) { produced++; yield new Uint8Array([byte]); }
  })());
  try {
    const result = await shell.exec("curl https://example.invalid/file -o /scratch/out");
    assert.equal(result.exitCode, 23);
    assert.equal(result.stderr, "curl: (23) Failed writing virtual output file\n");
    assert.equal(appended, 2);
    assert.equal(produced, 2);
    assert.deepEqual(await backing.readFile("/out"), new Uint8Array([1]));
  } finally { await shell.dispose(); }
});

test("curl cancellation before unsupported-stream fallback preserves the destination", async () => {
  const backing = createMemoryFileSystem();
  const fs: FileSystem = { ...buffered(backing), capabilities: {} };
  await backing.writeFile("/out", new Uint8Array([9]));
  const controller = new AbortController();
  const reason = new Error("stop before fallback");
  let produced = 0;
  fs.writeStream = async () => { controller.abort(reason); throw new FsError("ENOTSUP"); };
  const shell = shellFor(fs, (async function* () { produced++; yield new Uint8Array([1]); })());
  try {
    await assert.rejects(shell.exec("curl https://example.invalid/file -o /out", { signal: controller.signal }), error => error === reason);
    assert.equal(produced, 0);
    assert.deepEqual(await backing.readFile("/out"), new Uint8Array([9]));
  } finally { await shell.dispose(); }
});

for (const mounted of [false, true]) {
  for (const empty of [false, true]) {
    test(`curl writes exact ${empty ? "empty" : "binary"} bytes to ${mounted ? "mounted" : "direct"} buffered output`, async () => {
      const backing = createMemoryFileSystem();
      const destination = buffered(backing);
      const fs = mounted ? createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/scratch": destination } }) : destination;
      const target = mounted ? "/scratch/out" : "/out";
      await backing.writeFile("/out", new Uint8Array([9, 9, 9, 9]));
      const shell = shellFor(fs, (async function* () {
        if (!empty) {
          yield new Uint8Array([0, 1, 255]);
          yield new Uint8Array([128, 13, 10]);
        }
      })());
      try {
        const result = await shell.exec(`curl https://example.invalid/file -o ${target}`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
        assert.deepEqual(await backing.readFile("/out"), new Uint8Array(empty ? [] : [0, 1, 255, 128, 13, 10]));
      } finally { await shell.dispose(); }
    });
  }
}
