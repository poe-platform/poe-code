import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Volume } from "memfs";
import { CommandRegistry, createCommandArguments, FsError, toByteSource, type CommandContext, type FileStat, type FileSystem, type InvocationCleanup } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { PublicDiagnostic } from "../../src/diagnostics.js";
import { Shell } from "../../src/shell/index.js";
import { truncateCommand } from "../../src/commands/truncate.js";
import type { MetadataCommandsOptions } from "../../src/commands/metadata/internal.js";

function fixture() {
  const volume = Volume.fromJSON({ "/work/target": "abcdef", "/work/reference": "1234567", "/work/directory": null });
  volume.linkSync("/work/target", "/work/alias");
  volume.symlinkSync("target", "/work/symlink");
  volume.symlinkSync("referent", "/work/dangling");
  const filesystem: FileSystem = new MemoryFileSystem();
  Object.defineProperty(filesystem, "capabilities", { value: { ...filesystem.capabilities, retainedResize: true } });
  const convert = (error: unknown): never => { throw new FsError((error as FsError).code); };
  const ignoredInitialStat = volume.statSync("/work/target");
  const snapshot = (stat: typeof ignoredInitialStat): FileStat => ({
    type: stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "symlink", size: Number(stat.size),
    preferredIoBlockSize: 4096, mode: Number(stat.mode), atimeMs: Number(stat.atimeMs), mtimeMs: Number(stat.mtimeMs), ctimeMs: Number(stat.ctimeMs), ino: Number(stat.ino),
  });
  filesystem.stat = async (path, options = {}) => {
    options.signal?.throwIfAborted();
    try { return snapshot(volume.statSync(path)); } catch (error) { return convert(error); }
  };
  filesystem.lstat = async (path, options = {}) => {
    options.signal?.throwIfAborted();
    try {
      const stat = volume.lstatSync(path);
      return { ...snapshot(stat), ...(stat.isSymbolicLink() ? { type: "symlink" as const, size: Buffer.byteLength(volume.readlinkSync(path, { encoding: "utf8" })) } : {}) };
    } catch (error) { return convert(error); }
  };
  filesystem.access = async (path, mode = 0, options = {}) => {
    options.signal?.throwIfAborted();
    try { volume.accessSync(volume.realpathSync(path), mode); } catch (error) { convert(error); }
  };
  filesystem.realpath = async (path, options = {}) => {
    options.signal?.throwIfAborted();
    try { return volume.realpathSync(path).toString(); } catch (error) { return convert(error); }
  };
  filesystem.readlink = async (path, options = {}) => {
    options.signal?.throwIfAborted();
    try { return volume.readlinkSync(path, { encoding: "utf8" }).toString(); } catch (error) { return convert(error); }
  };
  filesystem.openResizeFile = async (path, options = {}) => {
    let descriptor: number;
    try {
      if (path.endsWith("/")) {
        if (options.create) throw new FsError("EISDIR");
        if (!volume.statSync(path).isDirectory()) throw new FsError("ENOTDIR");
      }
      let resolved = path;
      for (let links = 0; links <= 40; links++) {
        let stat: typeof ignoredInitialStat;
        try { stat = volume.lstatSync(resolved); }
        catch (error) { if ((error as FsError).code === "ENOENT") break; throw error; }
        if (!stat.isSymbolicLink()) break;
        if (links === 40) throw new FsError("ELOOP");
        const target = volume.readlinkSync(resolved, { encoding: "utf8" }).toString();
        resolved = target.startsWith("/") ? target : resolved.slice(0, resolved.lastIndexOf("/") + 1) + target;
      }
      descriptor = volume.openSync(resolved, 1 | (options.create ? 64 : 0), options.mode ?? 0o666);
    }
    catch (error) { return convert(error); }
    let closing: Promise<void> | undefined;
    return {
      async stat() { try { return snapshot(volume.fstatSync(descriptor)); } catch (error) { return convert(error); } },
      async truncate(length) { try { volume.ftruncateSync(descriptor, length); } catch (error) { convert(error); } },
      close() { return closing ??= Promise.resolve().then(() => { volume.closeSync(descriptor); }); },
    };
  };
  const originalInode = volume.statSync("/work/target").ino;
  const effects = () => {
    const result: Record<string, unknown> = {};
    for (const name of ["target", "reference", "alias", "symlink", "dangling", "referent", "new", "-"]) {
      try {
        const stat = volume.lstatSync(`/work/${name}`);
        result[name] = { type: stat.isFile() ? "file" : "symlink", size: stat.isSymbolicLink() ? Buffer.byteLength(volume.readlinkSync(`/work/${name}`, { encoding: "utf8" })) : Number(stat.size), sameOriginalInode: stat.ino === originalInode,
          ...(stat.isFile() ? { dataHex: Buffer.from(volume.readFileSync(`/work/${name}`)).subarray(0, 8192).toString("hex") } : {}) };
      } catch (error) { if ((error as FsError).code !== "ENOENT") throw error; }
    }
    return result;
  };
  return { fs: filesystem, volume, effects };
}

test("truncate fixture metadata resolves the same memfs entries as retained acquisition", async () => {
  const setup = fixture();
  for (const path of ["/", "/work", "/work/target", "/work/alias", "/work/directory"]) {
    assert.deepEqual(await setup.fs.lstat!(path), await setup.fs.stat(path));
    await setup.fs.access(path);
    assert.equal(await setup.fs.realpath(path), path);
  }
  const link = await setup.fs.lstat!("/work/symlink");
  assert.equal(link.type, "symlink");
  assert.equal(link.size, Buffer.byteLength("target"));
  assert.equal(await setup.fs.readlink!("/work/symlink"), "target");
  assert.equal(await setup.fs.realpath("/work/symlink"), "/work/target");
  assert.equal((await setup.fs.stat("/work/symlink")).ino, (await setup.fs.stat("/work/target")).ino);
  const handle = await setup.fs.openResizeFile!("/work/symlink");
  try { assert.deepEqual(await handle.stat(), await setup.fs.stat("/work/target")); }
  finally { await handle.close(); }
});

test("truncate fixture metadata follows memfs replacement and dangling-link creation", async () => {
  const setup = fixture();
  const original = await setup.fs.stat("/work/target");
  setup.volume.renameSync("/work/target", "/work/old");
  setup.volume.writeFileSync("/work/target", "replacement");
  assert.notEqual((await setup.fs.lstat!("/work/target")).ino, original.ino);
  assert.equal((await setup.fs.lstat!("/work/old")).ino, original.ino);
  assert.equal(await setup.fs.realpath("/work/symlink"), "/work/target");
  assert.equal(await setup.fs.readlink!("/work/dangling"), "referent");
  await assert.rejects(setup.fs.access("/work/dangling"), error => error instanceof FsError && error.code === "ENOENT");
  setup.volume.writeFileSync("/work/referent", "created");
  await setup.fs.access("/work/dangling");
  assert.equal(await setup.fs.realpath("/work/dangling"), "/work/referent");
  assert.equal((await setup.fs.stat("/work/dangling")).size, 7);
});

test("truncate fixture metadata preserves falsey cancellation before resolution", async () => {
  const setup = fixture();
  const controller = new AbortController();
  controller.abort(false);
  const options = { signal: controller.signal };
  for (const operation of [
    () => setup.fs.stat("/work/target", options),
    () => setup.fs.lstat!("/work/target", options),
    () => setup.fs.access("/work/target", 0, options),
    () => setup.fs.realpath("/work/target", options),
    () => setup.fs.readlink!("/work/symlink", options),
  ]) await assert.rejects(operation(), error => error === false);
});

async function resize(args: readonly string[], overrides: Partial<CommandContext> = {}, options: MetadataCommandsOptions = {}) {
  const setup = fixture();
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "truncate", args, cwd: "/work", env: { LC_ALL: "C" }, fs: setup.fs,
    stdin: { [Symbol.asyncIterator]() { throw new Error("truncate must not acquire stdin"); } },
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
    signal: new AbortController().signal, ...overrides,
  };
  const result = await truncateCommand(options).execute(context);
  return { exitCode: result.exitCode, stdoutHex: Buffer.concat(stdout).toString("hex"), stderrHex: Buffer.concat(stderr).toString("hex"), effects: setup.effects() };
}

