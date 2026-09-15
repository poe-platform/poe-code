import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { archiveCommands } from "../../src/commands/archive/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { bindFileOutputBudget } from "../../src/contracts/filesystem-output.js";
import type { FileSystem, InvocationCleanup } from "../../src/contracts/index.js";
import { archiveBytes, binary, compressed, execute, fixture, members, readOnlyArchive } from "./zip-standard-flags.helpers.js";
import { readZipArchive } from "../../src/commands/archive/zip-format.js";
import { settings } from "../../src/commands/archive/internal.js";
import { deflateRawSync } from "node:zlib";
import { toByteSource } from "../../src/contracts/index.js";

test("zip -d matches archive members without reading their source files", async () => {
  const fs = await fixture();
  await fs.rm("/work/folder", { recursive: true });
  const before = await readZipArchive(await fs.readFile("/work/sample.zip"), settings({}), new AbortController().signal);
  const result = await execute("zip", fs, ["-d", "sample.zip", "folder/*"]);
  assert.deepEqual(result, { exitCode: 0, stdout: Buffer.from("deleting: folder/\ndeleting: folder/data\n"), stderr: "" });
  const after = await readZipArchive(await fs.readFile("/work/sample.zip"), settings({}), new AbortController().signal);
  assert.deepEqual(after.entries, before.entries.filter(entry => !entry.name.startsWith("folder/")));
  assert.deepEqual(after.comment, before.comment);
});

test("zip -d combines archive-pattern operands with inclusion and exclusion", async () => {
  const fs = await fixture();
  const result = await execute("zip", fs, ["-qd", "sample.zip", "*", "-i", "folder/*", "binary", "-x", "folder/"]);
  assert.deepEqual(result, { exitCode: 0, stdout: Buffer.alloc(0), stderr: "" });
  const after = await readZipArchive(await fs.readFile("/work/sample.zip"), settings({}), new AbortController().signal);
  assert.deepEqual(after.entries.map(entry => entry.name), ["folder/", "empty", "link"]);
});

test("zip -d reports unmatched operands and preserves the old bytes", async () => {
  const fs = await fixture();
  const before = await fs.readFile("/work/sample.zip");
  const result = await execute("zip", fs, ["-d", "sample.zip", "none"]);
  assert.deepEqual(result, { exitCode: 12, stdout: Buffer.from("\tzip warning: name not matched: none\n\nzip error: Nothing to do! (sample.zip)\n"), stderr: "" });
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});

