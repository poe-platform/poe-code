import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";
import { FsError } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { copyCheckedSource } from "../../src/commands/copy-source.js";
import { createMountFileSystem } from "../../src/fs/mount/index.js";

for (const streaming of [false, true]) for (const command of ["cp --remove-destination", "mv"]) {
  test(`${command} replaces a looping destination symlink, streaming=${streaming}`, async () => {
    const source = await fixture({ source: "payload" });
    const destination = await fixture();
    await destination.symlink("target", "/work/target");
    const view = new Proxy(destination, { get(backing, property) {
      if (property === "capabilities") return { ...destination.capabilities, streamingWrite: streaming, write: false };
      const member = Reflect.get(backing, property);
      return typeof member === "function" ? member.bind(backing) : member;
    } });
    const fs = createMountFileSystem({ root: await fixture(), mounts: { "/source": source, "/destination": view } });
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      const result = await shell.exec(`${command} /source/work/source /destination/work/target`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal((await destination.lstat("/work/target")).type, "file");
      assert.equal(new TextDecoder().decode(await destination.readFile("/work/target")), "payload");
      if (command === "mv") await assert.rejects(source.stat("/work/source"), { code: "ENOENT" });
      else assert.equal(new TextDecoder().decode(await source.readFile("/work/source")), "payload");
    } finally { await shell.dispose(); }
  });
}

for (const streaming of [false, true]) test(`backup copy creates its replacement exclusively, streaming=${streaming}`, async () => {
  const fs = await fixture({ source: "new", target: "old" });
  let writes = 0;
  const view = new Proxy(fs, { get(backing, property) {
    if (property === "capabilities") return { ...fs.capabilities, streamingWrite: streaming, write: false };
    if (property === (streaming ? "writeStream" : "writeFile")) return async (...args: Parameters<typeof fs.writeFile> | Parameters<typeof fs.writeStream>) => {
      assert.equal(args[2]?.flag, "wx"); writes++;
      if (streaming) await fs.writeStream(...args as Parameters<typeof fs.writeStream>);
      else await fs.writeFile(...args as Parameters<typeof fs.writeFile>);
    };
    const member = Reflect.get(backing, property);
    return typeof member === "function" ? member.bind(backing) : member;
  } });
  const result = await run("cp", ["-b", "source", "target"], { fs: view });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target")), "new");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target~")), "old");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/source")), "new");
  assert.equal(writes, 1);
});

test("backup copy does not overwrite a replacement raced after backup rename", async () => {
  const fs = await fixture({ source: "new", target: "old" });
  const view = new Proxy(fs, { get(backing, property) {
    if (property === "rename") return async (...args: Parameters<typeof fs.rename>) => {
      await fs.rename(...args);
      await fs.writeFile("/work/target", new TextEncoder().encode("competitor"));
    };
    const member = Reflect.get(backing, property);
    return typeof member === "function" ? member.bind(backing) : member;
  } });
  const result = await run("cp", ["-b", "source", "target"], { fs: view });
  assert.equal(result.exitCode, 1);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target")), "competitor");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target~")), "old");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/source")), "new");
});

test("copy supports streaming overwrite independently of direct writeFile", async () => {
  const fs = await fixture({ source: "new", target: "old" });
  const view = new Proxy(fs, { get(backing, property) {
    if (property === "capabilities") return { ...fs.capabilities, write: false };
    if (property === "writeFile") return async () => { assert.fail("direct writeFile is unavailable"); };
    const member = Reflect.get(backing, property);
    return typeof member === "function" ? member.bind(backing) : member;
  } });
  const result = await run("cp", ["source", "target"], { fs: view });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target")), "new");
});

test("recursive copy resolves missing descendants through a parent symlink within its mount", async () => {
  const source = await fixture({ "tree/nested/file": "payload" });
  const destination = await fixture();
  const root = await fixture();
  await destination.symlink("/work", "/bridge");
  const view = new Proxy(root, { get(backing, property) {
    if (property === "capabilities") return { ...root.capabilities, streamingWrite: false, write: false, exclusiveCreate: false };
    const member = Reflect.get(backing, property);
    return typeof member === "function" ? member.bind(backing) : member;
  } });
  const fs = createMountFileSystem({ root: view, mounts: { "/source": source, "/destination": destination } });
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec("cp -r /source/work/tree /destination/bridge/new");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await destination.readFile("/work/new/nested/file")), "payload");
  } finally { await shell.dispose(); }
});

