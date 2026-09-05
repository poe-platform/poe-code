import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, lstatSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createCommandArguments, FsError, type ByteSource, type InvocationCleanup } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { run, seed, wrapped } from "./helpers.js";
import { installCommands } from "../../../src/commands/install/index.js";
import { Shell } from "../../../src/shell/shell.js";

const nativeOptions = {
  skip: process.env.SAFE_BASH_INSTALL_GNU_ORACLE === undefined ? "Set SAFE_BASH_INSTALL_GNU_ORACLE to the reviewed GNU 9.7 ginstall" : false,
};

test("review: buffered install cancellation drains its admitted filesystem write", async () => {
  const fs = await seed();
  const original = await fs.readFile("/source");
  const controller = new AbortController();
  let entered!: () => void, release!: () => void, finished!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const writerFinished = new Promise<void>(resolve => { finished = resolve; });
  let active = false, settled = false;
  const host = wrapped(fs, {
    capabilities: { ...fs.capabilities, streamingWrite: false },
    writeStream: undefined,
    async writeFile(path, bytes, options) {
      assert.equal(path, "/target");
      assert.equal(options?.flag, "wx");
      active = true;
      entered();
      try { await gate; await fs.writeFile(path, bytes, options); }
      finally { active = false; finished(); }
    },
  });
  const shell = new Shell({ fs: host }).use(installCommands({ identity: { uid: 0, gid: 0 }, securityContext: { enabled: false } }));
  const execution = shell.exec("install /source /target", { signal: controller.signal });
  const checked = assert.rejects(execution, error => error === false);
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await started;
    controller.abort(false);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(active, true);
    assert.equal(settled, false, "Shell must await its admitted buffered writer before returning cancellation");
  } finally {
    release();
    await writerFinished;
    await checked;
    await shell.dispose();
  }
  assert.equal(active, false);
  assert.deepEqual(await fs.readFile("/source"), original);
  await assert.rejects(fs.stat("/target"), { code: "ENOENT" });
});

let authenticated: Promise<string> | undefined;
function oracle(): Promise<string> {
  return authenticated ??= (async () => {
    const path = process.env.SAFE_BASH_INSTALL_GNU_ORACLE;
    assert.ok(path, "an explicit GNU install oracle is required");
    const stat = lstatSync(path);
    assert.ok(stat.isFile() && stat.size <= 16 * 1024 * 1024, "oracle must be a bounded regular executable");
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of createReadStream(path)) {
      size += chunk.length;
      assert.ok(size <= 16 * 1024 * 1024);
      hash.update(chunk);
    }
    assert.equal(hash.digest("hex"), "efd5c3373a8b3d8fdc4edc7c506bc1cc3ee215ed27fdd8eca151e70e8fa1893a");
    return path;
  })();
}

async function native(args: readonly string[]) {
  const result = spawnSync(await oracle(), args, {
    argv0: "install", env: { LC_ALL: "C" }, timeout: 2000, maxBuffer: 65536,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { exitCode: result.status, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

test("review: help is byte-exact GNU 9.7 help", nativeOptions, async () => {
  assert.deepEqual(await run(["--help"]), await native(["--help"]));
});

test("review: version truthfully names the implementation and compatibility target", async () => {
  const actual = await run(["--version"]);
  assert.equal(actual.exitCode, 0);
  assert.equal(actual.stderr, "");
  assert.ok(actual.stdout.includes("safe-bash") || actual.stdout.includes("virtual-bash"));
  assert.ok(actual.stdout.includes("9.7"));
  assert.equal(actual.stdout.startsWith("install (GNU coreutils)"), false);
  for (const misleading of ["Copyright (C)", "License GPL", "Written by"]) assert.equal(actual.stdout.includes(misleading), false);
});

test("review: native getopt diagnostics remain exact without pathname effects", nativeOptions, async () => {
  for (const args of [["--bad"], ["--ver"], ["--mode"], ["--directory=1"], ["--target-directory"], ["--=x"], ["-q"]]) {
    assert.deepEqual(await run(args), await native(args), JSON.stringify(args));
  }
});

test("review: cancellation reaches a pending cooperative source iterator", async () => {
  const fs = await seed();
  const controller = new AbortController();
  const reason = false;
  const cleanups: InvocationCleanup[] = [];
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  let release!: (value: IteratorResult<Uint8Array>) => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => { release = resolve; });
  let returns = 0;
  const source: ByteSource = {
    [Symbol.asyncIterator]() {
      return {
        next() { entered(); return pending; },
        async return() {
          returns++;
          release({ done: true, value: undefined });
          await new Promise<void>(resolve => setImmediate(resolve));
          return { done: true, value: undefined };
        },
      };
    },
  };
  const host = wrapped(fs, { open: undefined, readStream: () => source });
  const operation = run(["source", "target"], host, {}, {
    signal: controller.signal, registerCleanup(callback) { cleanups.push(callback); },
  });
  const checked = assert.rejects(operation, error => error === reason);
  let closing: Promise<unknown> | undefined;
  try {
    await ready;
    controller.abort(reason);
    closing = Promise.all(cleanups.map(close => close()));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(returns, 1, "cleanup must reach return() without externally resolving pending next()");
    await checked;
    await closing;
  } finally {
    release({ done: true, value: undefined });
    await Promise.allSettled([checked, closing]);
  }
});

test("review: empty source chunks yield to timer cancellation", async () => {
  const fs = await seed();
  const controller = new AbortController();
  const reason = new FsError("EIO");
  let reads = 0;
  let timer: ReturnType<typeof setImmediate> | undefined;
  const host = wrapped(fs, {
    open: undefined,
    readStream: () => ({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (++reads === 1) timer = setImmediate(() => controller.abort(reason));
            return reads <= 4096 ? { done: false, value: new Uint8Array() } : { done: true, value: undefined };
          },
        };
      },
    }),
  });
  try {
    await assert.rejects(run(["source", "target"], host, {}, { signal: controller.signal }), error => error === reason);
    assert.ok(reads < 4096);
  } finally { if (timer !== undefined) clearImmediate(timer); }
});