test("zip -d deletes all entries to an empty ZIP and -T preserves the original instead", async () => {
  const fs = await fixture();
  const before = await fs.readFile("/work/sample.zip");
  const tested = await execute("zip", fs, ["-qdT", "sample.zip", "*"]);
  assert.equal(tested.exitCode, 8);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  const result = await execute("zip", fs, ["-qd", "sample.zip", "*"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  const after = await readZipArchive(await fs.readFile("/work/sample.zip"), settings({}), new AbortController().signal);
  assert.equal(after.entries.length, 0);
});

test("zip -d warns about ignored recursion and missing archives", async () => {
  const fs = await fixture();
  const recursive = await execute("zip", fs, ["-rd", "sample.zip", "binary"]);
  assert.equal(recursive.exitCode, 0, recursive.stdout.toString() + recursive.stderr);
  assert.ok(recursive.stdout.toString().startsWith("\tzip warning: invalid option(s) used with -d; ignored.\n"));
  const missing = await execute("zip", fs, ["-d", "missing.zip", "binary"]);
  assert.deepEqual(missing, { exitCode: 12, stdout: Buffer.from("\tzip warning: missing.zip not found or empty\n\tzip warning: name not matched: binary\n\nzip error: Nothing to do! (missing.zip)\n"), stderr: "" });
  await assert.rejects(fs.stat("/work/missing.zip"), { code: "ENOENT" });
});

test("zip -T validates created binary data and reports success after progress", async () => {
  const fs = await fixture();
  const result = await execute("zip", fs, ["-T", "output.zip", "binary", "folder/data"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.ok(result.stdout.toString().endsWith("test of output.zip OK\n"));
  assert.deepEqual((await execute("unzip", fs, ["-p", "output.zip"])).stdout, Buffer.concat([binary, compressed]));
  const quiet = await execute("zip", fs, ["-qT", "quiet.zip", "binary"]);
  assert.deepEqual(quiet, { exitCode: 0, stdout: Buffer.alloc(0), stderr: "" });
});

for (const corruption of ["CRC", "invalid deflate", "trailing deflate"] as const) {
  test(`zip -T detects retained ${corruption} before publishing updates`, async () => {
    const bytes = await archiveBytes([{ name: "stale", body: compressed }], entries => {
      const entry = entries[0]!;
      if (corruption === "CRC") entries[0] = { ...entry, crc32: 0 };
      else entries[0] = { ...entry, data: corruption === "invalid deflate" ? Uint8Array.of(7) : Buffer.concat([entry.data, Uint8Array.of(0)]) };
    });
    const fs = await fixture(bytes);
    const result = await execute("zip", fs, ["-qT", "sample.zip", "binary"]);
    assert.equal(result.exitCode, 8);
    assert.match(result.stdout.toString(), /Zip file invalid/u);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), bytes);
  });
}

test("zip -T refuses an empty result without publishing it", async () => {
  const fs = await fixture();
  const result = await execute("zip", fs, ["-qT", "output.zip", "binary", "-i", "none"]);
  assert.equal(result.exitCode, 8);
  await assert.rejects(fs.stat("/work/output.zip"), { code: "ENOENT" });
});

test("zip -qT tests escaping link payloads without extraction or stdout charging", async () => {
  const fs = await fixture();
  await fs.symlink!("/outside", "/work/link");
  const registerCleanup = () => {};
  let charged = 0;
  bindFileOutputBudget({ registerCleanup }, sink => ({ async write(bytes) {
    charged += bytes.length;
    await sink.write(bytes);
  } }));
  const result = await execute("zip", fs, ["-qyT", "output.zip", "link"], { limits: { maxTextBytes: 1 } }, { registerCleanup });
  assert.deepEqual(result, { exitCode: 0, stdout: Buffer.alloc(0), stderr: "" });
  assert.equal(charged, (await fs.stat("/work/output.zip")).size);
});

test("zip -y stores live and broken links as target bytes and Unix symlink modes", async () => {
  const fs = await fixture();
  await fs.symlink!("binary", "/work/link");
  await fs.symlink!("missing", "/work/broken");
  const result = await execute("zip", fs, ["-qy", "output.zip", "link", "broken"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  const archive = await readZipArchive(await fs.readFile("/work/output.zip"), settings({}), new AbortController().signal);
  assert.deepEqual(archive.entries.map(entry => ({ name: entry.name, symlink: entry.symlink, method: entry.method, data: Buffer.from(entry.data) })), [
    { name: "link", symlink: true, method: 0, data: Buffer.from("binary") },
    { name: "broken", symlink: true, method: 0, data: Buffer.from("missing") },
  ]);
  assert.equal(archive.entries[0]!.mode, (await fs.lstat("/work/link")).mode);
});

test("zip -ryj stores directory-cycle and escaping links without traversing targets", async () => {
  const fs = await fixture();
  await fs.symlink!(".", "/work/folder/cycle");
  await fs.symlink!("/outside", "/work/folder/outside");
  const result = await execute("zip", fs, ["-qryj", "output.zip", "folder"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  const archive = await readZipArchive(await fs.readFile("/work/output.zip"), settings({}), new AbortController().signal);
  assert.deepEqual(archive.entries.map(entry => entry.name), ["cycle", "data", "outside"]);
  assert.equal(archive.entries.find(entry => entry.name === "cycle")!.symlink, true);
  assert.deepEqual((await execute("unzip", fs, ["-p", "output.zip", "outside"])).stdout, Buffer.from("/outside"));
});

test("zip -y detects replacement of a symlink while reading and preserves the archive", async () => {
  const fs = await fixture();
  await fs.symlink!("binary", "/work/link");
  const before = await fs.readFile("/work/sample.zip");
  const readlink = fs.readlink!.bind(fs);
  let changed = false;
  Object.defineProperty(fs, "readlink", { value: async (path: string) => {
    const target = await readlink(path);
    if (!changed && path === "/work/link") {
      changed = true;
      await fs.rm(path);
      await fs.symlink!("folder", path);
    }
    return target;
  } });
  const result = await execute("zip", fs, ["-qy", "sample.zip", "link"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /source changed while reading/u);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});

test("zip -rD omits directory entries while traversing unmatched parents", async () => {
  const fs = await fixture();
  await fs.mkdir("/work/folder/empty");
  const result = await execute("zip", fs, ["-qrD", "output.zip", "folder", "-i", "folder/data"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  const archive = await readZipArchive(await fs.readFile("/work/output.zip"), settings({}), new AbortController().signal);
  assert.deepEqual(archive.entries.map(entry => entry.name), ["folder/data"]);
});

test("zip -D leaves existing directory members intact", async () => {
  const fs = await fixture();
  const result = await execute("zip", fs, ["-qrD", "sample.zip", "folder"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  const archive = await readZipArchive(await fs.readFile("/work/sample.zip"), settings({}), new AbortController().signal);
  assert.equal(archive.entries.some(entry => entry.name === "folder/"), true);
});

test("zip -D with only a directory and no recursion returns Nothing to do", async () => {
  const result = await execute("zip", await fixture(), ["-qD", "output.zip", "folder"]);
  assert.equal(result.exitCode, 12);
  assert.match(result.stdout.toString(), /Nothing to do/u);
});

test("zip -@ reads stdin names before operands and preserves whitespace", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/ spaced ", binary);
  await fs.writeFile("/work/tab\t", binary);
  await fs.writeFile("/work/-q", binary);
  const result = await execute("zip", fs, ["-q", "output.zip", "binary", "-@", "folder/data"], {}, {
    stdin: toByteSource(" spaced \r\n\ntab\t\n-q\r\r\n"),
  });
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  const archive = await readZipArchive(await fs.readFile("/work/output.zip"), settings({}), new AbortController().signal);
  assert.deepEqual(archive.entries.map(entry => entry.name), [" spaced ", "tab\t", "-q", "binary", "folder/data"]);
});

test("zip -@ supports fragmented UTF-8, a final unterminated line and repeated flags", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/tigér", binary);
  const bytes = Buffer.from("tigér\nfolder/data");
  let pulls = 0;
  const result = await execute("zip", fs, ["-q@@", "output.zip"], {}, {
    stdin: { async *[Symbol.asyncIterator]() { for (const byte of bytes) { pulls++; yield Uint8Array.of(byte); } } },
  });
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.equal(pulls, bytes.length);
  const archive = await readZipArchive(await fs.readFile("/work/output.zip"), settings({}), new AbortController().signal);
  assert.deepEqual(archive.entries.map(entry => entry.name), ["tigér", "folder/data"]);
});

for (const { input, limits, diagnostic } of [
  { input: Buffer.from("binary\n"), limits: { maxFilesFromBytes: 2 }, diagnostic: "maxBytes" },
  { input: Buffer.from("binary\nfolder/data\n"), limits: { maxMembers: 1 }, diagnostic: "operand limit" },
  { input: Buffer.from("12345678901234567890\n"), limits: { maxPathBytes: 16 }, diagnostic: "path byte limit" },
  { input: Uint8Array.of(255, 10), limits: {}, diagnostic: "invalid UTF-8" },
  { input: Uint8Array.of(98, 0, 10), limits: {}, diagnostic: "NUL" },
]) {
  test(`zip -@ rejects ${diagnostic} before publication`, async () => {
    const fs = await fixture();
    const before = await fs.readFile("/work/sample.zip");
    const result = await execute("zip", fs, ["-q@", "sample.zip"], { limits }, { stdin: toByteSource(input) });
    assert.equal(result.exitCode, 2);
    assert.ok(result.stderr.includes(diagnostic), result.stderr);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  });
}

test("zip -@ with no names returns Nothing to do", async () => {
  const result = await execute("zip", await fixture(), ["-q@", "output.zip"], {}, { stdin: toByteSource("\n\r\n") });
  assert.equal(result.exitCode, 12);
  assert.match(result.stdout.toString(), /Nothing to do/u);
});

test("zip -@ drains an admitted stdin read before cancellation settles", async () => {
  const fs = await fixture();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const controller = new AbortController();
  let closed = false;
  let settled = false;
  const pending = execute("zip", fs, ["-q@", "output.zip"], {}, {
    signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() {
      try { entered(); await held; yield Buffer.from("binary\n"); }
      finally { closed = true; }
    } },
  }).then(value => { settled = true; return value; }, reason => { settled = true; return reason; });
  try {
    await started;
    controller.abort(false);
    await setImmediate();
    assert.equal(settled, false);
  } finally { release(); }
  assert.equal(await pending, false);
  assert.equal(closed, true);
  await assert.rejects(fs.stat("/work/output.zip"), { code: "ENOENT" });
});

for (let level = 0; level <= 9; level++) {
  test(`zip -q${level} applies the requested compression level`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, [`-q${level}`, "output.zip", "folder/data"]);
    assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
    const archive = await readZipArchive(await fs.readFile("/work/output.zip"), settings({}), new AbortController().signal);
    const entry = archive.entries[0]!;
    assert.equal(entry.method, level === 0 ? 0 : 8);
    assert.deepEqual(Buffer.from(entry.data), level === 0 ? compressed : deflateRawSync(compressed, { level }));
    assert.deepEqual((await execute("unzip", fs, ["-p", "output.zip"])).stdout, compressed);
  });
}

test("zip uses the last compression level even after operands", async () => {
  const fs = await fixture();
  const result = await execute("zip", fs, ["-9", "output.zip", "folder/data", "-0"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  const archive = await readZipArchive(await fs.readFile("/work/output.zip"), settings({}), new AbortController().signal);
  assert.equal(archive.entries[0]!.method, 0);
});

for (const { args, names } of [
  { args: ["-qr", "output.zip", "folder", "binary", "-x", "folder/*"], names: ["binary"] },
  { args: ["-qr", "output.zip", "folder", "binary", "-i", "folder/d?t[ab]"], names: ["folder/data"] },
  { args: ["-qrj", "output.zip", "folder", "binary", "-i", "folder/*", "-x", "folder/"], names: ["data"] },
  { args: ["-qr", "-x", "folder/*", "@", "output.zip", "folder", "binary"], names: ["binary"] },
  { args: ["-qr", "output.zip", "folder", "binary", "-ifolder/*", "-x", "folder/"], names: ["folder/data"] },
]) {
  test(`zip filters ${args.join(" ")} against source member paths`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, args);
    assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
    const archive = await readZipArchive(await fs.readFile("/work/output.zip"), settings({}), new AbortController().signal);
    assert.deepEqual(archive.entries.map(entry => entry.name), names);
  });
}

for (const flag of ["-x", "-i"]) {
  test(`zip ${flag} requires a pattern`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, ["output.zip", "binary", flag]);
    assert.equal(result.exitCode, 16);
    assert.match(result.stdout.toString(), /requires a value/u);
    await assert.rejects(fs.stat("/work/output.zip"), { code: "ENOENT" });
  });
}

test("zip unmatched inclusion publishes an empty archive while exclusion-only returns Nothing to do", async () => {
  const fs = await fixture();
  const included = await execute("zip", fs, ["output.zip", "binary", "-i", "none"]);
  assert.deepEqual(included, { exitCode: 0, stdout: Buffer.from("\tzip warning: zip file empty\n"), stderr: "" });
  const archive = await readZipArchive(await fs.readFile("/work/output.zip"), settings({}), new AbortController().signal);
  assert.equal(archive.entries.length, 0);
  const excluded = await execute("zip", fs, ["excluded.zip", "binary", "-x", "*"]);
  assert.equal(excluded.exitCode, 12);
  await assert.rejects(fs.stat("/work/excluded.zip"), { code: "ENOENT" });
});

test("zip filters preserve unselected existing members and avoid reading excluded payloads", async () => {
  const fs = await fixture();
  const original = await fs.readFile("/work/sample.zip");
  await fs.writeFile("/work/binary", Buffer.from("replacement"));
  for (const property of ["readFile", "readStream"] as const) {
    const originalRead = fs[property];
    if (!originalRead) continue;
    Object.defineProperty(fs, property, { value: (path: string, ...args: unknown[]) => {
      assert.notEqual(path, "/work/folder/data", "excluded payload read");
      return Reflect.apply(originalRead, fs, [path, ...args]);
    } });
  }
  const result = await execute("zip", fs, ["-qr", "sample.zip", "folder", "binary", "-x", "folder/*"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  const before = await readZipArchive(original, settings({}), new AbortController().signal);
  const after = await readZipArchive(await fs.readFile("/work/sample.zip"), settings({}), new AbortController().signal);
  assert.deepEqual(after.entries.find(entry => entry.name === "folder/data"), before.entries.find(entry => entry.name === "folder/data"));
  assert.deepEqual((await execute("unzip", fs, ["-p", "sample.zip", "binary"])).stdout, Buffer.from("replacement"));
});

for (const { flags, source } of [
  { flags: ["-j"], source: "/work/folder/data" },
  { flags: ["-qj"], source: "folder/data" },
  { flags: ["-jr"], source: "folder" },
  { flags: ["-r", "-j"], source: "folder" },
]) {
  test(`zip ${flags.join(" ")} stores basenames and omits directory entries`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, [...flags, "output.zip", "binary", source]);
    assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
    const archive = await readZipArchive(await fs.readFile("/work/output.zip"), settings({}), new AbortController().signal);
    assert.deepEqual(archive.entries.map(entry => entry.name), ["binary", "data"]);
    assert.deepEqual((await execute("unzip", fs, ["-p", "output.zip"])).stdout, Buffer.concat([binary, compressed]));
  });
}

test("zip -j rejects basename collisions without replacing an existing archive", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/folder/binary", compressed);
  const before = await fs.readFile("/work/sample.zip");
  const result = await execute("zip", fs, ["-j", "sample.zip", "binary", "folder/binary"]);
  assert.equal(result.exitCode, 16);
  assert.match(result.stdout.toString(), /cannot repeat names in zip file/u);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});

test("zip -j supports the reported image command through Shell", async () => {
  const fs = await fixture();
  await fs.mkdir("/tmp");
  await fs.writeFile("/tmp/basketball-tiger.png", binary);
  await fs.writeFile("/tmp/basketball-tiger-back.png", compressed);
  const shell = new Shell({ fs }).use(archiveCommands()).use(standardCommands());
  try {
    const result = await shell.exec("cd /tmp && zip -j basketball-tiger-images.zip basketball-tiger.png basketball-tiger-back.png && unzip -p basketball-tiger-images.zip > images");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Buffer.from(await fs.readFile("/tmp/images")), Buffer.concat([binary, compressed]));
  } finally { await shell.dispose(); }
});

for (const flags of [["-q"], ["-qq"], ["-qr"], ["-rq"], ["-r", "-q"]]) {
  test(`zip ${flags.join(" ")} suppresses create/update progress without a text budget charge`, async () => {
    const fs = await fixture();
    for (let update = 0; update < 2; update++) {
      const result = await execute("zip", fs, [...flags, "output", "binary", "folder/data"], { limits: { maxTextBytes: 1 } });
      assert.deepEqual(result, { exitCode: 0, stdout: Buffer.alloc(0), stderr: "" });
      const output = await execute("unzip", fs, ["-p", "output.zip"]);
      assert.equal(output.exitCode, 0, output.stderr);
      assert.deepEqual(output.stdout, Buffer.concat([binary, compressed]));
    }
  });
}

test("zip -q retains fatal diagnostics and native statuses, suppressing advisory missing-source warnings", async () => {
  const fs = await fixture();
  assert.deepEqual(await execute("zip", fs, ["-q", "output", "missing"]), {
    exitCode: 12, stdout: Buffer.from("\nzip error: Nothing to do! (output.zip)\n"), stderr: "",
  });
  assert.deepEqual(await execute("zip", fs, ["-q", "output", "missing", "binary"]), { exitCode: 0, stdout: Buffer.alloc(0), stderr: "" });
  const invalid = await execute("zip", fs, ["-q", "-!", "output", "binary"]);
  assert.equal(invalid.exitCode, 16);
  assert.match(invalid.stdout.toString(), /zip error: Invalid command arguments/u);
  const limited = await execute("zip", fs, ["-q", "output", "binary"], { limits: { maxEntryBytes: 1 } });
  assert.equal(limited.exitCode, 2);
  assert.notEqual(limited.stderr, "");
});

for (const flags of [["-p"], ["-pp"], ["-lp"], ["-pl"], ["-l", "-p"], ["-p", "-l"], ["-op"], ["-po"]]) {
  test(`unzip ${flags.join(" ")} streams raw members in archive order without any extraction access`, async () => {
    const observed = readOnlyArchive(await fixture());
    let stdinRead = false;
    const result = await execute("unzip", observed.fs, [...flags, "sample.zip"], { limits: { maxTextBytes: 16 } }, {
      stdin: { [Symbol.asyncIterator]() { stdinRead = true; throw new Error("must not read stdin"); } },
      registerCleanup() {},
    });
    assert.deepEqual(result, { exitCode: 0, stdout: Buffer.concat(members.map(member => member.body)), stderr: "" });
    assert.equal(stdinRead, false);
    assert.ok(observed.calls.length > 0);
    assert.ok(observed.calls.every(call => call.path === "/work/sample.zip"), JSON.stringify(observed.calls));
  });
}

test("unzip -p ignores -d with a diagnostic even when combined with -l and -o", async () => {
  const observed = readOnlyArchive(await fixture());
  assert.deepEqual(await execute("unzip", observed.fs, ["-plod/absent/path", "sample.zip", "binary"]), {
    exitCode: 0, stdout: binary, stderr: "caution:  not extracting; -d ignored\n",
  });
  assert.ok(observed.calls.every(call => call.path === "/work/sample.zip"));
});

for (const selection of [
  { args: ["folder/*", "binary"], body: Buffer.concat([binary, compressed]), status: 0, error: "" },
  { args: ["binary", "binary"], body: binary, status: 11, error: "caution: filename not matched:  binary\n" },
  { args: ["b?n[aeiou]ry"], body: binary, status: 0, error: "" },
  { args: ["empty"], body: Buffer.alloc(0), status: 0, error: "" },
  { args: ["folder/"], body: Buffer.alloc(0), status: 0, error: "" },
  { args: ["missing"], body: Buffer.alloc(0), status: 11, error: "caution: filename not matched:  missing\n" },
  { args: ["binary", "missing"], body: binary, status: 11, error: "caution: filename not matched:  missing\n" },
]) {
  test(`unzip -p selection ${selection.args.join(" ")}`, async () => {
    const observed = readOnlyArchive(await fixture());
    assert.deepEqual(await execute("unzip", observed.fs, ["-p", "sample", ...selection.args]), {
      exitCode: selection.status, stdout: selection.body, stderr: selection.error,
    });
  });
}

test("unzip -p reports missing and empty archives without stdout", async () => {
  const missing = await execute("unzip", await fixture(), ["-p", "missing.zip"]);
  assert.equal(missing.exitCode, 9);
  assert.equal(missing.stdout.length, 0);
  assert.equal(missing.stderr, "");
  const empty = await execute("unzip", await fixture(await archiveBytes([])), ["-p", "sample.zip"]);
  assert.deepEqual(empty, { exitCode: 1, stdout: Buffer.alloc(0), stderr: "warning [sample.zip]:  zipfile is empty\n" });
});

test("unzip -p streams symlink targets as bytes without extraction-target restrictions", async () => {
  const input = [{ name: "link", body: Buffer.from("/outside"), symlink: true }, { name: "binary-link", body: binary, symlink: true }];
  const observed = readOnlyArchive(await fixture(await archiveBytes(input)));
  const result = await execute("unzip", observed.fs, ["-p", "sample.zip"]);
  assert.deepEqual(result, { exitCode: 0, stdout: Buffer.concat(input.map(member => member.body)), stderr: "" });
});

test("unzip -p reports CRC failure after delivered bytes and never stages files", async () => {
  const bytes = await archiveBytes([members[1]!], entries => { entries[0] = { ...entries[0]!, crc32: 0 }; });
  const observed = readOnlyArchive(await fixture(bytes));
  const result = await execute("unzip", observed.fs, ["-p", "sample.zip"]);
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.stdout, binary);
  assert.match(result.stderr, /CRC32 mismatch/u);
});

for (const limits of [{ maxEntryBytes: 1 }, { maxTotalBytes: binary.length }, { maxArchiveBytes: 1 }, { maxMembers: 1 }, { maxPatternSteps: 1 }]) {
  test(`unzip -p retains archive limits ${JSON.stringify(limits)}`, async () => {
    const observed = readOnlyArchive(await fixture());
    const result = await execute("unzip", observed.fs, ["-p", "sample.zip"], { limits });
    assert.equal(result.exitCode, 2);
    assert.notEqual(result.stderr, "");
  });
}

test("unzip -p uses stdout accounting, never filesystem output accounting", async () => {
  const registerCleanup = () => {};
  bindFileOutputBudget({ registerCleanup }, () => { throw new Error("filesystem output charged"); });
  const result = await execute("unzip", readOnlyArchive(await fixture()).fs, ["-p", "sample.zip", "binary"], {}, { registerCleanup });
  assert.deepEqual(result, { exitCode: 0, stdout: binary, stderr: "" });
});

test("unzip -p respects Shell stdout limits and binary pipelines", async () => {
  const fs = await fixture();
  const shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes: binary.length * 3 } }).use(archiveCommands()).use(standardCommands());
  try {
    const exact = await shell.exec("unzip -p sample.zip binary | cat > copied");
    assert.equal(exact.exitCode, 0, exact.stderr);
    assert.deepEqual(Buffer.from(await fs.readFile("/work/copied")), binary);
    await assert.rejects(shell.exec("unzip -p sample.zip folder/data"), ShellLimitError);
  } finally { await shell.dispose(); }
});