interface NativeCase {
  name: string; args: string[]; env: Record<string, string>; stdoutHex: string; stderrHex: string; exitCode: number; effects: Record<string, unknown>;
}
const native = (JSON.parse(readFileSync(new URL("./truncate-native.snapshot.json", import.meta.url), "utf8")) as { cases: NativeCase[] }).cases;
for (const entry of native) {
  if (entry.args.includes("--version")) continue;
  test(`truncate GNU 8.30 ${entry.name}`, async () => {
    assert.deepEqual(await resize(entry.args, { env: { LC_ALL: "C", ...entry.env } }), {
      stdoutHex: entry.stdoutHex, stderrHex: entry.stderrHex, exitCode: entry.exitCode, effects: entry.effects,
    });
  });
}

test("truncate identifies the virtual implementation without claiming GNU authorship", async () => {
  assert.equal(Buffer.from((await resize(["--version"])).stdoutHex, "hex").toString(), "truncate (virtual-bash)\n");
});

for (const readonly of [false, true]) for (const option of ["--help", "--version"]) {
  test(`truncate Shell ${option} remains callable without retained resize: readonly=${readonly}`, async () => {
    const setup = fixture();
    Object.defineProperty(setup.fs, "capabilities", { value: { readOnly: readonly, retainedResize: false } });
    setup.fs.capabilitiesFor = async () => { throw new Error("informational command must not query target capabilities"); };
    setup.fs.openResizeFile = async () => { throw new Error("informational command must not acquire a resize handle"); };
    const shell = new Shell({ fs: setup.fs, commands: new CommandRegistry([truncateCommand()]) });
    try {
      const result = await shell.exec(`truncate ${option}`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      if (option === "--version") assert.equal(result.stdout, "truncate (virtual-bash)\n");
      else assert.ok(result.stdout.startsWith("Usage: truncate OPTION... FILE...\n"));
    } finally { await shell.dispose(); }
  });
}

test("truncate configured default umask applies only to creation", async () => {
  const setup = fixture();
  setup.volume.chmodSync("/work/target", 0o620);
  assert.equal((await resize(["-s1", "target", "new"], { fs: setup.fs })).exitCode, 0);
  assert.equal(Number(setup.volume.statSync("/work/new").mode) & 0o777, 0o644);
  assert.equal(Number(setup.volume.statSync("/work/target").mode) & 0o777, 0o620);
});

test("truncate configured settings reject invalid metadata options synchronously", () => {
  for (const options of [{ umask: -1 }, { umask: 0o1000 }, { umask: 0.5 },
    { limits: { maxEntries: 0 } }, { limits: { maxOutputBytes: Infinity } },
    { limits: { maxArgumentBytes: NaN } }, { limits: { maxDepth: -1 } },
    { limits: { maxAttempts: 0 } }]) assert.throws(() => truncateCommand(options), RangeError);
});

for (const noCreate of [false, true]) test(`truncate configured creation intent reaches capability query: ${noCreate}`, async () => {
  const setup = fixture();
  const queries: boolean[] = [], acquisitions: boolean[] = [];
  const open = setup.fs.openResizeFile!.bind(setup.fs);
  setup.fs.capabilitiesFor = async (_path, options) => {
    queries.push(options?.create === true);
    return setup.fs.capabilities;
  };
  setup.fs.openResizeFile = async (path, options) => { acquisitions.push(options?.create === true); return open(path, options); };
  assert.equal((await resize([...(noCreate ? ["-c"] : []), "-s1", "target"], { fs: setup.fs })).exitCode, 0);
  assert.deepEqual(queries, [!noCreate]);
  assert.deepEqual(acquisitions, [!noCreate]);
});

for (const kind of ["duplicate", "failed", "no-create"] as const) test(`truncate configured entries count every ${kind} target attempt`, async () => {
  const setup = fixture();
  const open = setup.fs.openResizeFile!.bind(setup.fs);
  const acquired: string[] = [];
  let references = 0;
  const stat = setup.fs.stat.bind(setup.fs);
  setup.fs.stat = async (path, options) => { references++; return stat(path, options); };
  setup.fs.openResizeFile = async (path, options) => {
    acquired.push(path);
    if (kind === "failed") throw new FsError("EACCES");
    return open(path, options);
  };
  const target = kind === "no-create" ? "absent" : "target";
  const result = await resize([...(kind === "no-create" ? ["-c"] : []), "-r", "reference", target, target], { fs: setup.fs }, { limits: { maxEntries: 1, maxDepth: 0, maxAttempts: 1 } });
  assert.equal(result.exitCode, 1);
  assert.ok(Buffer.from(result.stderrHex, "hex").toString().endsWith("truncate: entry limit exceeded\n"));
  assert.deepEqual(acquired, [`/work/${target}`]);
  assert.equal(references, 1);
  assert.equal(setup.volume.statSync("/work/target").size, kind === "duplicate" ? 7 : 6);
  assert.equal(setup.volume.existsSync("/work/absent"), false);
});

for (const raw of [false, true]) test(`truncate configured argument bytes admitted before materialization: raw=${raw}`, async () => {
  const setup = fixture();
  const argumentValues = createCommandArguments([shellValueFromBytes(Uint8Array.of(45, 115, 49)), shellValueFromBytes(Uint8Array.of(255, 255))]);
  const original = TextEncoder.prototype.encode;
  let encoded = 0;
  setup.fs.openResizeFile = async () => { throw new Error("over-budget argv must not open"); };
  try {
    TextEncoder.prototype.encode = function(input = "") { encoded += input.length; return original.call(this, input); };
    const result = await resize(raw ? argumentValues.args : ["-s1", "é"], { fs: setup.fs, ...(raw ? { argumentValues } : {}) }, { limits: { maxArgumentBytes: 4 } });
    assert.equal(result.exitCode, 1);
    assert.equal(Buffer.from(result.stderrHex, "hex").toString(), "truncate: argument limit exceeded\n");
  } finally { TextEncoder.prototype.encode = original; }
  assert.equal(encoded, Buffer.byteLength("truncate: argument limit exceeded\n"), "only the admitted UTF8 diagnostic is encoded, not rejected argv");
});

test("truncate configured raw argument byte boundary is exact", async () => {
  const argumentValues = createCommandArguments([shellValueFromBytes(Uint8Array.of(45, 115, 49)), shellValueFromBytes(Uint8Array.of(255, 255))]);
  const result = await resize(argumentValues.args, { argumentValues }, { limits: { maxArgumentBytes: 5 } });
  assert.equal(Buffer.from(result.stderrHex, "hex").toString(), "truncate: cannot open ''$'\\377\\377' for writing: No such file or directory\n");
});

test("truncate configured argument limit cannot raise the hard byte ceiling", async () => {
  const result = await resize(["-s1", "x".repeat(65534)], {}, { limits: { maxArgumentBytes: 100000 } });
  assert.equal(Buffer.from(result.stderrHex, "hex").toString(), "truncate: argument limit exceeded\n");
});

for (const spare of [0, 1]) test(`truncate configured aggregate output counts stdout before diagnostic: spare=${spare}`, async () => {
  const help = Buffer.from((await resize(["--help"])).stdoutHex, "hex");
  const diagnostic = "truncate: é\n";
  let stdout = 0, stderr = "";
  const result = await resize(["--help"], {
    stdout: { async write(bytes) { stdout += bytes.length; throw new PublicDiagnostic("é"); } },
    stderr: { async write(bytes) { stderr += Buffer.from(bytes).toString(); } },
  }, { limits: { maxOutputBytes: help.length + Buffer.byteLength(diagnostic) - spare } });
  assert.equal(result.exitCode, 1);
  assert.equal(stdout, help.length);
  assert.equal(stderr, spare === 0 ? diagnostic : "");
});

test("truncate configured output cap includes earlier ordinary and outer diagnostics", async () => {
  const setup = fixture();
  const ordinary = "truncate: cannot open 'target' for writing: Permission denied\n";
  let opens = 0, output = "";
  setup.fs.openResizeFile = async () => { if (++opens === 1) throw new FsError("EACCES"); throw new PublicDiagnostic("secondary"); };
  const result = await resize(["-s1", "target", "target"], { fs: setup.fs, stderr: { async write(bytes) { output += Buffer.from(bytes).toString(); } } }, { limits: { maxOutputBytes: Buffer.byteLength(ordinary) } });
  assert.equal(result.exitCode, 1);
  assert.equal(output, ordinary);
  assert.equal(opens, 2);
});

test("truncate configured default output cap is one MiB without diagnostic truncation", async () => {
  const setup = fixture();
  setup.fs.stat = async () => { throw new PublicDiagnostic("x".repeat(1024 * 1024)); };
  const result = await resize(["-r", "reference", "new"], { fs: setup.fs });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderrHex, "");
});

