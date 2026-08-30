import assert from "node:assert/strict";
import test from "node:test";
import * as host from "node:fs/promises";
import { join } from "node:path";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { namespace, oracle, run } from "./helpers.js";
import { qualifyModeFixtures } from "./permission-profile/fixtures.js";

test("GNU chmod directory setid controls compare actual host preservation", async context => {
  const root = await namespace(context);
  await host.mkdir(join(root, "directory"));
  const qualified = await qualifyModeFixtures(root, ["directory"]);
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work/directory", { recursive: true });
  for (const initial of [0o6755, 0o3755, 0o4755, 0o1777]) for (const mode of ["755", "0755", "00755", "=755", "u=rwx,go=rx", "a-s", "a=rwX", "u=rw", "g=rx", "o=rx", "+2000", "-6000"]) {
    const measured = await qualified.setMode("directory", initial);
    await fs.chmod("/work/directory", measured);
    const native = oracle("chmod", ["--", mode, "directory"], root);
    const actual = await run("chmod", ["--", mode, "directory"], fs);
    assert.equal(actual.exitCode, native.exitCode, `${initial.toString(8)} ${mode}: ${native.stderr}`);
    assert.equal((await fs.stat("/work/directory")).mode & 0o7777, (await host.stat(join(root, "directory"))).mode & 0o7777, `${initial.toString(8)} ${mode}`);
  }
});

test("GNU chmod verbose/changes/reference/error controls preserve bytes and aliases", async context => {
  const root = await namespace(context);
  await host.mkdir(join(root, "work"));
  const real = await createRealFileSystem({ root });
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work");
  for (const fs of [real, memory]) {
    await fs.writeFile("/work/file", Uint8Array.of(0, 255, 13), { mode: 0o640 });
    await fs.writeFile("/work/reference", Uint8Array.of(8), { mode: 0o751 });
    await fs.symlink("reference", "/work/ref-link");
    await fs.link("/work/file", "/work/alias");
  }
  for (const args of [["-v", "600", "file"], ["-c", "600", "file"], ["--verbose", "600", "file"], ["--changes", "--reference=ref-link", "file"], ["-f", "644", "missing", "file"]]) {
    const native = oracle("chmod", args, join(root, "work"));
    const actual = await run("chmod", args, memory);
    assert.equal(actual.exitCode, native.exitCode, native.stderr);
    assert.deepEqual(actual.stdout, native.stdout, args.join(" "));
    assert.equal(Boolean(actual.stderr), Boolean(native.stderr));
    assert.equal((await memory.stat("/work/file")).mode & 0o7777, (await real.stat("/work/file")).mode & 0o7777);
    assert.equal((await memory.stat("/work/alias")).mode, (await memory.stat("/work/file")).mode);
    assert.deepEqual(await memory.readFile("/work/alias"), await real.readFile("/work/alias"));
    assert.equal(await memory.readlink("/work/ref-link"), "reference");
    assert.deepEqual((await memory.readdir("/work")).map(entry => entry.name).sort(), ["alias", "file", "ref-link", "reference"]);
  }
});

test("chmod root and unsupported traversal controls fail without namespace effects", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/file", Uint8Array.of(3), { mode: 0o640 });
  for (const args of [["-R", "777", "/"], ["-RL", "777", "/work"], ["-RH", "777", "/work"], ["-RP", "777", "/work"], ["--no-preserve-root", "-R", "777", "/"]]) {
    const result = await run("chmod", args, fs);
    assert.equal(result.exitCode, 1);
    assert.equal((await fs.stat("/work/file")).mode & 0o777, 0o640);
    assert.deepEqual(await fs.readFile("/work/file"), Uint8Array.of(3));
  }
});
