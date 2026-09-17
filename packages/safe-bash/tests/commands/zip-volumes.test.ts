import assert from "node:assert/strict";
import test from "node:test";
import { createZipCommand } from "../../src/commands/archive/zip.js";
import { createUnzipCommand } from "../../src/commands/archive/unzip.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { toByteSource, type CommandContext } from "../../src/contracts/index.js";
import type { ArchiveCommandsOptions } from "../../src/commands/archive/internal.js";
import { settings } from "../../src/commands/archive/internal.js";
import { splitSize, splitZipVolumes, volumeName } from "../../src/commands/archive/zip/volumes.js";
import { makeZipEntry, writeZipArchive, readZipArchive, decodeZipEntry } from "../../src/commands/archive/zip-format.js";
import { collectBytes } from "../../src/contracts/index.js";
import native from "./fixtures/zip-volumes-infozip.json" with { type: "json" };
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { archiveCommands } from "../../src/commands/archive/index.js";

async function run(fs: CommandContext["fs"], command: "zip" | "unzip", args: string[], options: ArchiveCommandsOptions = {}, signal = new AbortController().signal, registerCleanup?: CommandContext["registerCleanup"]) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await (command === "zip" ? createZipCommand(options) : createUnzipCommand(options)).execute({
    command, args, cwd: "/", env: {}, fs, signal, stdin: toByteSource(new Uint8Array()), ...(registerCleanup ? { registerCleanup } : {}),
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
  });
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

