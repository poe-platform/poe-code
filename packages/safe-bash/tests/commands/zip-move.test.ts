import assert from "node:assert/strict";
import test from "node:test";
import { archiveBytes, execute, binary, compressed, modified } from "./zip-standard-flags.helpers.js";
import { MemoryFileSystem } from "../../../safe-fs/src/fs/memory/index.js";
import { toByteSource } from "../../src/contracts/index.js";

async function fixture(bytes?: Uint8Array) {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work/folder", { recursive: true });
  await fs.writeFile("/work/binary", binary);
  await fs.writeFile("/work/folder/data", compressed);
  await fs.writeFile("/work/sample.zip", bytes ?? await archiveBytes());
  return fs;
}

for (const flag of ["-m", "--move"]) {
  test(`zip ${flag} deletes sources only after archive publication`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, ["-q", flag, "out.zip", "binary"]);
    assert.equal(result.exitCode, 0, result.stderr);
    await assert.rejects(fs.lstat("/work/binary"), { code: "ENOENT" });
    assert.deepEqual((await execute("unzip", fs, ["-p", "out.zip", "binary"])).stdout, Buffer.from([0,255,128,13,10,65]));
  });
}
for (const flags of ["-um", "-fm", "-FSm"]) {
  test(`zip unchanged ${flags} deletes archived selected source with native status`, async () => {
    const fs = await fixture(await archiveBytes([{ name: "binary", body: Buffer.from("old") }]));
    await fs.writeFile("/work/binary", Buffer.from("old"));
    await fs.utimes!("/work/binary", modified.getTime(), modified.getTime());
    const before = await fs.readFile("/work/sample.zip");
    const result = await execute("zip", fs, ["-q", flags, "sample.zip", "binary"]);
    assert.equal(result.exitCode, flags === "-FSm" ? 0 : 12, result.stderr);
    await assert.rejects(fs.lstat("/work/binary"), { code: "ENOENT" });
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  });
}
for (const links of [false,true]) {
  test(`zip move removes symlink pathname while preserving target (stored=${links})`, async () => {
    const fs = await fixture();
    await fs.symlink!("binary", "/work/link");
    const result = await execute("zip", fs, [links ? "-qmy" : "-qm", "out.zip", "link"]);
    assert.equal(result.exitCode, 0, result.stderr);
    await assert.rejects(fs.lstat("/work/link"), { code: "ENOENT" });
    assert.equal((await fs.lstat("/work/binary")).type, "file");
  });
}
for (const omit of [false,true]) {
  test(`zip recursive move removes selected directories only (D=${omit})`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, [omit ? "-qrmD" : "-qrm", "out.zip", "folder"]);
    assert.equal(result.exitCode, 0, result.stderr);
    await assert.rejects(fs.lstat("/work/folder/data"), { code: "ENOENT" });
    if (omit) assert.equal((await fs.lstat("/work/folder")).type, "directory");
    else await assert.rejects(fs.lstat("/work/folder"), { code: "ENOENT" });
  });
}

test("zip move preserves excluded sources and nonempty selected directories", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/folder/keep", Buffer.from("keep"));
  const result = await execute("zip", fs, ["-qrm", "out.zip", "folder", "-x", "*/keep"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.lstat("/work/folder")).type, "directory");
  assert.equal(Buffer.from(await fs.readFile("/work/folder/keep")).toString(), "keep");
  await assert.rejects(fs.lstat("/work/folder/data"), { code: "ENOENT" });
});

test("zip move does not delete sources when integrity rejects retained payload", async () => {
  const fs = await fixture(await archiveBytes([{ name: "bad", body: Buffer.from("bad") }], entries => { entries[0]!.crc32 = 1; }));
  const result = await execute("zip", fs, ["-qmT", "sample.zip", "binary"]);
  assert.equal(result.exitCode, 8, result.stderr);
  assert.equal((await fs.lstat("/work/binary")).type, "file");
});

test("zip move does not delete sources when publication fails", async () => {
  const fs = await fixture();
  const rejected = new Proxy(fs, { get(target, property) {
    if (property === "publishStagedFile") return async () => { throw Error("publication rejected"); };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await execute("zip", rejected, ["-qm", "out.zip", "binary"]);
  assert.equal(result.exitCode, 2, result.stderr);
  assert.equal((await fs.lstat("/work/binary")).type, "file");
});

test("zip move refuses replacement source after publication", async () => {
  const fs = await fixture();
  const replaced = new Proxy(fs, { get(target, property) {
    const value = Reflect.get(target, property);
    if (property === "publishStagedFile") return async (...args: Parameters<NonNullable<typeof fs.publishStagedFile>>) => {
      await value.apply(target,args);
      await fs.rename("/work/binary", "/work/original");
      await fs.writeFile("/work/binary", Buffer.from("replacement"));
    };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await execute("zip", replaced, ["-m", "out.zip", "binary"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout.toString(), /error deleting binary/);
  assert.equal(Buffer.from(await fs.readFile("/work/binary")).toString(), "replacement");
});

test("zip stdout move requires successful stream completion", async () => {
  const fs = await fixture();
  const result = await execute("zip", fs, ["-qm", "-", "binary"]);
  assert.equal(result.exitCode, 0, result.stderr);
  await assert.rejects(fs.lstat("/work/binary"), { code: "ENOENT" });
  await fs.writeFile("/work/input", Buffer.from("a"));
  const failed = await execute("zip", fs, ["-qm", "-", "input"], {}, { stdout: { async write() { throw Error("output failed"); } } });
  assert.equal(failed.exitCode, 2);
  assert.equal((await fs.lstat("/work/input")).type, "file");
  const stdin = await execute("zip", fs, ["-qm", "out.zip", "-"], {}, { stdin: toByteSource("stdin") });
  assert.equal(stdin.exitCode, 0, stdin.stderr);
});

test("zip move archives and removes multiple hardlinks without adopting unrelated mutations", async () => {
  const fs = await fixture();
  await fs.link!("/work/binary", "/work/alias");
  const result = await execute("zip", fs, ["-qm", "out.zip", "binary", "alias"]);
  assert.equal(result.exitCode, 0, result.stderr);
  for (const name of ["binary", "alias"]) {
    await assert.rejects(fs.lstat(`/work/${name}`), { code: "ENOENT" });
    assert.deepEqual((await execute("unzip", fs, ["-p", "out.zip", name])).stdout, binary);
  }
});

test("zip move refuses unsupported removal capability before publication", async () => {
  const fs = await fixture();
  const unsupported = new Proxy(fs, { get(target, property) {
    if (property === "capabilities") return { ...fs.capabilities, atomicEntryRemoval: false };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await execute("zip", unsupported, ["-qm", "out.zip", "binary"]);
  assert.equal(result.exitCode, 2, result.stderr);
  assert.match(result.stderr, /atomic conditional source removal/);
  assert.equal((await fs.lstat("/work/binary")).type, "file");
  await assert.rejects(fs.lstat("/work/out.zip"), { code: "ENOENT" });
});
