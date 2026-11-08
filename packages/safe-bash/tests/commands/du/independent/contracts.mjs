import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { legacyStat } from "./typed-oldstats.ts";

export async function verify({ candidate, load, run, check, results }) {
  const { createMemoryFileSystem } = await load("fs/memory/index.js");
  const { createReadOnlyFileSystem } = await load("fs/readonly/index.js");
  const { createMountFileSystem } = await load("fs/mount/index.js");
  const { createOverlayFileSystem } = await load("fs/overlay/index.js");
  const { S3FileSystem, MockS3Client } = await load("fs/s3/index.js");
  const { WebDavFileSystem } = await load("fs/webdav/index.js");
  const { MockDav } = await import(pathToFileURL(join(candidate, "tests/fs/webdav/mock.ts")).href);
  const { createDuCommand, duCommands } = await load("commands/du/index.js");
  const { standardCommands } = await load("commands/index.js");
  const { Shell } = await load("shell/index.js");
  const { FsError } = await load("contracts/index.js");
  const turn = () => new Promise(resolve => setImmediate(resolve));
  const wrap = (base, overrides = {}, calls = undefined) => new Proxy(base, { get(target, property) {
    const value = Object.hasOwn(overrides, property) ? overrides[property] : Reflect.get(target, property);
    if (typeof value !== "function") return value;
    return (...args) => {
      if (calls) {
        calls.push({ method: property, path: args[0], signal: args[1]?.signal });
        assert.ok(["lstat", "readdir"].includes(property), `forbidden DU call ${property}`);
      }
      return value.apply(target, args);
    };
  } });
  const transform = (base, change) => wrap(base, { async lstat(path, options) { return change(await base.lstat(path, options), path); } });
  const seed = async () => {
    const base = createMemoryFileSystem();
    await base.mkdir("/tree/deep", { recursive: true });
    await base.writeFile("/tree/a", new Uint8Array(3));
    await base.writeFile("/tree/deep/b", new Uint8Array(5));
    return base;
  };
  const direct = async (fs, args, options = {}, overrides = {}) => {
    const stdout = [], stderr = [];
    const context = { command: "du", args, fs, cwd: "/", env: {}, signal: new AbortController().signal,
      stdin: (async function* () { throw new Error("DU must not read stdin"); })(),
      stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
      stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } }, ...overrides };
    const result = await createDuCommand(options).execute(context);
    return { status: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
  };
  for (const [name, value] of [["missing", undefined], ["NaN", NaN], ["negative", -1], ["fractional", 0.5], ["unsafe", Number.MAX_SAFE_INTEGER + 1], ["infinite", Infinity], ["null", null]]) {
    await check(`allocation ${name} fails even for logical empty file`, async () => {
      const base = createMemoryFileSystem(); await base.writeFile("/empty", new Uint8Array());
      const fs = transform(base, stat => ({ ...stat, allocatedBytes: value }));
      const result = await run(fs, ["-cB1", "empty"]);
      assert.equal(result.status, 1); assert.equal(result.stdout, "");
      assert.match(result.stderr, /allocated bytes (unknown|invalid); total suppressed/u);
    });
  }
  await check("reported zero allocation is a valid emitted row", async () => {
    const base = createMemoryFileSystem(); await base.writeFile("/file", new Uint8Array(99));
    const result = await run(transform(base, stat => ({ ...stat, allocatedBytes: 0 })), ["-cB1", "file"]);
    assert.deepEqual(result, { status: 0, stdout: "0\tfile\n0\ttotal\n", stderr: "" });
  });
  await check("typed legacy FileStat remains unknown allocation, not zero", async () => {
    const base = createMemoryFileSystem(); await base.writeFile("/empty", new Uint8Array());
    const fs = transform(base, () => legacyStat);
    const allocated = await run(fs, ["-cB1", "empty"]);
    assert.equal(allocated.status, 1); assert.equal(allocated.stdout, ""); assert.match(allocated.stderr, /allocated bytes unknown/u);
    assert.deepEqual(await run(fs, ["-bc", "empty"]), { status: 0, stdout: "0\tempty\n0\ttotal\n", stderr: "" });
  });
  await check("partial unknown subtree retains complete siblings and suppresses totals", async () => {
    const base = await seed();
    const fs = transform(base, (stat, path) => ({ ...stat, allocatedBytes: path.endsWith("/b") ? undefined : stat.type === "directory" ? 0 : 512 }));
    const result = await run(fs, ["-acB1", "tree", "tree/a"]);
    assert.equal(result.status, 1); assert.equal(result.stdout, "512\ttree/a\n");
    assert.match(result.stderr, /"tree\/deep\/b": allocated bytes unknown/u);
  });
  await check("unknown directory allocation still traverses known descendants", async () => {
    const base = await seed();
    const result = await run(transform(base, stat => ({ ...stat, allocatedBytes: stat.type === "directory" ? undefined : 512 })), ["-acB1", "tree"]);
    assert.equal(result.status, 1); assert.equal(result.stdout, "512\ttree/a\n512\ttree/deep/b\n");
    assert.equal(result.stderr.split("allocated bytes unknown").length - 1, 2);
  });
  for (const mode of ["allocated", "apparent"]) {
    await check(`${mode} subtree overflow never publishes unsafe aggregate`, async () => {
      const base = await seed();
      const fs = transform(base, (stat, path) => ({ ...stat, size: stat.type === "directory" ? 999 : path.endsWith("/a") ? Number.MAX_SAFE_INTEGER : 1, allocatedBytes: stat.type === "directory" ? 0 : path.endsWith("/a") ? Number.MAX_SAFE_INTEGER : 1 }));
      const result = await run(fs, [mode === "apparent" ? "-bac" : "-acB1", "tree"]);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, `${Number.MAX_SAFE_INTEGER}\ttree/a\n1\ttree/deep/b\n1\ttree/deep\n`);
      assert.match(result.stderr, /aggregate exceeds safe integer range/u);
    });
  }
  await check("grand-total overflow leaves individually safe operand rows", async () => {
    const base = await seed();
    const fs = transform(base, stat => ({ ...stat, allocatedBytes: Number.MAX_SAFE_INTEGER }));
    const result = await run(fs, ["-cB1", "tree/a", "tree/deep/b"]);
    assert.equal(result.status, 1); assert.equal(result.stdout, `${Number.MAX_SAFE_INTEGER}\ttree/a\n${Number.MAX_SAFE_INTEGER}\ttree/deep/b\n`);
    assert.match(result.stderr, /"total": aggregate exceeds/u);
  });
  const sharedScope = {};
  for (const [name, identities, expected] of [
    ["trusted same scope", [{ identityScope: sharedScope, dev: 0, ino: 0 }, { identityScope: sharedScope, dev: 0, ino: 0 }], 3],
    ["distinct equal-looking scopes", [{ identityScope: {}, dev: 1, ino: 1 }, { identityScope: {}, dev: 1, ino: 1 }], 8],
    ["missing scope", [{ dev: 1, ino: 1 }, { dev: 1, ino: 1 }], 8],
    ["unknown inode", [{ identityScope: sharedScope, dev: 1 }, { identityScope: sharedScope, dev: 1 }], 8],
    ["different devices", [{ identityScope: sharedScope, dev: 1, ino: 1 }, { identityScope: sharedScope, dev: 2, ino: 1 }], 8],
    ["invalid inode", [{ identityScope: sharedScope, dev: 1, ino: -1 }, { identityScope: sharedScope, dev: 1, ino: -1 }], 8],
    ["distinct same-description symbols", [{ identityScope: Symbol("disk"), dev: 1, ino: 1 }, { identityScope: Symbol("disk"), dev: 1, ino: 1 }], 8],
  ]) {
    await check(`identity ${name}`, async () => {
      const base = await seed();
      const fs = transform(base, (stat, path) => {
        const { identityScope, dev, ino, ...rest } = stat;
        return { ...rest, ...identities[path.endsWith("/a") ? 0 : 1] };
      });
      const result = await run(fs, ["-bsc", "tree"]);
      assert.deepEqual(result, { status: 0, stdout: `${expected}\ttree\n${expected}\ttotal\n`, stderr: "" });
      const counted = await run(fs, ["-blsc", "tree"]);
      assert.equal(counted.stdout, "8\ttree\n8\ttotal\n");
    });
  }
  await check("same directory identity never prunes alternate mount namespace", async () => {
    const shared = createMemoryFileSystem(); await shared.mkdir("/dir");
    const injected = createMemoryFileSystem(); await injected.writeFile("/extra", new Uint8Array(13));
    const view = createMountFileSystem({ root: shared, mounts: { "/dir/nested": injected } });
    const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/one": shared, "/two": view } });
    assert.deepEqual(await run(mounted, ["-bsc", "/one/dir", "/two/dir"]), { status: 0, stdout: "0\t/one/dir\n13\t/two/dir\n13\ttotal\n", stderr: "" });
  });
  await check("report-depth zero still visits descendants with no reads or mutation calls", async () => {
    const base = await seed(), calls = [];
    const result = await run(wrap(base, {}, calls), ["-bcd0", "tree"]);
    assert.deepEqual(result, { status: 0, stdout: "8\ttree\n8\ttotal\n", stderr: "" });
    assert.ok(calls.some(call => call.path === "/tree/deep/b"));
    assert.ok(calls.every(call => call.signal instanceof AbortSignal));
  });
  await check("stable UTF16 order and literal NUL records independent of provider order", async () => {
    const base = createMemoryFileSystem(); await base.mkdir("/tree");
    for (const name of ["é", "z", "a\nb", "a\tb", "a", "😀"]) await base.writeFile(`/tree/${name}`, new Uint8Array(1));
    const fs = wrap(base, { async readdir(path, options) { return (await base.readdir(path, options)).reverse(); } });
    const result = await run(fs, ["-ba0", "tree"]);
    assert.equal(result.stdout, ["a", "a\tb", "a\nb", "z", "é", "😀"].map(name => `1\ttree/${name}\0`).join("") + "6\ttree\0");
    assert.equal(result.status, 0); assert.equal(result.stderr, "");
  });
  await check("parse invalid later operand option before metadata effects", async () => {
    const calls = [];
    const result = await run(wrap(await seed(), {}, calls), ["-b", "tree", "--bad"]);
    assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.deepEqual(calls, []);
  });
  await check("context own environment only, not inherited properties or ambient env", async () => {
    const base = createMemoryFileSystem(); await base.writeFile("/file", new Uint8Array(1025));
    const inherited = Object.create({ DU_BLOCK_SIZE: "bad", POSIXLY_CORRECT: "" });
    const result = await direct(base, ["--apparent-size", "file"], {}, { env: inherited });
    assert.deepEqual(result, { status: 0, stdout: "2\tfile\n", stderr: "" });
  });
  for (const [limit, value] of Object.entries({ maxArguments: 1, maxArgumentBytes: 3, maxEntries: 1, maxDirectoryEntries: 1, maxDepth: 1, maxPathBytes: 3, maxMetadataBytes: 6, maxOutputBytes: 3, maxSteps: 5 })) {
    await check(`bounded ${limit} suppresses complete total`, async () => {
      const result = await run(await seed(), ["-bac", "tree"], {}, { limits: { [limit]: value } });
      assert.equal(result.status, 1); assert.ok(!result.stdout.includes("\ttotal\n"));
      if (limit === "maxOutputBytes") assert.ok(Buffer.byteLength(result.stdout + result.stderr) <= value);
      else assert.match(result.stderr, /limit exceeded/u);
    });
  }
  await check("every bounds class rejects all invalid configured values", async () => {
    for (const name of ["maxArguments", "maxArgumentBytes", "maxEntries", "maxDirectoryEntries", "maxDepth", "maxPathBytes", "maxMetadataBytes", "maxOutputBytes", "maxSteps"]) {
      for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) assert.throws(() => createDuCommand({ limits: { [name]: value } }), /Invalid du limit/u);
    }
  });
  await check("typed filesystem failure keeps sibling and suppresses total", async () => {
    const base = await seed();
    const fs = wrap(base, { async readdir(path, options) { if (path === "/tree/deep") throw new FsError("EACCES", { path, syscall: "readdir" }); return base.readdir(path, options); } });
    const result = await run(fs, ["-bac", "tree"]);
    assert.equal(result.status, 1); assert.equal(result.stdout, "3\ttree/a\n"); assert.match(result.stderr, /permission denied.*readdir/u);
  });
  await check("preaborted errno-shaped reason is exact and cleanup registered before calls", async () => {
    const controller = new AbortController(), reason = new FsError("ENOENT"), calls = [];
    controller.abort(reason); let cleanup;
    await assert.rejects(direct(wrap(await seed(), {}, calls), ["-b", "tree"], {}, { signal: controller.signal, registerCleanup(value) { cleanup = value; } }), error => error === reason);
    assert.equal(typeof cleanup, "function"); await cleanup(); assert.deepEqual(calls, []);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
  await check("registered cleanup closes stalled metadata admission and observes late rejection", async () => {
    const base = await seed(), controller = new AbortController();
    let cleanup, entered, rejectHost, calls = 0;
    const admitted = new Promise(resolve => { entered = resolve; });
    const fs = wrap(base, { async lstat() {
      assert.equal(typeof cleanup, "function"); calls++; entered();
      return new Promise((_resolve, reject) => { rejectHost = reject; });
    } });
    const task = direct(fs, ["-b", "tree"], {}, { signal: controller.signal, registerCleanup(value) { cleanup = value; } });
    const rejected = assert.rejects(task, /invocation closed/u);
    await admitted; const first = cleanup(), second = cleanup(); assert.equal(first, second);
    await first; await rejected; rejectHost(new Error("late metadata rejection")); await turn();
    assert.equal(calls, 1); assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
  await check("awaited sink backpressure stops next metadata admission", async () => {
    const base = await seed(), calls = []; let entered, release, writes = 0;
    const admitted = new Promise(resolve => { entered = resolve; });
    const task = direct(wrap(base, {}, calls), ["-ba", "tree"], {}, { stdout: { async write() { if (++writes === 1) { entered(); await new Promise(resolve => { release = resolve; }); } } } });
    await admitted; const count = calls.length; await turn(); assert.equal(calls.length, count);
    assert.ok(!calls.some(call => call.path === "/tree/deep")); release(); assert.equal((await task).status, 0);
  });
  await check("actual Shell abort preserves reason and prevents later admission", async () => {
    const base = await seed(), controller = new AbortController(), reason = new FsError("EIO");
    let entered, rejectHost, calls = 0, forwarded;
    const admitted = new Promise(resolve => { entered = resolve; });
    const fs = wrap(base, { async lstat(_path, options) {
      calls++; forwarded = options.signal; entered();
      return new Promise((_resolve, reject) => { rejectHost = reject; });
    } });
    const shell = new Shell({ fs }).use(duCommands());
    try {
      const task = shell.exec("du -bs tree", { signal: controller.signal });
      const rejected = assert.rejects(task, error => error === reason);
      await admitted; controller.abort(reason); await rejected;
      assert.equal(forwarded.aborted, true); assert.equal(calls, 1);
      rejectHost(new Error("late independent Shell rejection")); await turn();
      assert.equal(calls, 1);
    } finally { await shell.dispose(); }
  });
  await check("actual Shell early-closed head pipeline settles and stops metadata", async () => {
    const base = createMemoryFileSystem(); await base.mkdir("/tree");
    for (let index = 0; index < 600; index++) await base.writeFile(`/tree/file-${String(index).padStart(4, "0")}`, new Uint8Array(1));
    const calls = [], shell = new Shell({ fs: wrap(base, {}, calls) }).use(duCommands()).use(standardCommands());
    try {
      const result = await shell.exec("du -ba tree | head -n 1");
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "1\ttree/file-0000\n");
      const count = calls.length; await turn(); assert.equal(calls.length, count); assert.ok(count < 602);
      results.earlyPipeline = { metadataCalls: count, fullWalkCalls: 602, result };
    } finally { await shell.dispose(); }
  });
  for (const backend of ["memory", "readonly", "mount", "overlay", "s3-mock", "dav-mock"]) {
    await check(`actual Shell ${backend} apparent success plus honest allocation refusal`, async () => {
      let base = await seed(), s3, dav;
      if (backend === "s3-mock") { s3 = new MockS3Client({ buckets: ["independent"], pageSize: 1 }); base = new S3FileSystem({ transport: s3, bucket: "independent", pageSize: 1 }); }
      if (backend === "dav-mock") { dav = new MockDav(); base = new WebDavFileSystem({ baseUrl: "https://independent.test/dav/", fetch: dav.fetch }); }
      if (s3 || dav) { await base.mkdir("/tree/deep", { recursive: true }); await base.writeFile("/tree/a", new Uint8Array(3)); await base.writeFile("/tree/deep/b", new Uint8Array(5)); }
      if (backend === "readonly") base = createReadOnlyFileSystem(base);
      if (backend === "mount") base = createMountFileSystem({ root: base, mounts: { "/other": createMemoryFileSystem() } });
      if (backend === "overlay") base = createOverlayFileSystem({ lower: base, upper: createMemoryFileSystem() });
      const beforeS3 = s3?.requests.length, beforeDav = dav?.requests.length, calls = [];
      const fs = wrap(base, {}, calls);
      assert.deepEqual(await run(fs, ["-bac", "tree"]), { status: 0, stdout: "3\ttree/a\n5\ttree/deep/b\n5\ttree/deep\n8\ttree\n8\ttotal\n", stderr: "" });
      const refused = await run(fs, ["-sc", "tree"]);
      assert.equal(refused.status, 1); assert.equal(refused.stdout, ""); assert.match(refused.stderr, /allocated bytes unknown/u);
      assert.ok(calls.every(call => call.signal instanceof AbortSignal));
      if (s3) assert.ok(s3.requests.slice(beforeS3).every(request => ["headObject", "listObjectsV2"].includes(request.operation)));
      if (dav) assert.ok(dav.requests.slice(beforeDav).every(request => request.init.method === "PROPFIND"));
      (results.providerRefusals ??= []).push({ backend, result: refused });
    });
  }
  await check("RED control detects actual Overlay internal backend mutation unchanged", async () => {
    const upper = createMemoryFileSystem(); let deny = true; const mutations = [];
    const observedUpper = wrap(upper, { async rm(path, options) { mutations.push(path); if (deny) throw new FsError("EACCES"); return upper.rm(path, options); } });
    const overlay = createOverlayFileSystem({ upper: observedUpper, lower: createMemoryFileSystem() });
    await overlay.mkdir("/tree");
    const before = (await upper.readdir("/")).map(entry => entry.name);
    assert.ok(before.some(name => name.startsWith(".virtual-bash-overlay-")));
    mutations.length = 0; deny = false; const calls = [];
    const result = await run(wrap(overlay, {}, calls), ["-bs", "tree"]);
    assert.equal(result.status, 0); assert.deepEqual(calls.map(call => call.method), ["lstat", "readdir"]);
    assert.ok(mutations.length > 0);
    const after = (await upper.readdir("/")).map(entry => entry.name);
    results.blockers.push({ property: "strict actual no backend mutations", status: "FAIL", before, after, mutations, commandCalls: calls.map(call => call.method), result, unchangedRedControl: true });
  });
}