test("zip -s 64k emits split signature and relative offsets instead of rejecting -s", async () => {
  const fs = createMemoryFileSystem();
  const payload = Uint8Array.from({ length: 150000 }, (_, i) => i % 251);
  await fs.writeFile("/file", payload);
  const result = await run(fs, "zip", ["-q", "-0", "-s", "64k", "archive.zip", "file"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const first = await fs.readFile("/archive.z01");
  assert.equal(first.length, 65536);
  assert.equal(new DataView(first.buffer, first.byteOffset).getUint32(0, true), 0x08074b50);
  assert.equal((await fs.readFile("/archive.z02")).length, 65536);
  const extracted = await run(fs, "unzip", ["-p", "archive.zip"], resolver);
  assert.equal(extracted.exitCode, 0, extracted.stderr);
  assert.deepEqual(extracted.stdout, Buffer.from(payload));
});

const resolver: ArchiveCommandsOptions = { zipHost: { volume: ({ archive, disk, disks }) => volumeName(archive, disk, disks) } };
const limits = settings({});

for (const size of [0, 1, 65490, 65491, 65500, 65536, 70000, 131000, 150000]) {
  for (const wide of [false, true]) {
    test(`split copy/recombine and unzip preserves ${size} bytes, ZIP64=${wide}`, async () => {
      const fs = createMemoryFileSystem();
      const payload = Uint8Array.from({ length: size }, (_, i) => i % 251);
      await fs.writeFile("/file", payload);
      const zipped = await run(fs, "zip", ["-q", "-0", "-s64k", ...(wide ? ["-fz"] : []), "archive.zip", "file"]);
      assert.equal(zipped.exitCode, 0, zipped.stderr);
      const extracted = await run(fs, "unzip", ["-p", "archive.zip"], resolver);
      assert.equal(extracted.exitCode, 0, extracted.stderr);
      assert.deepEqual(extracted.stdout, Buffer.from(payload));
      const copied = await run(fs, "zip", ["-q", "-s0", "archive.zip", "--output-file=joined.zip"], resolver);
      assert.equal(copied.exitCode, 0, copied.stderr);
      const joined = await run(fs, "unzip", ["-p", "joined.zip"]);
      assert.equal(joined.exitCode, 0, joined.stderr);
      assert.deepEqual(joined.stdout, Buffer.from(payload));
    });
  }
}

for (const value of ["", "1k", "63k", "1024", "-1", "64kb", "1.5m", "9007199254740991t"]) {
  test(`split size refuses ${JSON.stringify(value)}`, () => assert.throws(() => splitSize(value)));
}
for (const [value, expected] of [["0", 0], ["64k", 65536], ["65536", 65536], ["1", 1048576], ["2M", 2097152], ["1g", 1073741824]] as const) {
  test(`split size accepts ${value}`, () => assert.equal(splitSize(value), expected));
}

for (const mode of ["missing", "repeat", "order", "final-alias", "none"] as const) {
  test(`input ${mode} volumes refuse without extraction or publication`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/file", new Uint8Array(150000).fill(42));
    assert.equal((await run(fs, "zip", ["-q", "-0", "-s64k", "archive.zip", "file"])).exitCode, 0);
    await fs.writeFile("/joined.zip", Uint8Array.of(9, 8, 7));
    const bad: ArchiveCommandsOptions = mode === "none" ? {} : { zipHost: { volume: ({ disk }) => mode === "missing" ? undefined : mode === "final-alias" ? "/archive.zip" : mode === "repeat" ? "/archive.z01" : disk === 0 ? "/archive.z02" : "/archive.z01" } };
    assert.notEqual((await run(fs, "unzip", ["archive.zip", "-d", "output"], bad)).exitCode, 0);
    await assert.rejects(fs.lstat("/output"), { code: "ENOENT" });
    assert.notEqual((await run(fs, "zip", ["-q", "-s0", "archive.zip", "-O", "joined.zip"], bad)).exitCode, 0);
    assert.deepEqual(await fs.readFile("/joined.zip"), Uint8Array.of(9, 8, 7));
  });
}

for (const wide of [false, true]) {
  test(`descriptor ending exactly at rollover, ZIP64=${wide}`, async () => {
    const signal = new AbortController().signal;
    const entry = await makeZipEntry("x", new Uint8Array(wide ? 65448 : 65476).fill(99), { modified: new Date("2020-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false }, limits, signal, 0);
    const input = await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal, true, wide);
    const parts = await splitZipVolumes(input, 65536, limits, signal);
    assert.ok(parts.every(part => part.length <= 65536));
    assert.equal(parts[0]!.length, 65536);
    const bytes = Buffer.concat(parts), starts: number[] = [];
    let total = 0;
    for (const part of parts) { starts.push(total); total += part.length; }
    const archive = await readZipArchive(bytes, limits, signal, { disks: { starts, lengths: parts.map(part => part.length) } });
    const payload = await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), { maxBytes: 70000, signal });
    assert.deepEqual(payload, entry.data);
  });
}

test("split encrypted members and copied ciphertext survive payload rollover", async () => {
  const fs = createMemoryFileSystem();
  const payload = new Uint8Array(150000).fill(42);
  await fs.writeFile("/file", payload);
  const host = { ...resolver.zipHost, entropy: (length: number) => new Uint8Array(length).fill(77) };
  const zipped = await run(fs, "zip", ["-q", "-0", "-P", "secret", "-s64k", "archive.zip", "file"], { zipHost: host });
  assert.equal(zipped.exitCode, 0, zipped.stderr);
  const extracted = await run(fs, "unzip", ["-p", "-P", "secret", "archive.zip"], resolver);
  assert.equal(extracted.exitCode, 0, extracted.stderr);
  assert.deepEqual(extracted.stdout, Buffer.from(payload));
  assert.notEqual((await run(fs, "unzip", ["-t", "-P", "wrong", "archive.zip"], resolver)).exitCode, 0);
  const copied = await run(fs, "zip", ["-q", "-s0", "archive.zip", "-O", "joined.zip"], resolver);
  assert.equal(copied.exitCode, 0, copied.stderr);
  const joined = await run(fs, "unzip", ["-p", "-P", "secret", "joined.zip"]);
  assert.equal(joined.exitCode, 0, joined.stderr);
  assert.deepEqual(joined.stdout, Buffer.from(payload));
});

for (const mode of ["reject-prompt", "cancel-prompt", "stage-error", "bad-destination"]) {
  test(`${mode} preserves every existing volume and removes owned stages`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/file", new Uint8Array(150000));
    for (const name of ["archive.z01", "archive.z02", "archive.zip"]) await fs.writeFile(`/${name}`, Uint8Array.of(1, 2, 3));
    await fs.mkdir("/.zip-1");
    await fs.writeFile("/.zip-1/user", Uint8Array.of(7));
    // Separate input bypasses treating the existing final destination as an input archive.
    assert.equal((await run(fs, "zip", ["-q", "-0", "input.zip", "file"])).exitCode, 0);
    const controller = new AbortController();
    if (mode === "stage-error") {
      const create = fs.createStagedFile!.bind(fs); let calls = 0;
      fs.createStagedFile = async (...args) => { if (++calls === 3) throw new Error("stage fault"); return create(...args); };
    }
    if (mode === "bad-destination") { await fs.rm("/archive.z02"); await fs.mkdir("/archive.z02"); }
    const options: ArchiveCommandsOptions = { zipHost: { volumePrompt: () => { if (mode === "cancel-prompt") controller.abort(new Error("stop")); return mode !== "reject-prompt"; } } };
    const action = run(fs, "zip", ["-q", "-s64k", "-sp", "input.zip", "-O", "archive.zip"], options, controller.signal);
    if (mode === "cancel-prompt") await assert.rejects(action, /stop/);
    else assert.notEqual((await action).exitCode, 0);
    for (const name of ["archive.z01", "archive.zip", ...(mode === "bad-destination" ? [] : ["archive.z02"])]) assert.deepEqual(await fs.readFile(`/${name}`), Uint8Array.of(1, 2, 3));
    assert.deepEqual(await fs.readFile("/.zip-1/user"), Uint8Array.of(7));
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).filter(name => name.startsWith(".zip-")), [".zip-1"]);
  });
}