test("truncate configured output budget cannot raise the fixed hard ceiling", async () => {
  const setup = fixture();
  setup.fs.stat = async () => { throw new PublicDiagnostic("x".repeat(32 * 1024 * 1024)); };
  const result = await resize(["-r", "reference", "new"], { fs: setup.fs }, { limits: { maxOutputBytes: 64 * 1024 * 1024 } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderrHex, "");
});

interface ParserCase {
  name: string; args: string[]; env: Record<string, string>; virtualIdentity: boolean;
  before: { mode: number; size: number; dataHex: string };
  after: { mode: number; size: number; dataHex: string; sameOriginalInode: boolean };
  expected: { exitCode: number; stdoutHex: string; stderrHex: string };
}
const parser = (JSON.parse(readFileSync(new URL("./truncate-parser.snapshot.json", import.meta.url), "utf8")) as { cases: ParserCase[] }).cases;
for (const entry of parser) test(`truncate ${entry.virtualIdentity ? "intentional identity difference" : "GNU parser"} ${entry.name}`, async () => {
  const setup = fixture();
  setup.volume.chmodSync("/work/target", entry.before.mode & 0o7777);
  const before = setup.volume.statSync("/work/target");
  assert.deepEqual({ mode: Number(before.mode), size: Number(before.size), dataHex: Buffer.from(setup.volume.readFileSync("/work/target")).toString("hex") }, entry.before);
  const result = await resize(entry.args, { fs: setup.fs, env: { LC_ALL: "C", ...entry.env } });
  assert.equal(result.exitCode, entry.expected.exitCode);
  assert.equal(result.stderrHex, entry.expected.stderrHex);
  if (entry.virtualIdentity) {
    assert.notEqual(result.stdoutHex, entry.expected.stdoutHex);
    assert.equal(Buffer.from(result.stdoutHex, "hex").toString(), "truncate (virtual-bash)\n");
  } else assert.equal(result.stdoutHex, entry.expected.stdoutHex);
  const after = setup.volume.statSync("/work/target");
  assert.deepEqual({ mode: Number(after.mode), size: Number(after.size), dataHex: Buffer.from(setup.volume.readFileSync("/work/target")).toString("hex"), sameOriginalInode: after.ino === before.ino }, entry.after);
  assert.equal(setup.volume.existsSync("/work/absent"), false);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

for (const boundary of ["capabilitiesFor", "referenceStat", "readOnly", "retainedResize", "openCheck", "openAcquire", "stat", "truncate"] as const) {
  for (const reason of [false, null, 0, ""]) test(`truncate getter abort ${boundary} preserves ${JSON.stringify(reason)} without late dispatch`, async () => {
    const setup = fixture();
    const snapshot = await setup.fs.stat("/work/target");
    const controller = new AbortController();
    const callbacks: InvocationCleanup[] = [];
    let lookups = 0, lateCalls = 0, closes = 0, opens = 0, resizes = 0;
    const handle = {
      async stat() { return snapshot; },
      async truncate() { resizes++; },
      async close() { closes++; },
    };
    setup.fs.capabilitiesFor = async () => setup.fs.capabilities;
    setup.fs.openResizeFile = async () => { opens++; return handle; };
    const install = (owner: object, key: string, callback: (...args: unknown[]) => unknown, abortAt = 1): void => {
      Object.defineProperty(owner, key, { configurable: true, get() {
        if (++lookups === abortAt) controller.abort(reason);
        return function(this: unknown, ...args: unknown[]) {
          assert.equal(this, owner);
          if (controller.signal.aborted) lateCalls++;
          return Reflect.apply(callback, this, args);
        };
      } });
    };
    if (boundary === "capabilitiesFor") install(setup.fs, "capabilitiesFor", async () => setup.fs.capabilities);
    if (boundary === "referenceStat") install(setup.fs, "stat", async () => snapshot);
    if (boundary === "readOnly" || boundary === "retainedResize") {
      const capabilities = { ...setup.fs.capabilities };
      Object.defineProperty(capabilities, boundary, { get() { lookups++; controller.abort(reason); return boundary === "retainedResize"; } });
      setup.fs.capabilitiesFor = async () => capabilities;
    }
    if (boundary === "openCheck" || boundary === "openAcquire") install(setup.fs, "openResizeFile", async () => { opens++; return handle; }, boundary === "openCheck" ? 1 : 2);
    if (boundary === "stat") install(handle, "stat", handle.stat);
    if (boundary === "truncate") install(handle, "truncate", handle.truncate);
    const args = boundary === "referenceStat" ? ["-r", "reference", "target"] : [boundary === "stat" ? "-s+1" : "-s1", "target", "new"];
    await assert.rejects(resize(args, { fs: setup.fs, signal: controller.signal, registerCleanup(cleanup) { callbacks.push(cleanup); } }), error => error === reason);
    await Promise.all(callbacks.map(cleanup => cleanup()));
    await Promise.all(callbacks.map(cleanup => cleanup()));
    assert.equal(lateCalls, 0);
    assert.equal(lookups, boundary === "openAcquire" ? 2 : 1);
    assert.equal(closes, opens);
    assert.equal(resizes, boundary === "openAcquire" ? 1 : 0);
  });
}

for (const boundary of ["capabilitiesFor", "referenceStat", "openResizeFile", "stat", "truncate"] as const) {
  test(`truncate captured ${boundary} callable retains its receiver with one lookup`, async () => {
    const setup = fixture();
    const snapshot = await setup.fs.stat("/work/target");
    let lookups = 0, calls = 0, closes = 0;
    const handle = {
      async stat() { return snapshot; }, async truncate() {}, async close() { closes++; },
    };
    setup.fs.capabilitiesFor = async () => setup.fs.capabilities;
    setup.fs.openResizeFile = async () => handle;
    const owner = boundary === "stat" || boundary === "truncate" ? handle : setup.fs;
    const key = boundary === "referenceStat" ? "stat" : boundary;
    Object.defineProperty(owner, key, { configurable: true, get() {
      lookups++;
      return async function(this: unknown) {
        assert.equal(this, owner);
        calls++;
        if (boundary === "capabilitiesFor") return setup.fs.capabilities;
        if (boundary === "openResizeFile") return handle;
        return snapshot;
      };
    } });
    const args = boundary === "referenceStat" ? ["-r", "reference", "target"] : [boundary === "stat" ? "-s+1" : "-s1", "target"];
    assert.equal((await resize(args, { fs: setup.fs })).exitCode, 0);
    assert.equal(lookups, 1);
    assert.equal(calls, 1);
    assert.equal(closes, 1);
  });
}

test("truncate composes through Shell without changing global registration", async () => {
  const setup = fixture();
  const shell = new Shell({ fs: setup.fs, commands: new CommandRegistry([truncateCommand()]) });
  try {
    const result = await shell.exec("truncate -s2 /work/target");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "", ""]);
    assert.equal(setup.volume.readFileSync("/work/target", "utf8"), "ab");
  } finally { await shell.dispose(); }
});

for (const phase of ["stat", "truncate"] as const) for (const reason of [false, null, 0, ""]) {
  test(`truncate registered cleanup preserves Shell ${phase} primary ${JSON.stringify(reason)}`, async () => {
    const setup = fixture();
    const metadata = await setup.fs.stat("/work/target");
    let closes = 0;
    const errors: unknown[] = [];
    setup.fs.openResizeFile = async () => ({
      async stat() { if (phase === "stat") throw reason; return metadata; },
      async truncate() { throw reason; },
      async close() { closes++; throw new Error("secondary close"); },
    });
    const shell = new Shell({ fs: setup.fs, commands: new CommandRegistry([truncateCommand()]), onInternalError(error) { errors.push(error); } });
    try {
      const result = await shell.exec("truncate -s+1 /work/target");
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [1, "", "shell: line 1: internal error\n"]);
      assert.deepEqual(errors, [reason]);
    } finally { await shell.dispose(); }
    assert.equal(closes, 1);
  });
}

