import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";

for (const args of [[], ["-d", "@0"]]) {
  test(`touch follows dangling symlink chains ${args.join(" ")}`, async () => {
    const fs = await fixture({});
    await fs.symlink("missing", "/work/inner");
    await fs.symlink("inner", "/work/link");
    const result = await run("touch", [...args, "link"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.lstat("/work/link")).type, "symlink");
    assert.equal((await fs.lstat("/work/inner")).type, "symlink");
    const target = await fs.stat("/work/missing");
    assert.equal(target.size, 0);
    if (args.length) assert.equal(target.mtimeMs, 0);
  });
}
for (const word of ["atime", "access", "use", "mtime", "modify"]) {
  test(`touch --time=${word} preserves the other timestamp and contents`, async () => {
    const fs = await fixture({ file: "keep" });
    await fs.utimes("/work/file", 100, 200);
    const result = await run("touch", [`--time=${word}`, "-d", "@0", "file"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    const stat = await fs.stat("/work/file");
    const access = ["atime", "access", "use"].includes(word);
    assert.equal(stat.atimeMs, access ? 0 : 100);
    assert.equal(stat.mtimeMs, access ? 200 : 0);
    assert.equal(Buffer.from(await fs.readFile("/work/file")).toString(), "keep");
  });
}
test("touch -t normalizes leap seconds across a year boundary", async () => {
  const fs = await fixture({ file: "keep" });
  const result = await run("touch", ["-t", "202412312359.60", "file"], { fs, env: { TZ: "UTC" } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.stat("/work/file")).mtimeMs, Date.parse("2025-01-01T00:00:00Z"));
});

test("touch no-create skips dangling links and rejects loops and invalid options", async () => {
  const fs = await fixture({ file: "keep" });
  await fs.symlink("missing", "/work/link");
  assert.equal((await run("touch", ["-c", "link"], { fs })).exitCode, 0);
  await assert.rejects(fs.stat("/work/missing"), { code: "ENOENT" });
  await fs.symlink("loop", "/work/loop");
  assert.equal((await run("touch", ["loop"], { fs })).exitCode, 1);
  for (const args of [["--time=bad"], ["--time"], ["-t", "202401020304.61"]]) {
    assert.notEqual((await run("touch", [...args, "file"], { fs })).exitCode, 0);
  }
});