test("pause is explicit, verbose and bell use bounded byte output", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array(150000));
  assert.equal((await run(fs, "zip", ["-q", "-0", "-s64k", "-sp", "archive.zip", "file"])).exitCode, 16);
  await assert.rejects(fs.lstat("/archive.zip"), { code: "ENOENT" });
  const requests: number[] = [];
  const result = await run(fs, "zip", ["-0", "--split-size=64k", "--split-pause", "--split-bell", "--split-verbose", "archive.zip", "file"], { zipHost: { volumePrompt: ({ disk }) => { requests.push(disk); return true; } } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(requests, [1, 2]);
  assert.equal(result.stdout.filter(byte => byte === 7).length, 2);
  assert.match(result.stdout.toString(), /split 3\/3/);
  const first = await fs.readFile("/archive.z01");
  assert.equal(new DataView(first.buffer, first.byteOffset).getUint16(10, true) & 8, 8);
});

test("pre-abort produces no volumes", async () => {
  const fs = createMemoryFileSystem(); const controller = new AbortController();
  controller.abort(new Error("early stop"));
  await assert.rejects(run(fs, "zip", ["-s64k", "a.zip", "file"], {}, controller.signal), /early stop/);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("pinned native split volumes extract and recombine through VFS only", async () => {
  const payload = Uint8Array.from({ length: native.payloadLength }, (_, i) => i % native.payloadModulus);
  const data = Buffer.concat([Buffer.from(native.prefix, "base64"), payload, Buffer.from(native.tail, "base64")]);
  const fs = createMemoryFileSystem(); let offset = 0;
  for (let disk = 0; disk < native.lengths.length; disk++) {
    await fs.writeFile(volumeName("/native.zip", disk, native.lengths.length), data.subarray(offset, offset + native.lengths[disk]!));
    offset += native.lengths[disk]!;
  }
  const result = await run(fs, "unzip", ["-p", "native.zip"], resolver);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, Buffer.from(payload));
  const copied = await run(fs, "zip", ["-q", "-s0", "native.zip", "-O", "joined.zip"], resolver);
  assert.equal(copied.exitCode, 0, copied.stderr);
  assert.deepEqual((await run(fs, "unzip", ["-p", "joined.zip"])).stdout, Buffer.from(payload));
});

for (const where of ["local", "descriptor", "central"]) {
  test(`reader refuses a ${where} record straddling disks`, async () => {
    const signal = new AbortController().signal;
    const entry = await makeZipEntry("x", Uint8Array.of(42), { modified: new Date("2020-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false }, limits, signal, 0);
    const parts = await splitZipVolumes(await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal, true), 65536, limits, signal);
    const bytes = parts[0]!, view = new DataView(bytes.buffer), end = bytes.length - 22;
    const central = view.getUint32(end + 16, true);
    const boundary = where === "local" ? 5 : where === "central" ? central + 1 : central - 15;
    view.setUint16(end + 4, 1, true);
    view.setUint16(end + 6, where === "central" ? 0 : 1, true);
    view.setUint16(end + 8, where === "central" ? 0 : 1, true);
    if (where !== "central") view.setUint32(end + 16, central - boundary, true);
    await assert.rejects(readZipArchive(bytes, limits, signal, { disks: { starts: [0, boundary], lengths: [boundary, bytes.length - boundary] } }), /record.*volume|straddl/);
  });
}

test("split destination cannot replace an archived source volume name", async () => {
  const fs = createMemoryFileSystem(); const payload = new Uint8Array(150000);
  await fs.writeFile("/archive.z01", payload);
  const result = await run(fs, "zip", ["-q", "-0", "-s64k", "archive.zip", "archive.z01"]);
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(await fs.readFile("/archive.z01"), payload);
  await assert.rejects(fs.lstat("/archive.zip"), { code: "ENOENT" });
});

test("recombine refuses overwriting an earlier input volume", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array(150000));
  assert.equal((await run(fs, "zip", ["-q", "-0", "-s64k", "archive.zip", "file"])).exitCode, 0);
  const before = await fs.readFile("/archive.z01");
  assert.notEqual((await run(fs, "zip", ["-q", "-s0", "archive.zip", "-O", "archive.z01"], resolver)).exitCode, 0);
  assert.deepEqual(await fs.readFile("/archive.z01"), before);
});

test("split destination cannot replace the target of a source symlink", async () => {
  const fs = createMemoryFileSystem(); const payload = new Uint8Array(150000);
  await fs.writeFile("/archive.z01", payload); await fs.symlink!("/archive.z01", "/source");
  const result = await run(fs, "zip", ["-q", "-0", "-s64k", "archive.zip", "source"]);
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(await fs.readFile("/archive.z01"), payload);
});

test("publication is per-volume, with every stage acquired before publishing", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(150000));
  assert.equal((await run(fs, "zip", ["-q", "-0", "input.zip", "file"])).exitCode, 0);
  for (const suffix of ["z01", "z02", "zip"]) await fs.writeFile(`/archive.${suffix}`, Uint8Array.of(9));
  const publish = fs.publishStagedFile!.bind(fs); let calls = 0;
  fs.publishStagedFile = async (...args) => {
    if (++calls === 1) assert.equal((await fs.readdir("/")).filter(entry => entry.name.startsWith(".zip-volume-")).length, 3);
    if (calls === 2) throw new Error("publish fault");
    return publish(...args);
  };
  const result = await run(fs, "zip", ["-q", "-s64k", "input.zip", "-O", "archive.zip"]);
  assert.notEqual(result.exitCode, 0);
  assert.equal((await fs.readFile("/archive.z01")).length, 65536);
  assert.deepEqual(await fs.readFile("/archive.z02"), Uint8Array.of(9));
  assert.deepEqual(await fs.readFile("/archive.zip"), Uint8Array.of(9));
  assert.deepEqual((await fs.readdir("/")).filter(entry => entry.name.startsWith(".zip-volume-")), []);
});