for (const reason of [false, 0, "", null]) {
  test(`unzip -p preserves cancellation ${JSON.stringify(reason)} at stdout`, async () => {
    const controller = new AbortController();
    let writes = 0;
    await assert.rejects(execute("unzip", readOnlyArchive(await fixture()).fs, ["-p", "sample.zip", "folder/data"], { limits: { chunkSize: 512 } }, {
      signal: controller.signal,
      stdout: { async write() { writes++; controller.abort(reason); } },
    }), error => Object.is(error, reason));
    assert.equal(writes, 1);
  });
}

for (const corruption of ["invalid deflate", "truncated deflate", "trailing deflate", "length", "entry limit", "aggregate limit"] as const) {
  test(`unzip -p enforces ${corruption} on actual decompression without publication`, async () => {
    const first = { name: "first", body: Buffer.alloc(512, 65) };
    const second = { name: "second", body: Buffer.alloc(512, 66) };
    const bytes = await archiveBytes(corruption === "aggregate limit" ? [first, second] : [second], entries => {
      const index = entries.length - 1;
      const entry = entries[index]!;
      assert.equal(entry.method, 8);
      if (corruption === "invalid deflate") entries[index] = { ...entry, data: Uint8Array.of(7) };
      else if (corruption === "truncated deflate") entries[index] = { ...entry, data: entry.data.subarray(0, entry.data.length - 1) };
      else if (corruption === "trailing deflate") entries[index] = { ...entry, data: Buffer.concat([entry.data, Uint8Array.of(0)]) };
      else entries[index] = { ...entry, size: 1 };
    });
    const result = await execute("unzip", readOnlyArchive(await fixture(bytes)).fs, ["-p", "sample.zip"], {
      limits: { chunkSize: 512, ...(corruption === "entry limit" ? { maxEntryBytes: 256 } : {}), ...(corruption === "aggregate limit" ? { maxTotalBytes: 700 } : {}) },
    });
    assert.equal(result.exitCode, 2);
    assert.notEqual(result.stderr, "");
    if (corruption === "aggregate limit") {
      assert.deepEqual(result.stdout, first.body);
      assert.match(result.stderr, /actual decompressed byte limit exceeded/u);
    }
    if (corruption === "entry limit") assert.equal(result.stdout.length, 0);
    if (corruption === "length") assert.match(result.stderr, /uncompressed size mismatch/u);
    if (corruption === "trailing deflate") assert.match(result.stderr, /trailing compressed data/u);
  });
}

