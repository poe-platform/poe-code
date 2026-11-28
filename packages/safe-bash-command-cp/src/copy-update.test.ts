import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { createCpCommand } from "./index.js";

async function fixture() {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/a", new TextEncoder().encode("x\n"));
  await fs.writeFile("/work/b", new TextEncoder().encode("y\n"));
  await fs.utimes!("/work/a", 2000, 2000);
  await fs.utimes!("/work/b", 1000, 1000);
  return fs;
}

async function run(fs: Awaited<ReturnType<typeof fixture>>, args: string[]) {
  let stderr = "";
  const result = await createCpCommand().execute({
    command: "cp", args, fs, cwd: "/work", env: {}, signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: { async write() {} },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
  });
  return { ...result, stderr };
}

for (const mode of ["none", "older", "all"]) {
  for (const targetTime of [1000, 2000, 3000]) {
    test(`cp --update=${mode} with target mtime ${targetTime}`, async () => {
      const fs = await fixture();
      await fs.utimes!("/work/b", targetTime, targetTime);
      const result = await run(fs, [`--update=${mode}`, "a", "b"]);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      const copied = mode === "all" || mode === "older" && targetTime < 2000;
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/b")), copied ? "x\n" : "y\n");
    });
  }
  test(`cp --update=${mode} creates missing destinations`, async () => {
    const fs = await fixture();
    const result = await run(fs, [`--update=${mode}`, "a", "c"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/work/c"), await fs.readFile("/work/a"));
  });
}

for (const args of [["-p", "--no-preserve=mode"], ["-p", "--no-preserve", "mode"]]) {
  test(`cp ${args.join(" ")} disables mode preservation`, async () => {
    const fs = await fixture();
    await fs.chmod!("/work/a", 0o600);
    await fs.chmod!("/work/b", 0o644);
    const result = await run(fs, [...args, "a", "b"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal((await fs.stat("/work/b")).mode & 0o777, 0o644);
    assert.equal((await fs.stat("/work/b")).mtimeMs, 2000);
  });
}

test("cp rejects invalid update and no-preserve values before writing", async () => {
  for (const option of ["--update=invalid", "--no-preserve=invalid"]) {
    const fs = await fixture();
    assert.equal((await run(fs, [option, "a", "b"])).exitCode, 2);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/b")), "y\n");
  }
});

for (const args of [["-u", "--update=all"], ["--update=none", "--update=all"], ["--update=all", "-u"], ["--update=all", "--update"]]) {
  test(`cp applies update options in order: ${args.join(" ")}`, async () => {
    const fs = await fixture();
    await fs.utimes!("/work/b", 3000, 3000);
    const result = await run(fs, [...args, "a", "b"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/b")), args.at(-1) === "--update=all" ? "x\n" : "y\n");
  });
}

for (const list of ["all", "mode,ownership,timestamps,links,context,xattr"]) {
  test(`cp --no-preserve=${list} disables attributes and allows later preservation`, async () => {
    const fs = await fixture();
    await fs.chmod!("/work/a", 0o600);
    await fs.chmod!("/work/b", 0o644);
    let result = await run(fs, ["-p", `--no-preserve=${list}`, "a", "b"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.stat("/work/b")).mode & 0o777, 0o644);
    assert.notEqual((await fs.stat("/work/b")).mtimeMs, 2000);
    result = await run(fs, [`--no-preserve=${list}`, "-p", "a", "b"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.stat("/work/b")).mode & 0o777, 0o600);
    assert.equal((await fs.stat("/work/b")).mtimeMs, 2000);
  });
}