test("central directory rolls at complete variable-length record boundaries", async () => {
  const signal = new AbortController().signal;
  const entries = [];
  for (const name of ["a", "b"]) {
    const entry = await makeZipEntry(name, Uint8Array.of(42), { modified: new Date("2020-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false }, limits, signal, 0);
    entry.comment = new Uint8Array(40000).fill(65); entries.push(entry);
  }
  const parts = await splitZipVolumes(await writeZipArchive({ entries, comment: new Uint8Array() }, limits, signal), 65536, limits, signal);
  assert.equal(parts.length, 2); assert.ok(parts[0]!.length < 65536);
  const bytes = Buffer.concat(parts);
  const parsed = await readZipArchive(bytes, limits, signal, { disks: { starts: [0, parts[0]!.length], lengths: parts.map(part => part.length) } });
  assert.deepEqual(parsed.entries.map(entry => entry.name), ["a", "b"]);
});

for (const method of ["deflate", "bzip2"] as const) {
  test(`split ${method} payload and descriptors across three volumes`, async () => {
    const fs = createMemoryFileSystem(); let state = 42;
    const payload = Uint8Array.from({ length: 150000 }, () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state & 255; });
    await fs.writeFile("/file", payload);
    const zipped = await run(fs, "zip", ["-q", "-Z", method, "-fd", "-s64k", "archive.zip", "file"]);
    assert.equal(zipped.exitCode, 0, zipped.stderr);
    const extracted = await run(fs, "unzip", ["-p", "archive.zip"], resolver);
    assert.equal(extracted.exitCode, 0, extracted.stderr);
    assert.deepEqual(extracted.stdout, Buffer.from(payload));
  });
}

test("cancellation while resolving an input disk preserves all inputs and destination", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(150000));
  assert.equal((await run(fs, "zip", ["-q", "-0", "-s64k", "archive.zip", "file"])).exitCode, 0);
  await fs.writeFile("/joined.zip", Uint8Array.of(9));
  const before = await fs.readFile("/archive.z01"), controller = new AbortController();
  await assert.rejects(run(fs, "zip", ["-q", "-s0", "archive.zip", "-O", "joined.zip"], { zipHost: { volume: () => { controller.abort(new Error("read stop")); return "/archive.z01"; } } }, controller.signal), /read stop/);
  assert.deepEqual(await fs.readFile("/archive.z01"), before);
  assert.deepEqual(await fs.readFile("/joined.zip"), Uint8Array.of(9));
});