test("review: source cleanup cannot replace the primary write diagnostic", async () => {
  const fs = await seed();
  let returns = 0;
  const host = wrapped(fs, {
    open: undefined,
    readStream: () => ({
      [Symbol.asyncIterator]() {
        return {
          async next() { return { done: false, value: Uint8Array.of(1) }; },
          async return() { returns++; throw new FsError("EIO"); },
        };
      },
    }),
    async writeStream() { throw new FsError("ENOSPC"); },
  });
  const actual = await run(["source", "target"], host);
  assert.deepEqual(actual, { exitCode: 1, stdout: "", stderr: "install: error writing 'target': No space left on device\n" });
  assert.equal(returns, 1);
});

test("review: descriptor cleanup cannot replace the primary write diagnostic", async () => {
  const fs = await seed();
  let opened = 0, closed = 0;
  const host = wrapped(fs, {
    async open(path, options) {
      opened++;
      const descriptor = await fs.open!(path, options);
      const close = descriptor.close.bind(descriptor);
      descriptor.close = async () => { closed++; await close(); throw new FsError("EIO"); };
      return descriptor;
    },
    readStream() { throw new Error("descriptor fixture must not use the streaming fallback"); },
    async writeStream() { throw new FsError("ENOSPC"); },
  });
  const actual = await run(["source", "target"], host);
  assert.deepEqual(actual, { exitCode: 1, stdout: "", stderr: "install: error writing 'target': No space left on device\n" });
  assert.equal(opened, 1);
  assert.equal(closed, 1);
});

for (const existing of [false, true]) {
  test(`review: dropped ordinary directory mode bits cannot report success; existing=${existing}`, async () => {
    const fs = await seed();
    if (existing) await fs.mkdir("/directory", { mode: 0o575 });
    const host = wrapped(fs, {
      async mkdir(path, options) { await fs.mkdir(path, { ...options, mode: (options?.mode ?? 0o777) & ~0o200 }); },
      async chmod(path, mode, options) { await fs.chmod!(path, mode & ~0o200, options); },
    });
    const actual = await run(["-d", "-m775", "directory"], host);
    assert.equal(actual.exitCode, 1);
    assert.match(actual.stderr, /Operation not supported.*did not retain requested mode/u);
    assert.equal((await fs.stat("/directory")).mode & 0o7777, 0o575);
  });
}

for (const profile of [
  { mode: "2700", existing: false, finalMode: 0o700 },
  { mode: "2700", existing: true, finalMode: 0o700 },
  { mode: "7777", existing: false, finalMode: 0o5777 },
  { mode: "7777", existing: true, finalMode: 0o5777 },
  { mode: "a+s", existing: true, finalMode: 0o4755 },
  { mode: "g+s", existing: true, finalMode: 0o755 },
]) {
  test(`review: captured GNU directory success permits setgid clearing: ${JSON.stringify(profile)}`, async () => {
    const fs = await seed();
    if (profile.existing) await fs.mkdir("/target", { mode: 0o755 });
    const host = wrapped(fs, {
      async mkdir(path, options) { await fs.mkdir(path, { ...options, mode: (options?.mode ?? 0o777) & ~0o2000 }); },
      async chmod(path, mode, options) { await fs.chmod!(path, mode & ~0o2000, options); },
    });
    const actual = await run(["-d", "-m", profile.mode, "target"], host);
    assert.deepEqual(actual, { exitCode: 0, stdout: "", stderr: "" });
    assert.equal((await fs.stat("/target")).mode & 0o7777, profile.finalMode);
  });
}

