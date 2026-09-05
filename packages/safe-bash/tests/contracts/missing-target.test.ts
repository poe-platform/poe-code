import assert from "node:assert/strict";
import { test } from "node:test";
import { basename, dirname, join } from "node:path/posix";
import { createMemoryFileSystem, createMountFileSystem, createOverlayFileSystem, createReadOnlyFileSystem, withFileSystemQuota, MemoryFileSystem, FsError } from "poe-code/safe-fs";
import type { FileSystem } from "poe-code/safe-fs";

async function reference(fs: FileSystem, path: string): Promise<string> {
  try { return await fs.realpath(path); }
  catch (error) {
    if (!(error instanceof FsError) || error.code !== "ENOENT" || path === "/") throw error;
    try { if ((await fs.lstat(path)).type === "symlink") throw error; }
    catch (linkError) {
      if (linkError === error || !(linkError instanceof FsError) || linkError.code !== "ENOENT") throw linkError;
    }
    return join(await reference(fs, dirname(path)), basename(path));
  }
}

async function fixture() {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/real/deep", { recursive: true });
  await fs.writeFile("/real/file", new Uint8Array([65]));
  await fs.mkdir("/locked", { mode: 0o600 });
  for (const [target, path] of [
    ["/real/deep", "/link"], ["/real/deep", "/existing-symlink"], ["/nope", "/dangling"],
    ["../nope", "/real/relative-dangling"], ["/dangling", "/outer"], ["/link", "/chain"],
    ["/loop", "/loop"], ["missing/../existing-symlink", "/target-dot"],
    ["/real/file", "/file-link"], ["/locked", "/locked-link"],
  ] as const) await fs.symlink(target, path);
  return fs;
}

async function outcome(operation: () => string | undefined | Promise<string>) {
  try { return { value: await operation() }; }
  catch (error) {
    assert.ok(error instanceof FsError);
    return { error: { code: error.code, path: error.path, syscall: error.syscall, message: error.message } };
  }
}

const paths = [
  "/", "/real/deep", "/link", "/link/", "/real/file", "/./", "/missing/a/b",
  "/missing/../existing-symlink", "/missing/../existing-symlink/new", "/missing/../dangling",
  "/missing/../locked/new", "/missing/../real/file/child", "/link/new/../existing-symlink",
  "/link/../new", "/chain/new", "/dangling", "/dangling/", "/dangling//", "/dangling/x",
  "/dangling//x", "/dangling/./x", "/dangling/./", "/outer/x", "/real/relative-dangling/x",
  "/target-dot", "/target-dot/", "/locked/new", "/locked-link/new", "/real/file/new",
  "/file-link/new", "/loop/x", "//link///new//child/", "/./link/new", "/link/new/.",
  "/dangling/../real", "/dangling//../real", "/missing/..", "/real/deep/../../missing",
];

for (const path of ["x/m", "x/.", "x/.."]) {
  test(`Memory missing-target preserves a one-character relative dangling ancestor: ${path}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.symlink("/absent", "/x");
    const expected = await outcome(() => reference(fs, path));
    assert.ok("error" in expected);
    assert.equal(expected.error.code, "ENOENT");
    assert.equal(expected.error.path, "x");
    assert.equal(expected.error.syscall, "realpath");
    assert.deepEqual(await outcome(() => fs.canonicalizeMissingTarget(path)), expected);
  });
}

for (const [path, failedPath, value] of [
  ["x", "x", undefined], ["x/", undefined, "/x"], ["x//m", undefined, "/x/m"],
  ["/x/m", "/x", undefined], ["//x/m", "//x", undefined],
  ["xx/m", "xx", undefined], ["./x/m", "./x", undefined],
] as const) {
  test(`Memory missing-target retains raw separator semantics around relative ancestors: ${path}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.symlink("/absent", "/x");
    await fs.symlink("/absent", "/xx");
    const expected = await outcome(() => reference(fs, path));
    if (failedPath !== undefined) {
      assert.ok("error" in expected);
      assert.equal(expected.error.code, "ENOENT");
      assert.equal(expected.error.path, failedPath);
      assert.equal(expected.error.syscall, "realpath");
    } else assert.deepEqual(expected, { value });
    assert.deepEqual(await outcome(() => fs.canonicalizeMissingTarget(path)), expected);
  });
}