test("registered cleanup waits for cooperative owned stage retirement", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(150000));
  const controller = new AbortController(), cleanups: Array<() => void | Promise<void>> = [];
  let entered!: () => void, release!: () => void;
  const retiring = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const remove = fs.removeStagedFile!.bind(fs);
  fs.removeStagedFile = async (...args) => { entered(); await gate; return remove(...args); };
  const executing = run(fs, "zip", ["-q", "-0", "-s64k", "-sp", "archive.zip", "file"], { zipHost: { volumePrompt: () => { controller.abort(new Error("retire stop")); return false; } } }, controller.signal, close => cleanups.push(close));
  const rejected = assert.rejects(executing, /retire stop/);
  await retiring;
  let closed = false;
  const closing = Promise.all(cleanups.map(close => close())).then(() => { closed = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  try { assert.equal(closed, false); } finally { release(); await closing; await rejected; }
  assert.deepEqual((await fs.readdir("/")).filter(entry => entry.name.startsWith(".zip-volume-")), []);
});

test("Shell args and SDK use the same volume resolver, prompts and virtual -T dispatch", async () => {
  const fs = createMemoryFileSystem(); const payload = new Uint8Array(70000).fill(99);
  await fs.writeFile("/file", payload);
  const requests: number[] = [];
  const shell = new Shell({ fs, cwd: "/" }).use(archiveCommands({ zipHost: { ...resolver.zipHost, volumePrompt: ({ disk }) => { requests.push(disk); return true; } } }));
  try {
    const created = await shell.exec("zip -q -0 -s64k -sp -T archive.zip file");
    assert.equal(created.exitCode, 0, created.stderr);
    assert.deepEqual(requests, [1]);
    const result = await shell.exec("unzip -p archive.zip");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, payload);
    assert.equal((await shell.exec("zip -q -s0 archive.zip -O joined.zip")).exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const mutation of ["signature", "disk-count", "locator-offset", "locator-disk", "central-disk", "member-disk", "member-offset", "per-disk-count", "payload"]) {
  test(`multi-disk negative control: ${mutation}`, async () => {
    const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(70000));
    assert.equal((await run(fs, "zip", ["-q", "-0", "-fz", "-s64k", "archive.zip", "file"])).exitCode, 0);
    const final = await fs.readFile("/archive.zip"), view = new DataView(final.buffer, final.byteOffset), end = final.length - 22;
    const central = Number(view.getBigUint64(end - 20 - 56 + 48, true));
    if (mutation === "signature" || mutation === "payload") {
      const first = await fs.readFile("/archive.z01"), position = mutation === "signature" ? 0 : 65535;
      first[position] = first[position]! ^ 1;
      await fs.writeFile("/archive.z01", first);
    } else {
      if (mutation === "disk-count") view.setUint32(end - 4, 3, true);
      if (mutation === "locator-offset") view.setBigUint64(end - 12, 9007199254740992n, true);
      if (mutation === "locator-disk") view.setUint32(end - 16, 2, true);
      if (mutation === "central-disk") view.setUint16(end + 6, 2, true);
      if (mutation === "member-disk") view.setUint16(central + 34, 2, true);
      if (mutation === "member-offset") view.setUint32(central + 42, 65536, true);
      if (mutation === "per-disk-count") view.setUint16(end + 8, 2, true);
      await fs.writeFile("/archive.zip", final);
    }
    const result = await run(fs, "unzip", ["-t", "archive.zip"], resolver);
    assert.notEqual(result.exitCode, 0, result.stderr);
  });
}

test("record too large for a volume refuses all publication", async () => {
  const signal = new AbortController().signal;
  const entry = await makeZipEntry("x", new Uint8Array(), { modified: new Date("2020-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false }, limits, signal, 0);
  entry.comment = new Uint8Array(65535);
  await assert.rejects(splitZipVolumes(await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal), 65536, limits, signal), /record cannot fit/);
});

test("aggregate input volume budget is enforced before recombination", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(150000));
  assert.equal((await run(fs, "zip", ["-q", "-0", "-s64k", "archive.zip", "file"])).exitCode, 0);
  await fs.writeFile("/joined.zip", Uint8Array.of(9));
  const result = await run(fs, "zip", ["-q", "-s0", "archive.zip", "-O", "joined.zip"], { ...resolver, limits: { maxArchiveBytes: 100000 } });
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(await fs.readFile("/joined.zip"), Uint8Array.of(9));
});

test("ZIP64 sentinel per-disk count still validates the actual wide count", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(70000));
  assert.equal((await run(fs, "zip", ["-q", "-0", "-fz", "-s64k", "archive.zip", "file"])).exitCode, 0);
  const final = await fs.readFile("/archive.zip"), view = new DataView(final.buffer, final.byteOffset), end = final.length - 22;
  view.setUint16(end + 8, 65535, true);
  await fs.writeFile("/archive.zip", final);
  assert.equal((await run(fs, "unzip", ["-t", "archive.zip"], resolver)).exitCode, 0);
  view.setBigUint64(end - 76 + 24, 2n, true);
  await fs.writeFile("/archive.zip", final);
  assert.notEqual((await run(fs, "unzip", ["-t", "archive.zip"], resolver)).exitCode, 0);
});

