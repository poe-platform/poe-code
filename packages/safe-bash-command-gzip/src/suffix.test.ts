import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { helloMember, run } from "./test-helpers.js";

test("gzip skips an already compressed operand and compresses the remaining file", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/a", Buffer.from("hi\n"));
  await fs.writeFile("/work/b", Buffer.from("yo\n"));
  const first = await run("gzip", ["a"], undefined, { fs, cwd: "/work" });
  assert.equal(first.exitCode, 0, first.stderr);
  assert.equal(first.stderr, "");
  const compressed = await fs.readFile("/work/a.gz");
  const stat = await fs.stat("/work/a.gz");

  const result = await run("gzip", ["a.gz", "b"], undefined, { fs, cwd: "/work" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.length, 0);
  assert.equal(result.stderr, "gzip: a.gz already has .gz suffix -- unchanged\n");
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["a.gz", "b.gz"]);
  assert.deepEqual(await fs.stat("/work/a.gz"), stat);
  assert.deepEqual(await fs.readFile("/work/a.gz"), compressed);
  assert.equal(gunzipSync(compressed).toString(), "hi\n");
  assert.equal(gunzipSync(await fs.readFile("/work/b.gz")).toString(), "yo\n");
});

for (const [suffix, flags] of [[".gz", []], [".GZ", []], [".tgz", []], [".custom", ["-S", ".custom"]]] as const) {
  test(`gzip skips a sole ${suffix} operand and honors quiet`, async () => {
    for (const quiet of [[], ["-q"], ["-qq"]]) {
      const fs = createMemoryFileSystem();
      await fs.writeFile(`/a${suffix}`, helloMember);
      const result = await run("gzip", [...flags, ...quiet, `a${suffix}`], undefined, { fs });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout.length, 0);
      assert.equal(result.stderr, quiet.length ? "" : `gzip: a${suffix} already has ${suffix} suffix -- unchanged\n`);
      assert.deepEqual(await fs.readFile(`/a${suffix}`), new Uint8Array(helloMember));
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), [`a${suffix}`]);
    }
  });
}

test("recursive gzip skips compressed files and continues through the directory", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dir");
  await fs.writeFile("/dir/a.gz", helloMember);
  await fs.writeFile("/dir/b", Buffer.from("yo\n"));
  const result = await run("gzip", ["-r", "dir"], undefined, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stderr.endsWith("a.gz already has .gz suffix -- unchanged\n"), result.stderr);
  assert.deepEqual(await fs.readFile("/dir/a.gz"), new Uint8Array(helloMember));
  assert.equal(gunzipSync(await fs.readFile("/dir/b.gz")).toString(), "yo\n");
  assert.deepEqual((await fs.readdir("/dir")).map(entry => entry.name).sort(), ["a.gz", "b.gz"]);
});

test("gzip suffix warnings do not suppress missing-file errors", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a.gz", helloMember);
  const result = await run("gzip", ["a.gz", "missing.gz"], undefined, { fs });
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.startsWith("gzip: a.gz already has .gz suffix -- unchanged\n"), result.stderr);
  assert.ok(result.stderr.includes("missing.gz"), result.stderr);
  assert.deepEqual(await fs.readFile("/a.gz"), new Uint8Array(helloMember));
});

test("gzip force and stdout still compress already suffixed files", async () => {
  for (const flag of ["-f", "-c"]) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/a.gz", helloMember);
    const result = await run("gzip", [flag, "a.gz"], undefined, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(gunzipSync(flag === "-c" ? result.stdout : await fs.readFile("/a.gz.gz")), helloMember);
    if (flag === "-c") assert.deepEqual(await fs.readFile("/a.gz"), new Uint8Array(helloMember));
    else await assert.rejects(fs.stat("/a.gz"), { code: "ENOENT" });
  }
});
