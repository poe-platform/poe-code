import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import test, { after, before } from "node:test";
import { createMemoryFileSystem, FsError, withFileSystemQuota } from "poe-code/safe-fs";
import { commandRuntimeIdentity } from "../../../src/contracts/command.js";
import { ddCommands, openDdFile } from "../../../src/commands/dd/index.js";
import { Shell, ShellLimitError } from "../../../src/shell/index.js";
import { bytes, run } from "./helpers.js";

const oracle = process.env.DD_ORACLE;
const expectedHash = "fadf2537de7e051d0ddda1f4e793da9c51034b2bff8cb9d593ad4855305fcd4f";
const absent = oracle === undefined && process.env.DD_ORACLE_SHA256 === undefined;
const nativeOptions = { skip: absent ? "Set DD_ORACLE and DD_ORACLE_SHA256 to the pinned clean GNU 9.7 DD" : false };

async function hashOracle() {
  assert.ok(oracle && isAbsolute(oracle));
  const metadata = lstatSync(oracle);
  assert.ok(metadata.isFile() && metadata.size > 0 && metadata.size <= 2 * 1024 * 1024);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(oracle, { end: metadata.size - 1, highWaterMark: 65536 })) hash.update(chunk);
  return hash.digest("hex");
}

function native(args: readonly string[], input = new Uint8Array()) {
  assert.ok(oracle);
  const result = spawnSync(oracle, args, { argv0: "dd", env: { LC_ALL: "C" }, input, timeout: 2000, maxBuffer: 128 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { exitCode: result.status, stdout: new Uint8Array(result.stdout), stderr: result.stderr.toString() };
}

before(async () => {
  if (absent) return;
  assert.equal(process.env.DD_ORACLE_SHA256?.toLowerCase(), expectedHash);
  assert.equal(await hashOracle(), expectedHash);
  const version = native(["--version"]);
  assert.equal(version.exitCode, 0);
  assert.equal(new TextDecoder().decode(version.stdout).split("\n")[0], "dd (coreutils) 9.7");
});

after(async () => { if (!absent) assert.equal(await hashOracle(), expectedHash); });

for (const args of [["--help"], ["--hel"], ["-h"], ["--help=x"], ["--version=x"], ["bs=2", "--help"], ["--", "--help"], ["if=missing", "--help"]]) {
  test(`review: exact pinned native CLI ${JSON.stringify(args)}`, nativeOptions, async () => {
    const actual = await run(args), expected = native(args);
    assert.equal(actual.exitCode, expected.exitCode);
    assert.equal(actual.stderr, expected.stderr);
    assert.equal(Buffer.compare(actual.stdout, expected.stdout), 0, `stdout differs: actual ${actual.stdout.length} bytes, native ${expected.stdout.length} bytes`);
  });
}

for (const operands of [
  ["ibs=7", "obs=11", "conv=swab,ucase"],
  ["ibs=7", "obs=11", "cbs=5", "conv=sync,block"],
  ["ibs=7", "obs=11", "cbs=5", "conv=ascii,unblock"],
  ["ibs=7", "obs=11", "skip=3B", "count=19B"],
]) {
  test(`review: exact raw-byte conversion and record stats ${operands.join(" ")}`, nativeOptions, async () => {
    const input = Uint8Array.from({ length: 261 }, (_, index) => index % 256);
    const args = [...operands, "iflag=fullblock", "status=noxfer"];
    assert.deepEqual(await run(args, input), native(args, input));
  });
}

for (const fixture of [
  { operands: ["bs=2", "seek=2", "count=0"], input: "XY", initial: "abcdef", output: "abcd", records: "0+0 records in\n0+0 records out\n" },
  { operands: ["bs=2", "seek=4", "count=0"], input: "XY", initial: "abcdef", output: "abcdef\0\0", records: "0+0 records in\n0+0 records out\n" },
  { operands: ["bs=2", "seek=2", "count=1", "conv=notrunc"], input: "XY", initial: "abcdef", output: "abcdXY", records: "1+0 records in\n1+0 records out\n" },
  { operands: ["bs=2", "seek=1", "count=1", "oflag=append", "conv=notrunc"], input: "XY", initial: "abcdef", output: "abcdefXY", records: "1+0 records in\n1+0 records out\n" },
  { operands: ["bs=2", "conv=sparse,notrunc"], input: "\0\0XY\0\0", initial: "abcdef", output: "abXYef", records: "3+0 records in\n3+0 records out\n" },
  { operands: ["bs=2", "conv=sparse,notrunc"], input: "XY\0\0\0\0", initial: "abc", output: "XYc\0\0\0", records: "3+0 records in\n3+0 records out\n" },
]) {
  test(`review: captured GNU named descriptor effects ${JSON.stringify(fixture)}`, async context => {
    context.diagnostic("Manual native capture: /tmp/safe-bash-scripting-oracles-20260904/dd-independent-files-DsGrtl/evidence.json; metadata observed before bytes; no unit disk writes");
    const fs = createMemoryFileSystem();
    await fs.writeFile("/output", bytes(fixture.initial), { mode: 0o640 });
    const before = await fs.stat("/output");
    const result = await run(["of=output", ...fixture.operands, "status=noxfer"], bytes(fixture.input), { fs });
    const after = await fs.stat("/output");
    assert.deepEqual(result, { exitCode: 0, stdout: new Uint8Array(), stderr: fixture.records });
    assert.deepEqual({ ino: after.ino, mode: after.mode, uid: after.uid, gid: after.gid, nlink: after.nlink, size: after.size },
      { ino: before.ino, mode: before.mode, uid: before.uid, gid: before.gid, nlink: before.nlink, size: bytes(fixture.output).length });
    assert.deepEqual(await fs.readFile("/output"), bytes(fixture.output));
  });
}

for (const truncate of [false, true]) {
  test(`review: retained same-file input/output observes truncate=${truncate}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/file", bytes("abcdef"), { mode: 0o640 });
    const before = await fs.stat("/file");
    const result = await run(["if=file", "of=file", "bs=2", "skip=1", "count=2", "status=noxfer", ...(truncate ? [] : ["conv=notrunc"])], undefined, { fs });
    const after = await fs.stat("/file");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mode, before.mode);
    assert.deepEqual(await fs.readFile("/file"), bytes(truncate ? "" : "cdefef"));
  });
}

for (const fixture of [
  { name: "zero", operands: ["bs=4"], first: 0, records: "0+0", diagnostic: "error writing", error: false },
  { name: "partial then zero", operands: ["bs=4"], first: 2, records: "0+0", diagnostic: "error writing", error: false },
  { name: "partial then ENOSPC", operands: ["bs=4"], first: 2, records: "0+0", diagnostic: "error writing", error: true },
  { name: "full-buffer zero", operands: ["ibs=4", "obs=4"], first: 0, records: "0+0", diagnostic: "writing to", error: false },
  { name: "full-buffer partial then ENOSPC", operands: ["ibs=4", "obs=4"], first: 2, records: "0+1", diagnostic: "writing to", error: true },
  { name: "final-buffer zero", operands: ["ibs=4", "obs=8"], first: 0, records: "0+0", diagnostic: "error writing", error: false },
  { name: "final-buffer partial then ENOSPC", operands: ["ibs=4", "obs=8"], first: 2, records: "0+1", diagnostic: "error writing", error: true },
]) {
  test(`review: GNU 9.7 write failure ${fixture.name}`, async context => {
    context.diagnostic("Native diagnostic captures: /tmp/safe-bash-scripting-oracles-20260904/dd-independent-EovVKR/write-profile-evidence.json and /tmp/safe-bash-scripting-oracles-20260904/dd-review-write-ErH146/evidence.json; tagged 9.7 src/dd.c iwrite/write_output/dd_copy distinguish full and final buffers");
    const fs = createMemoryFileSystem();
    await fs.writeFile("/output", bytes("abcdef"), { mode: 0o640 });
    const before = await fs.stat("/output"), originalOpen = fs.open.bind(fs);
    let writes = 0, closes = 0;
    fs.open = async (path, options) => {
      const descriptor = await originalOpen(path, options);
      if (options.access === "read") return descriptor;
      const write = descriptor.write.bind(descriptor), close = descriptor.close.bind(descriptor);
      descriptor.write = async (chunk, position, writeOptions) => {
        if (writes++ === 0 && fixture.first) return write(chunk.subarray(0, fixture.first), position, writeOptions);
        if (fixture.error) throw new FsError("ENOSPC");
        return 0;
      };
      descriptor.close = async () => { closes++; await close(); };
      return descriptor;
    };
    const result = await run(["of=output", ...fixture.operands, "conv=notrunc", "status=noxfer"], bytes("WXYZ"), { fs });
    const after = await fs.stat("/output");
    assert.equal(closes, 1);
    assert.equal(writes, fixture.first ? 2 : 1);
    assert.deepEqual({ ino: after.ino, mode: after.mode, size: after.size }, { ino: before.ino, mode: before.mode, size: before.size });
    assert.deepEqual(await fs.readFile("/output"), bytes(fixture.first ? "WXcdef" : "abcdef"));
    assert.deepEqual(result, { exitCode: 1, stdout: new Uint8Array(), stderr: `dd: ${fixture.diagnostic} 'output': No space left on device\n1+0 records in\n${fixture.records} records out\n` });
  });
}

for (const path of ["/input", "/output"]) {
  test(`review: rename and replacement after open cannot retarget ${path}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", bytes("WXYZ"));
    await fs.writeFile("/output", bytes("abcdef"), { mode: 0o640 });
    const before = await fs.stat(path);
    let closed = 0;
    const result = await run(["if=/input", "of=/output", "bs=2", "conv=notrunc", "status=noxfer"], undefined, { fs }, {
      async openFile(context, request) {
        const handle = await openDdFile(context, request), close = handle.close.bind(handle);
        handle.close = async () => { closed++; await close(); };
        if (request.path === path) {
          await fs.rename!(path, "/retained");
          await fs.writeFile(path, bytes("replacement"));
        }
        return handle;
      },
    });
    const after = await fs.stat("/retained");
    assert.equal(after.ino, before.ino);
    assert.equal(after.mode, before.mode);
    assert.equal(closed, 2);
    assert.deepEqual(result, { exitCode: 0, stdout: new Uint8Array(), stderr: "2+0 records in\n2+0 records out\n" });
    assert.deepEqual(await fs.readFile(path), bytes("replacement"));
    assert.deepEqual(await fs.readFile(path === "/output" ? "/retained" : "/output"), bytes("WXYZef"));
  });
}

for (const kind of ["canonical", "stream-only", "trusted-opener"] as const) {
  test(`review: actual Shell global output budget includes ${kind} named writes`, async () => {
    const backing = createMemoryFileSystem();
    await backing.writeFile("/input", bytes("WXYZ"));
    const fs = kind === "stream-only" ? new Proxy(backing, { get(target, key) {
      if (key === "open") return undefined;
      if (key === "capabilities") return { ...target.capabilities, open: false };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } }) : backing;
    const shell = new Shell({ fs, limits: { maxOutputBytes: 4 } }).use(ddCommands(kind === "trusted-opener" ? {
      async openFile(context, request) {
        if (request.direction === "input") return openDdFile(context, request);
        const descriptor = await backing.open("/output", { access: "write", creation: "ifMissing", truncate: request.truncate });
        return { write: chunk => descriptor.write(chunk, null), close: () => descriptor.close() };
      },
    } : {}));
    shell.use({ name: "dd-review-prefix", setup(host) {
      host.commands.register({ name: "prefix", runtimeIdentity: commandRuntimeIdentity, async execute(context) {
        await context.stdout.write(bytes("P"));
        return { exitCode: 0 };
      } });
    } });
    try {
      const exact = await shell.exec("dd if=/input of=/output bs=2 status=none");
      assert.equal(exact.exitCode, 0, exact.stderr);
      assert.equal(exact.stdout, "");
      assert.equal(exact.stderr, "");
      assert.deepEqual(await backing.readFile("/output"), bytes("WXYZ"));
      await assert.rejects(shell.exec("prefix; dd if=/input of=/output bs=2 status=none"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
      assert.deepEqual(await backing.readFile("/output"), bytes("WX"));
    } finally { await shell.dispose(); }
  });
}

for (const direction of ["input", "output"]) for (const primaryFailure of [false, true]) {
  test(`review: native ${direction} close failure preserves cleanup and diagnostics; primary=${primaryFailure}`, async context => {
    context.diagnostic("Pinned GNU manual close fault capture: /tmp/safe-bash-scripting-oracles-20260904/dd-review-close-ab3bcH/evidence.json; real close followed by EIO after copying, with/without prior ENOSPC");
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", bytes("WXYZ"));
    await fs.writeFile("/output", bytes("abcdef"), { mode: 0o640 });
    const closed: string[] = [];
    const result = await run(["if=input", "of=output", "bs=4", "conv=notrunc", "status=noxfer"], undefined, { fs }, {
      async openFile(context, request) {
        const handle = await openDdFile(context, request), close = handle.close.bind(handle);
        if (request.direction === "output" && primaryFailure) handle.write = async () => { throw new FsError("ENOSPC"); };
        handle.close = async () => {
          closed.push(request.direction);
          await close();
          if (request.direction === direction) throw new FsError("EIO");
        };
        return handle;
      },
    });
    assert.deepEqual(closed, ["input", "output"]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, `${primaryFailure ? "dd: error writing 'output': No space left on device\n" : ""}dd: closing ${direction} file '${direction}': Input/output error\n`);
    assert.deepEqual(await fs.readFile("/output"), bytes(primaryFailure ? "abcdef" : "WXYZef"));
  });
}

test("review: root cancellation waits for both cooperative close failures without replacing falsey reason", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", bytes("WXYZ"));
  let entered!: () => void, release!: () => void;
  const closing = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const closed: string[] = [];
  const shell = new Shell({ fs }).use(ddCommands({
    async openFile(context, request) {
      const handle = await openDdFile(context, request), close = handle.close.bind(handle);
      handle.close = async () => {
        closed.push(request.direction);
        if (request.direction === "input") { entered(); await gate; }
        await close();
        throw new FsError("EIO");
      };
      return handle;
    },
  }));
  const controller = new AbortController();
  let settled = false;
  const execution = shell.exec("dd if=/input of=/output bs=4 status=none", { signal: controller.signal });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(execution, error => error === false);
  try {
    await closing;
    controller.abort(false);
    await Promise.resolve();
    assert.equal(settled, false);
    assert.deepEqual(closed, ["input"]);
    release();
    await rejected;
    assert.deepEqual(closed, ["input", "output"]);
    assert.deepEqual(await fs.readFile("/output"), bytes("WXYZ"));
  } finally { release(); await shell.dispose(); }
});

for (const fixture of [
  { fullblock: false, sync: false, output: "ABEFGH", interim: "0+1 records in\n0+1 records out\n", final: "1+1 records in\n1+1 records out\n" },
  { fullblock: false, sync: true, output: "AB\0\0EFGH", interim: "0+1 records in\n1+0 records out\n", final: "1+1 records in\n2+0 records out\n" },
  { fullblock: true, sync: false, output: "EFGH", interim: "0+0 records in\n0+0 records out\n", final: "1+0 records in\n1+0 records out\n" },
  { fullblock: true, sync: true, output: "AB\0\0EFGH", interim: "0+0 records in\n0+0 records out\n", final: "1+1 records in\n2+0 records out\n" },
]) {
  test(`review: native short-read recovery fullblock=${fixture.fullblock} sync=${fixture.sync}`, async context => {
    context.diagnostic("Pinned GNU manual read fault capture: /tmp/safe-bash-scripting-oracles-20260904/dd-review-read-wuzwX1/evidence.json; first read accepts 2 bytes, next read fails EIO without advancing, later reads normal");
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", bytes("ABCDEFGH"), { mode: 0o640 });
    await fs.writeFile("/output", bytes("old target"), { mode: 0o600 });
    const before = await fs.stat("/output"), originalOpen = fs.open.bind(fs);
    const readPositions: (number | null)[] = [];
    let calls = 0, closed = 0;
    fs.open = async (path, options) => {
      const descriptor = await originalOpen(path, options), close = descriptor.close.bind(descriptor);
      descriptor.close = async () => { closed++; await close(); };
      if (options.access === "read") {
        const read = descriptor.read.bind(descriptor);
        descriptor.read = async (buffer, position, readOptions) => {
          readPositions.push(position);
          if (++calls === 1) return read(buffer.subarray(0, 2), position, readOptions);
          if (calls === 2) throw new FsError("EIO");
          return read(buffer, position, readOptions);
        };
      }
      return descriptor;
    };
    const result = await run(["if=input", "of=output", "bs=4", "count=3", `conv=noerror${fixture.sync ? ",sync" : ""}`, "status=noxfer", ...(fixture.fullblock ? ["iflag=fullblock"] : [])], undefined, { fs });
    const after = await fs.stat("/output");
    assert.equal(closed, 2);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mode, before.mode);
    assert.deepEqual(await fs.readFile("/output"), bytes(fixture.output));
    assert.deepEqual(readPositions.slice(0, 3), [0, 2, 4]);
    assert.deepEqual(result, { exitCode: 0, stdout: new Uint8Array(), stderr: `dd: error reading 'input': Input/output error\n${fixture.interim}${fixture.final}` });
  });
}

for (const streaming of [false, true]) {
  test(`review: exclusive collision precedes write permission probes; stream-only=${streaming}`, async context => {
    context.diagnostic("Uninstrumented pinned GNU native capture: /tmp/safe-bash-scripting-oracles-20260904/dd-review-exclusive-vk2J4m/evidence.json");
    const backing = createMemoryFileSystem();
    await backing.writeFile("/output", bytes("old"), { mode: 0o444 });
    const before = await backing.stat("/output");
    const fs = streaming ? new Proxy(backing, { get(target, key) {
      if (key === "open") return undefined;
      if (key === "capabilities") return { ...target.capabilities, open: false };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } }) : backing;
    const result = await run(["of=output", "conv=excl", "bs=1", "count=0", "status=noxfer"], undefined, { fs });
    const after = await backing.stat("/output");
    assert.deepEqual({ ino: after.ino, mode: after.mode, size: after.size, mtimeMs: after.mtimeMs },
      { ino: before.ino, mode: before.mode, size: before.size, mtimeMs: before.mtimeMs });
    assert.deepEqual(await backing.readFile("/output"), bytes("old"));
    assert.deepEqual(result, { exitCode: 1, stdout: new Uint8Array(), stderr: "dd: failed to open 'output': File exists\n" });
  });
}

for (const fixture of [
  { fullblock: false, sync: false, output: "ABCDEFGH", interim: "0+1 records in\n0+1 records out\n", final: "1+2 records in\n1+2 records out\n" },
  { fullblock: false, sync: true, output: "AB\0\0CDEFGH\0\0", interim: "0+1 records in\n1+0 records out\n", final: "1+2 records in\n3+0 records out\n" },
  { fullblock: true, sync: false, output: "CDEFGH", interim: "0+0 records in\n0+0 records out\n", final: "1+1 records in\n1+1 records out\n" },
  { fullblock: true, sync: true, output: "AB\0\0CDEFGH\0\0", interim: "0+0 records in\n0+0 records out\n", final: "1+2 records in\n3+0 records out\n" },
]) {
  test(`review: native recoverable pipe fullblock=${fixture.fullblock} sync=${fixture.sync}`, async context => {
    context.diagnostic("Native pipe read-error capture: /tmp/safe-bash-scripting-oracles-20260904/dd-review-pipe-read-yLyr7b/evidence.json; explicit resumable FIFO handle, not a terminated JS generator or implicit filesystem fallback");
    const input = bytes("ABCDEFGH");
    let position = 0, calls = 0, closed = 0;
    const result = await run(["bs=4", "count=3", `conv=noerror${fixture.sync ? ",sync" : ""}`, "status=noxfer", ...(fixture.fullblock ? ["iflag=fullblock"] : [])], undefined, {}, {
      async openFile(context, request) {
        if (request.direction === "output") return openDdFile(context, request);
        return {
          type: "fifo",
          async read(size) {
            if (++calls === 2) throw new FsError("EIO");
            const length = calls === 1 ? Math.min(size, 2) : size;
            const chunk = input.slice(position, position + length);
            position += chunk.length;
            return chunk;
          },
          async close() { closed++; },
        };
      },
    });
    assert.equal(closed, 1);
    assert.deepEqual(result, { exitCode: 0, stdout: bytes(fixture.output), stderr: `dd: error reading 'standard input': Input/output error\n${fixture.interim}${fixture.final}` });
  });
}

test("review: actual quota-backed Shell output keeps only its committed prefix and drains streams", async () => {
  const backing = createMemoryFileSystem();
  await backing.writeFile("/input", bytes("WXYZ"));
  const quota = withFileSystemQuota(backing, { maxBytes: 6 });
  let active = 0;
  const fs = new Proxy(quota, { get(target, key) {
    if (key === "writeStream") return async (...args: Parameters<NonNullable<typeof quota.writeStream>>) => {
      active++;
      try { await quota.writeStream!(...args); }
      finally { active--; }
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const shell = new Shell({ fs, limits: { maxOutputBytes: 4096 } }).use(ddCommands());
  try {
    const result = await shell.exec("dd if=/input of=/output bs=2 status=noxfer");
    const metadata = await backing.stat("/output");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "dd: error writing '/output': No space left on device\n2+0 records in\n1+0 records out\n");
    assert.equal(metadata.size, 2);
    assert.deepEqual(await backing.readFile("/output"), bytes("WX"));
    assert.deepEqual(await backing.readFile("/input"), bytes("WXYZ"));
    assert.equal(active, 0);
  } finally { await shell.dispose(); }
});

for (const streaming of [false, true]) {
  test(`review: Shell handles ENOSPC as DD failure, not escaping cleanup; stream-only=${streaming}`, async () => {
    const backing = createMemoryFileSystem();
    await backing.writeFile("/input", bytes("WXYZ"));
    let writes = 0;
    const fs = new Proxy(backing, { get(target, key) {
      if (key === "capabilities" && streaming) return { ...target.capabilities, open: false };
      if (key === "open") return streaming ? undefined : async (...args: Parameters<typeof backing.open>) => {
        const descriptor = await backing.open(...args);
        if (args[1].access === "write") {
          const write = descriptor.write.bind(descriptor);
          descriptor.write = async (...writeArgs: Parameters<typeof write>) => {
            if (++writes === 2) throw new FsError("ENOSPC");
            return write(...writeArgs);
          };
        }
        return descriptor;
      };
      if (key === "writeStream" && streaming) return async (path: string, source: AsyncIterable<Uint8Array>, options: Parameters<typeof backing.writeStream>[2]) => {
        await backing.writeStream(path, (async function* () {
          for await (const chunk of source) {
            if (++writes === 2) throw new FsError("ENOSPC");
            yield chunk;
          }
        })(), options);
      };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const shell = new Shell({ fs }).use(ddCommands());
    shell.use({ name: "dd-review-recovery", setup(host) {
      host.commands.register({ name: "recovered", runtimeIdentity: commandRuntimeIdentity, async execute(context) {
        await context.stdout.write(bytes("R"));
        return { exitCode: 0 };
      } });
    } });
    try {
      const result = await shell.exec("dd if=/input of=/output bs=2 status=none || recovered");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "R");
      assert.equal(result.stderr, "dd: error writing '/output': No space left on device\n");
      assert.equal(writes, 2);
      assert.deepEqual(await backing.readFile("/output"), bytes("WX"));
      assert.deepEqual(await backing.readFile("/input"), bytes("WXYZ"));
    } finally { await shell.dispose(); }
  });
}

for (const canonical of [false, true]) {
  test(`review: Shell can recover after a diagnosed output close failure; canonical owner=${canonical}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", bytes("WXYZ"));
    let closes = 0;
    if (canonical) {
      const open = fs.open.bind(fs);
      fs.open = async (...args) => {
        const descriptor = await open(...args);
        if (args[1].access === "write") {
          const close = descriptor.close.bind(descriptor);
          descriptor.close = async () => { closes++; await close(); throw new FsError("EIO"); };
        }
        return descriptor;
      };
    }
    const shell = new Shell({ fs }).use(ddCommands(canonical ? {} : {
      async openFile(context, request) {
        const handle = await openDdFile(context, request);
        if (request.path === "/output") {
          const close = handle.close.bind(handle);
          handle.close = async () => { closes++; await close(); throw new FsError("EIO"); };
        }
        return handle;
      },
    }));
    try {
      const result = await shell.exec("dd if=/input of=/output bs=4 status=none || dd if=/input bs=4 count=1 status=none");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "WXYZ");
      assert.equal(result.stderr, "dd: closing output file '/output': Input/output error\n");
      assert.equal(closes, 1);
      assert.deepEqual(await fs.readFile("/output"), bytes("WXYZ"));
    } finally { await shell.dispose(); }
  });
}
