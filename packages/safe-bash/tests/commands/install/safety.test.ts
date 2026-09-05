import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type FileSystem } from "../../../src/contracts/index.js";
import { run, seed, wrapped } from "./helpers.js";

type FileDescriptor = Awaited<ReturnType<NonNullable<FileSystem["open"]>>>;

test("empty directory operand never becomes cwd or changes root permissions", async () => {
  const fs = await seed(); const before = await fs.stat("/");
  const result = await run(["-d", "-m700", ""], fs);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "install: cannot create directory '': No such file or directory\n");
  assert.equal((await fs.stat("/")).mode, before.mode);
});

test("empty source and destination operands retain their real pathname errors", async () => {
  const fs = await seed();
  assert.equal((await run(["", "target"], fs)).stderr, "install: cannot stat '': No such file or directory\n");
  for (const args of [["source", ""], ["-T", "source", ""]]) assert.equal((await run(args, fs)).stderr, "install: cannot overwrite directory '' with non-directory 'source'\n");
});

test("GNU numeric identities support leading whitespace, plus, octal and hexadecimal", async () => {
  for (const [text, value] of [[" \t7", 7], ["+7", 7], ["010", 8], ["0x10", 16], ["4294967295", undefined]] as const) {
    const fs = await seed(), calls: (number | undefined)[] = [];
    const result = await run(["-o", text, "source", "target"], fs, { chown(_path, uid) { calls.push(uid); } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(calls, value === undefined ? [] : [value]);
  }
});

for (const identity of ["-1", "4294967296", "08", "0xg", "", "1 "]) {
  test(`invalid GNU account number ${JSON.stringify(identity)}`, async () => {
    const fs = await seed();
    assert.equal((await run(["-o", identity, "source", "target"], fs)).exitCode, 1);
    await assert.rejects(fs.stat("/target"), { code: "ENOENT" });
  });
}

test("stripping may transform bytes; timestamp and mode application follow it", async () => {
  const fs = await seed();
  const result = await run(["-spm700", "--strip-program=program with spaces", "source", "target"], fs, { async strip(path, program, context) {
    assert.equal(program, "program with spaces");
    await context.fs.writeFile(path, Uint8Array.of(42), { signal: context.signal });
    return 0;
  } });
  assert.equal(result.exitCode, 0);
  const metadata = await fs.stat("/target");
  assert.equal(metadata.mode & 0o7777, 0o700);
  assert.equal(metadata.atimeMs, 1000);
  assert.equal(metadata.mtimeMs, 2000);
  assert.deepEqual(await fs.readFile("/target"), Uint8Array.of(42));
});

test("a throwing strip provider removes the installation instead of reporting success", async () => {
  const fs = await seed();
  const result = await run(["-s", "source", "target"], fs, { strip() { throw new FsError("ENOENT"); } });
  assert.equal(result.exitCode, 1);
  await assert.rejects(fs.stat("/target"), { code: "ENOENT" });
});

test("ownership failure retains copied bytes but never pretends requested mode was applied", async () => {
  const fs = await seed();
  const result = await run(["-o42", "-m777", "source", "target"], fs, { chown() { throw new FsError("EPERM"); } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "install: cannot change ownership of 'target': Operation not permitted\n");
  assert.equal((await fs.stat("/target")).mode & 0o7777, 0o600);
  assert.deepEqual(await fs.readFile("/target"), await fs.readFile("/source"));
});

test("unknown SELinux profile and missing active profile methods are unsupported", async () => {
  for (const securityContext of [undefined, { enabled: true }]) {
    const fs = await seed();
    assert.equal((await run(["-Z", "source", "target"], fs, securityContext ? { securityContext } : {}, {}, false)).exitCode, 1);
    await assert.rejects(fs.stat("/target"), { code: "ENOENT" });
  }
});

test("active SELinux profiles get literal labels and reject preserve/set conflicts", async () => {
  const fs = await seed(), labels = new Map<string, string>();
  const securityContext = { enabled: true, apply(request: { path: string; label?: string }) { labels.set(request.path, request.label ?? "default"); } };
  assert.equal((await run(["--context=label", "source", "target"], fs, { securityContext })).exitCode, 0);
  assert.equal(labels.get("/target"), "label");
  assert.equal((await run(["--preserve-context", "-Z", "source", "other"], fs, { securityContext })).stderr, "install: cannot set target context and preserve it\n");
  await assert.rejects(fs.stat("/other"), { code: "ENOENT" });
});

test("bounded copy refusal preserves an existing target", async () => {
  const fs = await seed(); await fs.writeFile("/target", Uint8Array.of(9));
  assert.equal((await run(["source", "target"], fs, { maxFileBytes: 2 })).exitCode, 1);
  assert.deepEqual(await fs.readFile("/target"), Uint8Array.of(9));
});

test("reused producer buffers are owned before advancing, including non-streaming output", async () => {
  const fs = await seed();
  const host = wrapped(fs, { open: undefined, writeStream: undefined, async *readStream() { const buffer = Uint8Array.of(1, 2); yield buffer; buffer.set([3, 4]); yield buffer; buffer.fill(99); } });
  assert.equal((await run(["source", "target"], host)).exitCode, 0);
  assert.deepEqual(await fs.readFile("/target"), Uint8Array.of(1, 2, 3, 4));
});

test("input cleanup is registered before acquisition and finalized after output refusal", async () => {
  const fs = await seed(); let registered = false, closed = 0;
  const host = wrapped(fs, {
    open: undefined,
    async *readStream() { assert.ok(registered); try { yield Uint8Array.of(1); yield Uint8Array.of(2); } finally { closed++; } },
    async writeStream() { throw new FsError("ENOSPC"); },
  });
  assert.equal((await run(["source", "target"], host, {}, { registerCleanup() { registered = true; } })).exitCode, 1);
  assert.equal(closed, 1);
});

test("numbered backup does not remove a replacement inserted after exclusive link creation", async () => {
  const fs = await seed(); await fs.writeFile("/target", Uint8Array.of(8));
  const host = wrapped(fs, { async link(source, destination, options) {
    await fs.link!(source, destination, options);
    await fs.rm(source);
    await fs.writeFile(source, Uint8Array.of(77));
  } });
  assert.equal((await run(["--backup=numbered", "source", "target"], host)).exitCode, 1);
  assert.deepEqual(await fs.readFile("/target"), Uint8Array.of(77));
  assert.deepEqual(await fs.readFile("/target.~1~"), Uint8Array.of(8));
});

test("new directories use requested creation permissions and skip redundant chmod", async () => {
  const fs = await seed(), creations: number[] = [];
  const host = wrapped(fs, {
    async mkdir(path, options) { creations.push(options?.mode ?? -1); await fs.mkdir(path, options); },
    async chmod() { throw new FsError("EPERM"); },
  });
  assert.equal((await run(["-dm700", "new"], host)).exitCode, 0);
  assert.deepEqual(creations, [0o700]);
  assert.equal((await fs.stat("/new")).mode & 0o7777, 0o700);
});

test("directory ownership uses restrictive creation and avoids redundant ownership calls", async () => {
  const fs = await seed(); let createdMode = 0;
  const host = wrapped(fs, { async mkdir(path, options) { createdMode = options?.mode ?? -1; await fs.mkdir(path, options); } });
  assert.equal((await run(["-dm777", "-o0", "new"], host, { chown() { throw new Error("unchanged owner must not be reassigned"); } })).exitCode, 0);
  assert.equal(createdMode, 0o700);
  assert.equal((await fs.stat("/new")).mode & 0o7777, 0o777);
});

test("compare includes caller group rather than accepting identical bytes alone", async () => {
  const fs = await seed(); await run(["source", "target"], fs);
  const before = await fs.stat("/target");
  assert.equal((await run(["-Cv", "source", "target"], fs, { identity: { uid: 0, gid: 20 } })).stdout, "removed 'target'\n'source' -> 'target'\n");
  assert.notEqual((await fs.stat("/target")).ino, before.ino);
});

test("cleanup closure before stream admission cannot publish an empty successful copy", async () => {
  const fs = await seed(); let opened = 0;
  const host = wrapped(fs, { open: undefined, async *readStream() { opened++; yield Uint8Array.of(8); } });
  const result = await run(["source", "target"], host, {}, { registerCleanup(close) { void close(); } });
  assert.equal(result.exitCode, 1);
  assert.equal(opened, 0);
  await assert.rejects(fs.stat("/target"), { code: "ENOENT" });
});

test("a backend silently dropping requested regular-file mode bits cannot report success", async () => {
  const fs = await seed();
  const host = wrapped(fs, { async chmod(path, mode, options) { await fs.chmod!(path, mode & ~0o2000, options); } });
  const result = await run(["-m2700", "source", "target"], host);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Operation not supported.*did not retain requested mode/u);
  assert.equal((await fs.stat("/target")).mode & 0o7777, 0o700);
});

test("explicit exclusive-rename capability preserves numbered symlink backup identity", async () => {
  const fs = await seed(); await fs.symlink!("source", "/target");
  const original = await fs.lstat("/target");
  const result = await run(["--backup=numbered", "source", "target"], fs, { async renameExclusive(source, destination, context) {
    await assert.rejects(context.fs.lstat(destination), { code: "ENOENT" });
    await context.fs.rename(source, destination, { signal: context.signal });
  } });
  assert.equal(result.exitCode, 0);
  assert.equal((await fs.lstat("/target.~1~")).ino, original.ino);
  assert.equal(await fs.readlink!("/target.~1~"), "source");
  assert.deepEqual(await fs.readFile("/target"), Uint8Array.of(255, 0, 128, 65, 10));
});

test("numbered symlink backup without exclusive movement fails without consuming the link", async () => {
  const fs = await seed(); await fs.symlink!("source", "/target");
  const result = await run(["--backup=numbered", "source", "target"], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Operation not supported/u);
  assert.equal(await fs.readlink!("/target"), "source");
});

test("numbered backup selection handles gaps and ignores malformed backup names", async () => {
  const fs = await seed();
  for (const name of ["target", "target.~2~", "target.~11~", "target.~x~", "target.~99"]) await fs.writeFile(`/${name}`, Uint8Array.of(9));
  assert.equal((await run(["--backup=existing", "source", "target"], fs)).exitCode, 0);
  assert.deepEqual(await fs.readFile("/target.~12~"), Uint8Array.of(9));
});

test("backing up onto the actual source entry is rejected with the source operand", async () => {
  const fs = await seed(); await fs.writeFile("/target", Uint8Array.of(9)); await fs.writeFile("/target~", Uint8Array.of(7));
  const result = await run(["-b", "target~", "target"], fs);
  assert.equal(result.stderr, "install: backing up 'target' might destroy source;  'target~' not copied\n");
  assert.deepEqual(await fs.readFile("/target"), Uint8Array.of(9));
  assert.deepEqual(await fs.readFile("/target~"), Uint8Array.of(7));
});

test("a distinct hardlink backup name may be replaced without destroying the source", async () => {
  const fs = await seed(); await fs.writeFile("/target", Uint8Array.of(9)); await fs.link!("/source", "/target~");
  const source = await fs.stat("/source"), previous = await fs.stat("/target");
  const result = await run(["-b", "source", "target"], fs);
  assert.equal(result.exitCode, 0);
  assert.equal((await fs.stat("/source")).ino, source.ino);
  assert.equal((await fs.stat("/target~")).ino, previous.ino);
  assert.deepEqual(await fs.readFile("/target~"), Uint8Array.of(9));
  assert.deepEqual(await fs.readFile("/source"), Uint8Array.of(255, 0, 128, 65, 10));
  assert.deepEqual(await fs.readFile("/target"), await fs.readFile("/source"));
});

test("cleanup-only failure is reported before final metadata is applied", async () => {
  const fs = await seed(); let reads = 0;
  const host = wrapped(fs, { open: undefined, readStream: () => ({ [Symbol.asyncIterator]: () => ({
    async next() { return reads++ === 0 ? { done: false, value: Uint8Array.of(1) } : { done: true, value: undefined }; },
    async return() { throw new Error("source cleanup failed"); },
  }) }) });
  const result = await run(["source", "target"], host);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "install: source cleanup failed\n");
  assert.equal((await fs.stat("/target")).mode & 0o7777, 0o600);
});

test("cancellation during cleanup outranks a simultaneous cleanup failure", async () => {
  const fs = await seed(), controller = new AbortController(); let reads = 0;
  const host = wrapped(fs, { open: undefined, readStream: () => ({ [Symbol.asyncIterator]: () => ({
    async next() { return reads++ === 0 ? { done: false, value: Uint8Array.of(1) } : { done: true, value: undefined }; },
    async return() { controller.abort(false); throw new Error("secondary cleanup error"); },
  }) }) });
  await assert.rejects(run(["source", "target"], host, {}, { signal: controller.signal }), error => error === false);
});

for (const strip of [false, true]) {
  test(`preserved timestamps use the opened source snapshot unless stripping; strip=${strip}`, async () => {
    const fs = await seed(); let opened = 0, closed = 0, position = 0;
    const bytes = await fs.readFile("/source");
    await fs.utimes!("/source", 1000, 2000);
    const snapshot = await fs.stat("/source");
    const descriptor: FileDescriptor = {
      capabilities: { positionedRead: true, positionedWrite: false, truncate: false, synchronization: "none" },
      async stat() { return { ...snapshot, atimeMs: 9000, mtimeMs: 8000 }; },
      async read(buffer) { const length = Math.min(bytes.length - position, buffer.length); buffer.set(bytes.subarray(position, position + length)); position += length; return length; },
      async write() { throw new FsError("ENOTSUP"); }, async truncate() { throw new FsError("ENOTSUP"); }, async sync() { throw new FsError("ENOTSUP"); },
      async close() { closed++; },
    };
    const host = wrapped(fs, { async open(path, options) { assert.equal(path, "/source"); assert.equal(options.access, "read"); opened++; return descriptor; } });
    const result = await run([strip ? "-sp" : "-p", "source", "target"], host, { strip: () => 0 });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(opened, 1);
    assert.equal(closed, 1);
    const target = await fs.stat("/target");
    assert.equal(target.atimeMs, strip ? 1000 : 9000);
    assert.equal(target.mtimeMs, strip ? 2000 : 8000);
    assert.deepEqual(await fs.readFile("/target"), bytes);
  });
}

test("source access during copying does not replace the pre-read preserved timestamp snapshot", async () => {
  const fs = await seed(), snapshot = await fs.stat("/source"), bytes = Uint8Array.of(255, 0, 128, 65, 10);
  const events: string[] = [];
  let consumed = false;
  const host = wrapped(fs, { async open() { return {
    capabilities: { positionedRead: true, positionedWrite: false, truncate: false, synchronization: "none" },
    async stat() { events.push("fstat"); return await fs.stat("/source"); },
    async read(buffer) {
      events.push("read");
      if (consumed) return 0;
      consumed = true;
      await fs.utimes!("/source", 9000, snapshot.mtimeMs);
      buffer.set(bytes);
      return bytes.length;
    },
    async write() { throw new FsError("ENOTSUP"); }, async truncate() { throw new FsError("ENOTSUP"); }, async sync() { throw new FsError("ENOTSUP"); },
    async close() { events.push("close"); },
  }; } });
  assert.deepEqual(await run(["-p", "source", "target"], host), { exitCode: 0, stdout: "", stderr: "" });
  const sourceAfter = await fs.stat("/source"), targetBeforeRead = await fs.stat("/target");
  assert.equal(sourceAfter.atimeMs, 9000);
  assert.equal(sourceAfter.mtimeMs, snapshot.mtimeMs);
  assert.equal(targetBeforeRead.atimeMs, snapshot.atimeMs);
  assert.equal(targetBeforeRead.mtimeMs, snapshot.mtimeMs);
  assert.deepEqual(events, ["fstat", "read", "read", "close"]);
  assert.deepEqual(await fs.readFile("/target"), bytes);
});

test("opened source identity replacement is refused and its descriptor is closed", async () => {
  const fs = await seed(), original = await fs.stat("/source"); let closed = 0;
  const host = wrapped(fs, { async open() { return {
    capabilities: { positionedRead: true, positionedWrite: false, truncate: false, synchronization: "none" },
    async stat() { return { ...original, ino: original.ino! + 100 }; },
    async read() { throw new Error("replaced source must not be read"); },
    async write() { throw new FsError("ENOTSUP"); }, async truncate() { throw new FsError("ENOTSUP"); }, async sync() { throw new FsError("ENOTSUP"); },
    async close() { closed++; },
  }; } });
  assert.equal((await run(["source", "target"], host)).stderr, "install: skipping file 'source', as it was replaced while being copied\n");
  assert.equal(closed, 1);
  await assert.rejects(fs.stat("/target"), { code: "ENOENT" });
});

test("descriptor cleanup closes a pending cooperative read before iterator retirement", async () => {
  const fs = await seed(), snapshot = await fs.stat("/source"), controller = new AbortController();
  let entered!: () => void, release!: (count: number) => void, closed = 0;
  const ready = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise<number>(resolve => { release = resolve; });
  const host = wrapped(fs, { async open() { return {
    capabilities: { positionedRead: true, positionedWrite: false, truncate: false, synchronization: "none" },
    async stat() { return snapshot; },
    async read() { entered(); return pending; },
    async write() { throw new FsError("ENOTSUP"); }, async truncate() { throw new FsError("ENOTSUP"); }, async sync() { throw new FsError("ENOTSUP"); },
    async close() { closed++; release(0); },
  }; } });
  const command = run(["source", "target"], host, {}, { signal: controller.signal });
  const checked = assert.rejects(command, error => error === false);
  await ready;
  controller.abort(false);
  await checked;
  assert.equal(closed, 1);
});

test("trusted mode setter receives file versus new/existing directory operation kinds", async () => {
  const fs = await seed(); await fs.mkdir("/existing", { mode: 0o755 });
  const calls: { path: string; mode: number; kind: string }[] = [];
  const host = wrapped(fs, { chmod: undefined, async mkdir(path, options) {
    await fs.mkdir(path, path === "/new" ? { ...options, mode: (options?.mode ?? 0o777) & ~0o200 } : options);
  } });
  const options = { async setMode(request: { path: string; mode: number; kind: string }) {
    calls.push(request); await fs.chmod!(request.path, request.mode);
  } };
  assert.equal((await run(["-m700", "source", "target"], host, options)).exitCode, 0);
  assert.equal((await run(["-dm600", "new", "existing"], host, options)).exitCode, 0);
  assert.equal((await run(["-Dm700", "source", "parent/file"], host, options)).exitCode, 0);
  assert.deepEqual(calls, [
    { path: "/target", mode: 0o700, kind: "file" },
    { path: "/new", mode: 0o600, kind: "new-directory" },
    { path: "/existing", mode: 0o600, kind: "existing-directory" },
    { path: "/parent/file", mode: 0o700, kind: "file" },
  ]);
});

test("strict trusted setter preserves native failure bytes and pre-chmod modes", async () => {
  for (const directory of [false, true]) {
    const fs = await seed();
    const host = wrapped(fs, { async mkdir(path, options) { await fs.mkdir(path, { ...options, mode: (options?.mode ?? 0o777) & ~0o6000 }); } });
    const result = await run(directory ? ["-dm", "a+s", "target"] : ["-m2700", "source", "target"], host, {
      setMode(request) { assert.equal(request.kind, directory ? "new-directory" : "file"); throw new FsError("EPERM"); },
    });
    assert.deepEqual(result, { exitCode: 1, stdout: "", stderr: "install: cannot change permissions of 'target': Operation not permitted\n" });
    assert.equal((await fs.stat("/target")).mode & 0o7777, directory ? 0 : 0o600);
    if (!directory) assert.deepEqual(await fs.readFile("/target"), Uint8Array.of(255, 0, 128, 65, 10));
  }
});