for (const profile of [
  { mode: "2700", directory: false, finalMode: 0o600 },
  { mode: "7777", directory: false, finalMode: 0o600 },
  { mode: "a+s", directory: false, finalMode: 0o600 },
  { mode: "g+s", directory: false, finalMode: 0o600 },
  { mode: "a+s", directory: true, finalMode: 0 },
  { mode: "g+s", directory: true, finalMode: 0 },
]) {
  test(`review: strict backend permission failure preserves captured GNU partial mode: ${JSON.stringify(profile)}`, async () => {
    const fs = await seed();
    const host = wrapped(fs, {
      async mkdir(path, options) { await fs.mkdir(path, { ...options, mode: (options?.mode ?? 0o777) & ~0o6000 }); },
      async chmod() { throw new FsError("EPERM"); },
    });
    const args = profile.directory ? ["-d", "-m", profile.mode, "target"] : ["-m", profile.mode, "source", "target"];
    assert.deepEqual(await run(args, host), {
      exitCode: 1, stdout: "", stderr: "install: cannot change permissions of 'target': Operation not permitted\n",
    });
    assert.equal((await fs.stat("/target")).mode & 0o7777, profile.finalMode);
    if (!profile.directory) assert.deepEqual(await fs.readFile("/target"), await fs.readFile("/source"));
  });
}

for (const control of ["existing", "numbered"]) {
  test(`review: ${control} backups ignore zero-prefixed version names`, async () => {
    const fs = await seed();
    await fs.writeFile("/target", Uint8Array.of(9));
    await fs.writeFile("/target.~01~", Uint8Array.of(7));
    const suffix = control === "existing" ? "~" : ".~1~";
    const actual = await run([`--backup=${control}`, "-v", "source", "target"], fs);
    assert.deepEqual(actual, { exitCode: 0, stdout: `'source' -> 'target' (backup: 'target${suffix}')\n`, stderr: "" });
    assert.deepEqual(await fs.readFile(`/target${suffix}`), Uint8Array.of(9));
    assert.deepEqual(await fs.readFile("/target.~01~"), Uint8Array.of(7));
    assert.deepEqual(await fs.readFile("/target"), await fs.readFile("/source"));
  });
}

test("review: invalid mode diagnostics retain owned raw argument bytes", async () => {
  for (const byte of [254, 255]) {
    const fs = await seed();
    const carrier = createCommandArguments(["-m", shellValueFromBytes(Uint8Array.of(byte)), "source", "target"]);
    const actual = await run(carrier.args, fs, {}, { argumentValues: carrier });
    assert.deepEqual(actual, { exitCode: 1, stdout: "", stderr: `install: invalid mode '\\${byte.toString(8)}'\n` });
    await assert.rejects(fs.stat("/target"), { code: "ENOENT" });
  }
});

test("review: symlink backup, symbolic mode, explicit ownership and bytes compose", async () => {
  const fs = await seed();
  await fs.writeFile("/referent", Uint8Array.of(7));
  await fs.symlink!("source", "/input-link");
  await fs.symlink!("referent", "/output-link");
  const events: string[] = [];
  let ownership = { uid: 0, gid: 0 };
  const host = wrapped(fs, {
    async stat(path, options) { return { ...await fs.stat(path, options), ...(path === "/output-link" ? ownership : {}) }; },
    async chmod(path, mode, options) { events.push("chmod"); await fs.chmod!(path, mode, options); },
  });
  const actual = await run(["-bp", "-m", "u=rw,g=u,o-rwx", "-o0x2a", "-g010", "input-link", "output-link"], host, {
    async chown(path, uid, gid) {
      assert.equal(path, "/output-link");
      ownership = { uid: uid!, gid: gid! };
      events.push("chown");
    },
  });
  assert.deepEqual(actual, { exitCode: 0, stdout: "", stderr: "" });
  assert.deepEqual(events, ["chown", "chmod"]);
  assert.deepEqual(ownership, { uid: 42, gid: 8 });
  assert.equal((await fs.stat("/output-link")).mode & 0o7777, 0o660);
  assert.equal((await fs.lstat("/output-link~")).type, "symlink");
  assert.equal(await fs.readlink!("/output-link~"), "referent");
  assert.deepEqual(await fs.readFile("/referent"), Uint8Array.of(7));
  assert.deepEqual(await fs.readFile("/output-link"), await fs.readFile("/source"));
});
