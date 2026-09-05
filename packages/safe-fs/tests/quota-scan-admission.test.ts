import assert from "node:assert/strict";
import { test } from "vitest";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { FileSystemQuotaError, withFileSystemQuota } from "../src/fs/quota/index.js";
import { FsError } from "../src/contracts/errors.js";
import type { DirectoryEntry, FileSystem, FsOptions } from "../src/contracts/filesystem.js";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

for (const name of ["maxScanEntries", "maxScanDepth"] as const) {
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, "1"]) {
    test(`quota rejects invalid ${name}: ${String(value)}`, () => {
      assert.throws(() => Reflect.apply(withFileSystemQuota, undefined, [createMemoryFileSystem(), { maxBytes: 8, [name]: value }]),
        { name: "RangeError", message: `${name} must be a nonnegative safe integer` });
    });
  }
}

test("quota forwards the default entry allowance on an empty census", async () => {
  const raw = createMemoryFileSystem();
  const readdir = raw.readdir.bind(raw);
  const signal = new AbortController().signal;
  const allowances: (number | undefined)[] = [];
  raw.readdir = async (path, options) => {
    assert.equal(options?.signal, signal);
    allowances.push(options?.maxEntries);
    return readdir(path, options);
  };
  await withFileSystemQuota(raw, { maxBytes: 1 }).writeFile("/a", bytes("a"), { signal });
  assert.deepEqual(allowances, [4096]);
});

test("quota admits zero entry/depth limits for an empty census, not a namespace maximum", async () => {
  const raw = createMemoryFileSystem();
  const quota = withFileSystemQuota(raw, { maxBytes: 8, maxScanEntries: 0, maxScanDepth: 0 });
  await quota.writeFile("/a", bytes("a"));
  await assert.rejects(quota.appendFile("/a", bytes("b")), { code: "EFBIG" });
  assert.deepEqual(await raw.readFile("/a"), bytes("a"));
  await quota.rm("/a");
  await quota.writeFile("/b", bytes("b"));
});

test("quota shares remaining entries across directories and resets only per census", async () => {
  const raw = createMemoryFileSystem();
  await raw.mkdir("/dir");
  await raw.writeFile("/dir/a", bytes("a"));
  const readdir = raw.readdir.bind(raw);
  const requests: [string, number | undefined][] = [];
  raw.readdir = async (path, options) => {
    requests.push([path, options?.maxEntries]);
    return readdir(path, options);
  };
  const quota = withFileSystemQuota(raw, { maxBytes: 8, maxScanEntries: 2, maxScanDepth: 1 });
  await quota.appendFile("/dir/a", bytes("b"));
  await quota.appendFile("/dir/a", bytes("c"));
  assert.deepEqual(requests, [["/", 2], ["/dir", 1], ["/", 2], ["/dir", 1]]);
  await raw.writeFile("/dir/b", bytes("x"));
  await assert.rejects(quota.appendFile("/dir/a", bytes("d")), { code: "EFBIG" });
  assert.deepEqual(await raw.readFile("/dir/a"), bytes("abc"));
  await raw.rm("/dir/b");
  await quota.appendFile("/dir/a", bytes("d"));
  assert.deepEqual(await raw.readFile("/dir/a"), bytes("abcd"));
});

test("quota refuses a tiny wide Memory listing before census lstat work", async () => {
  const raw = createMemoryFileSystem();
  for (const name of ["a", "b", "c"]) await raw.writeFile(`/${name}`, bytes(name));
  let stats = 0;
  const lstat = raw.lstat.bind(raw);
  raw.lstat = async (path, options) => { stats++; return lstat(path, options); };
  const quota = withFileSystemQuota(raw, { maxBytes: 16, maxScanEntries: 2 });
  await assert.rejects(quota.writeFile("/new", bytes("n")), { code: "EFBIG", syscall: "readdir", path: "/" });
  assert.equal(stats, 0);
  await assert.rejects(raw.stat("/new"), { code: "ENOENT" });
});

test("quota rejects an ignored listing limit before entry access or later filesystem work", async () => {
  const raw = createMemoryFileSystem();
  let inspected = 0, stats = 0;
  const entries: DirectoryEntry[] = ["a", "b"].map(name => ({
    get name() { inspected++; return name; },
    get type() { inspected++; return "file" as const; },
  }));
  const lstat = raw.lstat.bind(raw);
  raw.readdir = async () => entries;
  raw.lstat = async (path, options) => { stats++; return lstat(path, options); };
  await assert.rejects(withFileSystemQuota(raw, { maxBytes: 8, maxScanEntries: 1 }).writeFile("/new", bytes("n")),
    { code: "EFBIG", syscall: "readdir", path: "/" });
  assert.equal(inspected, 0);
  assert.equal(stats, 0);
  await assert.rejects(raw.stat("/new"), { code: "ENOENT" });
});