for (const empty of [false, true]) test(`copy supports exclusive buffered publication from retained bytes, empty=${empty}`, async () => {
  const fs = await fixture({ source: empty ? "" : "ordinary" });
  const { context } = await run("true", [], { fs });
  const expected = await fs.stat("/work/source");
  let writes = 0;
  const view = new Proxy(fs, { get(target, property) {
    if (property === "capabilities") return { ...fs.capabilities, streamingWrite: false, write: false };
    if (property === "writeStream" || property === "copyFile" || property === "readFile") return async () => { assert.fail("buffered copy must retain its reader"); };
    if (property === "writeFile") return async (...args: Parameters<typeof fs.writeFile>) => {
      assert.equal(args[2]?.flag, "wx"); writes++;
      await fs.rename("/work/source", "/work/held");
      await fs.writeFile("/work/source", new TextEncoder().encode("private"));
      await fs.writeFile(...args);
    };
    const member = Reflect.get(target, property);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  await copyCheckedSource({ ...context, fs: view }, "/work/source", "/work/new", expected, true);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/new")), empty ? "" : "ordinary");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/source")), "private");
  assert.equal(writes, 1);
});

for (const fault of ["budget", "declared-budget", "growth", "shrink", "backing", "cancel", "race"] as const) {
  test(`exclusive buffered copy preserves source and target on ${fault}`, async () => {
    const fs = await fixture({ source: "abc" });
    const { context } = await run("true", [], { fs });
    const expected = await fs.stat("/work/source");
    const controller = new AbortController(), reason = new Error("copy cancelled");
    let reads = 0, closes = 0, writes = 0;
    const view = new Proxy(fs, { get(target, property) {
      if (property === "capabilities") return { ...fs.capabilities, streamingWrite: false, write: false };
      if (property === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
        const reader = await fs.openReadFile(...args);
        return { ...reader, async read(...args: Parameters<typeof reader.read>) {
          reads++;
          if (fault === "growth") return new TextEncoder().encode("growth");
          if (fault === "shrink") return new Uint8Array();
          if (fault === "backing") return new Uint8Array(128 * 1024).subarray(0, 1);
          const bytes = await reader.read(...args);
          if (fault === "cancel") controller.abort(reason);
          return bytes;
        }, async close() { closes++; await reader.close(); } };
      };
      if (property === "writeStream" || property === "copyFile") return async () => { assert.fail("no streaming or pathname fallback"); };
      if (property === "writeFile") return async (...args: Parameters<typeof fs.writeFile>) => {
        writes++; assert.equal(args[2]?.flag, "wx");
        if (fault === "race") await fs.writeFile("/work/new", new TextEncoder().encode("competitor"));
        await fs.writeFile(...args);
      };
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const inputBudget = fault === "budget" || fault === "declared-budget"
      ? { maxBytes: 2, check(size: number) { if (fault === "budget" && size > 2) throw new FsError("EFBIG"); } } : undefined;
    await assert.rejects(copyCheckedSource({ ...context, fs: view, signal: controller.signal,
      ...(inputBudget ? { inputBudget } : {}),
    }, "/work/source", "/work/new", expected, true), fault === "cancel" ? error => error === reason
      : { code: fault === "race" ? "EEXIST" : fault === "shrink" ? "EBUSY" : "EFBIG" });
    assert.equal(writes, fault === "race" ? 1 : 0);
    if (fault === "budget" || fault === "declared-budget") assert.equal(reads, 0);
    assert.equal(closes, 1);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/source")), "abc");
    if (fault === "race") assert.equal(new TextDecoder().decode(await fs.readFile("/work/new")), "competitor");
    else await assert.rejects(fs.stat("/work/new"), { code: "ENOENT" });
  });
}

for (const command of ["cp -r", "mv"]) test(`${command} publishes a tree through exclusive-create-only targets`, async () => {
  const source = await fixture({ "tree/nested/a": "alpha", "tree/b": "beta" });
  const destination = await fixture();
  let writes = 0;
  const target = new Proxy(destination, { get(backing, property) {
    if (property === "capabilities") return { ...destination.capabilities, streamingWrite: false, write: false };
    if (property === "writeStream" || property === "copyFile") return async () => { assert.fail("buffered publication only"); };
    if (property === "writeFile") return async (...args: Parameters<typeof destination.writeFile>) => {
      assert.equal(args[2]?.flag, "wx"); writes++; await destination.writeFile(...args);
    };
    const member = Reflect.get(backing, property);
    return typeof member === "function" ? member.bind(backing) : member;
  } });
  const fs = createMountFileSystem({ root: await fixture(), mounts: { "/source": source, "/destination": target } });
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec(`${command} /source/work/tree /destination/work/tree`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await destination.readFile("/work/tree/nested/a")), "alpha");
    assert.equal(new TextDecoder().decode(await destination.readFile("/work/tree/b")), "beta");
    assert.equal(writes, 2);
    if (command === "mv") await assert.rejects(source.stat("/work/tree"), { code: "ENOENT" });
    else assert.equal(new TextDecoder().decode(await source.readFile("/work/tree/nested/a")), "alpha");
  } finally { await shell.dispose(); }
});

test("copy retains source bytes before resolving destination capabilities", async () => {
  const fs = await fixture({ source: "ordinary", target: "old" });
  const expected = await fs.stat("/work/source");
  const { context } = await run("true", [], { fs });
  const view = new Proxy(fs, { get(target, property) {
    if (property === "capabilitiesFor") return async () => {
      await fs.rename("/work/source", "/work/held");
      await fs.writeFile("/work/source", new TextEncoder().encode("private"));
      return fs.capabilities;
    };
    const member = Reflect.get(target, property);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  await copyCheckedSource({ ...context, fs: view }, "/work/source", "/work/target", expected, false);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target")), "ordinary");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/source")), "private");
});

test("copy cleanup drains destination admission and closes its retained source before publication", async () => {
  const fs = await fixture({ source: "ordinary", target: "old" });
  const { context } = await run("true", [], { fs });
  const expected = await fs.stat("/work/source");
  let cleanup!: () => Promise<void>;
  let ready!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  let opened = 0, closed = 0, writes = 0;
  const view = new Proxy(fs, { get(target, property) {
    if (property === "capabilitiesFor") return async () => { ready(); await pending; return fs.capabilities; };
    if (property === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
      opened++;
      const reader = await fs.openReadFile(...args);
      return { ...reader, async close() { closed++; await reader.close(); } };
    };
    if (property === "writeStream") return async () => { writes++; assert.fail("closed admission must not publish"); };
    const member = Reflect.get(target, property);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const copying = copyCheckedSource({ ...context, fs: view, registerCleanup(close) { cleanup = async () => { await close(); }; } },
    "/work/source", "/work/target", expected, false);
  await started;
  const closing = cleanup();
  release();
  await assert.rejects(copying, { code: "EBADF" });
  await closing;
  assert.deepEqual({ opened, closed, writes }, { opened: 1, closed: 1, writes: 0 });
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target")), "old");
});

test("exclusive copy reports an existing looping symlink without following it for capabilities", async () => {
  const backing = await fixture({ source: "ordinary" });
  await backing.symlink("target", "/work/target");
  const fs = createMountFileSystem({ root: backing });
  const { context } = await run("true", [], { fs });
  await assert.rejects(copyCheckedSource(context, "/work/source", "/work/target", await fs.stat("/work/source"), true), { code: "EEXIST" });
  assert.equal(await backing.readlink("/work/target"), "target");
  assert.equal(new TextDecoder().decode(await backing.readFile("/work/source")), "ordinary");
});

for (const command of ["cp", "mv"]) for (const existing of [false, true]) {
  const refused = command === "mv" && existing;
  test(`${command} ${refused ? "refuses unbound overwrite" : "uses retained reads and streaming writes"} when pathname copy is unavailable, existing=${existing}`, async () => {
    const fs = await fixture({ source: "ordinary", ...(existing ? { target: "old" } : {}) });
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
    const capabilities = { ...fs.capabilities, copy: false, exclusiveCopy: false };
    const operations: string[] = [];
    const view = new Proxy(fs, {
      get(target, property) {
        if (property === "capabilities") return capabilities;
        if (property === "capabilitiesFor") return async () => capabilities;
        if (property === "copyFile") return undefined;
        if (property === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
          operations.push("open");
          return fs.openReadFile(...args);
        };
        if (property === "writeStream") return async (...args: Parameters<typeof fs.writeStream>) => {
          operations.push("write");
          await fs.writeStream(...args);
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await run(command, [...command === "cp" ? ["--remove-destination"] : [], "source", "target"], { fs: view });
    assert.equal(result.exitCode, refused ? 1 : 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, refused
      ? "mv: ENOTSUP: cross-device overwrite requires atomic destination and ancestry binding '/work/source' -> '/work/target'\n" : "");
    assert.deepEqual(operations, refused ? [] : ["open", "write"]);
    assert.equal(Buffer.from(await fs.readFile("/work/target")).toString(), refused ? "old" : "ordinary");
    if (command === "mv" && !refused) await assert.rejects(fs.lstat("/work/source"), { code: "ENOENT" });
    else assert.equal(Buffer.from(await fs.readFile("/work/source")).toString(), "ordinary");
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), command === "mv" && !refused ? ["target"] : ["source", "target"]);
  });

  test(`${command} ${refused ? "refuses overwrite before swapping source ancestry" : "reads the retained file while its pathname points at private bytes"}, existing=${existing}`, async () => {
    const fs = await fixture({ "sub/a": "ordinary", "/private/a": "topsecret", ...(existing ? { "output/a": "old" } : {}) });
    if (!existing) await fs.mkdir("/work/output");
    const rename = fs.rename.bind(fs);
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
    let swaps = 0;
    const view = new Proxy(fs, {
      get(target, property) {
        if (property === "writeStream") return async (...args: Parameters<typeof fs.writeStream>) => {
          swaps++;
          await rename("/work/sub", "/work/held");
          await fs.symlink("/private", "/work/sub");
          try { await fs.writeStream(...args); }
          finally { await fs.rm("/work/sub"); await rename("/work/held", "/work/sub"); }
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const shell = new Shell({ fs: view, cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(`${command} sub/a output/a`);
      assert.equal(result.exitCode, refused ? 1 : 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, refused
        ? "mv: ENOTSUP: cross-device overwrite requires atomic destination and ancestry binding '/work/sub/a' -> '/work/output/a'\n" : "");
      assert.equal(swaps, refused ? 0 : 1);
      assert.equal(Buffer.from(await fs.readFile("/work/output/a")).toString(), refused ? "old" : "ordinary");
      assert.equal(Buffer.from(await fs.readFile("/private/a")).toString(), "topsecret");
      if (command === "mv" && !refused) await assert.rejects(fs.lstat("/work/sub/a"), { code: "ENOENT" });
      else assert.equal(Buffer.from(await fs.readFile("/work/sub/a")).toString(), "ordinary");
      assert.deepEqual(await fs.readdir("/work"), [{ name: "output", type: "directory" }, { name: "sub", type: "directory" }]);
    } finally { await shell.dispose(); }
  });

  test(`${command} ${refused ? "refuses unbound overwrite" : "avoids pathname copy"} through a transient source ancestor replacement, existing=${existing}`, async () => {
    const fs = await fixture({ "sub/a": "ordinary", "/private/a": "topsecret", ...(existing ? { "output/a": "old" } : {}) });
    if (!existing) await fs.mkdir("/work/output");
    const rename = fs.rename.bind(fs);
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
    const copy = fs.copyFile.bind(fs);
    let copies = 0;
    fs.copyFile = async (source, target, options) => {
      copies++;
      await rename("/work/sub", "/work/held");
      await fs.symlink("/private", "/work/sub");
      try { await copy(source, target, options); }
      finally { await fs.rm("/work/sub"); await rename("/work/held", "/work/sub"); }
    };
    const result = await run(command, ["sub/a", "output/a"], { fs });
    assert.equal(result.exitCode, refused ? 1 : 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, refused
      ? "mv: ENOTSUP: cross-device overwrite requires atomic destination and ancestry binding '/work/sub/a' -> '/work/output/a'\n" : "");
    assert.equal(copies, 0);
    assert.equal(Buffer.from(await fs.readFile("/work/output/a")).toString(), refused ? "old" : "ordinary");
    assert.equal(Buffer.from(await fs.readFile("/private/a")).toString(), "topsecret");
    if (command === "mv" && !refused) await assert.rejects(fs.lstat("/work/sub/a"), { code: "ENOENT" });
    else assert.equal(Buffer.from(await fs.readFile("/work/sub/a")).toString(), "ordinary");
    assert.deepEqual(await fs.readdir("/work"), [{ name: "output", type: "directory" }, { name: "sub", type: "directory" }]);
  });
}

test("copy drains and closes a reader acquired while cleanup closes admission", async () => {
  const fs = await fixture({ source: "ordinary", target: "old" });
  const { context } = await run("true", [], { fs });
  let cleanup: (() => Promise<void>) | undefined;
  let closes = 0;
  const view = new Proxy(fs, {
    get(target, property) {
      if (property === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
        void cleanup!();
        const reader = await fs.openReadFile(...args);
        return { ...reader, async close() { closes++; await reader.close(); } };
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await assert.rejects(copyCheckedSource({ ...context, fs: view, registerCleanup(close) { cleanup = async () => { await close(); }; } },
    "/work/source", "/work/target", await fs.stat("/work/source"), false), { code: "EBADF" });
  await cleanup!();
  assert.equal(closes, 1);
  assert.equal(Buffer.from(await fs.readFile("/work/target")).toString(), "old");
});

for (const command of ["cp", "mv"]) for (const existing of [false, true]) {
  const refused = command === "mv" && existing;
  test(`${command} ${refused ? "refuses overwrite before acquisition" : "rejects a changed ancestor at reader acquisition before writing bytes"}, existing=${existing}`, async () => {
    const fs = await fixture({ "sub/a": "ordinary", "/private/a": "topsecret", ...(existing ? { "output/a": "old" } : {}) });
    if (!existing) await fs.mkdir("/work/output");
    const rename = fs.rename.bind(fs);
    const acquire = fs.openReadFile.bind(fs);
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
    let acquisitions = 0;
    const view = new Proxy(fs, {
      get(target, property) {
        if (property === "openReadFile") return async (...args: Parameters<typeof acquire>) => {
          acquisitions++;
          await rename("/work/sub", "/work/held");
          await fs.symlink("/private", "/work/sub");
          try { return await acquire(...args); }
          finally { await fs.rm("/work/sub"); await rename("/work/held", "/work/sub"); }
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await run(command, ["sub/a", "output/a"], { fs: view });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, refused
      ? "mv: ENOTSUP: cross-device overwrite requires atomic destination and ancestry binding '/work/sub/a' -> '/work/output/a'\n"
      : `${command}: EBUSY: copy reader is not bound to the inspected source identity '/work/sub/a'\n`);
    assert.equal(acquisitions, refused ? 0 : 1);
    if (existing) assert.equal(Buffer.from(await fs.readFile("/work/output/a")).toString(), "old");
    else await assert.rejects(fs.lstat("/work/output/a"), { code: "ENOENT" });
    assert.equal(Buffer.from(await fs.readFile("/work/sub/a")).toString(), "ordinary");
    assert.equal(Buffer.from(await fs.readFile("/private/a")).toString(), "topsecret");
    assert.deepEqual(await fs.readdir("/work"), [{ name: "output", type: "directory" }, { name: "sub", type: "directory" }]);
  });

  test(`${command} refuses ${refused ? "unbound overwrite" : "a backend without retained readers"} without mutating entries, existing=${existing}`, async () => {
    const fs = await fixture({ source: "ordinary", ...(existing ? { target: "old" } : {}) });
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
    const view = new Proxy(fs, {
      get(target, property) {
        if (property === "openReadFile") return undefined;
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await run(command, ["source", "target"], { fs: view });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, refused
      ? "mv: ENOTSUP: cross-device overwrite requires atomic destination and ancestry binding '/work/source' -> '/work/target'\n"
      : `${command}: ENOTSUP: copy requires retained reads '/work/source'\n`);
    if (existing) assert.equal(Buffer.from(await fs.readFile("/work/target")).toString(), "old");
    else await assert.rejects(fs.lstat("/work/target"), { code: "ENOENT" });
    assert.equal(Buffer.from(await fs.readFile("/work/source")).toString(), "ordinary");
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), existing ? ["source", "target"] : ["source"]);
  });
}
