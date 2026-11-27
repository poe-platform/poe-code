import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type FileSystem } from "safe-bash-contracts";
import { createCpCommand } from "./index.js";

async function execute(fs: FileSystem, args: string[], signal = new AbortController().signal) {
  let stderr = "";
  const result = await createCpCommand().execute({
    command: "cp", args, fs, cwd: "/", env: {}, signal,
    stdin: toByteSource(""), stdout: { async write() {} },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
  });
  return { ...result, stderr };
}

for (const nested of [false, true]) {
  test(`cp continues after multiple conflicting ${nested ? "nested " : ""}entries`, async () => {
    const fs = createMemoryFileSystem();
    const source = nested ? "/s/a" : "/s";
    await fs.mkdir(source, { recursive: true });
    for (const name of ["b", "c", "d"]) {
      await fs.writeFile(`${source}/${name}`, new TextEncoder().encode(name));
    }
    await fs.writeFile("/s/z", new TextEncoder().encode("later sibling"));
    const target = nested ? "/t/s/a" : "/t/s";
    for (const name of ["b", "c"]) await fs.mkdir(`${target}/${name}`, { recursive: true });
    const result = await execute(fs, ["-r", "/s", "/t"]);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(await fs.readFile(`${target}/d`), new TextEncoder().encode("d"));
    assert.deepEqual(await fs.readFile("/t/s/z"), new TextEncoder().encode("later sibling"));
    assert.equal(result.stderr.trim().split("\n").length, 2, result.stderr);
    for (const name of ["b", "c"]) {
      assert.ok(result.stderr.includes(`${target}/${name}`), result.stderr);
      assert.equal((await fs.stat(`${target}/${name}`)).type, "directory");
      assert.deepEqual(await fs.readFile(`${source}/${name}`), new TextEncoder().encode(name));
    }
  });
}

test("cp -rL copies siblings after a dangling source symlink", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/s");
  await fs.symlink("missing", "/s/b");
  await fs.writeFile("/s/c", new Uint8Array([2]));
  const result = await execute(fs, ["-rL", "/s", "/t"]);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(await fs.readFile("/t/c"), new Uint8Array([2]));
  assert.equal(result.stderr.trim().split("\n").length, 1, result.stderr);
  assert.ok(result.stderr.includes("/s/b"), result.stderr);
  await assert.rejects(fs.lstat("/t/b"), { code: "ENOENT" });
});

test("cp stops recursive copying on cancellation without reporting a file error", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/s");
  await fs.writeFile("/s/b", new Uint8Array([1]));
  await fs.writeFile("/s/c", new Uint8Array([2]));
  const controller = new AbortController();
  const lstat = fs.lstat.bind(fs);
  let roots = 0;
  fs.lstat = async (path, options) => {
    if (path === "/s") roots++;
    if (roots === 2 && path === "/s/b") controller.abort(false);
    return lstat(path, options);
  };
  await assert.rejects(execute(fs, ["-r", "/s", "/t"], controller.signal), reason => reason === false);
  await assert.rejects(fs.lstat("/t/c"), { code: "ENOENT" });
});
