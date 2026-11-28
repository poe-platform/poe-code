import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSedCommand } from "./index.js";

async function run(fs: FileSystem, suffix: string, file = "f1", flags: string[] = []) {
  const values = createCommandArguments([`-i${suffix}`, ...flags, "s/a/b/", file]);
  let stdout = "", stderr = "";
  const result = await createSedCommand().execute({
    command: "sed", args: values.args, argumentValues: values, cwd: "/work", env: {},
    fs, stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { ...result, stdout, stderr };
}

for (const fallback of [false, true]) {
  for (const [suffix, file, backup] of [
    ["bak_*", "f1", "/work/bak_f1"],
    ["bk/*.orig", "f1", "/work/bk/f1.orig"],
    ["*-*-*", "f1", "/work/f1-f1-f1"],
    ["bk/*", "sub/f1", "/work/bk/sub/f1"],
    ["/work/bk/*.orig", "f1", "/work/bk/f1.orig"],
    [".bak", "sub/f1", "/work/sub/f1.bak"],
    ["bk/*", "./f1", "/work/bk/f1"],
  ] as const) test(`sed backs up ${file} with ${suffix}, fallback=${fallback}`, async () => {
    const backing = createMemoryFileSystem();
    await backing.mkdir("/work/bk/sub", { recursive: true });
    await backing.mkdir("/work/sub");
    await backing.writeFile(`/work/${file}`, Buffer.from("a\n"), { mode: 0o640 });
    await backing.writeFile(backup, Buffer.from("previous\n"), { mode: 0o600 });
    const fs = fallback ? new Proxy(backing, { get(target, property) {
      if (property === "publishStagedFileSet") return undefined;
      const member: unknown = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(target) : member;
    } }) : backing;
    const result = await run(fs, suffix, file);
    assert.deepEqual(result, { exitCode: 0, stdout: "", stderr: "" });
    assert.equal(Buffer.from(await backing.readFile(`/work/${file}`)).toString(), "b\n");
    assert.equal(Buffer.from(await backing.readFile(backup)).toString(), "a\n");
    assert.equal((await backing.stat(backup)).mode & 0o7777, 0o640);
  });
}

for (const suffix of ["bak_*", "bk/*.orig"]) test(`sed creates a new ${suffix} backup`, async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work/bk", { recursive: true });
  await fs.writeFile("/work/f1", Buffer.from("a\n"));
  assert.deepEqual(await run(fs, suffix), { exitCode: 0, stdout: "", stderr: "" });
  assert.equal(Buffer.from(await fs.readFile(suffix === "bak_*" ? "/work/bak_f1" : "/work/bk/f1.orig")).toString(), "a\n");
  assert.equal(Buffer.from(await fs.readFile("/work/f1")).toString(), "b\n");
});

for (const file of ["f1", "link"]) test(`sed expands the backup of ${file} with --follow-symlinks`, async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/f1", Buffer.from("a\n"));
  await fs.symlink!("f1", "/work/link");
  assert.deepEqual(await run(fs, "bak_*", file, ["--follow-symlinks"]), { exitCode: 0, stdout: "", stderr: "" });
  assert.equal(Buffer.from(await fs.readFile("/work/bak_f1")).toString(), "a\n");
  assert.equal(Buffer.from(await fs.readFile("/work/f1")).toString(), "b\n");
  assert.equal((await fs.lstat("/work/link")).type, "symlink");
});

for (const existing of [false, true]) test(`sed refuses a swapped backup directory, existing=${existing}`, async () => {
  const backing = createMemoryFileSystem();
  await backing.mkdir("/work/bk", { recursive: true });
  await backing.mkdir("/private");
  await backing.writeFile("/work/f1", Buffer.from("a\n"), { mode: 0o640 });
  await backing.writeFile("/private/f1.orig", Buffer.from("secret\n"));
  if (existing) await backing.writeFile("/work/bk/f1.orig", Buffer.from("previous\n"), { mode: 0o600 });
  let swapped = false;
  const fs = new Proxy(backing, { get(target, property) {
    if (property === "openReadFile") return async (...args: Parameters<NonNullable<FileSystem["openReadFile"]>>) => {
      const reader = await target.openReadFile(...args);
      await backing.rename("/work/bk", "/work/held");
      await backing.symlink!("/private", "/work/bk");
      swapped = true;
      return reader;
    };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  assert.notEqual((await run(fs, "bk/*.orig")).exitCode, 0);
  assert.equal(swapped, true);
  assert.equal(Buffer.from(await backing.readFile("/work/f1")).toString(), "a\n");
  assert.equal(Buffer.from(await backing.readFile("/private/f1.orig")).toString(), "secret\n");
  assert.deepEqual((await backing.readdir("/work/held")).map(entry => entry.name), existing ? ["f1.orig"] : []);
  if (existing) assert.equal(Buffer.from(await backing.readFile("/work/held/f1.orig")).toString(), "previous\n");
});

for (const suffix of ["missing/*.bak", "*", "*\0"]) test(`sed preserves input on invalid backup ${JSON.stringify(suffix)}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/f1", Buffer.from("a\n"));
  assert.notEqual((await run(fs, suffix)).exitCode, 0);
  assert.equal(Buffer.from(await fs.readFile("/work/f1")).toString(), "a\n");
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["f1"]);
});
