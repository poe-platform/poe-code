import assert from "node:assert/strict";
import test from "node:test";
import { archiveBytes, execute, fixture, modified } from "./zip-standard-flags.helpers.js";

async function sources() {
  const fs = await fixture(await archiveBytes([
    { name: "folder/a.txt", body: Buffer.from("old") },
    { name: "folder/sub/b.txt", body: Buffer.from("old") },
    { name: "other.bin", body: Buffer.from("old") },
  ]));
  await fs.mkdir("/work/folder/sub", { recursive: true });
  for (const path of ["folder/a.txt", "folder/sub/b.txt", "other.bin"]) {
    await fs.writeFile(`/work/${path}`, Buffer.from("NEWER"));
    await fs.utimes!(`/work/${path}`, modified.getTime() + 10000, modified.getTime() + 10000);
  }
  return fs;
}

for (const flags of [[], ["-MM"], ["-j"], ["-u"], ["-f"]]) {
  test(`zip archive-name wildcard fallback rereads sources ${flags}`, async () => {
    const fs = await sources();
    const result = await execute("zip", fs, ["-q", ...flags, "sample.zip", "folder/*.txt"]);
    assert.equal(result.exitCode, 0, result.stderr);
    for (const name of ["folder/a.txt", "folder/sub/b.txt"]) {
      assert.equal((await execute("unzip", fs, ["-p", "sample.zip", name])).stdout.toString(), "NEWER");
    }
    assert.equal((await execute("unzip", fs, ["-p", "sample.zip", "other.bin"])).stdout.toString(), "old");
    assert.equal((await execute("unzip", fs, ["-p", "sample.zip", "a.txt"])).exitCode, 11);
  });
}
for (const flags of [["-nw"], ["-ws"]]) {
  test(`zip archive-source patterns respect wildcard controls ${flags}`, async () => {
    const fs = await sources();
    const before = await fs.readFile("/work/sample.zip");
    const result = await execute("zip", fs, ["-q", ...flags, "sample.zip", "folder/*.txt"]);
    assert.equal(result.exitCode, flags[0] === "-nw" ? 12 : 0, result.stderr);
    if (flags[0] === "-nw") assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
    else {
      assert.equal((await execute("unzip", fs, ["-p", "sample.zip", "folder/a.txt"])).stdout.toString(), "NEWER");
      assert.equal((await execute("unzip", fs, ["-p", "sample.zip", "folder/sub/b.txt"])).stdout.toString(), "old");
    }
  });
}

test("zip archive-source pattern filters avoid reading excluded sources", async () => {
  const fs = await sources();
  const guarded = new Proxy(fs, { get(target, property) {
    const value = Reflect.get(target, property);
    if (property === "readStream" || property === "readFile") return (path: string, ...args: unknown[]) => {
      assert.notEqual(path, "/work/folder/sub/b.txt");
      return value.apply(target, [path, ...args]);
    };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await execute("zip", guarded, ["-q", "sample.zip", "*.txt", "-x", "*/sub/*"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await execute("unzip", fs, ["-p", "sample.zip", "folder/a.txt"])).stdout.toString(), "NEWER");
});

test("zip recursive archive-source fallback updates archived names without discovering new children", async () => {
  const fs = await fixture(await archiveBytes([
    { name: "folder/", body: Buffer.alloc(0) },
    { name: "folder/a", body: Buffer.from("old") },
  ]));
  await fs.writeFile("/work/folder/a", Buffer.from("NEWER"));
  await fs.writeFile("/work/folder/new", Buffer.from("new"));
  const result = await execute("zip", fs, ["-qrj", "sample.zip", "folder*"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const { readZipArchive } = await import("../../src/commands/archive/zip-format.js");
  const { settings } = await import("../../src/commands/archive/internal.js");
  const archive = await readZipArchive(await fs.readFile("/work/sample.zip"), settings({}), new AbortController().signal);
  assert.deepEqual(archive.entries.map(entry => entry.name), ["folder/", "folder/a"]);
  assert.equal((await execute("unzip", fs, ["-p", "sample.zip", "folder/a"])).stdout.toString(), "NEWER");
});

test("zip new archives do not expand quoted source wildcards", async () => {
  const fs = await sources();
  const result = await execute("zip", fs, ["-q", "new.zip", "folder/*.txt"]);
  assert.equal(result.exitCode, 12, result.stderr);
  assert.equal((await fs.readdir("/work")).some(entry => entry.name === "new.zip"), false);
});

test("zip existing literal wildcard filename takes precedence over archive pattern fallback", async () => {
  const fs = await sources();
  await fs.writeFile("/work/folder/*.txt", Buffer.from("literal"));
  const result = await execute("zip", fs, ["-q", "sample.zip", "folder/*.txt"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await execute("unzip", fs, ["-p", "sample.zip", "folder/a.txt"])).stdout.toString(), "old");
  assert.equal((await execute("unzip", fs, ["-p", "sample.zip", "folder/\\*.txt"])).stdout.toString(), "literal");
});