test("unzip -p does not decode unselected CRC-corrupt members", async () => {
  const bytes = await archiveBytes([members[1]!, members[2]!], entries => { entries[1] = { ...entries[1]!, crc32: 0 }; });
  const result = await execute("unzip", readOnlyArchive(await fixture(bytes)).fs, ["-p", "sample.zip", "binary"]);
  assert.deepEqual(result, { exitCode: 0, stdout: binary, stderr: "" });
});

test("unzip -p still bounds comments even though they are not printed", async () => {
  const result = await execute("unzip", readOnlyArchive(await fixture()).fs, ["-p", "sample.zip"], { limits: { maxTextBytes: 1 } });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout.length, 0);
  assert.match(result.stderr, /comment limit/u);
});

for (const streaming of [false, true]) {
  test(`unzip -p drains cancelled ${streaming ? "stream" : "buffered"} reads without extracting`, async () => {
    const fs = await fixture();
    const bytes = await fs.readFile("/work/sample.zip");
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let closed = false;
    const readOnly = readOnlyArchive(fs).fs;
    const overrides: Partial<FileSystem> = {
      capabilities: { streamingRead: streaming },
      async readFile() { entered(); await held; return bytes; },
      readStream() { return { async *[Symbol.asyncIterator]() { try { entered(); await held; yield bytes; } finally { closed = true; } } }; },
    };
    const delayed = new Proxy(readOnly, { get(target, property) {
      if (property === "capabilitiesFor") return undefined;
      return Object.hasOwn(overrides, property) ? Reflect.get(overrides, property) : Reflect.get(target, property);
    } });
    const controller = new AbortController();
    let settled = false;
    const pending = execute("unzip", delayed, ["-p", "sample.zip"], {}, { signal: controller.signal }).then(
      value => { settled = true; return value; }, error => { settled = true; return error; },
    );
    try {
      await started;
      controller.abort(false);
      await setImmediate();
      assert.equal(settled, false);
    } finally { release(); }
    assert.equal(await pending, false);
    if (streaming) assert.equal(closed, true);
  });
}

