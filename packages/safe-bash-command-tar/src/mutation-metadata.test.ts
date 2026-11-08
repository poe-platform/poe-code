import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type FileSystem } from "safe-bash-contracts";
import { createTarCommand } from "./index.js";

async function run(fs: FileSystem, args: string[]) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await createTarCommand({ limits: { chunkSize: 4096 } }).execute({
    command: "tar", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { ...result, stdout, stderr };
}

for (const mode of ["r", "u"] as const) test(`tar ${mode} stages global metadata and streams directory entries`, async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/files");
  await fs.writeFile("/initial", Uint8Array.of(1));
  assert.equal((await run(fs, ["-cf", "/archive.tar", "initial"])).exitCode, 0);
  for (let index = 129; index >= 0; index--) await fs.writeFile(`/files/${String(index).padStart(3, "0")}`, Uint8Array.of(index));
  let spills = 0;
  const view = new Proxy(fs, { get(target, key) {
    if (key === "readdir") return () => { throw new Error("bulk directory metadata is forbidden"); };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<FileSystem["createStagedFile"]>>) => {
      if (args[0].includes("metadata")) spills++;
      return fs.createStagedFile!(...args);
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await run(view, [`-${mode}f`, "/archive.tar", "--sort=name", "files"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(spills > 0, "metadata must use owned scratch storage");
  const list = await run(fs, ["-tf", "/archive.tar"]);
  assert.equal(list.stdout, "initial\nfiles/\n" + Array.from({ length: 130 }, (_, index) => `files/${String(index).padStart(3, "0")}\n`).join(""));
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["archive.tar", "files", "initial"]);
});


test("tar update consults backed archive times and leaves unchanged archives untouched", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/files");
  for (let index = 0; index < 130; index++) {
    const path = `/files/${String(index).padStart(3, "0")}`;
    await fs.writeFile(path, Uint8Array.of(index));
    await fs.utimes!(path, 1000, 1000);
  }
  assert.equal((await run(fs, ["-cf", "/archive.tar", "--sort=name", "files"])).exitCode, 0);
  const before = await fs.readFile("/archive.tar");
  assert.equal((await run(fs, ["-uf", "/archive.tar", "files"])).exitCode, 0);
  assert.deepEqual(await fs.readFile("/archive.tar"), before);
  await fs.writeFile("/files/129", Uint8Array.of(255));
  await fs.utimes!("/files/129", 2000, 2000);
  const update = await run(fs, ["-uf", "/archive.tar", "files"]);
  assert.equal(update.exitCode, 0, update.stderr);
  const list = await run(fs, ["-tf", "/archive.tar"]);
  assert.equal(list.stdout.split("\n").filter(name => name === "files/129").length, 2);
  assert.equal(list.stdout.split("\n").filter(name => name === "files/000").length, 1);
});

test("tar append excludes only its owned staging while traversing the archive parent", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/original", Uint8Array.of(1));
  await fs.mkdir("/.tar-mutation-user");
  await fs.writeFile("/.tar-mutation-user/keep", Uint8Array.of(2));
  await fs.mkdir("/.zip-metadata-user");
  await fs.writeFile("/.zip-metadata-user/keep", Uint8Array.of(3));
  assert.equal((await run(fs, ["-cf", "/archive.tar", "original"])).exitCode, 0);
  const appended = await run(fs, ["-rf", "/archive.tar", "."]);
  assert.equal(appended.exitCode, 0, appended.stderr);
  const list = await run(fs, ["-tf", "/archive.tar"]);
  assert.ok(list.stdout.includes("./.tar-mutation-user/keep\n"));
  assert.ok(list.stdout.includes("./.zip-metadata-user/keep\n"));
  assert.equal(list.stdout.split("\n").length, 8);
});

test("tar append preserves hardlinks and duplicate-path rebinding after metadata spills", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/initial", Uint8Array.of(1));
  assert.equal((await run(fs, ["-cf", "/archive.tar", "initial"])).exitCode, 0);
  await fs.mkdir("/files");
  for (let index = 0; index < 130; index++) await fs.writeFile(`/files/${String(index).padStart(3, "0")}`, Uint8Array.of(index));
  await fs.link!("/files/000", "/alias");
  const appended = await run(fs, ["-rf", "/archive.tar", "--sort=name", "--atime-preserve", "files", "files/000", "alias"]);
  assert.equal(appended.exitCode, 0, appended.stderr);
  await fs.mkdir("/out");
  const extracted = await run(fs, ["-xf", "/archive.tar", "-C", "/out"]);
  assert.equal(extracted.exitCode, 0, extracted.stderr);
  assert.equal((await fs.stat("/out/files/000")).ino, (await fs.stat("/out/alias")).ino);
  assert.deepEqual(await fs.readFile("/out/alias"), Uint8Array.of(0));
});
