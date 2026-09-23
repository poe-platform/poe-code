import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { createMemoryFileSystem, MemoryFileSystem } from "../../src/fs/memory/index.js";
import { agentCommands } from "../../src/index.js";
import { CommandRegistry, FsError } from "../../src/contracts/index.js";
import { creationFileSystem } from "../../src/shell/umask.js";
import { createDeviceFileSystem, createMountFileSystem, createReadOnlyFileSystem, scopeFileSystem, type CapabilityQueryOptions, type FileSystem, type FileSystemCapabilities, type OpenFileOptions, type WriteFileOptions } from "@poe-code/safe-fs/core";
import { MockS3Client, S3FileSystem } from "../../src/fs/s3/index.js";

const legacyWrites = [
  { name: "writeFile", write: (fs: FileSystem, path: string, options?: WriteFileOptions) => fs.writeFile(path, new Uint8Array([1]), options) },
  { name: "appendFile", write: (fs: FileSystem, path: string, options?: WriteFileOptions) => fs.appendFile(path, new Uint8Array([1]), options) },
  { name: "writeStream", write: (fs: FileSystem, path: string, options?: WriteFileOptions) => fs.writeStream!(path, { async *[Symbol.asyncIterator]() { yield new Uint8Array([1]); } }, options) },
];

