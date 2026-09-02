import assert from "node:assert/strict";
import { createMemoryFileSystem, createMountFileSystem, createReadOnlyFileSystem, FsError } from "@poe-platform/safe-fs/core";
import { networkCommands } from "@poe-platform/safe-bash/commands/network";

function buffered(backing) {
  return {
    capabilities: { ...backing.capabilities, streamingRead: false, streamingWrite: false },
    ...Object.fromEntries([
      "stat", "lstat", "readdir", "readFile", "writeFile", "appendFile",
      "mkdir", "rmdir", "rm", "rename", "realpath", "access"
    ].map(name => [name, backing[name].bind(backing)]))
  };
}

for (const entry of ["@poe-platform/safe-bash", "@poe-platform/safe-bash/browser"]) {
  const { Shell, standardCommands, browserCommands } = await import(entry);
  const commands = standardCommands ?? browserCommands;
  for (const mounted of [false, true]) {
    for (const empty of [false, true]) {
      const backing = createMemoryFileSystem();
      await backing.writeFile("/out.bin", new Uint8Array([9, 9, 9, 9]));
      const destination = buffered(backing);
      const fs = mounted ? createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/scratch": destination } }) : destination;
      let disposed = 0;
      const shell = new Shell({ fs, cwd: mounted ? "/scratch" : "/" }).use(commands()).use(networkCommands({
        authorize: () => true,
        transport: async () => ({ status: 200, statusText: "OK", headers: [], body: (async function* () {
          if (!empty) { yield new Uint8Array([1, 2, 255]); yield new Uint8Array([0, 128]); }
        })(), async dispose() { disposed++; } })
      }));
      try {
        const result = await shell.exec("curl https://example.invalid/file -o out.bin");
        assert.equal(result.exitCode, 0, `${entry}: ${result.stderr}`);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
        assert.deepEqual(await backing.readFile("/out.bin"), new Uint8Array(empty ? [] : [1, 2, 255, 0, 128]));
        assert.equal(disposed, 1);
      } finally { await shell.dispose(); }
    }
  }

  const fast = createMemoryFileSystem();
  const slow = buffered(createMemoryFileSystem());
  const lockedBacking = createMemoryFileSystem();
  await lockedBacking.writeFile("/out", new Uint8Array([9]));
  let streams = 0;
  const stream = fast.writeStream.bind(fast);
  fast.writeStream = async (...args) => { streams++; return stream(...args); };
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: {
    "/fast": fast, "/slow": slow, "/locked": createReadOnlyFileSystem(buffered(lockedBacking))
  } });
  assert.equal(fs.capabilities.streamingWrite, undefined);
  const shell = new Shell({ fs }).use(commands()).use(networkCommands({
    authorize: () => true,
    transport: async () => ({ status: 200, statusText: "OK", headers: [], body: (async function* () {
      for (let index = 0; index < 300; index++) yield new Uint8Array([index % 256]);
    })(), async dispose() {} }),
    limits: { maxBufferBytes: 128, maxDownloadBytes: 300 }
  }));
  try {
    for (const target of ["/slow/out", "/fast/out"]) {
      const result = await shell.exec(`curl https://example.invalid/file -o ${target}`);
      assert.equal(result.exitCode, 0, `${entry}: ${result.stderr}`);
      assert.deepEqual(await fs.readFile(target), Uint8Array.from({ length: 300 }, (_value, index) => index % 256));
    }
    assert.equal(streams, 1);
    const locked = await shell.exec("curl https://example.invalid/file -o /locked/out");
    assert.equal(locked.exitCode, 23);
    assert.deepEqual(await lockedBacking.readFile("/out"), new Uint8Array([9]));
  } finally { await shell.dispose(); }

  for (const stage of ["unsupported", "acquired", "partial", "io-error"]) {
    const backing = createMemoryFileSystem();
    await backing.writeFile("/out", new Uint8Array([9]));
    const destination = { ...buffered(backing), capabilities: {} };
    let produced = 0;
    let writes = 0;
    destination.writeFile = async (...args) => { writes++; return backing.writeFile(...args); };
    destination.writeStream = async (_path, source) => {
      if (stage === "acquired" || stage === "partial") {
        const iterator = source[Symbol.asyncIterator]();
        try {
          if (stage === "partial") {
            const chunk = await iterator.next();
            await backing.writeFile("/out", chunk.value);
          }
        } finally { await iterator.return?.(); }
      }
      throw new FsError(stage === "io-error" ? "EIO" : "ENOTSUP");
    };
    const shell = new Shell({ fs: destination }).use(commands()).use(networkCommands({
      authorize: () => true,
      transport: async () => ({ status: 200, statusText: "OK", headers: [], body: (async function* () {
        produced++; yield new Uint8Array([1]); produced++; yield new Uint8Array([2]);
      })(), async dispose() {} })
    }));
    try {
      const result = await shell.exec("curl https://example.invalid/file -o /out");
      assert.equal(result.exitCode, stage === "unsupported" ? 0 : 23);
      assert.equal(writes, stage === "unsupported" ? 1 : 0);
      assert.equal(produced, stage === "unsupported" ? 2 : stage === "partial" ? 1 : 0);
      assert.deepEqual(await backing.readFile("/out"), new Uint8Array(stage === "unsupported" ? [1, 2] : stage === "partial" ? [1] : [9]));
    } finally { await shell.dispose(); }
  }

  const backing = createMemoryFileSystem();
  const destination = buffered(backing);
  const controller = new AbortController();
  const reason = new Error("cancel buffered output");
  let produced = 0;
  let disposed = 0;
  destination.appendFile = async (...args) => {
    await backing.appendFile(...args);
    controller.abort(reason);
  };
  const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/scratch": destination } });
  const canceled = new Shell({ fs: mounted }).use(commands()).use(networkCommands({
    authorize: () => true,
    transport: async () => ({ status: 200, statusText: "OK", headers: [], body: (async function* () {
      produced++; yield new Uint8Array([1]); produced++; yield new Uint8Array([2]);
    })(), async dispose() { disposed++; } })
  }));
  try {
    await assert.rejects(canceled.exec("curl https://example.invalid/file -o /scratch/out", { signal: controller.signal }), error => error === reason);
    assert.equal(produced, 1);
    assert.deepEqual(await backing.readFile("/out"), new Uint8Array([1]));
    await canceled.dispose();
    assert.equal(disposed, 1);
  } finally { await canceled.dispose(); }
}

console.log("Public curl buffered/mixed output preserves bytes, cancellation and non-replay failures");
