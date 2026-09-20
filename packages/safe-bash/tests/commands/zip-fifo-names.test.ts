import assert from "node:assert/strict";
import test from "node:test";
import { settings } from "../../src/commands/archive/internal.js";
import { makeZipEntry, readZipArchive, writeZipArchive } from "../../src/commands/archive/zip-format.js";
import type { ByteSource, FileSystem, ReadStreamOptions } from "../../src/contracts/index.js";
import { archiveBytes, execute, fixture, modified } from "./zip-standard-flags.helpers.js";
import { archiveCommands, Shell } from "../../src/index.js";

async function entries(fs: FileSystem) {
  return (await readZipArchive(await fs.readFile("/work/out.zip"), settings({}), new AbortController().signal)).entries;
}

for (const [name, expected] of [["longfilename.extension", "LONGFILE.EXT"], [".hidden", "HIDDEN"], ["a.b.c", "A.B"], ["foo+ bar.txt", "FOOBAR.TXT"], ["CON", "CON"], ["aux.txt", "AUX.TXT"], ["name.", "NAME."], ["+.txt", "TXT"]] as const) {
  test(`DOS conversion ${name}`, async () => {
    const fs = await fixture();
    await fs.writeFile(`/work/${name}`, Buffer.from("payload"));
    const result = await execute("zip", fs, ["-qk", "out.zip", name]);
    assert.equal(result.exitCode, 0, result.stderr);
    const [entry] = await entries(fs);
    assert.equal(entry!.name, expected);
    assert.equal(entry!.versionMadeBy! >>> 8, 0);
    assert.equal(entry!.flags! & 0x800, 0);
  });
}