test("truncate registered cleanup does not repeat a diagnosed close failure", async () => {
  const setup = fixture();
  let closes = 0;
  setup.fs.openResizeFile = async () => ({
    async stat() { throw new Error("unexpected stat"); }, async truncate() {},
    async close() { closes++; throw new FsError("EIO"); },
  });
  const shell = new Shell({ fs: setup.fs, commands: new CommandRegistry([truncateCommand()]) });
  try {
    const result = await shell.exec("truncate -s1 /work/target /work/target");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "truncate: failed to close '/work/target': Input/output error\n".repeat(2));
  } finally { await shell.dispose(); }
  assert.equal(closes, 2);
});

for (const reason of [false, null, 0, ""]) test(`truncate registered cleanup drains secondary close after cancellation ${JSON.stringify(reason)}`, async () => {
  const setup = fixture();
  const entered = deferred(), gate = deferred();
  const callbacks: InvocationCleanup[] = [];
  const controller = new AbortController();
  let closes = 0, drained = false;
  setup.fs.openResizeFile = async () => ({
    async stat() { throw new Error("unexpected stat"); },
    async truncate() { entered.resolve(); await gate.promise; },
    async close() { closes++; throw new Error("secondary close"); },
  });
  const pending = resize(["-s1", "target"], { fs: setup.fs, signal: controller.signal, registerCleanup(callback) { callbacks.push(callback); } });
  const outcome = pending.then(result => ({ result }), error => ({ error }));
  await entered.promise;
  controller.abort(reason);
  const retirement = Promise.all(callbacks.map(callback => callback())).then(() => { drained = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(drained, false);
  assert.equal(closes, 0);
  gate.resolve();
  assert.deepEqual(await outcome, { error: reason });
  await retirement;
  await Promise.all(callbacks.map(callback => callback()));
  assert.equal(closes, 1);
});

for (const phase of ["capabilities", "reference-stat", "open", "stat", "truncate", "close"] as const) {
  test(`truncate Shell exec/dispose tracks ${phase} with falsey cancellation`, async () => {
    const setup = fixture();
    const entered = deferred(), gate = deferred();
    const stat = setup.fs.stat.bind(setup.fs);
    const metadata = await stat("/work/target");
    let opens = 0, closes = 0, settled = false, disposed = false;
    setup.fs.capabilitiesFor = async () => {
      if (phase === "capabilities") { entered.resolve(); await gate.promise; }
      return setup.fs.capabilities;
    };
    setup.fs.stat = async (path, options) => {
      if (phase === "reference-stat" && path === "/work/reference") { entered.resolve(); await gate.promise; }
      return stat(path, options);
    };
    setup.fs.openResizeFile = async () => {
      opens++;
      if (phase === "open") { entered.resolve(); await gate.promise; }
      return {
        async stat() { if (phase === "stat") { entered.resolve(); await gate.promise; } return metadata; },
        async truncate() { if (phase === "truncate") { entered.resolve(); await gate.promise; } },
        async close() { closes++; if (phase === "close") { entered.resolve(); await gate.promise; } },
      };
    };
    const shell = new Shell({ fs: setup.fs, commands: new CommandRegistry([truncateCommand()]) });
    const controller = new AbortController();
    const command = phase === "reference-stat" ? "truncate -r /work/reference /work/target" : "truncate -s+1 /work/target";
    const execution = shell.exec(command, { signal: controller.signal }).then(result => { settled = true; return { result }; }, error => { settled = true; return { error }; });
    const admitted = await Promise.race([entered.promise.then(() => true), execution.then(() => false)]);
    if (!admitted) {
      await shell.dispose();
      assert.fail(`current public route did not admit retained ${phase}`);
    }
    controller.abort(false);
    const disposal = shell.dispose().then(() => { disposed = true; });
    for (let turn = 0; turn < 3; turn++) await new Promise(resolve => setImmediate(resolve));
    const before = { settled, disposed, closes };
    gate.resolve();
    const outcome = await execution;
    await disposal;
    assert.ok("error" in outcome);
    assert.equal(outcome.error, false);
    const opaque = phase === "capabilities" || phase === "reference-stat";
    assert.equal(before.settled, opaque);
    assert.equal(before.disposed, opaque);
    assert.equal(before.closes, phase === "close" ? 1 : 0);
    assert.equal(opens, opaque ? 0 : 1);
    assert.equal(closes, opaque ? 0 : 1);
  });
}

for (const phase of ["stat", "truncate"] as const) {
  test(`truncate drains retained ${phase} before invoking resource close`, async () => {
    const setup = fixture();
    const entered = deferred(), gate = deferred();
    const metadata = await setup.fs.stat("/work/target");
    let closes = 0, opens = 0, settled = false;
    setup.fs.openResizeFile = async () => {
      opens++;
      return {
        async stat() { if (phase === "stat") { entered.resolve(); await gate.promise; } return metadata; },
        async truncate() { if (phase === "truncate") { entered.resolve(); await gate.promise; } },
        async close() { closes++; },
      };
    };
    const controller = new AbortController();
    const pending = resize(["-s+1", "target", "new"], { fs: setup.fs, signal: controller.signal });
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await entered.promise;
    controller.abort(false);
    await new Promise(resolve => setImmediate(resolve));
    const closedEarly = closes;
    const settledEarly = settled;
    gate.resolve();
    await assert.rejects(pending, reason => reason === false);
    assert.equal(closedEarly, 0);
    assert.equal(settledEarly, false);
    assert.equal(closes, 1);
    assert.equal(opens, 1);
  });
}

test("truncate cooperatively cancels bounded diagnostic accounting before writing", async () => {
  const setup = fixture();
  setup.fs.stat = async () => { throw new PublicDiagnostic("é".repeat(8 * 1024 * 1024)); };
  const controller = new AbortController();
  let written = 0;
  const pending = resize(["-r", "reference", "new"], { fs: setup.fs, signal: controller.signal, stderr: { async write(bytes) { written += bytes.length; } } }, { limits: { maxOutputBytes: 32 * 1024 * 1024 } });
  setImmediate(() => { controller.abort(false); });
  await assert.rejects(pending, reason => reason === false);
  assert.equal(written, 0);
});

test("truncate admits the real diagnostic cap before encoding and never truncates a rejected diagnostic", async () => {
  const setup = fixture();
  const limit = 32 * 1024 * 1024;
  setup.fs.stat = async () => { throw new PublicDiagnostic("x".repeat(limit)); };
  const original = TextEncoder.prototype.encode;
  let encoded = 0, written = 0;
  try {
    TextEncoder.prototype.encode = function(input = "") {
      assert.ok(input.length <= 65536, "diagnostics must be admitted and encoded in bounded chunks");
      encoded += input.length;
      return original.call(this, input);
    };
    const result = await resize(["-r", "reference", "new"], { fs: setup.fs, stderr: { async write(bytes) { written += bytes.length; } } }, { limits: { maxOutputBytes: limit } });
    assert.equal(result.exitCode, 1);
  } finally { TextEncoder.prototype.encode = original; }
  assert.equal(encoded, 14, "only the admitted argument bytes are encoded");
  assert.equal(written, 0);
});

test("truncate admits exactly the real stderr cap with UTF8 bytes and bounded sink chunks", async () => {
  const setup = fixture();
  const limit = 32 * 1024 * 1024;
  setup.fs.stat = async () => { throw new PublicDiagnostic("é".repeat((limit - 12) / 2) + "x"); };
  let written = 0;
  const result = await resize(["-r", "reference", "new"], { fs: setup.fs, stderr: { async write(bytes) {
    assert.ok(bytes.length <= 65536);
    written += bytes.length;
  } } }, { limits: { maxOutputBytes: limit } });
  assert.equal(result.exitCode, 1);
  assert.equal(written, limit);
});

interface ExtraCase {
  name: string; argvHex: string[]; locale: string; stdoutHex: string; stderrHex: string; exitCode: number; newSize: number | null; seekGap: boolean;
}
const extra = (JSON.parse(readFileSync(new URL("./truncate-extra.snapshot.json", import.meta.url), "utf8")) as { cases: ExtraCase[] }).cases;
for (const entry of extra) {
  const nullSeek = entry.argvHex.includes("2f6465762f6e756c6c");
  test(`truncate ${entry.seekGap && !nullSeek ? "documented backend seek gap" : "GNU 8.30 raw/nonregular custom handles"} ${entry.name}`, async () => {
    const argumentValues = createCommandArguments(entry.argvHex.map(value => shellValueFromBytes(Buffer.from(value, "hex"))));
    const setup = fixture();
    if (entry.name.startsWith("nonregular")) {
      const stat = setup.fs.stat.bind(setup.fs);
      const metadata: FileStat = { type: "character", size: 0, mode: 0o20666, preferredIoBlockSize: 4096, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 };
      setup.fs.stat = async (path, options) => path === "/dev/null" ? metadata : stat(path, options);
      const open = setup.fs.openResizeFile!.bind(setup.fs);
      setup.fs.openResizeFile = async (path, options) => path === "/dev/null" ? {
        async stat() { return metadata; }, async seekEnd() { return 0n; }, async truncate() { throw new FsError("EINVAL"); }, async close() {},
      } : open(path, options);
      setup.fs.openReadFile = async path => {
        if (path !== "/dev/null") throw new FsError("ENOTSUP");
        return { async stat() { return metadata; }, async read() { throw new Error("reference must not read bytes"); }, async seekEnd() { return 0n; }, async close() {} };
      };
    }
    const result = await resize(argumentValues.args, { argumentValues, fs: setup.fs, env: { LC_ALL: entry.locale } });
    if (entry.seekGap && !nullSeek) {
      assert.match(Buffer.from(result.stderrHex, "hex").toString(), /cannot get the size.*Operation not supported/);
      assert.notEqual(result.stderrHex, entry.stderrHex);
      assert.equal(setup.volume.existsSync("/work/new"), false);
    } else {
      assert.deepEqual({ exitCode: result.exitCode, stdoutHex: result.stdoutHex, stderrHex: result.stderrHex }, { exitCode: entry.exitCode, stdoutHex: entry.stdoutHex, stderrHex: entry.stderrHex });
      assert.equal(setup.volume.existsSync("/work/new") ? Number(setup.volume.statSync("/work/new").size) : null, entry.newSize);
    }
  });
}

interface ModeEffect { type: string; mode: number; size: number; sameOriginalInode: boolean; dataHex?: string; target?: string }
interface ModeCase {
  name: string; args: string[]; umask: number; before: Record<string, ModeEffect>; after: Record<string, ModeEffect>;
  stdoutHex: string; stderrHex: string; exitCode: number;
}
const modes = (JSON.parse(readFileSync(new URL("./truncate-modes.snapshot.json", import.meta.url), "utf8")) as { cases: ModeCase[] }).cases;
for (const umask of [0, 0o022, 0o077]) test(`truncate native extra-mask qualification with modeled backend mask077 and virtual ${umask.toString(8)}`, async () => {
  const native = modes.find(entry => entry.umask === 0o077 && JSON.stringify(entry.args) === JSON.stringify(["-s", "2", "target", "new"]));
  assert.ok(native);
  const setup = fixture();
  setup.volume.chmodSync("/work/target", 0o640);
  const original = setup.volume.statSync("/work/target").ino;
  const open = setup.fs.openResizeFile!.bind(setup.fs);
  const supplied: number[] = [];
  setup.fs.openResizeFile = async (path, options = {}) => {
    assert.equal(options.mode, 0o666 & ~umask);
    supplied.push(options.mode!);
    return open(path, { ...options, mode: options.mode! & ~0o077 });
  };
  const result = await resize(native.args, { fs: setup.fs }, { umask });
  assert.deepEqual([result.exitCode, result.stdoutHex, result.stderrHex], [native.exitCode, native.stdoutHex, native.stderrHex]);
  for (const name of ["target", "new"]) {
    const stat = setup.volume.statSync(`/work/${name}`);
    assert.deepEqual({ type: "file", mode: Number(stat.mode), size: Number(stat.size), sameOriginalInode: stat.ino === original, dataHex: Buffer.from(setup.volume.readFileSync(`/work/${name}`)).toString("hex") }, native.after[name]);
  }
  assert.deepEqual(supplied, [0o666 & ~umask, 0o666 & ~umask]);
  if (umask !== 0o077) assert.notEqual(Number(setup.volume.statSync("/work/new").mode) & 0o777, 0o666 & ~umask);
});

for (const entry of modes) {
  test(`truncate matched configured native umask ${entry.name}`, async () => {
    const setup = fixture();
    setup.volume.chmodSync("/work/target", 0o640);
    setup.volume.chmodSync("/work/reference", 0o444);
    setup.volume.lchmodSync("/work/symlink", 0o777);
    setup.volume.lchmodSync("/work/dangling", 0o777);
    const observe = () => Object.fromEntries(Object.entries(setup.effects()).map(([name, effect]) => [name, {
      ...(effect as object), mode: Number(setup.volume.lstatSync(`/work/${name}`).mode),
      ...(setup.volume.lstatSync(`/work/${name}`).isSymbolicLink() ? { target: setup.volume.readlinkSync(`/work/${name}`, { encoding: "utf8" }).toString() } : {}),
    }])) as Record<string, ModeEffect>;
    assert.deepEqual(observe(), entry.before);
    const result = await resize(entry.args, { fs: setup.fs }, { umask: entry.umask });
    assert.deepEqual({ stdoutHex: result.stdoutHex, stderrHex: result.stderrHex, exitCode: result.exitCode }, { stdoutHex: entry.stdoutHex, stderrHex: entry.stderrHex, exitCode: entry.exitCode });
    const after = observe();
    assert.deepEqual(after, entry.after);
  });
}

test("truncate admits raw argv by its bytes rather than lossy display re-encoding", async () => {
  const argumentValues = createCommandArguments([shellValueFromBytes(Uint8Array.of(45, 115)), shellValueFromBytes(new Uint8Array(60000).fill(255)), shellValueFromBytes(Uint8Array.of(110))]);
  const result = await resize(argumentValues.args, { argumentValues });
  assert.equal(result.exitCode, 1);
  assert.equal(Buffer.from(result.stderrHex, "hex").toString(), `truncate: Invalid number: '${"\\377".repeat(60000)}'\n`);
});

test("truncate registers cleanup before acquisition and snapshots a reference only once", async () => {
  const setup = fixture();
  const callbacks: InvocationCleanup[] = [];
  const stat = setup.fs.stat.bind(setup.fs), open = setup.fs.openResizeFile!.bind(setup.fs);
  let stats = 0, opens = 0;
  setup.fs.stat = async (path, options) => { stats++; return stat(path, options); };
  setup.fs.openResizeFile = async (path, options) => { assert.ok(callbacks.length); opens++; return open(path, options); };
  assert.equal((await resize(["-r", "target", "-s", "+2", "target", "target"], { fs: setup.fs, registerCleanup(callback) { callbacks.push(callback); } })).exitCode, 0);
  assert.equal(stats, 1);
  assert.equal(opens, 2);
  assert.equal(setup.volume.statSync("/work/target").size, 8);
  await Promise.all(callbacks.map(callback => callback()));
});

test("truncate uses the pinned object and target block hint after namespace replacement", async () => {
  const setup = fixture();
  const open = setup.fs.openResizeFile!.bind(setup.fs);
  setup.fs.openResizeFile = async (path, options) => {
    const handle = await open(path, options);
    const stat = await handle.stat();
    setup.volume.renameSync(path, "/work/old");
    setup.volume.writeFileSync(path, "replacement");
    return { ...handle, async stat() { return { ...stat, preferredIoBlockSize: 3 }; } };
  };
  setup.fs.truncate = async () => { throw new Error("pathname resize is forbidden"); };
  assert.equal((await resize(["-o", "-s", "+1", "target"], { fs: setup.fs })).exitCode, 0);
  assert.equal(setup.volume.statSync("/work/old").size, 9);
  assert.equal(setup.volume.readFileSync("/work/target", "utf8"), "replacement");
});

test("truncate reports stat, resize and close failures separately and continues targets", async () => {
  const setup = fixture();
  const open = setup.fs.openResizeFile!.bind(setup.fs);
  const events: string[] = [];
  setup.fs.openResizeFile = async (path, options) => {
    events.push(path);
    if (path.endsWith("/stat")) return {
      async stat() { throw new FsError("EIO"); }, async truncate() { throw new Error("unexpected resize"); }, async close() { throw new FsError("EBADF"); },
    };
    if (path.endsWith("/resize")) return {
      async stat() { return { ...(await setup.fs.stat("/work/target")), size: 2 }; }, async truncate() { throw new FsError("ENOSPC"); }, async close() {},
    };
    return open(path, options);
  };
  const result = await resize(["-s+1", "stat", "resize", "new"], { fs: setup.fs });
  assert.equal(result.exitCode, 1);
  assert.equal(Buffer.from(result.stderrHex, "hex").toString(), "truncate: cannot fstat 'stat': Input/output error\ntruncate: failed to close 'stat': Bad file descriptor\ntruncate: failed to truncate 'resize' at 3 bytes: No space left on device\n");
  assert.equal(events.length, 3);
  assert.equal(setup.volume.statSync("/work/new").size, 1);
});

test("truncate no-create suppresses only acquisition ENOENT, not retained-operation ENOENT", async () => {
  const setup = fixture();
  let closes = 0;
  setup.fs.openResizeFile = async path => {
    if (path.endsWith("/missing")) throw new FsError("ENOENT");
    return { async stat() { throw new FsError("ENOENT"); }, async truncate() { throw new Error("unexpected resize"); }, async close() { closes++; } };
  };
  const result = await resize(["-c", "-s+1", "missing", "target"], { fs: setup.fs });
  assert.equal(result.exitCode, 1);
  assert.equal(Buffer.from(result.stderrHex, "hex").toString(), "truncate: cannot fstat 'target': No such file or directory\n");
  assert.equal(closes, 1);
});

for (const policy of ["readonly", "false", "missing"] as const) {
  test(`truncate honors ${policy} retained-resize admission without pathname fallback`, async () => {
    const setup = fixture();
    let opens = 0;
    setup.fs.openResizeFile = async () => { opens++; throw new Error("denied resource"); };
    if (policy === "missing") Reflect.deleteProperty(setup.fs, "openResizeFile");
    else setup.fs.capabilitiesFor = async () => ({ ...setup.fs.capabilities, ...(policy === "readonly" ? { readOnly: true } : { retainedResize: false }) });
    const result = await resize(["-s0", "new"], { fs: setup.fs });
    assert.equal(result.exitCode, 1);
    assert.match(Buffer.from(result.stderrHex, "hex").toString(), policy === "readonly" ? /Read-only file system/ : /Operation not supported/);
    assert.equal(opens, 0);
    assert.equal(setup.volume.existsSync("/work/new"), false);
  });
}

for (const hint of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`truncate refuses unobserved or invalid block hint ${hint} after acquisition`, async () => {
    const setup = fixture();
    const open = setup.fs.openResizeFile!.bind(setup.fs);
    setup.fs.openResizeFile = async (path, options) => {
      const handle = await open(path, options);
      return { ...handle, async stat() { const { preferredIoBlockSize: ignoredHint, ...stat } = await handle.stat(); return { ...stat, ...(hint === undefined ? {} : { preferredIoBlockSize: hint }) }; } };
    };
    const result = await resize(["-o", "-s1", "new"], { fs: setup.fs });
    assert.equal(result.exitCode, 1);
    assert.match(Buffer.from(result.stderrHex, "hex").toString(), /I\/O block size.*Operation not supported/);
    assert.equal(setup.volume.statSync("/work/new").size, 0);
  });
}

test("truncate never rounds unsafe computed lengths or observed sizes through Number", async () => {
  const setup = fixture();
  const stat = await setup.fs.stat("/work/target");
  const calls: number[] = [];
  let observed = Number.MAX_SAFE_INTEGER;
  setup.fs.openResizeFile = async () => ({ async stat() { return { ...stat, size: observed }; }, async truncate(length) { calls.push(length); }, async close() {} });
  const unsafe = await resize(["-s+1", "target"], { fs: setup.fs });
  assert.equal(Buffer.from(unsafe.stderrHex, "hex").toString(), "truncate: failed to truncate 'target' at 9007199254740992 bytes: File too large\n");
  assert.deepEqual(calls, []);
  assert.equal((await resize(["-s/3", "target"], { fs: setup.fs })).exitCode, 0);
  assert.deepEqual(calls, [9007199254740990]);
  observed++;
  const invalidStat = await resize(["-s/3", "target"], { fs: setup.fs });
  assert.equal(invalidStat.exitCode, 1);
  assert.match(Buffer.from(invalidStat.stderrHex, "hex").toString(), /file size is not a safe integer/);
  assert.equal(calls.length, 1);
});

for (const reason of [false, null, 0, ""]) {
  test(`truncate cancels opaque capabilities without draining them: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture();
    const entered = deferred(), gate = deferred();
    let opens = 0;
    setup.fs.capabilitiesFor = async () => { entered.resolve(); await gate.promise; return setup.fs.capabilities; };
    setup.fs.openResizeFile = async () => { opens++; throw new Error("late open"); };
    const controller = new AbortController();
    const pending = resize(["-s1", "target"], { fs: setup.fs, signal: controller.signal });
    await entered.promise;
    controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
    gate.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(opens, 0);
  });

  test(`truncate drains late admitted opens and preserves cancellation: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture();
    const entered = deferred(), gate = deferred();
    let closes = 0, operations = 0;
    setup.fs.openResizeFile = async () => {
      entered.resolve(); await gate.promise;
      return { async stat() { operations++; throw new Error("late stat"); }, async truncate() { operations++; }, async close() { closes++; throw new Error("secondary close"); } };
    };
    const controller = new AbortController();
    let settled = false;
    const pending = resize(["-s1", "target"], { fs: setup.fs, signal: controller.signal });
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await entered.promise;
    controller.abort(reason);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    gate.resolve();
    await assert.rejects(pending, error => error === reason);
    assert.equal(closes, 1);
    assert.equal(operations, 0);
  });

  test(`truncate keeps falsey primary failures after owned cleanup: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture();
    let closes = 0;
    setup.fs.openResizeFile = async () => ({
      async stat() { throw new Error("absolute resize must not stat"); }, async truncate() { throw reason; },
      async close() { closes++; throw new Error("secondary"); },
    });
    await assert.rejects(resize(["-s1", "target"], { fs: setup.fs }), error => error === reason);
    assert.equal(closes, 1);
  });
}

test("truncate does not approximate nonregular reference seeking with directory size", async () => {
  const setup = fixture();
  setup.fs.openReadFile = async () => { throw new FsError("ENOTSUP"); };
  const result = await resize(["-r", "directory", "new"], { fs: setup.fs });
  assert.equal(result.exitCode, 1);
  assert.match(Buffer.from(result.stderrHex, "hex").toString(), /cannot get the size.*Operation not supported/);
  assert.equal(result.effects.new, undefined);
});

function seekFixture() {
  const setup = fixture();
  const events: string[] = [];
  const metadata: FileStat = { type: "character", size: 9876, preferredIoBlockSize: 4096, mode: 0o20666, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 };
  const referenceHandle = {
    async stat() { throw new Error("reference size comes from seek, not retained stat"); },
    async read() { throw new Error("reference size must not read bytes"); },
    async seekEnd() { assert.equal(this, referenceHandle); events.push("reference-seek"); return 7n; },
    async close() { events.push("reference-close"); },
  };
  const targetHandle = {
    async stat() { events.push("target-stat"); return metadata; },
    async seekEnd() { assert.equal(Object.getPrototypeOf(this), targetHandle); events.push("target-seek"); return 7n; },
    async truncate(length: number) { events.push(`truncate:${length}`); },
    async close() { events.push("target-close"); },
  };
  const stat = setup.fs.stat.bind(setup.fs);
  setup.fs.stat = async (path, options) => {
    if (path === "/work/reference") { events.push("reference-stat"); return metadata; }
    return stat(path, options);
  };
  setup.fs.openReadFile = async function(path, options) {
    assert.equal(this, setup.fs);
    assert.equal(path, "/work/reference");
    assert.deepEqual(Object.keys(options ?? {}), ["allowDirectory", "signal"]);
    assert.equal(options?.allowDirectory, true);
    events.push("reference-open");
    return referenceHandle;
  };
  setup.fs.openResizeFile = async () => { events.push("target-open"); return Object.create(targetHandle) as typeof targetHandle; };
  return { ...setup, events, metadata, referenceHandle, targetHandle };
}

test("truncate seek regular reference uses pathname stat without read admission", async () => {
  const setup = seekFixture();
  setup.fs.stat = async () => ({ ...setup.metadata, type: "file", size: 3 });
  Object.defineProperty(setup.fs, "openReadFile", { get() { throw new Error("regular reference must not even look up read admission"); } });
  assert.equal((await resize(["-r", "reference", "target"], { fs: setup.fs })).exitCode, 0);
  assert.deepEqual(setup.events, ["target-open", "truncate:3", "target-close"]);
});

test("truncate seek reference closes before opening any target and snapshots once", async () => {
  const setup = seekFixture();
  const result = await resize(["-r", "reference", "target", "target"], { fs: setup.fs });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(setup.events, ["reference-stat", "reference-open", "reference-seek", "reference-close", "target-open", "truncate:7", "target-close", "target-open", "truncate:7", "target-close"]);
});

for (const reference of [false, true]) test(`truncate seek retains exact bigint offsets beyond Number precision: reference=${reference}`, async () => {
  const setup = seekFixture();
  const handle = reference ? setup.referenceHandle : setup.targetHandle;
  handle.seekEnd = async () => 9007199254740993n;
  const result = await resize([...(reference ? ["-r", "reference"] : []), "-s-9007199254740992", "target"], { fs: setup.fs });
  assert.equal(result.exitCode, 0);
  assert.ok(setup.events.includes("truncate:1"));
});

test("truncate seek target calculates block overflow before querying the end", async () => {
  const setup = seekFixture();
  const result = await resize(["-o", "-s+9223372036854775807", "target"], { fs: setup.fs });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(setup.events, ["target-open", "target-stat", "target-close"]);
  assert.ok(Buffer.from(result.stderrHex, "hex").toString().includes("overflow in"));
});

test("truncate seek waits for an ignored reference close failure before targets", async () => {
  const setup = seekFixture();
  const entered = deferred(), gate = deferred();
  setup.referenceHandle.close = async () => { setup.events.push("reference-close"); entered.resolve(); await gate.promise; throw false; };
  const execution = resize(["-r", "reference", "target"], { fs: setup.fs });
  await entered.promise;
  const before = [...setup.events];
  gate.resolve();
  assert.equal((await execution).exitCode, 0);
  assert.deepEqual(before, ["reference-stat", "reference-open", "reference-seek", "reference-close"]);
  assert.deepEqual(setup.events.slice(4), ["target-open", "truncate:7", "target-close"]);
});

test("truncate seek reference preserves the seek diagnostic over ignored close errno", async () => {
  const setup = seekFixture();
  setup.referenceHandle.seekEnd = async () => { throw new FsError("EACCES"); };
  setup.referenceHandle.close = async () => { setup.events.push("reference-close"); throw new FsError("EIO"); };
  const result = await resize(["-r", "reference", "target", "new"], { fs: setup.fs });
  assert.equal(result.exitCode, 1);
  assert.equal(Buffer.from(result.stderrHex, "hex").toString(), "truncate: cannot get the size of 'reference': Permission denied\n");
  assert.deepEqual(setup.events, ["reference-stat", "reference-open", "reference-close"]);
});

for (const reference of [false, true]) for (const closeFailure of [false, true]) {
  test(`truncate ESPIPE seek diagnostic preserves primary and target continuation: reference=${reference}, closeFailure=${closeFailure}`, async () => {
    const setup = seekFixture();
    const primary = new FsError("ESPIPE");
    const handle = reference ? setup.referenceHandle : setup.targetHandle;
    const callbacks: InvocationCleanup[] = [];
    handle.seekEnd = async () => { throw primary; };
    if (closeFailure) handle.close = async () => { setup.events.push("failed-close"); throw new FsError("EIO"); };
    const result = await resize([...(reference ? ["-r", "reference"] : []), "-s+1", "target", "new"], { fs: setup.fs, registerCleanup(cleanup) { callbacks.push(cleanup); } });
    const expected = reference ? "truncate: cannot get the size of 'reference': Illegal seek\n" :
      ["target", "new"].map(name => `truncate: cannot get the size of '${name}': Illegal seek\n${closeFailure ? `truncate: failed to close '${name}': Input/output error\n` : ""}`).join("");
    assert.deepEqual([result.exitCode, result.stdoutHex, result.stderrHex], [1, "", Buffer.from(expected).toString("hex")]);
    await Promise.all(callbacks.map(cleanup => cleanup()));
    await Promise.all(callbacks.map(cleanup => cleanup()));
    assert.equal(setup.events.filter(event => event === "target-open").length, reference ? 0 : 2);
    assert.equal(setup.events.filter(event => event.endsWith("-close")).length, reference ? 1 : 2);
    assert.equal(setup.events.some(event => event.startsWith("truncate:")), false);
  });
}

for (const reference of [false, true]) for (const reason of [false, null, 0, ""]) {
  test(`truncate ESPIPE seek preserves falsey cancellation ${JSON.stringify(reason)} through close: reference=${reference}`, async () => {
    const setup = seekFixture();
    const primary = new FsError("ESPIPE");
    const controller = new AbortController();
    const handle = reference ? setup.referenceHandle : setup.targetHandle;
    const callbacks: InvocationCleanup[] = [];
    let written = 0;
    handle.seekEnd = async () => { controller.abort(reason); throw primary; };
    handle.close = async () => { setup.events.push("failed-close"); throw new FsError("EIO"); };
    await assert.rejects(resize([...(reference ? ["-r", "reference"] : []), "-s+1", "target", "new"], {
      fs: setup.fs, signal: controller.signal, registerCleanup(cleanup) { callbacks.push(cleanup); },
      stderr: { async write(bytes) { written += bytes.length; } },
    }), error => error === reason);
    await Promise.all(callbacks.map(cleanup => cleanup()));
    assert.equal(written, 0);
    assert.equal(setup.events.filter(event => event === "failed-close").length, 1);
    assert.equal(setup.events.filter(event => event === "target-open").length, reference ? 0 : 1);
    assert.equal(setup.events.some(event => event.startsWith("truncate:")), false);
  });
}

for (const reference of [false, true]) for (const value of [-1n, 1n << 63n, 7, undefined]) {
  test(`truncate seek rejects invalid successful offsets ${String(value)}: reference=${reference}`, async () => {
    const setup = seekFixture();
    Object.defineProperty(reference ? setup.referenceHandle : setup.targetHandle, "seekEnd", { value: async () => value });
    const result = await resize([...(reference ? ["-r", "reference"] : []), "-s+1", "target", "new"], { fs: setup.fs });
    assert.equal(result.exitCode, 1);
    assert.equal(Buffer.from(result.stderrHex, "hex").toString(), "truncate: invalid retained end-seek offset\n");
    assert.equal(setup.events.filter(event => event === "target-open").length, reference ? 0 : 1);
    assert.equal(setup.events.some(event => event.startsWith("truncate:")), false);
  });
}

for (const phase of ["reference-open", "reference-seek", "target-seek"] as const) for (const reason of [false, null, 0, ""]) {
  test(`truncate seek method ${phase} cancellation ${JSON.stringify(reason)} prevents later effects`, async () => {
    const setup = seekFixture();
    const controller = new AbortController();
    if (phase === "reference-open") setup.fs.openReadFile = async () => { controller.abort(reason); return setup.referenceHandle; };
    else (phase === "reference-seek" ? setup.referenceHandle : setup.targetHandle).seekEnd = async () => { controller.abort(reason); return 7n; };
    await assert.rejects(resize([...(phase === "target-seek" ? [] : ["-r", "reference"]), "-s+1", "target", "new"], { fs: setup.fs, signal: controller.signal }), error => error === reason);
    assert.equal(setup.events.filter(event => event.endsWith("-close")).length, 1);
    assert.equal(setup.events.filter(event => event === "target-open").length, phase === "target-seek" ? 1 : 0);
    assert.equal(setup.events.some(event => event.startsWith("truncate:")), false);
  });
}

for (const failure of [false, null, 0, "", new Error("ignored reference close"), new FsError("EIO")]) {
  test(`truncate seek ignores reference close failure ${String(failure)} before target dispatch`, async () => {
    const setup = seekFixture();
    const callbacks: InvocationCleanup[] = [];
    setup.referenceHandle.close = async () => { setup.events.push("reference-close"); throw failure; };
    const result = await resize(["-r", "reference", "target"], { fs: setup.fs, registerCleanup(cleanup) { callbacks.push(cleanup); } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderrHex, "");
    await Promise.all(callbacks.map(cleanup => cleanup()));
    assert.deepEqual(setup.events, ["reference-stat", "reference-open", "reference-seek", "reference-close", "target-open", "truncate:7", "target-close"]);
  });
}

for (const reference of [false, true]) for (const failure of [false, null, 0, "", new Error("host seek")]) {
  test(`truncate seek preserves arbitrary primary ${String(failure)} and stops later targets: reference=${reference}`, async () => {
    const setup = seekFixture();
    const handle = reference ? setup.referenceHandle : setup.targetHandle;
    handle.seekEnd = async () => { throw failure; };
    handle.close = async () => { setup.events.push("closed"); throw new Error("secondary close"); };
    const callbacks: InvocationCleanup[] = [];
    await assert.rejects(resize([...(reference ? ["-r", "reference"] : []), "-s+1", "target", "new"], { fs: setup.fs, registerCleanup(cleanup) { callbacks.push(cleanup); } }), error => error === failure);
    await Promise.all(callbacks.map(cleanup => cleanup()));
    assert.equal(setup.events.filter(event => event === "target-open").length, reference ? 0 : 1);
    assert.equal(setup.events.filter(event => event === "closed").length, 1);
    assert.equal(setup.events.some(event => event.startsWith("truncate:")), false);
  });
}

for (const reference of [false, true]) test(`truncate seek reports typed failure without losing GNU target continuation: reference=${reference}`, async () => {
  const setup = seekFixture();
  const handle = reference ? setup.referenceHandle : setup.targetHandle;
  handle.seekEnd = async () => { throw new FsError("EACCES"); };
  const result = await resize([...(reference ? ["-r", "reference"] : []), "-s+1", "target", "new"], { fs: setup.fs });
  assert.equal(result.exitCode, 1);
  assert.equal(setup.events.filter(event => event === "target-open").length, reference ? 0 : 2);
  assert.ok(Buffer.from(result.stderrHex, "hex").toString().startsWith(`truncate: cannot get the size of '${reference ? "reference" : "target"}': Permission denied\n`));
});

for (const reference of [false, true]) test(`truncate seek refuses an absent optional method without size fallback: reference=${reference}`, async () => {
  const setup = seekFixture();
  Object.defineProperty(reference ? setup.referenceHandle : setup.targetHandle, "seekEnd", { value: undefined });
  const result = await resize([...(reference ? ["-r", "reference"] : []), "-s+1", "target"], { fs: setup.fs });
  assert.equal(result.exitCode, 1);
  assert.ok(Buffer.from(result.stderrHex, "hex").toString().includes("Operation not supported"));
  assert.equal(setup.events.some(event => event.startsWith("truncate:")), false);
  assert.equal(setup.events.filter(event => event.endsWith("-close")).length, 1);
});

for (const phase of ["reference-open", "reference-seek", "target-seek"] as const) for (const reason of [false, null, 0, ""]) {
  test(`truncate seek getter ${phase} abort ${JSON.stringify(reason)} never dispatches the returned callable`, async () => {
    const setup = seekFixture();
    const controller = new AbortController();
    let lookups = 0, calls = 0;
    const owner = phase === "reference-open" ? setup.fs : phase === "reference-seek" ? setup.referenceHandle : setup.targetHandle;
    Object.defineProperty(owner, phase === "reference-open" ? "openReadFile" : "seekEnd", { get() {
      lookups++;
      controller.abort(reason);
      return async () => { calls++; return phase === "reference-open" ? setup.referenceHandle : 7n; };
    } });
    await assert.rejects(resize([...(phase === "target-seek" ? [] : ["-r", "reference"]), "-s+1", "target", "new"], { fs: setup.fs, signal: controller.signal }), error => error === reason);
    assert.equal(lookups, 1);
    assert.equal(calls, 0);
    assert.equal(setup.events.filter(event => event.endsWith("-close")).length, phase === "reference-open" ? 0 : 1);
    assert.equal(setup.events.some(event => event.startsWith("truncate:")), false);
  });
}

for (const phase of ["reference-open", "reference-seek", "reference-close", "target-seek"] as const) for (const reason of [false, null, 0, ""]) {
  test(`truncate seek drains held ${phase} after cancellation ${JSON.stringify(reason)}`, async () => {
    const setup = seekFixture();
    const entered = deferred(), gate = deferred();
    const controller = new AbortController();
    const callbacks: InvocationCleanup[] = [];
    if (phase === "reference-open") setup.fs.openReadFile = async () => { entered.resolve(); await gate.promise; return setup.referenceHandle; };
    else if (phase === "reference-close") setup.referenceHandle.close = async () => { setup.events.push("reference-close"); entered.resolve(); await gate.promise; throw new Error("ignored close"); };
    else (phase === "reference-seek" ? setup.referenceHandle : setup.targetHandle).seekEnd = async () => { entered.resolve(); await gate.promise; return 7n; };
    let settled = false, drained = false;
    const execution = resize([...(phase === "target-seek" ? [] : ["-r", "reference"]), "-s+1", "target", "new"], { fs: setup.fs, signal: controller.signal, registerCleanup(cleanup) { callbacks.push(cleanup); } }).then(result => { settled = true; return { result }; }, error => { settled = true; return { error }; });
    assert.equal(await Promise.race([entered.promise.then(() => true), execution.then(() => false)]), true, "retained phase must be admitted");
    controller.abort(reason);
    const retirement = Promise.all(callbacks.map(cleanup => cleanup())).then(() => { drained = true; });
    await new Promise(resolve => setImmediate(resolve));
    const before = { settled, drained, closes: setup.events.filter(event => event.endsWith("-close")).length };
    gate.resolve();
    assert.deepEqual(await execution, { error: reason });
    await retirement;
    assert.deepEqual(before, { settled: false, drained: false, closes: phase === "reference-close" ? 1 : 0 });
    assert.equal(setup.events.filter(event => event.endsWith("-close")).length, 1);
    assert.equal(setup.events.filter(event => event === "target-open").length, phase === "target-seek" ? 1 : 0);
    assert.equal(setup.events.some(event => event.startsWith("truncate:")), false);
  });
}

test("truncate preserves raw diagnostic bytes without Buffer and never aliases invalid UTF8 paths", async () => {
  const argumentValues = createCommandArguments([shellValueFromBytes(Uint8Array.of(45, 114)), shellValueFromBytes(Uint8Array.of(255)), shellValueFromBytes(Uint8Array.of(110))]);
  const setup = fixture();
  setup.fs.stat = async () => { throw new Error("invalid UTF8 path must not reach filesystem"); };
  const original = globalThis.Buffer;
  let stderr = "";
  try {
    Reflect.set(globalThis, "Buffer", undefined);
    const result = await truncateCommand().execute({ command: "truncate", args: argumentValues.args, argumentValues, cwd: "/work", env: { LC_ALL: "C" }, fs: setup.fs,
      signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() { throw new Error("unexpected stdout"); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
    assert.equal(result.exitCode, 1);
  } finally { Reflect.set(globalThis, "Buffer", original); }
  assert.equal(stderr, "truncate: cannot stat ''$'\\377': No such file or directory\n");
});
