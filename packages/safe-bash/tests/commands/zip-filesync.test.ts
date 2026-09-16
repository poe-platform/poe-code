import assert from "node:assert/strict";
import test from "node:test";
import { archiveBytes, execute, fixture, modified } from "./zip-standard-flags.helpers.js";
import { readZipArchive } from "../../src/commands/archive/zip-format.js";
import { settings } from "../../src/commands/archive/internal.js";

async function sourceFixture() {
  const fs = await fixture(await archiveBytes([
    { name: "a", body: Buffer.from("old") },
    { name: "b", body: Buffer.from("retained?") },
  ]));
  await fs.writeFile("/work/a", Buffer.from("old"));
  await fs.utimes!("/work/a", modified.getTime(), modified.getTime());
  return fs;
}

for (const flag of ["-FS", "--filesync", "--filesy"]) {
  test(`zip ${flag} deletes entries outside selected source set without reading unchanged members`, async () => {
    const fs = await sourceFixture();
    const result = await execute("zip", fs, [flag, "sample.zip", "a"]);
    assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
    assert.equal(result.stdout.toString(), "deleting: b\n");
    const archive = await readZipArchive(await fs.readFile("/work/sample.zip"), settings({}), new AbortController().signal);
    assert.deepEqual(archive.entries.map(entry => entry.name), ["a"]);
    assert.equal((await execute("unzip", fs, ["-p", "sample.zip", "a"])).stdout.toString(), "old");
  });
}

test("zip filesync current archive succeeds and leaves bytes unchanged, respecting quiet", async () => {
  const fs = await sourceFixture();
  await execute("zip", fs, ["-qFS", "sample.zip", "a"]);
  const before = await fs.readFile("/work/sample.zip");
  for (const args of [["-FS"], ["-qFS"]]) {
    const result = await execute("zip", fs, [...args, "sample.zip", "a"]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.toString(), args[0] === "-FS" ? "Archive is current\n" : "");
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  }
});

for (const change of ["older", "size"]) {
  test(`zip filesync replaces ${change} source rather than applying update freshness`, async () => {
    const fs = await sourceFixture();
    const body = change === "size" ? "longer" : "new";
    await fs.writeFile("/work/a", Buffer.from(body));
    const stamp = modified.getTime() - (change === "older" ? 10000 : 0);
    await fs.utimes!("/work/a", stamp, stamp);
    const result = await execute("zip", fs, ["-qFS", "sample.zip", "a"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await execute("unzip", fs, ["-p", "sample.zip", "a"])).stdout.toString(), body);
  });
}

for (const operands of [[], ["missing"], ["a", "-x", "a"]]) {
  test(`zip filesync empty source selection ${JSON.stringify(operands)} preserves input`, async () => {
    const fs = await sourceFixture();
    const before = await fs.readFile("/work/sample.zip");
    const result = await execute("zip", fs, ["-FS", "sample.zip", ...operands]);
    assert.equal(result.exitCode, 12, result.stdout.toString() + result.stderr);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  });
}

for (const action of ["-u", "-f", "-d", "-U"]) {
  test(`zip filesync rejects incompatible ${action} without publication`, async () => {
    const fs = await sourceFixture();
    const before = await fs.readFile("/work/sample.zip");
    assert.equal((await execute("zip", fs, ["-FS", action, "sample.zip", "a"])).exitCode, 16);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  });
}

test("zip filesync separate output preserves original and copies current entries without source payload reads", async () => {
  const fs = await sourceFixture();
  const before = await fs.readFile("/work/sample.zip");
  const guarded = new Proxy(fs, { get(target, property) {
    const value = Reflect.get(target, property);
    if (property === "readStream" || property === "readFile") return (path: string, ...args: unknown[]) => {
      assert.notEqual(path, "/work/a", "unchanged source payload was read");
      return Reflect.apply(value, target, [path, ...args]);
    };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await execute("zip", guarded, ["-qFS", "sample.zip", "a", "-O", "out.zip"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  assert.equal((await execute("unzip", fs, ["-p", "out.zip", "a"])).stdout.toString(), "old");
});

test("zip filesync recursive selection and omitted directories produce only selected files", async () => {
  const fs = await sourceFixture();
  const result = await execute("zip", fs, ["-qFSrD", "sample.zip", "folder"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const archive = await readZipArchive(await fs.readFile("/work/sample.zip"), settings({}), new AbortController().signal);
  assert.deepEqual(archive.entries.map(entry => entry.name), ["folder/data"]);
});

test("zip filesync rejects flattened duplicate names even when both source metadata match old entry", async () => {
  const fs = await sourceFixture();
  await fs.writeFile("/work/folder/a", Buffer.from("old"));
  await fs.utimes!("/work/folder/a", modified.getTime(), modified.getTime());
  const before = await fs.readFile("/work/sample.zip");
  const result = await execute("zip", fs, ["-qFSj", "sample.zip", "a", "folder/a"]);
  assert.equal(result.exitCode, 16, result.stderr);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});

test("zip filesync resource rejection preserves old archive before deletions publish", async () => {
  const fs = await sourceFixture();
  await fs.writeFile("/work/a", Buffer.from("longer"));
  const before = await fs.readFile("/work/sample.zip");
  const result = await execute("zip", fs, ["-qFS", "sample.zip", "a"], { limits: { maxEntryBytes: 3 } });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});

test("zip filesync same DOS two-second time and size remains current", async () => {
  const fs = await sourceFixture();
  await execute("zip", fs, ["-qFS", "sample.zip", "a"]);
  await fs.utimes!("/work/a", modified.getTime() - 1000, modified.getTime() - 1000);
  const result = await execute("zip", fs, ["-FS", "sample.zip", "a"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), "Archive is current\n");
});

for (const latest of [false, true]) {
  test(`zip current filesync skips integrity test while retaining latest-time behavior (${latest})`, async () => {
    const fs = await fixture(await archiveBytes([{ name: "binary", body: Buffer.from("old") }], entries => { entries[0]!.crc32 = 1; }));
    await fs.writeFile("/work/binary", Buffer.from("old"));
    await fs.utimes!("/work/binary", modified.getTime(), modified.getTime());
    const priorTime = modified.getTime() - 60000;
    await fs.utimes!("/work/sample.zip", priorTime, priorTime);
    const before = await fs.readFile("/work/sample.zip");
    const result = await execute("zip", fs, ["-FS", latest ? "-oT" : "-T", "sample.zip", "binary"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString(), "Archive is current\n");
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
    assert.equal((await fs.stat("/work/sample.zip")).mtimeMs, latest ? modified.getTime() : priorTime);
  });
}
