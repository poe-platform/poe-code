import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { createCpCommand } from "./index.js";

async function fixture() {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work/a/b", { recursive: true });
  await fs.mkdir("/work/d");
  await fs.writeFile("/work/a/b/f", new TextEncoder().encode("1\n"));
  await fs.writeFile("/work/a/g", new TextEncoder().encode("2\n"));
  return fs;
}

async function run(fs: Awaited<ReturnType<typeof fixture>>, args: string[]) {
  let stdout = "", stderr = "";
  const result = await createCpCommand().execute({
    command: "cp", args, fs, cwd: "/work", env: {}, signal: new AbortController().signal,
    stdin: toByteSource(""),
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
  });
  return { ...result, stdout, stderr };
}

for (const source of ["a/b/f", "./a/b/f", "/work/a/b/f"]) {
  test(`cp --parents copies ${source} below the destination`, async () => {
    const fs = await fixture();
    const result = await run(fs, ["--parents", source, "d"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    const target = source.startsWith("/") ? "/work/d/work/a/b/f" : "/work/d/a/b/f";
    assert.deepEqual(await fs.readFile(target), await fs.readFile("/work/a/b/f"));
  });
}

test("cp --parents supports multiple sources, target-directory and no-clobber", async () => {
  const fs = await fixture();
  assert.equal((await run(fs, ["--parents", "-t", "d", "a/b/f", "a/g"])).exitCode, 0);
  assert.deepEqual(await fs.readFile("/work/d/a/g"), await fs.readFile("/work/a/g"));
  await fs.writeFile("/work/a/b/f", new TextEncoder().encode("changed"));
  assert.equal((await run(fs, ["--parents", "-n", "a/b/f", "d"])).exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/d/a/b/f")), "1\n");
});

test("cp --parents supports recursive copies and preserved symbolic links", async () => {
  const fs = await fixture();
  await fs.symlink("f", "/work/a/b/link");
  const result = await run(fs, ["--parents", "-R", "a/b", "d"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await fs.readFile("/work/d/a/b/f"), await fs.readFile("/work/a/b/f"));
  assert.equal(await fs.readlink("/work/d/a/b/link"), "f");
});

for (const args of [["a/b/f", "missing"], ["a/b/f", "a/g"], ["-T", "a/b/f", "d"]]) {
  test(`cp --parents requires an existing target directory: ${args.join(" ")}`, async () => {
    const fs = await fixture();
    const result = await run(fs, ["--parents", ...args]);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("with --parents, the destination must be a directory"), result.stderr);
    assert.deepEqual(await fs.readdir("/work/d"), []);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/a/g")), "2\n");
  });
}

test("cp --parents rejects unsupported directory creation before copying any source", async () => {
  const fs = await fixture();
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, recursiveMkdir: false });
  const result = await run(fs, ["--parents", "a/g", "a/b/f", "d"]);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("ENOTSUP"), result.stderr);
  assert.deepEqual(await fs.readdir("/work/d"), []);
});

test("cp --parents does not overwrite a file blocking a parent directory", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/d/a", new TextEncoder().encode("keep"));
  const result = await run(fs, ["--parents", "a/b/f", "d"]);
  assert.equal(result.exitCode, 1);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/d/a")), "keep");
  assert.deepEqual(await fs.readFile("/work/a/b/f"), new TextEncoder().encode("1\n"));
});

test("cp help advertises --parents", async () => {
  const result = await run(await fixture(), ["--help"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.includes("--parents"));
});