for (const path of paths) {
  test(`Memory missing-target preserves the raw helper result: ${path}`, async () => {
    const fs = await fixture();
    const expected = await outcome(() => reference(fs, path));
    const operation = fs.canonicalizeMissingTarget;
    assert.equal(typeof operation, "function", "stock Memory must own the atomic operation");
    assert.ok(operation);
    const actual = await outcome(() => operation.call(fs, path));
    if (!("error" in actual)) assert.notEqual(actual.value, undefined, "stock path must not decline");
    assert.deepEqual(actual, expected);
  });
}

function countWork(fs: FileSystem) {
  const maps = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    const entries: unknown = Object.getOwnPropertyDescriptor(node, "entries")?.value;
    if (!(entries instanceof Map) || maps.has(entries)) return;
    maps.add(entries);
    for (const child of entries.values()) visit(child);
  };
  visit(Object.getOwnPropertyDescriptor(fs, "root")?.value);
  assert.ok(maps.size > 0);
  const descriptors = {
    get: Object.getOwnPropertyDescriptor(Map.prototype, "get"),
    split: Object.getOwnPropertyDescriptor(String.prototype, "split"),
    charCodeAt: Object.getOwnPropertyDescriptor(String.prototype, "charCodeAt"),
  };
  const counts = { lookups: 0, scanned: 0 };
  const get = Map.prototype.get, split = String.prototype.split, charCodeAt = String.prototype.charCodeAt;
  Object.defineProperty(Map.prototype, "get", { ...descriptors.get, value: function (this: Map<unknown, unknown>, key: unknown) {
    if (maps.has(this)) counts.lookups++;
    return Reflect.apply(get, this, [key]);
  } });
  Object.defineProperty(String.prototype, "split", { ...descriptors.split, value: function (this: string, separator: unknown, limit?: number) {
    if (separator === "/") counts.scanned += this.length;
    return Reflect.apply(split, this, [separator, limit]);
  } });
  Object.defineProperty(String.prototype, "charCodeAt", { ...descriptors.charCodeAt, value: function (this: string, offset: number) {
    counts.scanned++;
    return Reflect.apply(charCodeAt, this, [offset]);
  } });
  return { counts, restore() {
    for (const [name, descriptor] of Object.entries(descriptors)) {
      assert.ok(descriptor);
      Object.defineProperty(name === "get" ? Map.prototype : String.prototype, name, descriptor);
    }
  } };
}

for (const family of ["plain", "symlink", "dots", "opaque", "dangling", "dangling-error"] as const) {
  test(`Memory missing-target reduces resolver work for ${family} paths`, async context => {
    const rows = [];
    for (const depth of [2, 4, 5]) {
      const fs = await fixture();
      const suffix = Array.from({ length: depth }, () => "n").join("/");
      const path = family === "plain" ? `/missing/${suffix}`
        : family === "symlink" ? `/chain/new/${suffix}`
        : family === "dots" ? `//link///./new/${suffix}//`
        : family === "opaque" ? `/missing/../existing-symlink/${suffix}`
        : family === "dangling" ? `/dangling//${suffix}` : `/dangling/${suffix}`;
      const baseline = countWork(fs);
      let expected;
      try { expected = await outcome(() => reference(fs, path)); }
      finally { baseline.restore(); }
      const candidate = countWork(fs);
      let actual;
      try { actual = await outcome(() => fs.canonicalizeMissingTarget?.(path) ?? reference(fs, path)); }
      finally { candidate.restore(); }
      assert.deepEqual(actual, expected);
      rows.push({ depth, path, baseline: baseline.counts, candidate: candidate.counts });
      context.diagnostic(JSON.stringify(rows.at(-1)));
      assert.ok(candidate.counts.lookups < baseline.counts.lookups, "actual directory lookups must decrease");
      assert.ok(candidate.counts.scanned < baseline.counts.scanned, "actual pathname scanning must decrease");
    }
  });
}

test("Memory missing-target declines altered observations and preserves falsey cancellation", async () => {
  const fs = await fixture();
  const operation = fs.canonicalizeMissingTarget;
  assert.ok(operation);
  const realpath = fs.realpath.bind(fs);
  fs.realpath = async (path, options) => path === "/missing" ? Promise.reject(new FsError("ENOTSUP", { path, syscall: "realpath" })) : realpath(path, options);
  assert.equal(operation.call(fs, "/missing/child"), undefined);
  await assert.rejects(reference(fs, "/missing/child"), { code: "ENOTSUP", path: "/missing" });
  const stock = await fixture();
  for (const reason of [0, false, "", null]) {
    const controller = new AbortController();
    controller.abort(reason);
    assert.throws(() => operation.call(stock, "/missing/child", { signal: controller.signal }), error => error === reason);
  }
});