test("ZIP64 locator may refer to the end record on the preceding disk", async () => {
  const signal = new AbortController().signal;
  const entry = await makeZipEntry("x", Uint8Array.of(42), { modified: new Date("2020-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false }, limits, signal, 0);
  const [bytes] = await splitZipVolumes(await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal, false, true), 65536, limits, signal);
  const view = new DataView(bytes!.buffer), end = bytes!.length - 22, boundary = end - 20;
  view.setUint16(end + 4, 1, true); view.setUint16(end + 8, 0, true); view.setUint32(end - 4, 2, true);
  const parsed = await readZipArchive(bytes!, limits, signal, { disks: { starts: [0, boundary], lengths: [boundary, bytes!.length - boundary] } });
  assert.equal(parsed.entries[0]!.name, "x");
});

test("copy preserves a split input profile unless -s0 explicitly recombines", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(150000));
  assert.equal((await run(fs, "zip", ["-q", "-0", "-s64k", "archive.zip", "file"])).exitCode, 0);
  const copied = await run(fs, "zip", ["-q", "archive.zip", "-O", "copied.zip"], resolver);
  assert.equal(copied.exitCode, 0, copied.stderr);
  assert.equal((await fs.readFile("/copied.z01")).length, 65536);
  assert.equal((await run(fs, "unzip", ["-t", "copied.zip"], resolver)).exitCode, 0);
});