for (const operation of legacyWrites) {
  test(`legacy ${operation.name} uses generic mode capability queries`, async () => {
    const backing = createMemoryFileSystem();
    const queries: unknown[] = [];
    const fs = new Proxy(backing, { get(target, key) {
      if (key === "capabilitiesFor") return async (path: string, options: object) => {
        queries.push(path);
        assert.equal(Object.hasOwn(options, "create"), false);
        return target.capabilities;
      };
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    await operation.write(creationFileSystem(fs, 0o077), "/new");
    assert.deepEqual(queries, ["/new"]);
    assert.equal((await backing.stat("/new")).mode & 0o777, 0o600);
    assert.deepEqual(await backing.readFile("/new"), new Uint8Array([1]));
  });

  test(`legacy ${operation.name} preserves missing-target mount and device modes`, async () => {
    const backing = createMemoryFileSystem();
    const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/data": backing } });
    const fs = createDeviceFileSystem(mounted);
    await operation.write(creationFileSystem(fs, 0o077), "/data/new");
    assert.equal((await backing.stat("/new")).mode & 0o777, 0o600);
    assert.deepEqual(await fs.readFile("/data/new"), new Uint8Array([1]));
    await assert.rejects(operation.write(creationFileSystem(fs, 0o077), "/dev/null/child"), { code: "ENOTDIR" });
    await assert.rejects(backing.stat("/child"), { code: "ENOENT" });
  });

  for (const permissions of [false, undefined]) {
    test(`legacy ${operation.name} retains mode capability refusal/unknown: ${permissions}`, async () => {
      const backing = createMemoryFileSystem();
      const modes: unknown[] = [];
      const fs = new Proxy(backing, { get(target, key) {
        if (key === "capabilitiesFor") return async () => {
          const capabilities: FileSystemCapabilities = Object.fromEntries(Object.entries(target.capabilities).filter(([name]) => name !== "permissions"));
          return permissions === undefined ? capabilities : { ...capabilities, permissions };
        };
        const member: unknown = Reflect.get(target, key, target);
        if (key === operation.name) return (...args: unknown[]) => {
          modes.push((args[2] as WriteFileOptions | undefined)?.mode);
          return Reflect.apply(member as (...args: unknown[]) => unknown, target, args);
        };
        return typeof member === "function" ? member.bind(target) : member;
      } });
      await operation.write(creationFileSystem(fs, 0o077), "/new");
      assert.deepEqual(modes, [permissions === false ? undefined : 0o600]);
    });
  }

  test(`legacy ${operation.name} preserves explicit mode without querying`, async () => {
    const backing = createMemoryFileSystem();
    const fs = new Proxy(backing, { get(target, key) {
      if (key === "capabilitiesFor") return async () => { assert.fail("explicit mode must not query"); };
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    await operation.write(creationFileSystem(fs, 0o077), "/new", { mode: 0o640 });
    assert.equal((await backing.stat("/new")).mode & 0o777, 0o640);
  });

  test(`legacy ${operation.name} propagates query errors and falsey cancellation`, async () => {
    const backing = createMemoryFileSystem();
    for (const reason of [new FsError("EACCES"), null, false, 0, "", Number.NaN]) {
      const controller = new AbortController();
      const fs = new Proxy(backing, { get(target, key) {
        if (key === "capabilitiesFor") return async () => {
          if (reason instanceof FsError) throw reason;
          controller.abort(reason);
          return target.capabilities;
        };
        if (key === operation.name) return async () => { assert.fail("failed/aborted query must not write"); };
        const member: unknown = Reflect.get(target, key, target);
        return typeof member === "function" ? member.bind(target) : member;
      } });
      try {
        await operation.write(creationFileSystem(fs, 0o077), "/new", { signal: controller.signal });
        assert.fail("expected query failure");
      } catch (error) { assert.ok(Object.is(error, reason)); }
      await assert.rejects(backing.stat("/new"), { code: "ENOENT" });
    }
  });
}

for (const operation of legacyWrites.filter(operation => operation.name !== "appendFile")) for (const flag of ["wx", "ax"] as const) {
  test(`exclusive legacy mode hints carry acquisition intent: ${operation.name}/${flag}`, async () => {
    for (const permissions of [false, undefined]) {
      const backing = createMemoryFileSystem();
      const options: WriteFileOptions = { flag };
      let forwarded: WriteFileOptions | undefined;
      const fs = new Proxy(backing, { get(target, key) {
        if (key === "capabilitiesFor") return async (path: string, query: CapabilityQueryOptions) => {
          assert.equal(path, "/new");
          assert.equal(query.creation, "exclusive");
          assert.equal(Object.hasOwn(query, "create"), false);
          assert.notEqual(query, options);
          const capabilities: FileSystemCapabilities = Object.fromEntries(Object.entries(target.capabilities).filter(([name]) => name !== "permissions"));
          return permissions === undefined ? capabilities : { ...capabilities, permissions };
        };
        const member: unknown = Reflect.get(target, key, target);
        if (key === operation.name) return (...args: unknown[]) => {
          forwarded = args[2] as WriteFileOptions;
          return Reflect.apply(member as (...args: unknown[]) => unknown, target, args);
        };
        return typeof member === "function" ? member.bind(target) : member;
      } });
      await operation.write(creationFileSystem(fs, 0o077), "/new", options);
      assert.equal(forwarded?.mode, permissions === false ? undefined : 0o600);
      assert.equal(forwarded === options, permissions === false);
      assert.deepEqual(options, { flag });
      assert.deepEqual(await backing.readFile("/new"), new Uint8Array([1]));
    }
  });
}

for (const options of [
  { access: "read" }, { access: "read", creation: "never" },
  { access: "write", creation: "never" }, { access: "readwrite" },
] as const) {
  test(`noncreating open delegates untouched options: ${JSON.stringify(options)}`, async () => {
    const backing = createMemoryFileSystem();
    await backing.writeFile("/file", new Uint8Array([1]));
    let queries = 0;
    const opens: OpenFileOptions[] = [];
    const fs = new Proxy(backing, { get(target, key) {
      if (key === "capabilitiesFor") return async () => { queries++; return target.capabilities; };
      if (key === "open") return async (path: string, forwarded: OpenFileOptions) => { opens.push(forwarded); return target.open(path, forwarded); };
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const descriptor = await creationFileSystem(fs, 0o077).open!("/file", options);
    await descriptor.close();
    assert.equal(queries, 0);
    assert.deepEqual(opens, [options]);
    assert.equal(opens[0], options);
    assert.equal((await backing.stat("/file")).mode & 0o777, 0o666);
  });
}

for (const creation of ["ifMissing", "exclusive"] as const) {
  test(`creating open queries generic permission hints and masks mode: ${creation}`, async () => {
    const backing = createMemoryFileSystem();
    const queries: unknown[] = [];
    const opens: OpenFileOptions[] = [];
    const options: OpenFileOptions = { access: "write", creation };
    const fs = new Proxy(backing, { get(target, key) {
      if (key === "capabilitiesFor") return async (path: string, forwarded: object) => {
        queries.push(path);
        assert.equal(Object.hasOwn(forwarded, "create"), false);
        assert.equal(forwarded, options);
        return target.capabilities;
      };
      if (key === "open") return async (path: string, forwarded: OpenFileOptions) => { opens.push(forwarded); return target.open(path, forwarded); };
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const descriptor = await creationFileSystem(fs, 0o077).open!("/new", options);
    await descriptor.close();
    assert.deepEqual(queries, ["/new"]);
    assert.deepEqual(opens, [{ ...options, mode: 0o600 }]);
    assert.notEqual(opens[0], options);
    assert.equal(Object.hasOwn(options, "mode"), false);
    assert.equal((await backing.stat("/new")).mode & 0o777, 0o600);
  });

  for (const permissions of [false, undefined]) {
    test(`creating open preserves permissionless and unknown hints: ${creation}/${permissions}`, async () => {
      const backing = createMemoryFileSystem();
      const options: OpenFileOptions = { access: "write", creation };
      const opens: OpenFileOptions[] = [];
      const fs = new Proxy(backing, { get(target, key) {
        if (key === "capabilitiesFor") return async () => {
          const capabilities: FileSystemCapabilities = Object.fromEntries(Object.entries(target.capabilities).filter(([name]) => name !== "permissions"));
          return permissions === undefined ? capabilities : { ...capabilities, permissions };
        };
        if (key === "open") return async (path: string, forwarded: OpenFileOptions) => { opens.push(forwarded); return target.open(path, forwarded); };
        const member: unknown = Reflect.get(target, key, target);
        return typeof member === "function" ? member.bind(target) : member;
      } });
      const descriptor = await creationFileSystem(fs, 0o077).open!("/new", options);
      await descriptor.close();
      assert.equal(opens[0]!.mode, permissions === false ? undefined : 0o600);
      assert.equal(opens[0] === options, permissions === false);
      assert.equal(Object.hasOwn(options, "mode"), false);
    });
  }

  test(`creating open preserves explicit caller options without querying: ${creation}`, async () => {
    const backing = createMemoryFileSystem();
    const options: OpenFileOptions = { access: "write", creation, mode: 0o640 };
    const fs = new Proxy(backing, { get(target, key) {
      if (key === "capabilitiesFor") return async () => { assert.fail("explicit mode must not query"); };
      if (key === "open") return async (path: string, forwarded: OpenFileOptions) => { assert.equal(forwarded, options); return target.open(path, forwarded); };
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const descriptor = await creationFileSystem(fs, 0o077).open!("/new", options);
    await descriptor.close();
    assert.equal((await backing.stat("/new")).mode & 0o777, 0o640);
  });

  test(`creating open propagates query errors and falsey cancellations: ${creation}`, async () => {
    const backing = createMemoryFileSystem();
    for (const reason of [new FsError("EACCES"), null, false, 0, "", Number.NaN]) {
      const controller = new AbortController();
      const fs = new Proxy(backing, { get(target, key) {
        if (key === "capabilitiesFor") return async () => {
          if (reason instanceof FsError) throw reason;
          controller.abort(reason);
          return target.capabilities;
        };
        if (key === "open") return async () => { assert.fail("failed/aborted query must not acquire"); };
        const member: unknown = Reflect.get(target, key, target);
        return typeof member === "function" ? member.bind(target) : member;
      } });
      try {
        await creationFileSystem(fs, 0o077).open!("/new", { access: "write", creation, signal: controller.signal });
        assert.fail("expected query failure");
      } catch (error) { assert.ok(Object.is(error, reason)); }
      await assert.rejects(backing.stat("/new"), { code: "ENOENT" });
    }
    for (const reason of [null, false, 0, "", Number.NaN]) {
      const controller = new AbortController();
      controller.abort(reason);
      const fs = new Proxy(backing, { get(target, key) {
        if (key === "capabilitiesFor" || key === "open") return async () => { assert.fail("pre-abort must not query/acquire"); };
        const member: unknown = Reflect.get(target, key, target);
        return typeof member === "function" ? member.bind(target) : member;
      } });
      try {
        await creationFileSystem(fs, 0o077).open!("/new", { access: "write", creation, signal: controller.signal });
        assert.fail("expected pre-abort");
      } catch (error) { assert.ok(Object.is(error, reason)); }
    }
  });

  for (const fixture of [
    { name: "missing final", path: "/new", backend: () => createMemoryFileSystem() },
    { name: "mounted missing final", path: "/data/new", backend: () => createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/data": createMemoryFileSystem() } }) },
    { name: "missing parent", path: "/missing/new", backend: () => createMemoryFileSystem(), error: "ENOENT" },
    { name: "mounted missing parent", path: "/data/missing/new", backend: () => createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/data": createMemoryFileSystem() } }), error: "ENOENT" },
    { name: "readonly backend", path: "/new", backend: () => createReadOnlyFileSystem(createMemoryFileSystem()), error: "EROFS" },
    { name: "mounted readonly backend", path: "/data/new", backend: () => createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/data": createReadOnlyFileSystem(createMemoryFileSystem()) } }), error: "EROFS" },
    { name: "null device", path: "/dev/null", backend: () => createMemoryFileSystem(), ...(creation === "exclusive" ? { error: "EEXIST" } : {}) },
    { name: "null device child", path: "/dev/null/child", backend: () => createMemoryFileSystem(), error: "ENOTDIR" },
    { name: "device directory", path: "/dev", backend: () => createMemoryFileSystem(), error: "ENOTSUP" },
  ]) {
    test(`creating open retains actual backend authority: ${creation}/${fixture.name}`, async () => {
      const backing = fixture.backend();
      const fs = createDeviceFileSystem(backing);
      if (fixture.error) {
        await assert.rejects(creationFileSystem(fs, 0o077).open!(fixture.path, { access: "write", creation }), { code: fixture.error });
        if (fixture.name.includes("missing parent") || fixture.name.includes("readonly")) await assert.rejects(backing.stat(fixture.path), { code: "ENOENT" });
      } else {
        const descriptor = await creationFileSystem(fs, 0o077).open!(fixture.path, { access: "write", creation });
        const stat = await descriptor.stat();
        await descriptor.write(new Uint8Array([1]), null);
        await descriptor.close();
        if (fixture.name === "null device") {
          assert.equal(stat.type, "character");
          assert.equal(stat.mode & 0o777, 0o666);
          assert.deepEqual(await fs.readFile(fixture.path), new Uint8Array());
        } else {
          assert.equal(stat.mode & 0o777, 0o600);
          assert.deepEqual(await fs.readFile(fixture.path), new Uint8Array([1]));
        }
      }
    });
  }
}

for (const exclusive of [false, true]) {
  test(`Shell retains caller creating-open preflight and mode: exclusive=${exclusive}`, async context => {
    const backing = createMemoryFileSystem();
    const metadata = context.mock.method(backing, "stat");
    const queries: { create?: boolean }[] = [];
    const fs = new Proxy(backing, { get(target, key) {
      if (key === "capabilitiesFor") return async (_path: string, options: { create?: boolean }) => { queries.push(options); return target.capabilities; };
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      const result = await shell.exec(`umask 077; ${exclusive ? "set -C; " : ""}printf x >/new`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.deepEqual(metadata.mock.calls.map(call => call.arguments[0]), exclusive ? [] : ["/"]);
      assert.equal(queries.filter(options => options.create === true).length, exclusive ? 0 : 1);
      assert.equal((await backing.stat("/new")).mode & 0o777, 0o600);
      assert.deepEqual(await backing.readFile("/new"), new Uint8Array([120]));
    } finally { await shell.dispose(); }
  });
}

for (const fixture of [
  { source: ": >/dev", stderr: "shell: line 1: /dev: Permission denied\n", exitCode: 1 },
  { source: "set -C; : >/dev", stderr: "shell: line 1: ENOTSUP: exclusive creation is not supported, write '/dev'\n", exitCode: 1 },
  { source: ": >/dev/null", stderr: "", exitCode: 0 },
  { source: "set -C; : >/dev/null", stderr: "shell: line 1: /dev/null: cannot overwrite existing file\n", exitCode: 1 },
  { source: ": >/dev/null/child", stderr: "shell: line 1: /dev/null/child: Not a directory\n", exitCode: 1 },
  { source: "set -C; : >/dev/null/child", stderr: "shell: line 1: /dev/null/child: Not a directory\n", exitCode: 1 },
]) {
  test(`Shell preserves device diagnostic ordering: ${fixture.source}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() });
    try {
      const result = await shell.exec(fixture.source);
      assert.equal(result.exitCode, fixture.exitCode);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, fixture.stderr);
    } finally { await shell.dispose(); }
  });
}

test("noncreating open preserves falsey pre-abort without querying or opening", async () => {
  const backing = createMemoryFileSystem();
  for (const reason of [null, false, 0, "", Number.NaN]) {
    const controller = new AbortController();
    controller.abort(reason);
    const fs = new Proxy(backing, { get(target, key) {
      if (key === "capabilitiesFor" || key === "open") return async () => { assert.fail("aborted open must not call host"); };
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    try { await creationFileSystem(fs, 0o077).open!("/file", { access: "read", signal: controller.signal }); assert.fail("expected cancellation"); }
    catch (error) { assert.ok(Object.is(error, reason)); }
  }
});

for (const mode of [0o755, 0o711]) for (const symlink of [false, true]) {
  test(`umask preserves existing implicit recursive mkdir options: ${mode.toString(8)}/${symlink}`, async () => {
    const backing = createMemoryFileSystem();
    await backing.mkdir("/existing", { mode });
    if (symlink) await backing.symlink("/existing", "/alias");
    const calls: { path: string; mode?: number; recursive?: boolean }[] = [];
    const fs = new Proxy(backing, {
      get(target, key) {
        if (key === "capabilities") return { ...target.capabilities, implicitDirectories: true };
        if (key === "capabilitiesFor") return undefined;
        if (key === "mkdir") return async (path: string, options: { mode?: number; recursive?: boolean }) => {
          calls.push({ path, ...options });
          return target.mkdir(path, options);
        };
        const member: unknown = Reflect.get(target, key, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      const path = symlink ? "/alias" : "/existing";
      const result = await shell.exec(`umask 077; mkdir -pv -m700 ${path}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.path, path);
      assert.equal(calls[0]!.recursive, true);
      assert.equal(calls[0]!.mode, undefined);
      assert.equal((await backing.stat("/existing")).mode & 0o777, mode);
    } finally { await shell.dispose(); }
  });
}

test("umask recursive mkdir admits missing paths only for typed ENOENT", async () => {
  const backing = createMemoryFileSystem();
  await creationFileSystem(backing, 0o077).mkdir("/new", { recursive: true });
  assert.equal((await backing.stat("/new")).mode & 0o777, 0o700);
  for (const reason of [new FsError("EACCES", { path: "/blocked" }), { code: "ENOENT" }]) {
    let calls = 0;
    const fs = new Proxy(backing, {
      get(target, key) {
        if (key === "stat") return async () => { throw reason; };
        if (key === "mkdir") return async () => { calls++; };
        const member: unknown = Reflect.get(target, key, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    await assert.rejects(creationFileSystem(fs, 0o077).mkdir("/blocked", { recursive: true }), error => error === reason);
    assert.equal(calls, 0);
  }
});

test("umask recursive mkdir propagates falsey cancellation after existence lookup", async () => {
  const backing = createMemoryFileSystem();
  await backing.mkdir("/existing", { mode: 0o711 });
  for (const reason of [null, false, 0, "", Number.NaN]) {
    const controller = new AbortController();
    let calls = 0;
    const fs = new Proxy(backing, {
      get(target, key) {
        if (key === "stat") return async (...args: Parameters<typeof target.stat>) => {
          const result = await target.stat(...args);
          controller.abort(reason);
          return result;
        };
        if (key === "mkdir") return async () => { calls++; };
        const member: unknown = Reflect.get(target, key, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    try {
      await creationFileSystem(fs, 0o077).mkdir("/existing", { recursive: true, signal: controller.signal });
      assert.fail("expected caller cancellation");
    } catch (error) { assert.ok(Object.is(error, reason)); }
    assert.equal(calls, 0);
  }
});

for (const pathOverride of [false, true]) {
  test(`umask omits implicit modes for permissionless adapters: path override=${pathOverride}`, async () => {
    const backing = createMemoryFileSystem();
    const modes: unknown[] = [];
    const fs = new Proxy(backing, {
      get(target, key) {
        if (key === "capabilities") return { ...target.capabilities, permissions: pathOverride };
        if (key === "capabilitiesFor") return async () => ({ ...target.capabilities, permissions: false });
        const member: unknown = Reflect.get(target, key, target);
        if (typeof member !== "function") return member;
        if (["writeFile", "appendFile", "mkdir", "open"].includes(String(key))) return (...args: unknown[]) => {
          const index = key === "writeFile" || key === "appendFile" ? 2 : 1;
          const options = args[index] as { mode?: number } | undefined;
          modes.push(options?.mode);
          assert.equal(options?.mode, undefined, `${String(key)} must not imply permissions`);
          return Reflect.apply(member, target, args);
        };
        return member.bind(target);
      },
    });
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      const result = await shell.exec("umask 077; touch file; mkdir dir; echo hi >redirect; echo hi >>append");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(new TextDecoder().decode(await backing.readFile("/redirect")), "hi\n");
      assert.ok(modes.length >= 4);
    } finally { await shell.dispose(); }
  });
}

test("umask preserves explicit creation modes on permissionless adapters", async () => {
  const backing = createMemoryFileSystem();
  const fs = new Proxy(backing, {
    get(target, key) {
      if (key === "capabilities") return { ...target.capabilities, permissions: false };
      if (key === "capabilitiesFor") return async () => ({ ...target.capabilities, permissions: false });
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  await creationFileSystem(fs, 0o077).mkdir("/explicit", { mode: 0o755 });
  assert.equal((await backing.stat("/explicit")).mode & 0o777, 0o755);
});

test("umask creation views preserve known comparison peers and leave unknown peers opaque", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/source", new Uint8Array([1]));
  await fs.writeFile("/target", new Uint8Array([2]));
  const compare = fs.compareEntry.bind(fs);
  const peers: unknown[] = [];
  fs.compareEntry = async (path, peer, peerPath, options) => {
    peers.push(peer);
    return compare(path, peer, peerPath, options);
  };
  const first = creationFileSystem(fs, 0o077);
  const second = creationFileSystem(fs, 0o022);
  assert.equal(await first.compareEntry!("/source", second, "/target"), "distinct");
  assert.equal(await first.compareEntry!("/source", first, "/source"), "same");
  const opaquePeer = createMemoryFileSystem();
  await opaquePeer.writeFile("/target", new Uint8Array([3]));
  assert.equal(await first.compareEntry!("/source", opaquePeer, "/target"), "distinct");
  assert.equal(peers.length, 3);
  assert.equal(peers[0], second);
  assert.equal(peers[1], first);
  assert.equal(peers[2], opaquePeer);
});

test("umask views preserve provider authority in both directions through nested scoped views", async () => {
  const fs = new S3FileSystem({ transport: new MockS3Client({ buckets: ["bucket"] }), bucket: "bucket" });
  await fs.writeFile("/source", new Uint8Array([1]));
  await fs.writeFile("/target", new Uint8Array([2]));
  assert.equal((await fs.stat("/source")).identityScope, undefined);
  const first = creationFileSystem(fs, 0o022);
  const nested = creationFileSystem(first, 0o077);
  const controller = new AbortController();
  let operations = 0;
  const scoped = scopeFileSystem(nested, () => { operations++; }, controller.signal);
  for (const view of [first, nested, scoped]) {
    assert.equal(await view.compareEntry!("/source", view, "/target"), "distinct");
    assert.equal(await fs.compareEntry("/source", view, "/target"), "distinct");
    assert.equal(await view.compareEntry!("/source", fs, "/source"), "same");
    assert.equal(await fs.compareEntry("/source", view, "/source"), "same");
  }
  assert.ok(operations > 0);
  const opaque = new Proxy(fs, {
    get(target, key) {
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  assert.equal(await first.compareEntry!("/source", opaque, "/target"), "unknown");
  assert.equal(await fs.compareEntry("/source", opaque, "/source"), "unknown");
});

test("umask comparison forwarding preserves cancellation reason identity", async () => {
  const fs = createMemoryFileSystem();
  fs.compareEntry = async (_path, _peer, _peerPath, options) => {
    options?.signal?.throwIfAborted();
    return "unknown";
  };
  const view = creationFileSystem(fs, 0o022);
  for (const reason of [null, false, 0, "", NaN]) {
    const controller = new AbortController();
    controller.abort(reason);
    await assert.rejects(view.compareEntry!("/source", view, "/target", { signal: controller.signal }), error => Object.is(error, reason));
  }
});

import { spawnSync } from "node:child_process";

test("umask masks new files, directories and redirects without changing existing modes", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  const result = await shell.exec("umask 077; touch file; mkdir dir; echo hi >redirect; echo hi >>append; umask");
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "0077\n");
  for (const path of ["/file", "/redirect", "/append"]) assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
  assert.equal((await fs.stat("/dir")).mode & 0o777, 0o700);
  await fs.chmod("/file", 0o644);
  await shell.exec("umask 077; echo changed >file");
  assert.equal((await fs.stat("/file")).mode & 0o777, 0o644);
});

test("umask is inherited by children and isolated between executions", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  const result = await shell.exec("umask 077; (umask; umask 022); umask; sh -c 'umask'; echo \"$(umask)\"");
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "0077\n0077\n0077\n0077\n");
  assert.equal((await shell.exec("umask")).stdout, "0022\n");
});

test("umask supports symbolic modes and reusable output, and rejects invalid input", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  const result = await shell.exec("umask 077; umask -S; umask -p; umask u=rwx,g=rx,o=; umask");
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "u=rwx,g=,o=\numask 0077\n0027\n");
  assert.equal((await shell.exec("umask 088")).exitCode, 1);
  assert.equal((await shell.exec("umask 077; umask -pS")).stdout, "umask -S u=rwx,g=,o=\n");
});

test("umask reaches sequential-only redirect adapters and respects explicit mkdir modes", async () => {
  const fs = createMemoryFileSystem();
  const sequential = new Proxy(fs, {
    get(target, key) {
      if (key === "capabilities") return { ...target.capabilities, open: false, randomAccessWrite: false };
      if (key === "capabilitiesFor" || key === "open") return undefined;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const shell = new Shell({ fs: sequential }).use(agentCommands());
  const result = await shell.exec("umask 077; echo hi >out; echo hi >>app; mkdir -m 755 explicit");
  assert.equal(result.stderr, "");
  assert.equal((await fs.stat("/out")).mode & 0o777, 0o600);
  assert.equal((await fs.stat("/app")).mode & 0o777, 0o600);
  assert.equal((await fs.stat("/explicit")).mode & 0o777, 0o755);
});

test("literal command invocation inherits the mask without affecting concurrent executions", async () => {
  const fs = createMemoryFileSystem();
  const commands = new CommandRegistry();
  commands.register({ name: "child", async execute(context) {
    return context.invoke!("sh", ["-c", "touch child-file; umask 022"]);
  } });
  const shell = new Shell({ fs, commands }).use(agentCommands());
  const results = await Promise.all([
    shell.exec("umask 077; child; touch private-file; umask"),
    shell.exec("umask 002; touch shared-file; umask"),
  ]);
  assert.deepEqual(results.map(result => result.stderr), ["", ""]);
  assert.deepEqual(results.map(result => result.stdout), ["0077\n", "0002\n"]);
  for (const path of ["/child-file", "/private-file"]) assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
  assert.equal((await fs.stat("/shared-file")).mode & 0o777, 0o664);
});

test("umask controls new files, directories and redirections without changing existing modes", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/existing", new Uint8Array(), { mode: 0o640 });
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec("umask 077; umask; touch created; mkdir directory; echo data > redirected; echo more >> appended; echo replace > existing; stat -c %a created directory redirected appended existing");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "0077\n600\n700\n600\n600\n640\n");
  } finally { await shell.dispose(); }
});

test("umask is inherited by children and reset between concurrent invocations", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec("umask 077; (umask 027; umask); echo $(umask); bash -c 'umask; umask 002'; umask; umask 002 | cat; umask; f() { umask 007; }; f; umask");
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "0027\n0077\n0077\n0077\n0077\n0007\n");
    const results = await Promise.all([shell.exec("umask 077; touch private; umask"), shell.exec("umask; touch normal")]);
    assert.deepEqual(results.map(result => result.stdout), ["0077\n", "0022\n"]);
    assert.deepEqual(results.map(result => result.stderr), ["", ""]);
    assert.equal((await fs.stat("/private")).mode & 0o777, 0o600);
    assert.equal((await fs.stat("/normal")).mode & 0o777, 0o644);
  } finally { await shell.dispose(); }
});

test("umask supports symbolic forms and printable output; invalid masks preserve state", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec("umask 077; umask -S; umask -p; umask u=rwx,g=rx,o=; umask; umask g+w,o+r; umask; umask 089; echo $?; umask");
    assert.equal(result.stdout, "u=rwx,g=,o=\numask 0077\n0027\n0003\n1\n0003\n");
    assert.match(result.stderr, /umask:/u);
    assert.equal((await shell.exec("type umask")).stdout, "umask is a shell builtin\n");
    assert.equal((await shell.exec("umask -z")).exitCode, 2);
  } finally { await shell.dispose(); }
});

test("umask output and symbolic operations agree with Bash", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  try {
    for (const source of [
      "umask 022; umask; umask -S; umask -p; umask -pS",
      "umask 077; umask -S 027; umask; umask -pS 002",
      "umask 027; umask g=rwx,o=; umask; umask u-x,g+w,o=r; umask",
      "umask 7777; umask; umask a=rw; umask; umask -- 002; umask",
      "umask 022; umask u=,g=,o=; umask; umask a+r,a-w,a+x; umask",
    ]) {
      const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
      assert.ifError(native.error);
      const result = await shell.exec(source);
      assert.equal(result.stdout, native.stdout, source);
      assert.equal(result.stderr, native.stderr, source);
      assert.equal(result.exitCode, native.status, source);
    }
  } finally { await shell.dispose(); }
});

test("nested SDK invocations inherit masks without changing the caller", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  shell.commands.register({ name: "child", async execute(context) {
    assert.ok(context.invoke);
    await context.invoke("touch", ["nested"]);
    return context.invoke("umask", ["002"]);
  } });
  try {
    const result = await shell.exec("umask 077; child; umask");
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "0077\n");
    assert.equal((await fs.stat("/nested")).mode & 0o777, 0o600);
  } finally { await shell.dispose(); }
});


test("umask retains symbolic permission copies and multiple operations", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  try {
    const result = await shell.exec("umask 027; umask u=g,g=o,o=u; umask; umask u+rw-w+rx,g=r; umask");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "0272\n0232\n");
  } finally { await shell.dispose(); }
});