test("quota counts returned directory names globally before descending", async () => {
  const raw = createMemoryFileSystem();
  await raw.mkdir("/a");
  await raw.mkdir("/b");
  const readdir = raw.readdir.bind(raw);
  const requests: [string, number | undefined][] = [];
  raw.readdir = async (path, options) => { requests.push([path, options?.maxEntries]); return readdir(path, options); };
  await withFileSystemQuota(raw, { maxBytes: 8, maxScanEntries: 2 }).writeFile("/new", bytes("n"));
  assert.deepEqual(requests, [["/", 2], ["/b", 0], ["/a", 0]]);
});

test("quota depth zero permits root files but rejects child-directory descent", async () => {
  const raw = createMemoryFileSystem();
  await raw.writeFile("/a", bytes("a"));
  const quota = withFileSystemQuota(raw, { maxBytes: 8, maxScanDepth: 0 });
  await quota.appendFile("/a", bytes("b"));
  await raw.mkdir("/dir");
  const readdir = raw.readdir.bind(raw);
  const listed: string[] = [];
  raw.readdir = async (path, options) => { listed.push(path); return readdir(path, options); };
  await assert.rejects(quota.appendFile("/a", bytes("c")), { code: "EFBIG", path: "/dir" });
  assert.deepEqual(listed, ["/"]);
  assert.deepEqual(await raw.readFile("/a"), bytes("ab"));
});

test("quota admits the exact directory-depth boundary and refuses the next level", async () => {
  const raw = createMemoryFileSystem();
  await raw.mkdir("/a/b", { recursive: true });
  await raw.writeFile("/a/b/file", bytes("a"));
  const quota = withFileSystemQuota(raw, { maxBytes: 8, maxScanDepth: 2, maxScanEntries: 8 });
  await quota.appendFile("/a/b/file", bytes("b"));
  await raw.mkdir("/a/b/c");
  const readdir = raw.readdir.bind(raw);
  const listed: string[] = [];
  raw.readdir = async (path, options) => { listed.push(path); return readdir(path, options); };
  await assert.rejects(quota.appendFile("/a/b/file", bytes("c")), { code: "EFBIG", path: "/a/b/c" });
  assert.ok(!listed.includes("/a/b/c"));
  assert.deepEqual(await raw.readFile("/a/b/file"), bytes("ab"));
});

test("quota preserves backend refusal identity and falsey cancellation before oversized replies", async () => {
  const raw = createMemoryFileSystem();
  const failure = new FsError("EACCES", { syscall: "readdir", path: "/" });
  raw.readdir = async () => { throw failure; };
  const quota = withFileSystemQuota(raw, { maxBytes: 8, maxScanEntries: 0 });
  await assert.rejects(quota.writeFile("/new", bytes("a")), error => error === failure);
  for (const reason of [false, 0, "", null]) {
    const controller = new AbortController();
    let inspected = 0;
    raw.readdir = async () => {
      controller.abort(reason);
      return [{ get name() { inspected++; return "a"; }, type: "file" }];
    };
    await assert.rejects(quota.writeFile("/new", bytes("a"), { signal: controller.signal }), error => error === reason);
    assert.equal(inspected, 0);
  }
  await assert.rejects(raw.stat("/new"), { code: "ENOENT" });
});

for (const append of [false, true]) {
  test(`quota scan refusal closes a ${append ? "append" : "truncate-first"} stream and preserves accepted prefix`, async () => {
    const raw = createMemoryFileSystem();
    await raw.writeFile("/file", bytes("old"));
    const quota = withFileSystemQuota(raw, { maxBytes: 16, maxScanEntries: 1 });
    let yielded = 0, closed = 0;
    const source = (async function* () {
      try {
        yielded++; yield bytes("a");
        await raw.writeFile("/outside", bytes("x"));
        yielded++; yield bytes("b");
        yielded++; yield bytes("c");
      } finally { closed++; }
    })();
    assert.ok(quota.writeStream);
    await assert.rejects(quota.writeStream("/file", source, { flag: append ? "a" : "w" }), { code: "EFBIG" });
    assert.equal(yielded, 2);
    assert.equal(closed, 1);
    assert.deepEqual(await raw.readFile("/file"), bytes(append ? "olda" : "a"));
    assert.deepEqual(await raw.readFile("/outside"), bytes("x"));
  });
}