test("Memory missing-target matches small relative, slash, Unicode and suffix-fold boundaries", async () => {
  const fs = await fixture();
  await fs.mkdir("/é");
  await fs.symlink("../real/deep/../deep", "/é/link");
  const cases = ["", ".", "..", "real//deep//", "missing/../existing-symlink", "dangling//child",
    "///", "//dangling/x", "/dangling///child", "/dangling//./child", "/dangling/.//child",
    "/é/link/new", "/é/link/../new", "/missing//./../é/link", "/real/deep/./.././new",
    `/${"é".repeat(128)}`, `/missing/${"é".repeat(128)}`];
  for (const path of cases) {
    assert.deepEqual(await outcome(() => fs.canonicalizeMissingTarget(path)), await outcome(() => reference(fs, path)), path);
  }
  await fs.chmod("/", 0o600);
  for (const path of ["", "/", ".", "/missing", "//"]) {
    assert.deepEqual(await outcome(() => fs.canonicalizeMissingTarget(path)), await outcome(() => reference(fs, path)), path);
  }
});

test("Memory missing-target declines altered prototype methods, accessors and unowned receivers", async () => {
  const original = createMemoryFileSystem();
  const operation = original.canonicalizeMissingTarget;
  for (const name of ["realpath", "lstat", "resolve", "permission", "validatePath", "fail", "snapshot", "root"]) {
    const fs = createMemoryFileSystem();
    let reads = 0;
    Object.defineProperty(fs, name, { configurable: true, get() { reads++; throw new Error("must not read accessor"); } });
    assert.equal(operation.call(fs, "/missing/child"), undefined, name);
    assert.equal(reads, 0, name);
  }
  class DerivedMemory extends MemoryFileSystem {}
  assert.equal(operation.call(new DerivedMemory(), "/missing/child"), undefined);
  assert.equal(operation.call(new Proxy(original, {}), "/missing/child"), undefined);
  assert.equal(Reflect.apply(operation, Object.create(original), ["/missing/child"]), undefined);
  const descriptor = Object.getOwnPropertyDescriptor(MemoryFileSystem.prototype, "realpath");
  assert.ok(descriptor);
  try {
    Object.defineProperty(MemoryFileSystem.prototype, "realpath", { ...descriptor, value: async () => "/altered" });
    assert.equal(operation.call(original, "/missing/child"), undefined);
  } finally { Object.defineProperty(MemoryFileSystem.prototype, "realpath", descriptor); }
});

test("composed filesystems mask the backend's missing-target operation", async () => {
  const backend = await fixture();
  const views: FileSystem[] = [
    createReadOnlyFileSystem(backend),
    createMountFileSystem({ root: backend }),
    createOverlayFileSystem({ upper: createMemoryFileSystem(), lower: backend }),
    withFileSystemQuota(backend, { maxBytes: 32 }),
  ];
  for (const fs of views) {
    assert.equal(fs.canonicalizeMissingTarget, undefined);
    assert.equal(await reference(fs, "/link/new"), "/real/deep/new");
  }
});

test("Memory missing-target preserves bounded combinations of physical and opaque suffixes", async () => {
  const fs = await fixture();
  for (const prefix of ["/real/deep", "/link", "/dangling", "/outer", "/target-dot", "/locked", "/file-link", "/missing"]) {
    for (const suffix of ["", "/", "//n", "/n/..", "/../link", "//./n"]) {
      const path = prefix + suffix;
      assert.deepEqual(await outcome(() => fs.canonicalizeMissingTarget(path)), await outcome(() => reference(fs, path)), path);
    }
  }
});

test("Memory missing-target checks cancellation during the source scan without later lookups", async () => {
  const fs = await fixture();
  const controller = new AbortController();
  const check = controller.signal.throwIfAborted.bind(controller.signal);
  let checks = 0;
  controller.signal.throwIfAborted = () => {
    if (++checks === 4) controller.abort(false);
    check();
  };
  const observer = countWork(fs);
  try {
    assert.throws(() => fs.canonicalizeMissingTarget("/missing/n/n", { signal: controller.signal }), reason => reason === false);
    assert.equal(checks, 4);
    assert.equal(observer.counts.lookups, 0);
    assert.equal(observer.counts.scanned, 2);
  } finally { observer.restore(); }
});