test("regex switch uses bounded existing bracket glob selection", async () => {
  const fs = await fixture();
  const result = await execute("zip", fs, ["-qRE", "out.zip", "binary", "-i", "[b]inary"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual((await entries(fs)).map(entry => entry.name), ["binary"]);
});

function fifoView(fs: FileSystem, produce: (options: ReadStreamOptions) => ByteSource, enabled = true): FileSystem {
  return new Proxy(fs, { get(target, property) {
    if (property === "readStream") return enabled ? (path: string, options: ReadStreamOptions) => path === "/work/pipe" ? produce(options) : fs.readStream!(path, options) : undefined;
    if (property === "stat" || property === "lstat") return async (path: string, options: unknown) => {
      const stat = await Reflect.apply(Reflect.get(target, property), target, [path, options]);
      return path === "/work/pipe" ? { ...stat, type: "character", mode: 0o010600, size: 0 } : stat;
    };
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

test("FIFO explicit VFS source archives bytes despite zero stat size", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/pipe", Buffer.from("never use readFile"));
  const view = fifoView(fs, async function* () { yield Buffer.from("producer"); });
  const result = await execute("zip", view, ["-qFI", "out.zip", "pipe"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const extracted = await execute("unzip", fs, ["-p", "out.zip", "pipe"]);
  assert.equal(extracted.stdout.toString(), "producer");
});

test("FIFO missing explicit reader refuses without opening ordinary stream", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/pipe", Buffer.from("secret"));
  const result = await execute("zip", fifoView(fs, async function* () {}, false), ["-qFI", "out.zip", "pipe"]);
  assert.match(result.stdout.toString() + result.stderr, /explicit.*FIFO.*stream/i);
  assert.notEqual(result.exitCode, 0);
  await assert.rejects(fs.stat("/work/out.zip"), { code: "ENOENT" });
});

for (const flag of ["-k-", "--DOS-names-", "-RE-", "--regex-", "--fifo=1", "--DOS-names=x", "--regex=x"]) {
  test(`name/source option rejects invalid form ${flag}`, async () => {
    const fs = await fixture();
    const before = await fs.readFile("/work/sample.zip");
    assert.equal((await execute("zip", fs, [flag, "sample.zip", "binary"])).exitCode, 16);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  });
}

for (const flag of ["-FI-", "--fifo-", "-FI", "--fifo"]) {
  test(`FIFO enable and negate ${flag}`, async () => {
    const fs = await fixture();
    await fs.writeFile("/work/pipe", Buffer.from("host placeholder"));
    let opens = 0;
    const view = fifoView(fs, async function* () { opens++; yield Buffer.from("x"); });
    const result = await execute("zip", view, ["-q", flag, "out.zip", "pipe", "binary"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(opens, flag.endsWith("-") ? 0 : 1);
    assert.deepEqual((await entries(fs)).map(entry => entry.name), flag.endsWith("-") ? ["binary"] : ["pipe", "binary"]);
  });
}

for (const name of ["café.txt", "a\\b.txt", "....", "delete\u007f.txt"]) {
  test(`DOS restricted or empty names preserve archive: ${name}`, async () => {
    const fs = await fixture();
    await fs.writeFile(`/work/${name}`, Buffer.from("x"));
    const before = await fs.readFile("/work/sample.zip");
    const result = await execute("zip", fs, ["-qk", "sample.zip", name]);
    assert.equal(result.exitCode, 16, result.stdout.toString() + result.stderr);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  });
}

test("DOS collisions refuse publication and preserve both move sources", async () => {
  const fs = await fixture();
  for (const name of ["longfilename.txt", "longfileother.txt"]) await fs.writeFile(`/work/${name}`, Buffer.from(name));
  const before = await fs.readFile("/work/sample.zip");
  const result = await execute("zip", fs, ["-qkm", "sample.zip", "longfilename.txt", "longfileother.txt"]);
  assert.equal(result.exitCode, 16);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  assert.equal((await fs.stat("/work/longfilename.txt")).type, "file");
  assert.equal((await fs.stat("/work/longfileother.txt")).type, "file");
});

for (const junk of [false, true]) {
  test(`DOS recursive separators and junk=${junk}`, async () => {
    const fs = await fixture();
    await fs.mkdir("/work/longdirectory");
    await fs.writeFile("/work/longdirectory/a.b.c", Buffer.from("x"));
    const result = await execute("zip", fs, [junk ? "-qkrj" : "-qkr", "out.zip", "longdirectory"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual((await entries(fs)).map(entry => entry.name), junk ? ["A.B"] : ["LONGDIRE/", "LONGDIRE/A.B"]);
  });
}

test("DOS filters retain native parse ordering, case and stripped wildcards", async () => {
  const fs = await fixture();
  // Filters parsed before -k retain their source spelling.
  let result = await execute("zip", fs, ["-q", "-i", "binary", "@", "-k", "out.zip", "binary"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual((await entries(fs)).map(entry => entry.name), ["BINARY"]);
  // With -k first the filter is DOS-converted, then compared to raw source names.
  result = await execute("zip", fs, ["-qk", "other.zip", "binary", "-i", "*"]);
  assert.equal(result.exitCode, 0);
  assert.equal((await readZipArchive(await fs.readFile("/work/other.zip"), settings({}), new AbortController().signal)).entries.length, 0);
});

for (const [size, maximum, success] of [[0, 1, true], [3, 3, true], [4, 3, false]] as const) {
  test(`FIFO byte boundary size=${size} limit=${maximum}`, async () => {
    const fs = await fixture();
    await fs.writeFile("/work/pipe", new Uint8Array());
    let closed = false;
    const view = fifoView(fs, async function* () { try { yield Buffer.alloc(size, 65); } finally { closed = true; } });
    const result = await execute("zip", view, ["-qFI", "out.zip", "pipe"], { limits: { maxEntryBytes: maximum } });
    assert.equal(result.exitCode === 0, success, result.stdout.toString() + result.stderr);
    assert.equal(closed, true);
    if (success) assert.equal((await entries(fs))[0]!.size, size);
    else await assert.rejects(fs.stat("/work/out.zip"), { code: "ENOENT" });
  });
}

test("FIFO producer failure and reused chunks preserve owned bytes", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/pipe", new Uint8Array());
  const shared = Buffer.from("A");
  let closed = false;
  const view = fifoView(fs, async function* () { try { yield shared; shared[0] = 66; yield shared; } finally { shared[0] = 67; closed = true; } });
  assert.equal((await execute("zip", view, ["-qFI", "out.zip", "pipe"])).exitCode, 0);
  assert.equal(closed, true);
  assert.equal((await execute("unzip", fs, ["-p", "out.zip", "pipe"])).stdout.toString(), "AB");
  const before = await fs.readFile("/work/out.zip");
  const failing = fifoView(fs, async function* () { yield Buffer.from("partial"); throw new Error("producer failed"); });
  assert.notEqual((await execute("zip", failing, ["-qFI", "out.zip", "pipe"])).exitCode, 0);
  assert.deepEqual(await fs.readFile("/work/out.zip"), before);
});

test("FIFO cancellation closes producer and prevents publication", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/pipe", new Uint8Array());
  const controller = new AbortController();
  const reason = new Error("cancel producer");
  let closed = false;
  const view = fifoView(fs, async function* () {
    try { yield Buffer.from("first"); controller.abort(reason); yield Buffer.from("second"); }
    finally { closed = true; }
  });
  await assert.rejects(execute("zip", view, ["-qFI", "out.zip", "pipe"], {}, { signal: controller.signal }), error => error === reason);
  assert.equal(closed, true);
  await assert.rejects(fs.stat("/work/out.zip"), { code: "ENOENT" });
});

for (const flag of ["-k", "-RE", "-FI"]) {
  test(`pre-abort preserves reason for ${flag}`, async () => {
    const fs = await fixture();
    const reason = new Error("preabort");
    await assert.rejects(execute("zip", fs, [flag, "out.zip", "binary"], {}, { signal: AbortSignal.abort(reason) }), error => error === reason);
    await assert.rejects(fs.stat("/work/out.zip"), { code: "ENOENT" });
  });
}

for (const flag of ["-qFIFS", "-qFIDF"]) {
  test(`FIFO ${flag} never infers payload currency from zero stat size`, async () => {
    const fs = await fixture(await archiveBytes([{ name: "pipe", body: Buffer.alloc(0) }]));
    await fs.writeFile("/work/pipe", new Uint8Array());
    let opens = 0;
    const base = fifoView(fs, async function* () { opens++; yield Buffer.from("changed"); });
    const view = new Proxy(base, { get(target, property) {
      if (property === "stat" || property === "lstat") return async (path: string, options: unknown) => {
        const stat = await Reflect.apply(Reflect.get(target, property), target, [path, options]);
        return path === "/work/pipe" ? { ...stat, mtimeMs: modified.getTime() } : stat;
      };
      return Reflect.get(target, property);
    } });
    const args = flag.endsWith("DF") ? [flag, "sample.zip", "pipe", "-O", "out.zip"] : [flag, "sample.zip", "pipe"];
    const result = await execute("zip", view, args);
    assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
    assert.equal(opens, 1);
    assert.equal((await execute("unzip", fs, ["-p", flag.endsWith("DF") ? "out.zip" : "sample.zip", "pipe"])).stdout.toString(), "changed");
  });
}

test("DOS archive fallback preserves Unicode name encoding", async () => {
  const fs = await fixture(await archiveBytes([{ name: "é.txt", body: Buffer.from("old") }]));
  await fs.writeFile("/work/é.txt", Buffer.from("new"));
  const result = await execute("zip", fs, ["-qk", "sample.zip", "*"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  const archive = await readZipArchive(await fs.readFile("/work/sample.zip"), settings({}), new AbortController().signal);
  assert.equal(archive.entries[0]!.name, "é.txt");
  assert.equal(archive.entries[0]!.flags! & 0x800, 0x800);
  assert.equal((await execute("unzip", fs, ["-p", "sample.zip", "é.txt"])).stdout.toString(), "new");
});

test("DOS recursive patterns receive native DOS filter conversion", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/lower.txt", Buffer.from("x"));
  const result = await execute("zip", fs, ["-qkR", "out.zip", "*.txt"]);
  assert.equal(result.exitCode, 12, result.stdout.toString() + result.stderr);
  await assert.rejects(fs.stat("/work/out.zip"), { code: "ENOENT" });
});

for (const [name, expected] of [["abcdefgh.xyz", "ABCDEFGH.XYZ"], ["abcdefghi.xyzz", "ABCDEFGH.XYZ"], ["A*.t?xt", "A.TXT"]] as const) {
  test(`DOS component boundary and literal wildcard name ${name}`, async () => {
    const fs = await fixture();
    await fs.writeFile(`/work/${name}`, Buffer.from("x"));
    const result = await execute("zip", fs, ["-qk", "out.zip", name]);
    assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
    assert.equal((await entries(fs))[0]!.name, expected);
  });
}

test("DOS recursive patterns select original uppercase names", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/BINARY", Buffer.from("uppercase"));
  const result = await execute("zip", fs, ["-qkR", "out.zip", "binary"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.deepEqual((await entries(fs)).map(entry => entry.name), ["BINARY"]);
});

test("DOS exclusion precedes conversion and preserves excluded Unicode sources", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/café.txt", Buffer.from("unicode"));
  const result = await execute("zip", fs, ["-q", "-x", "café.txt", "@", "-k", "out.zip", "café.txt", "binary"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual((await entries(fs)).map(entry => entry.name), ["BINARY"]);
  assert.equal(Buffer.from(await fs.readFile("/work/café.txt")).toString(), "unicode");
});

test("DOS symlink flag follows target and preserves neighboring Unicode without -k", async () => {
  const fs = await fixture();
  await fs.symlink("binary", "/work/linkname");
  const result = await execute("zip", fs, ["-qky", "out.zip", "linkname"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await entries(fs))[0]!.symlink, false);
  assert.equal((await execute("unzip", fs, ["-p", "out.zip", "LINKNAME"])).stdout.length, (await fs.readFile("/work/binary")).length);
  await fs.writeFile("/work/é.txt", Buffer.from("utf8"));
  assert.equal((await execute("zip", fs, ["-q", "unicode.zip", "é.txt"])).exitCode, 0);
  assert.equal((await execute("unzip", fs, ["-p", "unicode.zip", "é.txt"])).stdout.toString(), "utf8");
});

for (const flag of ["-qRE", "--regex"]) {
  test(`regex ${flag} treats unsafe-looking general regex as literal glob`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, [flag, "out.zip", "binary", "-i", "(b+)+inary"]);
    assert.equal(result.exitCode, 0);
    assert.equal((await entries(fs)).length, 0);
  });
}

for (const delta of [0, -1]) {
  test(`regex argument budget exact boundary delta=${delta}`, async () => {
    const fs = await fixture();
    const args = ["-qRE", "out.zip", "binary", "-i", "[b]inary"];
    const bytes = args.reduce((sum, value) => sum + Buffer.byteLength(value), 0);
    const result = await execute("zip", fs, args, { limits: { maxArgumentBytes: bytes + delta } });
    assert.equal(result.exitCode === 0, delta === 0, result.stdout.toString() + result.stderr);
    if (delta < 0) await assert.rejects(fs.stat("/work/out.zip"), { code: "ENOENT" });
  });
}

test("regex pattern work limit refuses publication", async () => {
  const fs = await fixture();
  const name = "b".repeat(64);
  await fs.writeFile(`/work/${name}`, Buffer.from("x"));
  const result = await execute("zip", fs, ["-qRE", "out.zip", name, "-i", "?".repeat(64)], { limits: { maxPatternSteps: 64 } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stdout.toString() + result.stderr, /pattern work limit/);
  await assert.rejects(fs.stat("/work/out.zip"), { code: "ENOENT" });
});

test("regex active cancellation at bounded matcher yield prevents publication", async t => {
  const fs = await fixture();
  const name = "b".repeat(64);
  await fs.writeFile(`/work/${name}`, Buffer.from("x"));
  const controller = new AbortController();
  const reason = new Error("cancel glob");
  t.mock.method(globalThis, "setImmediate", () => { queueMicrotask(() => controller.abort(reason)); return undefined; });
  await assert.rejects(execute("zip", fs, ["-qRE", "out.zip", name, "-i", "?".repeat(64)], {}, { signal: controller.signal }), error => error === reason);
  await assert.rejects(fs.stat("/work/out.zip"), { code: "ENOENT" });
});

test("FIFO empty-chunk producer hits work budget and retires", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/pipe", new Uint8Array());
  let closed = false;
  const view = fifoView(fs, async function* () { try { while (true) yield new Uint8Array(); } finally { closed = true; } });
  const result = await execute("zip", view, ["-qFI", "out.zip", "pipe"], { limits: { maxPatternSteps: 64 } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stdout.toString() + result.stderr, /work limit/);
  assert.equal(closed, true);
  await assert.rejects(fs.stat("/work/out.zip"), { code: "ENOENT" });
});

test("FIFO reader receives owned cancellation signal and chunk size", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/pipe", new Uint8Array());
  let suppliedSignal: AbortSignal | undefined;
  const view = fifoView(fs, options => {
    suppliedSignal = options.signal;
    assert.equal(options.chunkSize, 512);
    return (async function* () { yield Buffer.from("x"); })();
  });
  assert.equal((await execute("zip", view, ["-qFI", "out.zip", "pipe"], { limits: { chunkSize: 512 } })).exitCode, 0);
  assert.ok(suppliedSignal);
});

test("FIFO total payload boundary includes neighboring members", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/pipe", new Uint8Array());
  const view = fifoView(fs, async function* () { yield Buffer.from("x"); });
  const size = (await fs.stat("/work/binary")).size;
  assert.equal((await execute("zip", view, ["-qFI", "out.zip", "binary", "pipe"], { limits: { maxTotalBytes: size + 1 } })).exitCode, 0);
  assert.notEqual((await execute("zip", view, ["-qFI", "short.zip", "binary", "pipe"], { limits: { maxTotalBytes: size } })).exitCode, 0);
  await assert.rejects(fs.stat("/work/short.zip"), { code: "ENOENT" });
});

test("DOS active source cancellation retires owned stream before settlement", async () => {
  const fs = await fixture();
  const controller = new AbortController();
  const reason = new Error("cancel DOS input");
  let closed = false;
  const view = new Proxy(fs, { get(target, property) {
    if (property === "readStream") return async function* () {
      try { yield Buffer.from("first"); controller.abort(reason); yield Buffer.from("next"); }
      finally { closed = true; }
    };
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await assert.rejects(execute("zip", view, ["-qk", "out.zip", "binary"], {}, { signal: controller.signal }), error => error === reason);
  assert.equal(closed, true);
  await assert.rejects(fs.stat("/work/out.zip"), { code: "ENOENT" });
});

test("FIFO and DOS options share actual Shell and SDK dispatch", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/pipe", new Uint8Array());
  const shell = new Shell({ fs: fifoView(fs, async function* () { yield Buffer.from("shell producer"); }), cwd: "/work" }).use(archiveCommands());
  try {
    const result = await shell.exec("zip -q --fifo --DOS-names --regex out.zip pipe; unzip -p out.zip PIPE");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "shell producer");
  } finally { await shell.dispose(); }
});

test("FIFO disabled never reads a provider's file-typed FIFO mode", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/pipe", new Uint8Array());
  const base = fifoView(fs, async function* () { assert.fail("disabled FIFO must not open"); yield new Uint8Array(); });
  const view = new Proxy(base, { get(target, property) {
    if (property === "stat" || property === "lstat") return async (path: string, options: unknown) => {
      const stat = await Reflect.apply(Reflect.get(target, property), target, [path, options]);
      return path === "/work/pipe" ? { ...stat, type: "file" } : stat;
    };
    return Reflect.get(target, property);
  } });
  const result = await execute("zip", view, ["-qFI-", "out.zip", "pipe", "binary"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.deepEqual((await entries(fs)).map(entry => entry.name), ["binary"]);
});

for (const capability of [false, undefined]) {
  test(`FIFO requires explicit streaming capability: ${capability}`, async () => {
    const fs = await fixture();
    await fs.writeFile("/work/pipe", new Uint8Array());
    const base = fifoView(fs, async function* () { assert.fail("must not open unsupported FIFO"); yield new Uint8Array(); });
    const view = new Proxy(base, { get(target, property) {
      if (property === "capabilitiesFor") return (path: string) => path === "/work/pipe" ? { ...fs.capabilities, streamingRead: capability } : fs.capabilities;
      return Reflect.get(target, property);
    } });
    const result = await execute("zip", view, ["-qFI", "out.zip", "pipe"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stdout.toString() + result.stderr, /explicit FIFO byte stream/);
    await assert.rejects(fs.stat("/work/out.zip"), { code: "ENOENT" });
  });
}

test("FIFO flag never opts into neighboring character devices", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/pipe", new Uint8Array());
  const base = fifoView(fs, async function* () { assert.fail("character device must not open"); yield new Uint8Array(); });
  const view = new Proxy(base, { get(target, property) {
    if (property === "stat" || property === "lstat") return async (path: string, options: unknown) => {
      const stat = await Reflect.apply(Reflect.get(target, property), target, [path, options]);
      return path === "/work/pipe" ? { ...stat, mode: 0o020600 } : stat;
    };
    return Reflect.get(target, property);
  } });
  assert.equal((await execute("zip", view, ["-qFI", "out.zip", "pipe", "binary"])).exitCode, 0);
  assert.deepEqual((await entries(fs)).map(entry => entry.name), ["binary"]);
});

test("FIFO selected move refuses without opening producer or deleting source", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/pipe", new Uint8Array());
  const view = fifoView(fs, async function* () { assert.fail("FIFO move must not open"); yield new Uint8Array(); });
  assert.notEqual((await execute("zip", view, ["-qFIm", "out.zip", "pipe"])).exitCode, 0);
  assert.equal((await fs.stat("/work/pipe")).type, "file");
  await assert.rejects(fs.stat("/work/out.zip"), { code: "ENOENT" });
});

test("DOS comments preserve Unicode byte identity", async () => {
  const fs = await fixture(await archiveBytes([{ name: "BINARY", body: Buffer.from("old") }], entries => {
    entries[0]!.comment = Buffer.from("é comment");
  }));
  assert.equal((await execute("zip", fs, ["-qk", "sample.zip", "binary"])).exitCode, 0);
  const archive = await readZipArchive(await fs.readFile("/work/sample.zip"), settings({}), new AbortController().signal);
  assert.deepEqual(Buffer.from(archive.entries[0]!.comment!), Buffer.from("é comment"));
});

test("FIFO producer with no chunks creates an extractable empty member", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/pipe", new Uint8Array());
  let closed = false;
  const view = fifoView(fs, async function* () {
    try { yield* []; } finally { closed = true; }
  });
  assert.equal((await execute("zip", view, ["-qFIk", "out.zip", "pipe"])).exitCode, 0);
  assert.equal(closed, true);
  const extracted = await execute("unzip", fs, ["-p", "out.zip", "PIPE"]);
  assert.equal(extracted.exitCode, 0);
  assert.equal(extracted.stdout.length, 0);
});

for (const failure of ["open", "first read"] as const) {
  test(`FIFO ${failure} failure preserves existing archive and source`, async () => {
    const fs = await fixture();
    await fs.writeFile("/work/pipe", Buffer.from("source"));
    const before = await fs.readFile("/work/sample.zip");
    let closed = false;
    const view = fifoView(fs, () => {
      if (failure === "open") throw new Error("producer open failed");
      return (async function* () {
        try { yield* []; throw new Error("producer first read failed"); }
        finally { closed = true; }
      })();
    });
    assert.notEqual((await execute("zip", view, ["-qFI", "sample.zip", "pipe"])).exitCode, 0);
    assert.equal(closed, failure === "first read");
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
    assert.equal(Buffer.from(await fs.readFile("/work/pipe")).toString(), "source");
  });
}

test("FIFO exclusion prevents admission even without a stream capability", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/pipe", new Uint8Array());
  const view = fifoView(fs, () => { assert.fail("excluded producer must not open"); }, false);
  const result = await execute("zip", view, ["-qFI", "out.zip", "pipe", "binary", "-x", "pipe"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual((await entries(fs)).map(entry => entry.name), ["binary"]);
});

test("FIFO metadata change after EOF refuses publication", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/pipe", new Uint8Array());
  const before = await fs.readFile("/work/sample.zip");
  let changed = false;
  const base = fifoView(fs, async function* () {
    yield Buffer.from("producer");
    changed = true;
  });
  const view = new Proxy(base, { get(target, property) {
    if (property === "stat" || property === "lstat") return async (path: string, options: unknown) => {
      const stat = await Reflect.apply(Reflect.get(target, property), target, [path, options]);
      return path === "/work/pipe" ? { ...stat, mtimeMs: modified.getTime() + (changed ? 1000 : 0) } : stat;
    };
    return Reflect.get(target, property);
  } });
  const result = await execute("zip", view, ["-qFI", "sample.zip", "pipe"]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stdout.toString() + result.stderr, /source changed while reading/);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});

test("DOS empty directory component refuses while junk paths can discard it", async () => {
  const fs = await fixture();
  await fs.mkdir("/work/...");
  await fs.writeFile("/work/.../name.txt", Buffer.from("payload"));
  assert.equal((await execute("zip", fs, ["-qk", "out.zip", ".../name.txt"])).exitCode, 16);
  await assert.rejects(fs.stat("/work/out.zip"), { code: "ENOENT" });
  assert.equal((await execute("zip", fs, ["-qkj", "out.zip", ".../name.txt"])).exitCode, 0);
  assert.deepEqual((await entries(fs)).map(entry => entry.name), ["NAME.TXT"]);
});

test("regex switch respects exclusions and no-wild mode", async () => {
  const fs = await fixture();
  const result = await execute("zip", fs, ["-qRE", "out.zip", "binary", "folder/data", "-i", "*", "-x", "[b]inary"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual((await entries(fs)).map(entry => entry.name), ["folder/data"]);
  const literal = await execute("zip", fs, ["-qREnw", "literal.zip", "binary", "-i", "[b]inary"]);
  assert.equal(literal.exitCode, 0);
  const archive = await readZipArchive(await fs.readFile("/work/literal.zip"), settings({}), new AbortController().signal);
  assert.equal(archive.entries.length, 0);
});

test("buffered FIFO BZIP2 ZIP64 descriptors retain known local byte spans", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/pipe", new Uint8Array());
  const payload = Buffer.from([0, 255, 128, 13, 10, 65]);
  const view = fifoView(fs, async function* () { yield payload; });
  const result = await execute("zip", view, ["-qFIk", "-Z", "bzip2", "-fz", "-fd", "out.zip", "pipe"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  const bytes = Buffer.from(await fs.readFile("/work/out.zip"));
  const [entry] = await entries(fs);
  const extraStart = 30 + bytes.readUInt16LE(26);
  assert.equal(bytes.readUInt16LE(extraStart), 1);
  assert.equal(bytes.readBigUInt64LE(extraStart + 4), BigInt(payload.length));
  assert.equal(bytes.readBigUInt64LE(extraStart + 12), BigInt(entry!.data.length));
});

test("BZIP2 descriptor ZIP64 size sentinel includes both local size fields", async () => {
  // Synthetic wire metadata exercises the 4 GiB boundary without a 4 GiB fixture.
  const limits = settings({ limits: { maxEntryBytes: 0x100000000, maxTotalBytes: 0x100000000 } });
  const signal = new AbortController().signal;
  const entry = await makeZipEntry("x", Buffer.from("x"), { modified, mode: 0o100644, directory: false, symlink: false }, limits, signal, 6, true, "bzip2");
  entry.size = 0xffffffff;
  entry.descriptors = true;
  const bytes = Buffer.from(await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal));
  assert.equal(bytes.readUInt32LE(18), 0xffffffff);
  assert.equal(bytes.readUInt32LE(22), 0xffffffff);
  const extraStart = 30 + bytes.readUInt16LE(26);
  assert.equal(bytes.readUInt16LE(extraStart + 2), 16);
  assert.equal(bytes.readBigUInt64LE(extraStart + 4), 0xffffffffn);
  assert.equal(bytes.readBigUInt64LE(extraStart + 12), BigInt(entry.data.length));
});