test("quota preserves truncation before a first-chunk census failure and closes the source", async () => {
  const raw = createMemoryFileSystem();
  await raw.writeFile("/file", bytes("old"));
  const quota = withFileSystemQuota(raw, { maxBytes: 8, maxScanEntries: 0 });
  let yielded = 0, closed = 0;
  const source = (async function* () {
    try { yielded++; yield bytes("a"); yielded++; yield bytes("b"); }
    finally { closed++; }
  })();
  assert.ok(quota.writeStream);
  await assert.rejects(quota.writeStream("/file", source), { code: "EFBIG" });
  assert.equal(yielded, 1);
  assert.equal(closed, 1);
  assert.deepEqual(await raw.readFile("/file"), bytes(""));
});

test("quota retains byte/alias admission independently of scan admission", async () => {
  const raw = createMemoryFileSystem();
  await raw.writeFile("/a", bytes("a"));
  await raw.link("/a", "/b");
  const quota = withFileSystemQuota(raw, { maxBytes: 4, maxScanEntries: 2, maxScanDepth: 0 });
  await quota.appendFile("/a", bytes("b"));
  await assert.rejects(quota.appendFile("/a", bytes("c")), FileSystemQuotaError);
  assert.deepEqual(await raw.readFile("/b"), bytes("ab"));
});

test("quota keeps per-wrapper queue ownership and allows independent writers", async () => {
  const raw = createMemoryFileSystem();
  await raw.writeFile("/a", bytes("a"));
  const readdir = raw.readdir.bind(raw);
  let release: () => void = () => { throw new Error("not installed"); };
  let entered: () => void = () => { throw new Error("not installed"); };
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let calls = 0;
  raw.readdir = async (path, options) => {
    if (++calls === 1) { entered(); await held; }
    return readdir(path, options);
  };
  const first = withFileSystemQuota(raw, { maxBytes: 16, maxScanEntries: 1 });
  const independent = withFileSystemQuota(raw, { maxBytes: 16, maxScanEntries: 1 });
  const pending = first.appendFile("/a", bytes("b"));
  await started;
  const queued = first.appendFile("/a", bytes("c"));
  try {
    await independent.appendFile("/a", bytes("x"));
    assert.equal(calls, 2);
    assert.deepEqual(await raw.readFile("/a"), bytes("ax"));
  } finally { release(); }
  await Promise.all([pending, queued]);
  assert.equal(calls, 3);
  assert.deepEqual(await raw.readFile("/a"), bytes("axbc"));
});

const guarded: Record<string, (fs: FileSystem, options?: FsOptions) => Promise<void>> = {
  write: (fs, options) => fs.writeFile("/a", bytes("b"), options),
  append: (fs, options) => fs.appendFile("/a", bytes("b"), options),
  copy: (fs, options) => fs.copyFile("/a", "/copy", options),
  truncate: (fs, options) => { assert.ok(fs.truncate); return fs.truncate("/a", 0, options); },
  link: (fs, options) => { assert.ok(fs.link); return fs.link("/a", "/link", options); },
  symlink: (fs, options) => { assert.ok(fs.symlink); return fs.symlink("/a", "/link", options); },
};
for (const [name, operation] of Object.entries(guarded)) {
  test(`quota census cap precedes guarded ${name} mutation`, async () => {
    const raw = createMemoryFileSystem();
    await raw.writeFile("/a", bytes("a"));
    const quota = withFileSystemQuota(raw, { maxBytes: 16, maxScanEntries: 0 });
    await assert.rejects(operation(quota), { code: "EFBIG" });
    assert.deepEqual(await raw.readFile("/a"), bytes("a"));
    assert.deepEqual((await raw.readdir("/")).map(entry => entry.name), ["a"]);
  });
}

test("quota accepts safe-integer maxima without materializing large inputs", async () => {
  const raw = createMemoryFileSystem();
  const quota = withFileSystemQuota(raw, { maxBytes: 2, maxScanEntries: Number.MAX_SAFE_INTEGER, maxScanDepth: Number.MAX_SAFE_INTEGER });
  await quota.writeFile("/a", bytes("a"));
  await quota.appendFile("/a", bytes("b"));
  assert.deepEqual(await raw.readFile("/a"), bytes("ab"));
});