test("ZIP64 member disk numbers resolve from the four-byte extra field", async () => {
  const signal = new AbortController().signal;
  const entry = await makeZipEntry("x", Uint8Array.of(42), { modified: new Date("2020-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false }, limits, signal, 0);
  const [original] = await splitZipVolumes(await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal, false, true), 65536, limits, signal);
  const old = new DataView(original!.buffer), oldEnd = original!.length - 22, central = Number(old.getBigUint64(oldEnd - 76 + 48, true));
  const field = central + 46 + old.getUint16(central + 28, true);
  const insertion = field + 4 + old.getUint16(field + 2, true);
  const bytes = Buffer.concat([original!.subarray(0, insertion), new Uint8Array(4), original!.subarray(insertion)]);
  const view = new DataView(bytes.buffer, bytes.byteOffset), end = oldEnd + 4;
  view.setUint16(central + 34, 65535, true);
  view.setUint16(central + 30, old.getUint16(central + 30, true) + 4, true);
  view.setUint16(field + 2, old.getUint16(field + 2, true) + 4, true);
  view.setBigUint64(end - 76 + 40, old.getBigUint64(oldEnd - 76 + 40, true) + 4n, true);
  view.setBigUint64(end - 12, old.getBigUint64(oldEnd - 12, true) + 4n, true);
  view.setUint32(end + 12, old.getUint32(oldEnd + 12, true) + 4, true);
  const profile = { disks: { starts: [0], lengths: [bytes.length] } };
  assert.equal((await readZipArchive(bytes, limits, signal, profile)).entries[0]!.name, "x");
  view.setUint32(insertion, 1, true);
  await assert.rejects(readZipArchive(bytes, limits, signal, profile), /disk offset/);
});

test("Shell output budget counts every volume including the four-byte split signature", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(70000));
  assert.equal((await run(fs, "zip", ["-q", "-0", "-s64k", "archive.zip", "file"])).exitCode, 0);
  const total = (await fs.readFile("/archive.z01")).length + (await fs.readFile("/archive.zip")).length;
  await fs.rm("/archive.z01"); await fs.rm("/archive.zip");
  const shell = new Shell({ fs, cwd: "/", limits: { maxOutputBytes: total - 1 } }).use(archiveCommands());
  try {
    await assert.rejects(shell.exec("zip -q -0 -s64k archive.zip file"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    await assert.rejects(fs.lstat("/archive.zip"), { code: "ENOENT" });
    await assert.rejects(fs.lstat("/archive.z01"), { code: "ENOENT" });
    assert.deepEqual((await fs.readdir("/")).filter(entry => entry.name.startsWith(".zip-volume-")), []);
  } finally { await shell.dispose(); }
});

test("extraction cannot replace any preceding input volume", async () => {
  const signal = new AbortController().signal, fs = createMemoryFileSystem();
  const entry = await makeZipEntry("archive.z01", new Uint8Array(70000), { modified: new Date("2020-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false }, limits, signal, 0);
  const parts = await splitZipVolumes(await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal), 65536, limits, signal);
  for (let disk = 0; disk < parts.length; disk++) await fs.writeFile(volumeName("/archive.zip", disk, parts.length), parts[disk]!);
  const result = await run(fs, "unzip", ["-o", "archive.zip"], resolver);
  assert.notEqual(result.exitCode, 0);
  for (let disk = 0; disk < parts.length; disk++) assert.deepEqual(await fs.readFile(volumeName("/archive.zip", disk, parts.length)), parts[disk]);
});

test("logging cannot alias a preceding split input volume", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(150000));
  assert.equal((await run(fs, "zip", ["-q", "-0", "-s64k", "archive.zip", "file"])).exitCode, 0);
  const first = await fs.readFile("/archive.z01");
  assert.notEqual((await run(fs, "zip", ["-q", "-s0", "archive.zip", "-O", "joined.zip", "-lf", "archive.z01"], resolver)).exitCode, 0);
  assert.deepEqual(await fs.readFile("/archive.z01"), first);
  await assert.rejects(fs.lstat("/joined.zip"), { code: "ENOENT" });
});

test("logging cannot alias a generated volume before rejected prompt publication", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(150000));
  await fs.writeFile("/archive.z01", Uint8Array.of(7, 8, 9));
  const result = await run(fs, "zip", ["-q", "-0", "-s64k", "-sp", "-lf", "archive.z01", "archive.zip", "file"], { zipHost: { volumePrompt: () => false } });
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(await fs.readFile("/archive.z01"), Uint8Array.of(7, 8, 9));
});