test("unzip -p awaits stdout backpressure and stops on a sink failure", async () => {
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let writes = 0;
  let settled = false;
  const failure = new Error("sink refused");
  const errors: unknown[] = [];
  const pending = execute("unzip", readOnlyArchive(await fixture()).fs, ["-p", "sample.zip", "folder/data"], { limits: { chunkSize: 512 } }, {
    stdout: { async write() { writes++; entered(); await held; throw failure; } },
    onInternalError(error) { errors.push(error); },
  }).then(result => { settled = true; return result; });
  try {
    await started;
    await setImmediate();
    assert.equal(writes, 1);
    assert.equal(settled, false);
  } finally { release(); }
  const result = await pending;
  assert.equal(result.exitCode, 2);
  assert.equal(writes, 1);
  assert.deepEqual(errors, [failure]);
});

test("unzip -p drains an enrolled stdout write before cancellation settles", async () => {
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const controller = new AbortController();
  const consumer = new AbortController();
  const cleanups: InvocationCleanup[] = [];
  let writes = 0;
  const write = async () => { writes++; entered(); await held; };
  let settled = false;
  const pending = execute("unzip", readOnlyArchive(await fixture()).fs, ["-p", "sample.zip", "folder/data"], { limits: { chunkSize: 512 } }, {
    signal: controller.signal,
    registerCleanup(cleanup) { cleanups.push(cleanup); },
    stdout: { write, ownedOutput: { consumerClosed: consumer.signal, write } },
  }).then(value => { settled = true; return value; }, error => { settled = true; return error; });
  try {
    await started;
    controller.abort(false);
    await setImmediate();
    assert.equal(settled, false, "owned output still writing");
  } finally { release(); }
  assert.equal(await pending, false);
  await Promise.all(cleanups.map(cleanup => cleanup()));
  assert.equal(writes, 1);
});

test("zip -q still charges file output and preserves an existing archive when the budget rejects publication", async () => {
  const fs = await fixture();
  const before = await fs.readFile("/work/sample.zip");
  const shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes: 1 } }).use(archiveCommands());
  try {
    await assert.rejects(shell.exec("zip -q sample.zip binary"), ShellLimitError);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["binary", "folder", "sample.zip"]);
  } finally { await shell.dispose(); }
});