test("quota also charges entries appended to a host reply during awaited metadata", async () => {
  const raw = createMemoryFileSystem();
  await raw.writeFile("/a", bytes("a"));
  const entries: DirectoryEntry[] = [{ name: "a", type: "file" }];
  let inspected = 0, stats = 0;
  const lstat = raw.lstat.bind(raw);
  raw.readdir = async () => entries;
  raw.lstat = async (path, options) => {
    stats++;
    const stat = await lstat(path, options);
    entries.push({ get name() { inspected++; return "b"; }, type: "file" });
    return stat;
  };
  await assert.rejects(withFileSystemQuota(raw, { maxBytes: 8, maxScanEntries: 1 }).writeFile("/new", bytes("n")), { code: "EFBIG" });
  assert.equal(stats, 1);
  assert.equal(inspected, 0);
  await assert.rejects(raw.stat("/new"), { code: "ENOENT" });
});

test("quota forwards an inherited signal with the remaining listing allowance", async () => {
  const raw = createMemoryFileSystem();
  const signal = new AbortController().signal;
  const readdir = raw.readdir.bind(raw);
  let calls = 0;
  raw.readdir = async (path, options) => {
    calls++;
    assert.equal(options?.signal, signal);
    assert.equal(options?.maxEntries, 1);
    return readdir(path, options);
  };
  class Options { get signal() { return signal; } }
  await withFileSystemQuota(raw, { maxBytes: 8, maxScanEntries: 1 }).writeFile("/a", bytes("a"), new Options());
  assert.equal(calls, 1);
});

test("quota retains falsey stream cancellation and closes without consuming a later chunk", async () => {
  for (const reason of [false, 0, "", null]) {
    const raw = createMemoryFileSystem();
    const controller = new AbortController();
    const quota = withFileSystemQuota(raw, { maxBytes: 8, maxScanEntries: 1 });
    let yielded = 0, closed = 0;
    const source = (async function* () {
      try {
        yielded++; yield bytes("a");
        controller.abort(reason);
        yielded++; yield bytes("b");
        yielded++; yield bytes("c");
      } finally { closed++; }
    })();
    assert.ok(quota.writeStream);
    await assert.rejects(quota.writeStream("/file", source, { signal: controller.signal }), error => error === reason);
    assert.equal(yielded, 2);
    assert.equal(closed, 1);
    assert.deepEqual(await raw.readFile("/file"), bytes("a"));
  }
});

test("quota preserves a scan refusal over source-return failure", async () => {
  const raw = createMemoryFileSystem();
  const quota = withFileSystemQuota(raw, { maxBytes: 8, maxScanEntries: 0 });
  const cleanupFailure = new Error("source return failed");
  let closed = 0;
  const source = (async function* () {
    try { yield bytes("a"); }
    finally { closed++; throw cleanupFailure; }
  })();
  assert.ok(quota.writeStream);
  await assert.rejects(quota.writeStream("/file", source), { code: "EFBIG" });
  assert.equal(closed, 1);
  assert.deepEqual(await raw.readFile("/file"), bytes(""));
});

test("quota reserves all returned names even when a host reply shrinks during metadata", async () => {
  const raw = createMemoryFileSystem();
  await raw.mkdir("/d");
  for (const path of ["/a", "/b", "/d/f"]) await raw.writeFile(path, bytes("a"));
  const entries: DirectoryEntry[] = [{ name: "d", type: "directory" }, { name: "a", type: "file" }, { name: "b", type: "file" }];
  const readdir = raw.readdir.bind(raw);
  const lstat = raw.lstat.bind(raw);
  const requests: [string, number | undefined][] = [];
  raw.readdir = async (path, options) => {
    requests.push([path, options?.maxEntries]);
    return path === "/" ? entries : readdir(path, options);
  };
  raw.lstat = async (path, options) => {
    const stat = await lstat(path, options);
    if (path === "/a") entries.pop();
    return stat;
  };
  await assert.rejects(withFileSystemQuota(raw, { maxBytes: 16, maxScanEntries: 3 }).writeFile("/new", bytes("n")), { code: "EFBIG" });
  assert.deepEqual(requests, [["/", 3], ["/d", 0]]);
  await assert.rejects(raw.stat("/new"), { code: "ENOENT" });
});
