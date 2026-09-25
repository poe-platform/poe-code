import assert from "node:assert/strict";
import test from "node:test";
import { Shell, FsError, agentCommands, createMemoryFileSystem, createMountFileSystem, type CommandContext, type FileSystem } from "../../src/index.js";
import { run } from "./helpers.js";

const bytes = (text: string) => new TextEncoder().encode(text);

const script = "mv /source/input/a /destination/output/a";

for (const race of ["retarget", "recreate", "intermediate", "permission", "ancestor", "capture"] as const) {
  test(`cross-device mv preserves both sides after symlink resolution ${race}`, async () => {
    const { source, destination } = await fixture();
    await destination.mkdir("/links");
    await destination.symlink("../output", "/links/via");
    await destination.symlink("links/via", "/alias");
    await destination.mkdir("/other");
    await destination.writeFile("/other/a", bytes("competitor"));
    let capturing = false, mutations = 0;
    const replaceLink = async (path: string, value: string) => { await destination.rm(path); await destination.symlink(value, path); mutations++; };
    const backend = new Proxy(destination, { get(target, property) {
      if (property === "readlink" && race === "capture") return async (...args: Parameters<typeof destination.readlink>) => {
        const value = await destination.readlink(...args);
        if (capturing && args[0] === "/alias" && mutations === 0) await replaceLink("/alias", "links/via");
        return value;
      };
      if (property === "publishStagedFile") return async (...args: Parameters<typeof destination.publishStagedFile>) => {
        if (race === "retarget") await replaceLink("/alias", "other");
        else if (race === "recreate") await replaceLink("/alias", "links/via");
        else if (race === "intermediate") await replaceLink("/links/via", "../other");
        else if (race === "permission") { await destination.chmod("/links", 0o600); mutations++; }
        else if (race === "ancestor") { await destination.rename("/output", "/held"); await destination.mkdir("/output"); await destination.writeFile("/output/a", bytes("replacement")); mutations++; }
        return destination.publishStagedFile(...args);
      };
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const base = mounted(source, backend);
    const fs = new Proxy(base, { get(target, property) {
      if (property === "prepareStagingResolution") return async (...args: Parameters<NonNullable<FileSystem["prepareStagingResolution"]>>) => {
        capturing = true;
        return base.prepareStagingResolution(...args);
      };
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      const result = await shell.exec("mv /source/input/a /destination/alias/a");
      assert.equal(result.exitCode, 1, result.stderr);
      assert.match(result.stderr, race === "permission" ? /EACCES/u : /EAGAIN/u);
      assert.equal(mutations, 1);
      assert.deepEqual(await source.readFile("/input/a"), bytes("source"));
      assert.deepEqual(await destination.readFile(race === "ancestor" ? "/held/a" : "/output/a"), bytes("previous"));
      assert.deepEqual(await destination.readFile("/other/a"), bytes("competitor"));
      assert.deepEqual((await destination.readdir(race === "ancestor" ? "/held" : "/output")).map(entry => entry.name), ["a"]);
    } finally { await shell.dispose(); }
  });
}

async function fixture(shared = false, data = bytes("source")) {
  const source = createMemoryFileSystem(), destination = shared ? source : createMemoryFileSystem();
  await source.mkdir("/input");
  await source.writeFile("/input/a", data);
  await source.chmod("/input/a", 0o640);
  await source.utimes("/input/a", 1234, 5678);
  await destination.mkdir("/output");
  await destination.writeFile("/output/a", bytes("previous"));
  return { source, destination };
}

function mounted(source: FileSystem, destination: FileSystem) {
  return createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/source": source, "/destination": destination } });
}

for (const shared of [false, true]) for (const shape of ["absolute", "relative", "chain"] as const) {
  test(`cross-device mv replaces through a symlink destination parent, shared=${shared}, shape=${shape}`, async () => {
    const { source, destination } = await fixture(shared);
    if (shape === "chain") {
      await destination.mkdir("/links");
      await destination.symlink("../output", "/links/via");
    }
    const link = shape === "absolute" ? "/output" : shape === "relative" ? "output" : "links/via";
    await destination.symlink(link, "/alias");
    const shell = new Shell({ fs: mounted(source, destination) }).use(agentCommands());
    try {
      const result = await shell.exec("mv /source/input/a /destination/alias/a");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await destination.readFile("/output/a"), bytes("source"));
      assert.equal(await destination.readlink("/alias"), link);
      const stat = await destination.stat("/output/a");
      assert.equal(stat.mode & 0o7777, 0o640);
      assert.equal(stat.mtimeMs, 5678);
      await assert.rejects(source.lstat("/input/a"), { code: "ENOENT" });
      assert.deepEqual((await destination.readdir("/output")).map(entry => entry.name), ["a"]);
    } finally { await shell.dispose(); }
  });
}

for (const shared of [false, true]) for (const length of [0, 150_001]) {
  test(`cross-device mv stages an existing file with metadata, shared=${shared}, bytes=${length}`, async () => {
    const data = Uint8Array.from({ length }, (_, i) => i % 251);
    const { source, destination } = await fixture(shared, data);
    const shell = new Shell({ fs: mounted(source, destination) }).use(agentCommands());
    try {
      const result = await shell.exec("mv /source/input/a /destination/output/a");
      assert.equal(result.exitCode, 0, result.stderr);
      const stat = await destination.stat("/output/a");
      assert.equal(stat.mode & 0o7777, 0o640);
      assert.equal(stat.atimeMs, 1234);
      assert.equal(stat.mtimeMs, 5678);
      assert.deepEqual(await destination.readFile("/output/a"), data);
      await assert.rejects(source.stat("/input/a"), { code: "ENOENT" });
      assert.deepEqual((await destination.readdir("/output")).map(entry => entry.name), ["a"]);
    } finally { await shell.dispose(); }
  });
}

for (const shared of [false, true]) test(`cross-device mv replaces a distinct hardlinked target, shared=${shared}`, async () => {
  const { source, destination } = await fixture(shared);
  await destination.link("/output/a", "/output/peer");
  const before = await destination.lstat("/output/peer");
  const shell = new Shell({ fs: mounted(source, destination) }).use(agentCommands());
  try {
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await destination.readFile("/output/a")), "source");
    assert.equal(new TextDecoder().decode(await destination.readFile("/output/peer")), "previous");
    assert.equal((await destination.lstat("/output/peer")).ino, before.ino);
    assert.equal((await destination.lstat("/output/peer")).nlink, 1);
    assert.equal((await destination.lstat("/output/a")).nlink, 1);
    await assert.rejects(source.stat("/input/a"), { code: "ENOENT" });
    assert.deepEqual((await destination.readdir("/output")).map(entry => entry.name), ["a", "peer"]);
  } finally { await shell.dispose(); }
});

for (const race of ["destination", "ancestor"] as const) {
  test(`cross-device mv preserves replacements after ${race} changes at publication`, async () => {
    const { source, destination } = await fixture();
    let publications = 0;
    const view = new Proxy(destination, { get(target, key) {
      if (key === "publishStagedFile") return async (...args: Parameters<typeof destination.publishStagedFile>) => {
        publications++;
        if (race === "ancestor") {
          await destination.rename("/output", "/held");
          await destination.mkdir("/output");
        } else await destination.rename("/output/a", "/original");
        await destination.writeFile("/output/a", bytes("competitor"));
        return destination.publishStagedFile(...args);
      };
      const member = Reflect.get(target, key);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const shell = new Shell({ fs: mounted(source, view) }).use(agentCommands());
    try {
      const result = await shell.exec("mv /source/input/a /destination/output/a");
      assert.equal(result.exitCode, 1, result.stderr);
      assert.equal(publications, 1);
      assert.equal(new TextDecoder().decode(await source.readFile("/input/a")), "source");
      assert.equal(new TextDecoder().decode(await destination.readFile("/output/a")), "competitor");
      assert.equal(new TextDecoder().decode(await destination.readFile(race === "ancestor" ? "/held/a" : "/original")), "previous");
      assert.deepEqual((await destination.readdir(race === "ancestor" ? "/held" : "/output")).map(entry => entry.name), ["a"]);
    } finally { await shell.dispose(); }
  });
}

test("cross-device mv rejects same-size source mutation during retained reads before staging", async () => {
  const { source, destination } = await fixture();
  let reads = 0, closes = 0, creations = 0;
  const view = new Proxy(source, { get(target, key) {
    if (key === "openReadFile") return async (...args: Parameters<typeof source.openReadFile>) => {
      const reader = await source.openReadFile(...args);
      return { ...reader, async read(...args: Parameters<typeof reader.read>) {
        const data = await reader.read(...args);
        if (++reads === 1) await source.writeFile("/input/a", bytes("change"));
        return data;
      }, async close() { closes++; await reader.close(); } };
    };
    const member = Reflect.get(target, key);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const output = new Proxy(destination, { get(target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<typeof destination.createStagedFile>) => {
      creations++; return destination.createStagedFile(...args);
    };
    const member = Reflect.get(target, key);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const shell = new Shell({ fs: mounted(view, output) }).use(agentCommands());
  try {
    const result = await shell.exec("mv /source/input/a /destination/output/a");
    assert.equal(result.exitCode, 1, result.stderr);
    assert.ok(reads > 0);
    assert.equal(closes, 1);
    assert.equal(creations, 0);
    assert.equal(new TextDecoder().decode(await source.readFile("/input/a")), "change");
    assert.equal(new TextDecoder().decode(await destination.readFile("/output/a")), "previous");
  } finally { await shell.dispose(); }
});

for (const point of ["acquire", "read", "create", "publish", "committed"] as const) {
  test(`cross-device mv drains retained resources on cancellation at ${point}`, async () => {
    const { source, destination } = await fixture();
    const caller = new AbortController(), reason = new Error(`cancel at ${point}`);
    let closes = 0, creations = 0, publications = 0;
    const input = new Proxy(source, { get(target, key) {
      if (key === "openReadFile") return async (...args: Parameters<typeof source.openReadFile>) => {
        const reader = await source.openReadFile(...args);
        if (point === "acquire") caller.abort(reason);
        return { ...reader, async read(...args: Parameters<typeof reader.read>) {
          const chunk = await reader.read(...args);
          if (point === "read") caller.abort(reason);
          return chunk;
        }, async close() { closes++; await reader.close(); } };
      };
      const member = Reflect.get(target, key);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const output = new Proxy(destination, { get(target, key) {
      if (key === "createStagedFile") return async (...args: Parameters<typeof destination.createStagedFile>) => {
        const staging = await destination.createStagedFile(...args);
        creations++;
        if (point === "create") caller.abort(reason);
        return staging;
      };
      if (key === "publishStagedFile") return async (...args: Parameters<typeof destination.publishStagedFile>) => {
        publications++;
        if (point === "publish") caller.abort(reason);
        await destination.publishStagedFile(...args);
        if (point === "committed") caller.abort(reason);
      };
      const member = Reflect.get(target, key);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const shell = new Shell({ fs: mounted(input, output) }).use(agentCommands());
    try {
      await assert.rejects(shell.exec(script, { signal: caller.signal }), error => error === reason);
      assert.equal(closes, 1);
      assert.equal(creations, point === "acquire" || point === "read" ? 0 : 1);
      assert.equal(publications, point === "publish" || point === "committed" ? 1 : 0);
      assert.equal(new TextDecoder().decode(await source.readFile("/input/a")), "source");
      assert.equal(new TextDecoder().decode(await destination.readFile("/output/a")), point === "committed" ? "source" : "previous");
      assert.deepEqual((await destination.readdir("/output")).map(entry => entry.name), ["a"]);
    } finally { await shell.dispose(); }
  });
}

test("cross-device mv uses independently declared conditional removal and staging", async () => {
  const { source, destination } = await fixture();
  const input = new Proxy(source, { get(target, key) {
    if (key === "capabilities") return { ...source.capabilities, remove: false };
    if (key === "rm") return async () => { assert.fail("ordinary remove is unavailable"); };
    const member = Reflect.get(target, key);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const output = new Proxy(destination, { get(target, key) {
    if (key === "capabilities") return { ...destination.capabilities, copy: false, exclusiveCopy: false,
      write: false, streamingWrite: false, exclusiveCreate: false };
    if (key === "copyFile" || key === "writeFile" || key === "writeStream") return async () => { assert.fail("unbound publication is unavailable"); };
    const member = Reflect.get(target, key);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const shell = new Shell({ fs: mounted(input, output) }).use(agentCommands());
  try {
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 0, result.stderr);
    await assert.rejects(source.stat("/input/a"), { code: "ENOENT" });
    assert.equal(new TextDecoder().decode(await destination.readFile("/output/a")), "source");
  } finally { await shell.dispose(); }
});

test("cross-device mv refuses an over-budget source before reading or staging", async () => {
  const { source, destination } = await fixture();
  let reads = 0, closes = 0;
  const input = new Proxy(source, { get(target, key) {
    if (key === "openReadFile") return async (...args: Parameters<typeof source.openReadFile>) => {
      const reader = await source.openReadFile(...args);
      return { ...reader, async read() { reads++; assert.fail("over-budget source read"); }, async close() { closes++; await reader.close(); } };
    };
    const member = Reflect.get(target, key);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const shell = new Shell({ fs: mounted(input, destination), limits: { maxInputBytes: 5 } }).use(agentCommands());
  try {
    await assert.rejects(shell.exec(script), { name: "ShellLimitError", limit: "maxInputBytes" });
    assert.equal(reads, 0);
    assert.equal(closes, 1);
    assert.equal(new TextDecoder().decode(await source.readFile("/input/a")), "source");
    assert.equal(new TextDecoder().decode(await destination.readFile("/output/a")), "previous");
    assert.deepEqual((await destination.readdir("/output")).map(entry => entry.name), ["a"]);
  } finally { await shell.dispose(); }
});

for (const point of ["acquire", "create", "publish"] as const) {
  test(`cross-device mv closes admission when cleanup reenters ${point} without cancellation`, async () => {
    const { source, destination } = await fixture();
    let cleanup: (() => Promise<void>) | undefined, cleanupWork: Promise<void> | undefined;
    let closes = 0, creations = 0, publications = 0;
    const beginCleanup = () => {
      assert.ok(cleanup, "cleanup must be registered before acquisition");
      cleanupWork = cleanup();
    };
    const input = new Proxy(source, { get(target, key) {
      if (key === "openReadFile") return async (...args: Parameters<typeof source.openReadFile>) => {
        if (point === "acquire") beginCleanup();
        const reader = await source.openReadFile(...args);
        return { ...reader, async close() { closes++; await reader.close(); } };
      };
      const member = Reflect.get(target, key);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const output = new Proxy(destination, { get(target, key) {
      if (key === "createStagedFile") return async (...args: Parameters<typeof destination.createStagedFile>) => {
        creations++;
        if (point === "create") beginCleanup();
        return destination.createStagedFile(...args);
      };
      if (key === "publishStagedFile") return async (...args: Parameters<typeof destination.publishStagedFile>) => {
        publications++;
        if (point === "publish") beginCleanup();
        return destination.publishStagedFile(...args);
      };
      const member = Reflect.get(target, key);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const shell = new Shell({ fs: mounted(input, output) }).use(agentCommands());
    shell.register({ name: "driver", execute(context: CommandContext) {
      return shell.commands.get("mv")!.execute({ ...context, command: "mv", args: ["/source/input/a", "/destination/output/a"],
        registerCleanup(close) {
          cleanup = async () => { await close(); };
          context.registerCleanup!(close);
        },
      });
    } });
    try {
      const result = await shell.exec("driver");
      assert.equal(result.exitCode, 1, result.stderr);
      assert.match(result.stderr, /EBADF/u);
      await cleanupWork;
      assert.equal(closes, 1);
      assert.equal(creations, point === "acquire" ? 0 : 1);
      assert.equal(publications, point === "publish" ? 1 : 0);
      assert.equal(new TextDecoder().decode(await source.readFile("/input/a")), "source");
      assert.equal(new TextDecoder().decode(await destination.readFile("/output/a")), "previous");
      assert.deepEqual((await destination.readdir("/output")).map(entry => entry.name), ["a"]);
    } finally { await shell.dispose(); }
  });
}

test("cross-device mv closes its reader even when retained staging cleanup throws synchronously", async () => {
  const { source, destination } = await fixture(true);
  let closes = 0;
  let staging: Awaited<ReturnType<typeof destination.createStagedFile>> | undefined;
  const view = new Proxy(source, { get(target, key) {
    if (key === "rename") return async () => { throw new FsError("EXDEV"); };
    if (key === "openReadFile") return async (...args: Parameters<typeof source.openReadFile>) => {
      const reader = await source.openReadFile(...args);
      return { ...reader, async close() { closes++; await reader.close(); } };
    };
    if (key === "createStagedFile") return async (...args: Parameters<typeof destination.createStagedFile>) => {
      staging = await destination.createStagedFile(...args);
      return { ...staging, cleanup: { ...staging.cleanup!, remove() { throw new FsError("EIO", { message: "cleanup failed" }); } } };
    };
    if (key === "publishStagedFile") return async () => { throw new FsError("EACCES", { message: "publication denied" }); };
    const member = Reflect.get(target, key);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  try {
    const result = await run("mv", ["/input/a", "/output/a"], { fs: view });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(closes, 1);
    assert.equal(new TextDecoder().decode(await source.readFile("/input/a")), "source");
    assert.equal(new TextDecoder().decode(await destination.readFile("/output/a")), "previous");
  } finally { if (staging) await destination.removeStagedFile(staging); }
});

test("cross-device mv cancellation drains the admitted read before closing its reader", async () => {
  const { source } = await fixture(true);
  const caller = new AbortController(), reason = new Error("cancel pending read");
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const events: string[] = [];
  const view = new Proxy(source, { get(target, key) {
    if (key === "rename") return async () => { throw new FsError("EXDEV"); };
    if (key === "openReadFile") return async (...args: Parameters<typeof source.openReadFile>) => {
      const reader = await source.openReadFile(...args);
      return { ...reader, async read(...args: Parameters<typeof reader.read>) {
        started();
        await pending;
        events.push("read settled");
        return reader.read(...args);
      }, async close() { events.push("close"); await reader.close(); } };
    };
    const member = Reflect.get(target, key);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const execution = run("mv", ["/input/a", "/output/a"], { fs: view, signal: caller.signal });
  const outcome = assert.rejects(execution, error => error === reason);
  try {
    await ready;
    caller.abort(reason);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(events, [], "cleanup must wait for the admitted read");
  } finally { release(); await outcome; }
  assert.deepEqual(events, ["read settled", "close"]);
  assert.equal(new TextDecoder().decode(await source.readFile("/input/a")), "source");
  assert.equal(new TextDecoder().decode(await source.readFile("/output/a")), "previous");
});

test("cross-device mv omits unsupported staging metadata", async () => {
  const { source, destination } = await fixture();
  let creations = 0;
  const view = new Proxy(destination, { get(target, key) {
    if (key === "capabilities") return { ...destination.capabilities, permissions: false, timestamps: false };
    if (key === "createStagedFile") return async (...args: Parameters<typeof destination.createStagedFile>) => {
      creations++;
      const options = args[3];
      if (options.mode !== undefined || options.atimeMs !== undefined || options.mtimeMs !== undefined) throw new FsError("ENOTSUP");
      return destination.createStagedFile(...args);
    };
    const member = Reflect.get(target, key);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const shell = new Shell({ fs: mounted(source, view) }).use(agentCommands());
  try {
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(creations, 1);
    assert.equal(new TextDecoder().decode(await destination.readFile("/output/a")), "source");
    await assert.rejects(source.stat("/input/a"), { code: "ENOENT" });
  } finally { await shell.dispose(); }
});

for (const removed of [false, true]) test(`cross-device mv never stages at its destination pathname, removed=${removed}`, async () => {
  const { source, destination } = await fixture();
  await destination.rename("/output/a", "/output/.mv-1");
  const candidates: string[] = [];
  const view = new Proxy(destination, { get(target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<typeof destination.createStagedFile>) => {
      if (removed && !candidates.length) await destination.rm("/output/.mv-1");
      candidates.push(args[0]);
      return destination.createStagedFile(...args);
    };
    const member = Reflect.get(target, key);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const shell = new Shell({ fs: mounted(source, view) }).use(agentCommands());
  try {
    const result = await shell.exec("mv /source/input/a /destination/output/.mv-1");
    assert.equal(result.exitCode, removed ? 1 : 0, result.stderr);
    assert.deepEqual(candidates, ["/output/.mv-2"]);
    assert.deepEqual((await destination.readdir("/output")).map(entry => entry.name), removed ? [] : [".mv-1"]);
    if (removed) assert.equal(new TextDecoder().decode(await source.readFile("/input/a")), "source");
    else assert.equal(new TextDecoder().decode(await destination.readFile("/output/.mv-1")), "source");
  } finally { await shell.dispose(); }
});

test("cross-device mv explicitly closes retained staging cleanup after removal", async () => {
  const { source, destination } = await fixture(true);
  const events: string[] = [];
  const view = new Proxy(source, { get(target, key) {
    if (key === "rename") return async () => { throw new FsError("EXDEV"); };
    if (key === "createStagedFile") return async (...args: Parameters<typeof source.createStagedFile>) => {
      const staging = await source.createStagedFile(...args);
      return { ...staging, cleanup: {
        async remove() { events.push("remove"); await staging.cleanup!.remove(); },
        async close() { events.push("close"); await staging.cleanup!.close(); },
      } };
    };
    const member = Reflect.get(target, key);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const result = await run("mv", ["/input/a", "/output/a"], { fs: view });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(events, ["remove", "close"]);
  assert.equal(new TextDecoder().decode(await destination.readFile("/output/a")), "source");
});

for (const race of ["source-ancestor", "source-content"] as const) test(`cross-device mv rejects ${race} changes during staging before publication`, async () => {
  const { source, destination } = await fixture();
  const view = new Proxy(destination, { get(target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<typeof destination.createStagedFile>) => {
      const staging = await destination.createStagedFile(...args);
      if (race === "source-ancestor") { await source.rename("/input", "/held"); await source.mkdir("/input"); }
      await source.writeFile("/input/a", bytes("change"));
      return staging;
    };
    const member = Reflect.get(target, key);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const shell = new Shell({ fs: mounted(source, view) }).use(agentCommands());
  try {
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(new TextDecoder().decode(await source.readFile("/input/a")), "change");
    assert.equal(new TextDecoder().decode(await destination.readFile("/output/a")), "previous");
    assert.deepEqual((await destination.readdir("/output")).map(entry => entry.name), ["a"]);
  } finally { await shell.dispose(); }
});

for (const newer of [false, true]) test(`cross-device mv -u rechecks the destination after EXDEV, newer=${newer}`, async () => {
  const { source, destination } = await fixture(true);
  await destination.utimes("/output/a", 1, 1);
  let renames = 0;
  const view = new Proxy(source, { get(target, key) {
    if (key === "rename") return async () => {
      renames++;
      await destination.writeFile("/output/a", bytes("competitor"));
      await destination.utimes("/output/a", 1, newer ? 9999 : 2);
      throw new FsError("EXDEV");
    };
    const member = Reflect.get(target, key);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const result = await run("mv", ["-uv", "/input/a", "/output/a"], { fs: view });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(renames, 1);
  assert.equal(new TextDecoder().decode(await destination.readFile("/output/a")), newer ? "competitor" : "source");
  if (newer) {
    assert.equal(result.stdout, "");
    assert.equal(new TextDecoder().decode(await source.readFile("/input/a")), "source");
  } else await assert.rejects(source.stat("/input/a"), { code: "ENOENT" });
});
