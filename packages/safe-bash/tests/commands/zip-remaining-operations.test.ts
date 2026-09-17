import { Shell } from "../../src/shell/shell.js";
import { archiveCommands } from "../../src/commands/archive/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { archiveBytes, execute, fixture, modified } from "./zip-standard-flags.helpers.js";
import { readZipArchive, writeZipArchive } from "../../src/commands/archive/zip-format.js";
import { settings } from "../../src/commands/archive/internal.js";

async function sources() {
  const fs = await fixture(await archiveBytes([{ name: "a", body: Buffer.from("old") }]));
  await fs.writeFile("/work/a", Buffer.from("old"));
  await fs.utimes!("/work/a", modified.getTime(), modified.getTime());
  await fs.writeFile("/work/b", Buffer.from("new"));
  return fs;
}
async function names(fs: Awaited<ReturnType<typeof fixture>>, path: string) {
  return (await readZipArchive(await fs.readFile(path), settings({}), new AbortController().signal)).entries.map(entry => entry.name);
}
for (const descriptor of [false, true]) for (const field of ["size", "compressed-size", "offset"] as const) test(`grow central-only ZIP64 ${field} descriptor=${descriptor} admits exact output budget`, async () => {
  const limits = settings({});
  const signal = new AbortController().signal;
  const initial = await readZipArchive(await archiveBytes([{ name: "a", body: Buffer.from("old") }]), limits, signal);
  const original = Buffer.from(await writeZipArchive(initial, limits, signal, descriptor));
  const central = original.indexOf(Buffer.from([80, 75, 1, 2]));
  const end = original.lastIndexOf(Buffer.from([80, 75, 5, 6]));
  original.writeUInt16LE(45, 4);
  original.writeUInt16LE(45, central + 6);
  original.writeUInt32LE(0xffffffff, central + (field === "size" ? 24 : field === "compressed-size" ? 20 : 42));
  const extra = Buffer.alloc(12);
  extra.writeUInt16LE(1, 0);
  extra.writeUInt16LE(8, 2);
  extra.writeBigUInt64LE(field === "offset" ? 0n : 3n, 4);
  const insertion = central + 46 + original.readUInt16LE(central + 28) + original.readUInt16LE(central + 30);
  const bytes = Buffer.concat([original.subarray(0, insertion), extra, original.subarray(insertion)]);
  bytes.writeUInt16LE(original.readUInt16LE(central + 30) + extra.length, central + 30);
  bytes.writeUInt32LE(original.readUInt32LE(end + 12) + extra.length, end + extra.length + 12);
  const retained = await readZipArchive(bytes, limits, signal, { grow: true });
  const output = await writeZipArchive(retained, limits, signal);
  const exact = await writeZipArchive(retained, { ...limits, maxArchiveBytes: output.length }, signal);
  assert.deepEqual(exact, output);
  assert.deepEqual(Buffer.from(output.subarray(0, central)), bytes.subarray(0, central));
  await assert.rejects(writeZipArchive(retained, { ...limits, maxArchiveBytes: output.length - 1 }, signal), /archive byte limit/);
  const controller = new AbortController();
  const reason = new Error("cancel retained ZIP64 budget");
  controller.abort(reason);
  await assert.rejects(writeZipArchive(retained, limits, controller.signal), error => error === reason);
  const fs = await fixture(output);
  assert.equal((await execute("unzip", fs, ["-tqq", "sample.zip"])).exitCode, 0);
  assert.equal((await execute("unzip", fs, ["-p", "sample.zip", "a"])).stdout.toString(), "old");
});
test("grow central-only ZIP64 empty members do not retain unused local extras", async () => {
  const limits = settings({});
  const signal = new AbortController().signal;
  const original = Buffer.from(await archiveBytes(Array.from({ length: 10 }, (_, index) => ({ name: `a${index}`, body: Buffer.alloc(0) }))));
  const central = original.indexOf(Buffer.from([80, 75, 1, 2]));
  const end = original.lastIndexOf(Buffer.from([80, 75, 5, 6]));
  const pieces: Buffer[] = [];
  let cursor = 0;
  let position = central;
  for (let index = 0; index < 10; index++) {
    const nameLength = original.readUInt16LE(position + 28);
    const extraLength = original.readUInt16LE(position + 30);
    const commentLength = original.readUInt16LE(position + 32);
    original.writeUInt16LE(45, original.readUInt32LE(position + 42) + 4);
    original.writeUInt16LE(45, position + 6);
    original.writeUInt32LE(0xffffffff, position + 24);
    original.writeUInt16LE(extraLength + 12, position + 30);
    const insertion = position + 46 + nameLength + extraLength;
    const extra = Buffer.alloc(12);
    extra.writeUInt16LE(1, 0);
    extra.writeUInt16LE(8, 2);
    pieces.push(original.subarray(cursor, insertion), extra);
    cursor = insertion;
    position = insertion + commentLength;
  }
  pieces.push(original.subarray(cursor));
  const bytes = Buffer.concat(pieces);
  bytes.writeUInt32LE(original.readUInt32LE(end + 12) + 120, end + 120 + 12);
  const retained = await readZipArchive(bytes, limits, signal, { grow: true });
  const output = await writeZipArchive(retained, limits, signal);
  assert.deepEqual(await writeZipArchive(retained, { ...limits, maxArchiveBytes: output.length }, signal), output);
  assert.deepEqual(Buffer.from(output.subarray(0, central)), bytes.subarray(0, central));
  await assert.rejects(writeZipArchive(retained, { ...limits, maxArchiveBytes: output.length - 1 }, signal), /archive byte limit/);
  const fs = await fixture(output);
  assert.equal((await execute("unzip", fs, ["-tqq", "sample.zip"])).exitCode, 0);
  assert.equal((await readZipArchive(output, limits, signal)).entries.length, 10);
});
for (const flag of ["-DF", "--difference-archive"]) test(`zip ${flag} writes only changed and new members`, async () => {
  const fs = await sources();
  const before = await fs.readFile("/work/sample.zip");
  const result = await execute("zip", fs, [flag, "sample.zip", "a", "b", "-O", "diff.zip"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.deepEqual(await names(fs, "/work/diff.zip"), ["b"]);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});
for (const flag of ["-g", "--grow"]) test(`zip ${flag} retains existing local bytes while adding members`, async () => {
  const fs = await sources();
  const before = await fs.readFile("/work/sample.zip");
  const end = before.length - 22 - Buffer.byteLength("archive comment\n");
  const localEnd = new DataView(before.buffer, before.byteOffset).getUint32(end + 16, true);
  const result = await execute("zip", fs, [flag, "sample.zip", "b"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  const after = await fs.readFile("/work/sample.zip");
  assert.deepEqual(after.subarray(0, localEnd), before.subarray(0, localEnd));
  assert.deepEqual(await names(fs, "/work/sample.zip"), ["a", "b"]);
});
test("zip temp path uses requested authorized VFS directory", async () => {
  const fs = await sources();
  await fs.mkdir("/scratch");
  const paths: string[] = [];
  const guarded = new Proxy(fs, { get(target, property) {
    const value = Reflect.get(target, property);
    if (property === "createStagedFile") return (path: string, ...args: unknown[]) => { paths.push(path); return Reflect.apply(value, target, [path, ...args]); };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await execute("zip", guarded, ["-b", "/scratch", "sample.zip", "b"]);
  assert.equal(result.exitCode, 0, result.stderr + result.stdout);
  assert.deepEqual(paths, ["/scratch/.zip-1"]);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
test("zip junk-sfx removes a prefix only after validating the archive", async () => {
  const fs = await sources();
  const before = await fs.readFile("/work/sample.zip");
  await fs.writeFile("/work/sample.zip", Buffer.concat([Buffer.from("MZ virtual SFX\n"), before]));
  const result = await execute("zip", fs, ["-J", "sample.zip"]);
  assert.equal(result.exitCode, 0, result.stderr + result.stdout);
  assert.deepEqual(await names(fs, "/work/sample.zip"), ["a"]);
});
test("zip log-info logs progress through VFS byte I/O", async () => {
  const fs = await sources();
  const result = await execute("zip", fs, ["-lf", "run", "-li", "sample.zip", "b"]);
  assert.equal(result.exitCode, 0, result.stderr + result.stdout);
  assert.match(Buffer.from(await fs.readFile("/work/run.log")).toString(), /adding: b/);
});
test("zip -TT invokes the supplied virtual command on staged archive before publication", async () => {
  const fs = await sources();
  const calls: string[][] = [];
  const result = await execute("zip", fs, ["-T", "-TT", "verify --check {}", "sample.zip", "b"], {}, {
    async invoke(command, args) {
      calls.push([command, ...args]);
      assert.deepEqual(await names(fs, args[1]!), ["a", "b"]);
      assert.deepEqual(await names(fs, "/work/sample.zip"), ["a"]);
      return { exitCode: 0 };
    },
  });
  assert.equal(result.exitCode, 0, result.stderr + result.stdout);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![0], "verify");
});

for (const action of [[], ["-u"], ["-f"]]) test(`difference unchanged ${action} publishes an empty archive`, async () => {
  const fs = await sources();
  const result = await execute("zip", fs, ["-DF", ...action, "sample.zip", "a", "-O", "diff.zip"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.deepEqual(await names(fs, "/work/diff.zip"), []);
});
test("default -T dispatches registered virtual unzip", async () => {
  const fs = await sources();
  const calls: string[][] = [];
  const result = await execute("zip", fs, ["-T", "sample.zip", "b"], {}, {
    async invoke(command, args) { calls.push([command, ...args]); return { exitCode: 0 }; },
  });
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.equal(calls[0]?.[0], "unzip");
  assert.equal(calls[0]?.[1], "-tqq");
});
test("virtual unzip -tqq validates payloads without extraction effects", async () => {
  const fs = await sources();
  await fs.rm("/work/a");
  const result = await execute("unzip", fs, ["-tqq", "sample.zip"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.length, 0);
  await assert.rejects(fs.stat("/work/a"), { code: "ENOENT" });
});

for (const flag of ["-DF", "-g", "-b.", "-J"]) {
  test(`${flag} cancellation at publication preserves original and retires owned staging`, async () => {
    const fs = await sources();
    const before = await fs.readFile("/work/sample.zip");
    const controller = new AbortController();
    const reason = new Error("root cancellation");
    const guarded = new Proxy(fs, { get(target, property) {
      const value = Reflect.get(target, property);
      if (property === "publishStagedFile") return () => { controller.abort(reason); throw reason; };
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const args = flag === "-DF" ? [flag, "sample.zip", "b", "-O", "diff.zip"] : [flag, "sample.zip", "b"];
    await assert.rejects(execute("zip", guarded, args, {}, { signal: controller.signal }), error => error === reason);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
    assert.equal((await fs.readdir("/work")).some(entry => entry.name.startsWith(".zip-")), false);
  });
  test(`${flag} publication failure preserves archive and move sources`, async () => {
    const fs = await sources();
    const before = await fs.readFile("/work/sample.zip");
    const guarded = new Proxy(fs, { get(target, property) {
      const value = Reflect.get(target, property);
      if (property === "publishStagedFile") return () => { throw new Error("publication refused"); };
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const args = flag === "-DF" ? [flag, "-m", "sample.zip", "b", "-O", "diff.zip"] : [flag, "-m", "sample.zip", "b"];
    assert.equal((await execute("zip", guarded, args)).exitCode, 2);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
    assert.equal(Buffer.from(await fs.readFile("/work/b")).toString(), "new");
    assert.equal((await fs.readdir("/work")).some(entry => entry.name.startsWith(".zip-")), false);
  });
}
for (const action of ["-d", "-U"]) test(`difference refuses ${action}`, async () => {
  const fs = await sources();
  assert.equal((await execute("zip", fs, ["-DF", action, "sample.zip", "a", "-O", "diff.zip"])).exitCode, 16);
  await assert.rejects(fs.stat("/work/diff.zip"), { code: "ENOENT" });
});
for (const flag of ["-DF", "-g", "-b.", "-J"]) test(`${flag} refuses same-output alias`, async () => {
  const fs = await sources();
  const before = await fs.readFile("/work/sample.zip");
  assert.equal((await execute("zip", fs, [flag, "sample.zip", "b", "-O", "./sample.zip"])).exitCode, 16);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});
for (const kind of ["older", "size"]) test(`difference selects ${kind} source changes`, async () => {
  const fs = await sources();
  await fs.writeFile("/work/a", Buffer.from(kind === "size" ? "larger" : "new"));
  const time = modified.getTime() - (kind === "older" ? 10000 : 0);
  await fs.utimes!("/work/a", time, time);
  const result = await execute("zip", fs, ["-DF", "sample.zip", "a", "-O", "diff.zip"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.deepEqual(await names(fs, "/work/diff.zip"), ["a"]);
});
test("difference filesync current selection publishes nothing", async () => {
  const fs = await sources();
  assert.equal((await execute("zip", fs, ["-DFFS", "sample.zip", "a", "-O", "diff.zip"])).exitCode, 0);
  await assert.rejects(fs.stat("/work/diff.zip"), { code: "ENOENT" });
});
for (const action of [[], ["-u"], ["-f"], ["-d"], ["-U", "-O", "out.zip"]]) test(`grow composes with ${action}`, async () => {
  const fs = await sources();
  await fs.writeFile("/work/a", Buffer.from("changed"));
  await fs.utimes!("/work/a", modified.getTime() + 10000, modified.getTime() + 10000);
  const result = await execute("zip", fs, ["-g", ...action, "sample.zip", "a"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.deepEqual(await names(fs, action.includes("-U") ? "/work/out.zip" : "/work/sample.zip"), action.includes("-d") ? [] : ["a"]);
});
test("grow filesync conflict and empty source selection are not publications", async () => {
  const fs = await sources();
  const before = await fs.readFile("/work/sample.zip");
  assert.equal((await execute("zip", fs, ["-gFS", "sample.zip", "a"])).exitCode, 16);
  assert.equal((await execute("zip", fs, ["-g", "sample.zip", "missing"])).exitCode, 12);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});
for (const flag of ["-DF", "-g", "-b.", "-J"]) test(`${flag} flattened duplicate inputs fail before publication`, async () => {
  const fs = await sources();
  await fs.writeFile("/work/folder/b", Buffer.from("other"));
  const args = [flag, "-j", "sample.zip", "b", "folder/b", ...(flag === "-DF" ? ["-O", "diff.zip"] : [])];
  assert.equal((await execute("zip", fs, args)).exitCode, 16);
});
for (const flag of ["-DF", "-g", "-b.", "-J"]) test(`${flag} honors archive admission boundary`, async () => {
  const fs = await sources();
  const size = (await fs.stat("/work/sample.zip")).size;
  const args = [flag, "sample.zip", ...(flag === "-J" ? [] : ["b"]), ...(flag === "-DF" ? ["-O", "diff.zip"] : [])];
  assert.equal((await execute("zip", fs, args, { limits: { maxArchiveBytes: size - 1 } })).exitCode, 2);
});
for (const path of ["/missing", "/work/a"]) test(`temp path ${path} is refused`, async () => {
  const fs = await sources();
  const before = await fs.readFile("/work/sample.zip");
  assert.equal((await execute("zip", fs, ["--temp-path", path, "sample.zip", "b"])).exitCode, 2);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});
test("temp path capability must be truthful at staging location", async () => {
  const fs = await sources();
  await fs.mkdir("/scratch");
  const guarded = new Proxy(fs, { get(target, property) {
    if (property === "capabilitiesFor") return (path: string) => ({ ...fs.capabilities, atomicFileStaging: !path.startsWith("/scratch") });
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await execute("zip", guarded, ["-b/scratch", "sample.zip", "b"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /temporary path requires atomic owned file staging/);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
for (const corruption of ["crc", "trailing", "fake"]) test(`junk-sfx refuses ${corruption} without stripping bytes`, async () => {
  const original = await archiveBytes([{ name: "a", body: Buffer.from("old") }], entries => { if (corruption === "crc") entries[0]!.crc32 = 0; });
  const bytes = corruption === "fake" ? Buffer.from("arbitrary bytes PK\x03\x04 no archive") : Buffer.concat([Buffer.from("MZ prefix"), original, ...(corruption === "trailing" ? [Buffer.from("tail")] : [])]);
  const fs = await fixture(bytes);
  assert.equal((await execute("zip", fs, ["-J", "sample.zip"])).exitCode, 2);
  assert.deepEqual(Buffer.from(await fs.readFile("/work/sample.zip")), Buffer.from(bytes));
});
for (const adjusted of [false, true]) test(`junk-sfx complete prefix, adjusted=${adjusted}, preserves comments`, async () => {
  const fs = await sources();
  const original = await fs.readFile("/work/sample.zip");
  const prefix = Buffer.from("MZ inert\n");
  const bytes = Buffer.concat([prefix, original]);
  if (adjusted) {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const end = bytes.length - 22 - Buffer.byteLength("archive comment\n");
    const central = view.getUint32(end + 16, true) + prefix.length;
    view.setUint32(end + 16, central, true);
    view.setUint32(central + 42, view.getUint32(central + 42, true) + prefix.length, true);
  }
  await fs.writeFile("/work/sample.zip", bytes);
  assert.equal((await execute("zip", fs, ["--junk-sfx", "sample.zip", "-O", "out.zip"])).exitCode, 0);
  const archive = await readZipArchive(await fs.readFile("/work/out.zip"), settings({}), new AbortController().signal);
  assert.deepEqual(Buffer.from(archive.comment), Buffer.from("archive comment\n"));
  assert.deepEqual(Buffer.from(await fs.readFile("/work/sample.zip")), Buffer.from(bytes));
});

for (const info of [false, true]) test(`log overwrite and append, info=${info}`, async () => {
  const fs = await sources();
  await fs.writeFile("/work/run.log", Buffer.from("old\n"));
  const args = ["--logfile-path=run", ...(info ? ["--log-info"] : []), "sample.zip", "b"];
  assert.equal((await execute("zip", fs, args)).exitCode, 0);
  const first = await fs.readFile("/work/run.log");
  assert.equal(Buffer.from(first).toString(), info ? "  adding: b (stored 0%)\n" : "");
  assert.equal((await execute("zip", fs, ["--log-append", ...args])).exitCode, 0);
  assert.equal(Buffer.from(await fs.readFile("/work/run.log")).toString(), info ? "  adding: b (stored 0%)\nupdating: b (stored 0%)\n" : "");
});
for (const path of ["sample.zip", "a.log", "/missing/run"]) test(`log rejects unsafe ${path} and preserves sources`, async () => {
  const fs = await sources();
  const before = await fs.readFile("/work/sample.zip");
  await fs.writeFile("/work/a.log", Buffer.from("source log"));
  const result = await execute("zip", fs, ["-lf", path, "sample.zip", "a", "a.log"]);
  assert.equal(result.exitCode, 16, result.stdout.toString() + result.stderr);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  assert.equal(Buffer.from(await fs.readFile("/work/a")).toString(), "old");
});
test("logging warnings and status includes no test-command secrets", async () => {
  const fs = await sources();
  const result = await execute("zip", fs, ["-lf", "run", "sample.zip", "missing"]);
  assert.equal(result.exitCode, 12);
  const log = Buffer.from(await fs.readFile("/work/run.log")).toString();
  assert.match(log, /warning: name not matched: missing/);
  assert.match(log, /Nothing to do/);
  const failed = await execute("zip", fs, ["-lf", "run", "-T", "-TT", "verify", "sample.zip", "b"], {}, {
    async invoke() { throw new Error("secret=private-value"); },
  });
  assert.equal(failed.exitCode, 8);
  assert.doesNotMatch(Buffer.from(await fs.readFile("/work/run.log")).toString(), /private-value/);
});
test("log redacts supplied password bytes even in member names", async () => {
  const fs = await sources();
  await fs.writeFile("/work/private-value", Buffer.from("data"));
  const result = await execute("zip", fs, ["-Pprivate-value", "-lf", "run", "-li", "sample.zip", "private-value"], { zipHost: { entropy: length => new Uint8Array(length) } });
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.doesNotMatch(Buffer.from(await fs.readFile("/work/run.log")).toString(), /private-value/);
  assert.match(Buffer.from(await fs.readFile("/work/run.log")).toString(), /\[redacted\]/);
});
for (const short of [false, true]) test(`log appended byte boundary, short=${short}`, async () => {
  const fs = await sources();
  const message = "  adding: b (stored 0%)\n";
  const prefix = "x".repeat(30);
  await fs.writeFile("/work/run.log", Buffer.from(prefix));
  const result = await execute("zip", fs, ["-lf", "run", "-lali", "sample.zip", "b"], { limits: { maxTextBytes: prefix.length + message.length - Number(short) } });
  assert.equal(result.exitCode, short ? 11 : 0, result.stdout.toString() + result.stderr);
  assert.equal(Buffer.from(await fs.readFile("/work/run.log")).toString(), prefix + (short ? "" : message));
});
test("log cancellation preserves root identity and drains admitted VFS write", async () => {
  const fs = await sources();
  const controller = new AbortController();
  const reason = new Error("log cancellation");
  let settled = false;
  const guarded = new Proxy(fs, { get(target, property) {
    const value = Reflect.get(target, property);
    if (property === "writeFileConditional") return async (path: string, data: Uint8Array, ...args: unknown[]) => {
      if (path === "/work/run.log" && data.length) { controller.abort(reason); await Promise.resolve(); settled = true; throw reason; }
      return Reflect.apply(value, target, [path, data, ...args]);
    };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await assert.rejects(execute("zip", guarded, ["-lf", "run", "-li", "sample.zip", "b"], {}, { signal: controller.signal }), error => error === reason);
  assert.equal(settled, true);
});
for (const command of ["verify; echo x", "verify | other", "verify $(x)", "verify 'unterminated"]) test(`test-command grammar refuses ${command}`, async () => {
  const fs = await sources();
  assert.equal((await execute("zip", fs, ["-T", "-TT", command, "sample.zip", "b"])).exitCode, 16);
});
for (const outcome of ["status", "throw", "limit", "cancel"]) test(`virtual test-command ${outcome} prevents publication and move`, async () => {
  const fs = await sources();
  const before = await fs.readFile("/work/sample.zip");
  const controller = new AbortController();
  const reason = new Error("test command root abort");
  const run = execute("zip", fs, ["-Tm", "-TT", "verify {}", "sample.zip", "b"], { limits: { maxTextBytes: 1024 } }, {
    signal: controller.signal,
    async invoke(_command, _args, invocation) {
      if (outcome === "cancel") { controller.abort(reason); throw reason; }
      if (outcome === "throw") throw new Error("secret=private-value");
      if (outcome === "limit") await invocation!.stdout!.write(new Uint8Array(1025));
      return { exitCode: 19 };
    },
  });
  if (outcome === "cancel") await assert.rejects(run, error => error === reason);
  else { const result = await run; assert.equal(result.exitCode, 8); assert.doesNotMatch(result.stdout.toString() + result.stderr, /private-value/); }
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  assert.equal(Buffer.from(await fs.readFile("/work/b")).toString(), "new");
  assert.equal((await fs.readdir("/work")).some(entry => entry.name.startsWith(".zip-")), false);
});
test("help exposes remaining operations and virtual-only test-command contract", async () => {
  const result = await execute("zip", await sources(), ["-h2"]);
  for (const option of ["-DF", "-g", "-b", "-J", "-lf", "-la", "-li", "-TT"]) assert.ok(result.stdout.toString().includes(option), option);
  assert.match(result.stdout.toString(), /registered virtual/);
});

for (const flag of ["-DF", "-g", "-b.", "-J", "-lf=run"]) test(`${flag} pre-abort preserves exact reason without VFS effects`, async () => {
  const fs = await sources();
  const controller = new AbortController();
  controller.abort(false);
  const guarded = new Proxy(fs, { get(target, property) {
    const value = Reflect.get(target, property);
    return typeof value === "function" ? () => assert.fail("pre-abort touched VFS") : value;
  } });
  await assert.rejects(execute("zip", guarded, [flag, "sample.zip", "b", ...(flag === "-DF" ? ["-O", "diff.zip"] : [])], {}, { signal: controller.signal }), reason => reason === false);
});
test("temp path stdout spools inside VFS and cleans before completion", async () => {
  const fs = await sources();
  await fs.mkdir("/scratch");
  let staged = false;
  const guarded = new Proxy(fs, { get(target, property) {
    const value = Reflect.get(target, property);
    if (property === "createStagedFile") return (path: string, ...args: unknown[]) => {
      assert.equal(path, "/scratch/.zip-1"); staged = true; return Reflect.apply(value, target, [path, ...args]);
    };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await execute("zip", guarded, ["-b", "/scratch", "-", "b"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(staged, true);
  const archive = await readZipArchive(result.stdout, settings({}), new AbortController().signal);
  assert.deepEqual(archive.entries.map(entry => entry.name), ["b"]);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
for (const version of [10, 20, 45, 46]) test(`grow preserves admitted STORE extraction version ${version}`, async () => {
  const bytes = Buffer.from(await archiveBytes([{ name: "a", body: Buffer.from("old") }]));
  const central = bytes.indexOf(Buffer.from([80, 75, 1, 2]));
  bytes.writeUInt16LE(version, 4);
  bytes.writeUInt16LE(version, central + 6);
  const fs = await fixture(bytes);
  await fs.writeFile("/work/b", Buffer.from("new"));
  assert.equal((await execute("unzip", fs, ["-tqq", "sample.zip"])).exitCode, 0);
  const result = await execute("zip", fs, ["-qg", "sample.zip", "b"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const updated = Buffer.from(await fs.readFile("/work/sample.zip"));
  assert.deepEqual(updated.subarray(0, central), bytes.subarray(0, central));
  const checked = await execute("unzip", fs, ["-tqq", "sample.zip"]);
  assert.equal(checked.exitCode, 0, checked.stderr);
  assert.deepEqual((await execute("unzip", fs, ["-p", "sample.zip", "a"])).stdout, Buffer.from("old"));
  assert.deepEqual((await execute("unzip", fs, ["-p", "sample.zip", "b"])).stdout, Buffer.from("new"));
});
test("forcing ZIP64 rebuilds retained classic local records without losing grow ownership", async () => {
  const bytes = await archiveBytes([{ name: "a", body: Buffer.from("old") }]);
  const limits = settings({});
  const signal = new AbortController().signal;
  const archive = await readZipArchive(bytes, limits, signal, { grow: true });
  const wide = await writeZipArchive(archive, limits, signal, false, true);
  assert.deepEqual(await writeZipArchive(archive, { ...limits, maxArchiveBytes: wide.length }, signal, false, true), wide);
  await assert.rejects(writeZipArchive(archive, { ...limits, maxArchiveBytes: wide.length - 1 }, signal, false, true), /archive byte limit/);
  const controller = new AbortController();
  const reason = new Error("retained ZIP64 cancellation");
  controller.abort(reason);
  await assert.rejects(writeZipArchive(archive, limits, controller.signal, false, true), error => error === reason);
  const fs = await fixture(wide);
  const checked = await execute("unzip", fs, ["-tqq", "sample.zip"]);
  assert.equal(checked.exitCode, 0, checked.stderr);
  assert.deepEqual((await execute("unzip", fs, ["-p", "sample.zip", "a"])).stdout, Buffer.from("old"));
  assert.deepEqual(await writeZipArchive(archive, limits, signal), bytes);
});
for (const version of [9, 47]) test(`grow refuses unsupported STORE extraction version ${version} without publication`, async () => {
  const bytes = Buffer.from(await archiveBytes([{ name: "a", body: Buffer.from("old") }]));
  const central = bytes.indexOf(Buffer.from([80, 75, 1, 2]));
  bytes.writeUInt16LE(version, 4);
  bytes.writeUInt16LE(version, central + 6);
  const fs = await fixture(bytes);
  await fs.writeFile("/work/b", Buffer.from("new"));
  assert.equal((await execute("zip", fs, ["-qg", "sample.zip", "b"])).exitCode, 2);
  assert.deepEqual(Buffer.from(await fs.readFile("/work/sample.zip")), bytes);
});
for (const flags of [["-g", "-fd"], ["-g", "-fz"], ["-g", "-fz-"]]) test(`grow retained descriptor records remain valid with ${flags}`, async () => {
  const fs = await sources();
  assert.equal((await execute("zip", fs, ["-qfd", "descriptors.zip", "b"])).exitCode, 0);
  assert.equal((await execute("zip", fs, [...flags, "descriptors.zip", "a"])).exitCode, 0);
  assert.equal((await execute("unzip", fs, ["-tqq", "descriptors.zip"])).exitCode, 0);
});
for (const flags of [["-g"], ["-J"]]) test(`${flags} preserves forced ZIP64 input and archive comments`, async () => {
  const fs = await sources();
  assert.equal((await execute("zip", fs, ["-qfz", "wide.zip", "a"])).exitCode, 0);
  if (flags[0] === "-J") await fs.writeFile("/work/wide.zip", Buffer.concat([Buffer.from("MZ ZIP64"), await fs.readFile("/work/wide.zip")]));
  const result = await execute("zip", fs, [...flags, "wide.zip", "b"]);
  assert.equal(result.exitCode, 0, result.stderr + result.stdout);
  assert.equal((await execute("unzip", fs, ["-tqq", "wide.zip"])).exitCode, 0);
});
test("actual Shell registry dispatch tests staged default and custom archives", async () => {
  const fs = await sources();
  const shell = new Shell({ fs, cwd: "/work" }).use(archiveCommands());
  const paths: string[] = [];
  shell.commands.register({ name: "verify", async execute(context) {
    assert.deepEqual(context.args.slice(0, 2), ["--check", "two words"]);
    paths.push(context.args[2]!);
    const archive = await readZipArchive(await fs.readFile(context.args[2]!), settings({}), context.signal);
    assert.deepEqual(archive.entries.map(entry => entry.name), ["a", "b"]);
    return { exitCode: 0 };
  } });
  try {
    const first = await shell.exec("zip -T sample.zip b");
    assert.equal(first.exitCode, 0, first.stdout + first.stderr);
    const second = await shell.exec(`zip -T -TT 'verify --check "two words" {}' sample.zip b`);
    assert.equal(second.exitCode, 0, second.stdout + second.stderr);
    assert.equal(paths.length, 1);
    const missing = await shell.exec("zip -T -TT unavailable sample.zip b");
    assert.equal(missing.exitCode, 8, missing.stdout + missing.stderr);
    assert.equal((await fs.readdir("/work")).some(entry => entry.name.startsWith(".zip-")), false);
  } finally { await shell.dispose(); }
});
test("difference move removes only sources represented in the difference archive", async () => {
  const fs = await sources();
  const result = await execute("zip", fs, ["-DFm", "sample.zip", "a", "b", "-O", "diff.zip"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(await fs.readFile("/work/a")).toString(), "old");
  await assert.rejects(fs.stat("/work/b"), { code: "ENOENT" });
});

for (const flag of ["-g", "-b.", "-J", "-DF"]) test(`${flag} comment editing survives separate output`, async () => {
  const fs = await sources();
  const before = await fs.readFile("/work/sample.zip");
  const { toByteSource } = await import("../../src/contracts/index.js");
  const result = await execute("zip", fs, [flag, "-cz", "sample.zip", "b", "-O", "out.zip"], {}, { stdin: toByteSource("member comment\nchanged comment\n.\n") });
  assert.equal(result.exitCode, 0, result.stderr + result.stdout);
  const archive = await readZipArchive(await fs.readFile("/work/out.zip"), settings({}), new AbortController().signal);
  assert.equal(Buffer.from(archive.comment).toString(), "changed comment");
  assert.equal(Buffer.from(archive.entries.find(entry => entry.name === "b")!.comment!).toString(), "member comment");
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});
for (const action of [[], ["-u"], ["-f"], ["-d"], ["-U"], ["-FS"]]) test(`temp staging supports ${action} with separate output`, async () => {
  const fs = await sources();
  await fs.mkdir("/scratch");
  await fs.writeFile("/work/a", Buffer.from("changed"));
  await fs.utimes!("/work/a", modified.getTime() + 10000, modified.getTime() + 10000);
  const before = await fs.readFile("/work/sample.zip");
  const result = await execute("zip", fs, ["-b/scratch", ...action, "sample.zip", "a", "-O", "out.zip"]);
  assert.equal(result.exitCode, 0, result.stderr + result.stdout);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
for (const outcome of ["reject", "cancel"]) test(`temp stdout ${outcome} cleans owned staging`, async () => {
  const fs = await sources();
  await fs.mkdir("/scratch");
  const controller = new AbortController();
  const reason = new Error("stdout refused");
  const run = execute("zip", fs, ["-b/scratch", "-", "b"], {}, {
    signal: controller.signal,
    stdout: { async write() { if (outcome === "cancel") controller.abort(reason); throw reason; } },
  });
  if (outcome === "cancel") await assert.rejects(run, error => error === reason);
  else assert.equal((await run).exitCode, 2);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
test("test command cannot replace staged bytes and still publish with stale identity", async () => {
  const fs = await sources();
  const before = await fs.readFile("/work/sample.zip");
  const result = await execute("zip", fs, ["-T", "-TT", "verify {}", "sample.zip", "b"], {}, {
    async invoke(_name, args) { await fs.writeFile(args[0]!, Buffer.from("corrupt")); return { exitCode: 0 }; },
  });
  assert.equal(result.exitCode, 2);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  // External mutation invalidates the cleanup identity too: preserve those bytes.
  assert.equal(Buffer.from(await fs.readFile("/work/.zip-1/archive.zip")).toString(), "corrupt");
});
test("grow refuses overlapping input before retaining any local payload records", async () => {
  const { zipGrowRecords } = await import("../../src/commands/archive/zip/grow.js");
  const bytes = await archiveBytes([{ name: "a", body: Buffer.from("one") }, { name: "a", body: Buffer.from("one") }]);
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const end = bytes.length - 22 - Buffer.byteLength("archive comment\n");
  const first = view.getUint32(end + 16, true);
  const second = first + 46 + view.getUint16(first + 28, true) + view.getUint16(first + 30, true) + view.getUint16(first + 32, true);
  view.setUint32(second + 42, 0, true);
  const originalSet = zipGrowRecords.set;
  let retained = 0;
  zipGrowRecords.set = function(entry, bytes) { retained += bytes.length; return originalSet.call(this, entry, bytes); };
  try {
    await assert.rejects(readZipArchive(bytes, settings({}), new AbortController().signal, { grow: true }), /overlapping/);
    assert.equal(retained, 0);
  } finally { zipGrowRecords.set = originalSet; }
});
test("buffered BZIP2 descriptor records expose known local compressed spans", async () => {
  const fs = await sources();
  const result = await execute("zip", fs, ["-Zbzip2", "-fd", "-DF", "sample.zip", "b", "-O", "diff.zip"]);
  assert.equal(result.exitCode, 0);
  const bytes = await fs.readFile("/work/diff.zip");
  const entry = (await readZipArchive(bytes, settings({}), new AbortController().signal)).entries[0]!;
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  assert.equal(view.getUint16(6, true) & 8, 8);
  assert.equal(view.getUint32(18, true), entry.data.length);
  assert.equal(view.getUint32(22, true), entry.size);
});
for (const info of [false, true]) test(`quiet logging retains ${info ? "info" : "warnings"} without visible progress`, async () => {
  const fs = await sources();
  const result = await execute("zip", fs, ["-q", "-lf", "run", ...(info ? ["-li"] : []), "sample.zip", "b", "missing"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, 0);
  const log = Buffer.from(await fs.readFile("/work/run.log")).toString();
  assert.match(log, info ? /adding: b/ : /warning: name not matched: missing/);
});
for (const flags of [[], ["-la"], ["-q"], ["-sd"], ["-li"]]) test(`log wildcard refusal preserves existing source bytes with ${flags}`, async () => {
  const fs = await sources();
  await fs.writeFile("/work/run.log", Buffer.from("source log bytes"));
  const before = await fs.readFile("/work/sample.zip");
  const result = await execute("zip", fs, [...flags, "-lf", "run", "-R", "sample.zip", "*.log"]);
  assert.equal(result.exitCode, 16, result.stderr + result.stdout);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  assert.equal(Buffer.from(await fs.readFile("/work/run.log")).toString(), "source log bytes");
});
test("recursive selection excluding the log still writes eligible progress", async () => {
  const fs = await sources();
  await fs.writeFile("/work/run.log", Buffer.from("old log"));
  const result = await execute("zip", fs, ["-lf", "run", "-li", "-R", "sample.zip", "*", "-x", "*.log"]);
  assert.equal(result.exitCode, 0, result.stderr + result.stdout);
  assert.doesNotMatch(Buffer.from(await fs.readFile("/work/run.log")).toString(), /old log/);
  assert.match(Buffer.from(await fs.readFile("/work/run.log")).toString(), /adding: b/);
  assert.equal((await names(fs, "/work/sample.zip")).includes("run.log"), false);
});
test("selection budget refusal cannot overwrite an unvisited log source", async () => {
  const fs = await sources();
  await fs.writeFile("/work/run.log", Buffer.from("unvisited source log"));
  const result = await execute("zip", fs, ["-lf", "run", "-R", "sample.zip", "*.log"], { limits: { maxMembers: 2 } });
  assert.notEqual(result.exitCode, 0);
  assert.equal(Buffer.from(await fs.readFile("/work/run.log")).toString(), "unvisited source log");
});
test("deferred log opening refusal preserves existing log, archive and move source", async () => {
  const fs = await sources();
  await fs.writeFile("/work/run.log", Buffer.from("old log"));
  const before = await fs.readFile("/work/sample.zip");
  const guarded = new Proxy(fs, { get(target, property) {
    const value = Reflect.get(target, property);
    if (property === "writeFileConditional") return () => { throw new Error("log opening refused"); };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await execute("zip", guarded, ["-lf", "run", "-m", "sample.zip", "b"]);
  assert.equal(result.exitCode, 16, result.stderr + result.stdout);
  assert.equal(Buffer.from(await fs.readFile("/work/run.log")).toString(), "old log");
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  assert.equal(Buffer.from(await fs.readFile("/work/b")).toString(), "new");
});
for (const flag of ["-DF", "-g", "-b.", "-J"]) test(`${flag} exact archive byte boundary and one-byte-short refusal`, async () => {
  const first = await sources();
  const args = [flag, "sample.zip", "b", ...(flag === "-DF" ? ["-O", "diff.zip"] : [])];
  assert.equal((await execute("zip", first, args)).exitCode, 0);
  const outputSize = (await first.stat(flag === "-DF" ? "/work/diff.zip" : "/work/sample.zip")).size;
  for (const short of [false, true]) {
    const fs = await sources();
    const before = await fs.readFile("/work/sample.zip");
    const boundary = Math.max(before.length, outputSize);
    const result = await execute("zip", fs, args, { limits: { maxArchiveBytes: boundary - Number(short) } });
    assert.equal(result.exitCode, short ? 2 : 0, result.stderr + result.stdout);
    if (short) assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  }
});
for (const short of [false, true]) test(`test-command expanded argv boundary, short=${short}`, async () => {
  const fs = await sources();
  const expected = "/work/.zip-1/archive.zip".repeat(20);
  let called = false;
  const result = await execute("zip", fs, ["-T", "-TT", `verify ${"{}".repeat(20)}`, "sample.zip", "b"], { limits: { maxArgumentBytes: Buffer.byteLength(expected) + 1 - Number(short) } }, {
    async invoke(_name, args) { called = true; assert.deepEqual(args, [expected]); return { exitCode: 0 }; },
  });
  assert.equal(result.exitCode, short ? 8 : 0, result.stdout.toString() + result.stderr);
  assert.equal(called, !short);
});
for (const flag of ["-g", "-DF"]) test(`${flag} does not silently lose untouched duplicate archive members`, async () => {
  const fs = await fixture(await archiveBytes([{ name: "a", body: Buffer.from("one") }, { name: "a", body: Buffer.from("two") }]));
  await fs.writeFile("/work/b", Buffer.from("new"));
  const result = await execute("zip", fs, [flag, "sample.zip", "b", ...(flag === "-DF" ? ["-O", "out.zip"] : [])]);
  assert.equal(result.exitCode, 0, result.stderr + result.stdout);
  assert.deepEqual(await names(fs, flag === "-DF" ? "/work/out.zip" : "/work/sample.zip"), flag === "-DF" ? ["b"] : ["a", "a", "b"]);
});
test("stdout spooling registered cleanup waits for owned staging retirement", async () => {
  const fs = await sources();
  await fs.mkdir("/scratch");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let acquired!: () => void;
  const removing = new Promise<void>(resolve => { acquired = resolve; });
  const callbacks: (() => void | Promise<void>)[] = [];
  const controller = new AbortController();
  const reason = new Error("retire stdout spool");
  const guarded = new Proxy(fs, { get(target, property) {
    const value = Reflect.get(target, property);
    if (property === "removeStagedFile") return async (...args: unknown[]) => { acquired(); await gate; return Reflect.apply(value, target, args); };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const execution = execute("zip", guarded, ["-b/scratch", "-", "b"], {}, {
    signal: controller.signal, registerCleanup(callback) { callbacks.push(callback); },
    stdout: { async write() { controller.abort(reason); throw reason; } },
  });
  const rejected = assert.rejects(execution, error => error === reason);
  await removing;
  let settled = false;
  const cleanup = Promise.all(callbacks.map(callback => callback())).then(() => { settled = true; });
  for (let turn = 0; turn < 8; turn++) await new Promise<void>(resolve => setImmediate(resolve));
  try { assert.equal(settled, false); }
  finally { release(); await cleanup; await rejected; }
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