for (const commentSize of [65450, 65500, 65514]) test(`ZIP64 end records may roll individually before a ${commentSize}-byte EOCD comment`, async () => {
  const signal = new AbortController().signal;
  const entry = await makeZipEntry("x", Uint8Array.of(42), { modified: new Date("2020-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false }, limits, signal, 0);
  const comment = new Uint8Array(commentSize).fill(65);
  const parts = await splitZipVolumes(await writeZipArchive({ entries: [entry], comment }, limits, signal, false, true), 65536, limits, signal);
  assert.equal(parts.length, 2);
  assert.equal(parts[1]!.length, commentSize + 22);
  const bytes = Buffer.concat(parts);
  const parsed = await readZipArchive(bytes, limits, signal, { disks: { starts: [0, parts[0]!.length], lengths: parts.map(part => part.length) } });
  assert.equal(parsed.entries[0]!.name, "x"); assert.deepEqual(parsed.comment, comment);
});

test("split -y preserves dangling symlinks just like unsplit -y", async () => {
  const fs = createMemoryFileSystem(); await fs.symlink!("/missing", "/link");
  assert.equal((await run(fs, "zip", ["-q", "-y", "plain.zip", "link"])).exitCode, 0);
  const split = await run(fs, "zip", ["-q", "-y", "-s64k", "split.zip", "link"]);
  assert.equal(split.exitCode, 0, split.stderr);
  const result = await run(fs, "unzip", ["-p", "split.zip"], resolver);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), "/missing");
});

for (const [size, finalSize] of [[65332, 42], [65312, 22]] as const) {
  test(`exact ZIP64 end-record rollover preserves ${finalSize}-byte final disk`, async () => {
    const signal = new AbortController().signal, fs = createMemoryFileSystem();
    const entry = await makeZipEntry("x", new Uint8Array(size), { modified: new Date("2020-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false }, limits, signal, 0);
    const parts = await splitZipVolumes(await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal, false, true), 65536, limits, signal);
    assert.deepEqual(parts.map(part => part.length), [65536, finalSize]);
    for (let disk = 0; disk < parts.length; disk++) await fs.writeFile(volumeName("/archive.zip", disk, parts.length), parts[disk]!);
    const result = await run(fs, "unzip", ["-t", "archive.zip"], resolver);
    assert.equal(result.exitCode, 0, result.stderr);
  });
}

for (const command of ["zip", "unzip"] as const) {
  test(`${command} cancellation during volume revalidation preserves inputs and destination`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/file", new Uint8Array(70000).fill(42));
    assert.equal((await run(fs, "zip", ["-q", "-0", "-s64k", "archive.zip", "file"])).exitCode, 0);
    await fs.writeFile("/joined.zip", Uint8Array.of(9));
    const before = await fs.readFile("/archive.z01"), controller = new AbortController();
    const lstat = fs.lstat.bind(fs); let reads = 0;
    fs.lstat = async (path, options) => {
      if (path === "/archive.z01" && ++reads === 3) controller.abort(new Error("revalidate stop"));
      return lstat(path, options);
    };
    await assert.rejects(run(fs, command, command === "zip" ? ["-q", "-s0", "archive.zip", "-O", "joined.zip"] : ["archive.zip", "-d", "output"], resolver, controller.signal), /revalidate stop/);
    assert.deepEqual(await fs.readFile("/archive.z01"), before);
    assert.deepEqual(await fs.readFile("/joined.zip"), Uint8Array.of(9));
    await assert.rejects(fs.lstat("/output"), { code: "ENOENT" });
    assert.deepEqual((await fs.readdir("/")).filter(entry => entry.name.startsWith(".zip-volume-")), []);
  });
  test(`${command} rejects a previously read volume replaced by a later resolver callback`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/file", new Uint8Array(150000).fill(42));
    assert.equal((await run(fs, "zip", ["-q", "-0", "-s64k", "archive.zip", "file"])).exitCode, 0);
    await fs.writeFile("/joined.zip", Uint8Array.of(9));
    const options: ArchiveCommandsOptions = { zipHost: { volume: async ({ archive, disk, disks }) => {
      if (disk === 1) {
        await fs.rm("/archive.z01");
        await fs.writeFile("/archive.z01", new Uint8Array(65536).fill(7));
      }
      return volumeName(archive, disk, disks);
    } } };
    const result = await run(fs, command, command === "zip" ? ["-q", "-s0", "archive.zip", "-O", "joined.zip"] : ["archive.zip", "-d", "output"], options);
    assert.notEqual(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/joined.zip"), Uint8Array.of(9));
    await assert.rejects(fs.lstat("/output"), { code: "ENOENT" });
    assert.deepEqual(await fs.readFile("/archive.z01"), new Uint8Array(65536).fill(7));
    assert.deepEqual((await fs.readdir("/")).filter(entry => entry.name.startsWith(".zip-volume-")), []);
  });
  test(`${command} rejects the final volume replaced during resolution`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/file", new Uint8Array(70000).fill(42));
    assert.equal((await run(fs, "zip", ["-q", "-0", "-s64k", "archive.zip", "file"])).exitCode, 0);
    const final = await fs.readFile("/archive.zip");
    await fs.writeFile("/joined.zip", Uint8Array.of(9));
    const options: ArchiveCommandsOptions = { zipHost: { volume: async ({ archive, disk, disks }) => {
      await fs.rm("/archive.zip");
      await fs.writeFile("/archive.zip", new Uint8Array(final.length).fill(7));
      return volumeName(archive, disk, disks);
    } } };
    const result = await run(fs, command, command === "zip" ? ["-q", "-s0", "archive.zip", "-O", "joined.zip"] : ["archive.zip", "-d", "output"], options);
    assert.notEqual(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/joined.zip"), Uint8Array.of(9));
    await assert.rejects(fs.lstat("/output"), { code: "ENOENT" });
    assert.deepEqual(await fs.readFile("/archive.zip"), new Uint8Array(final.length).fill(7));
  });
}
