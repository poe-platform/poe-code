import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFileSystem, createMemoryFileSystem, createNodeFileSystemAdapterRegistry,
  FsError, MemoryFileSystem,
} from "poe-code/safe-fs";
import { CommandRegistry } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";

const storageFull = (error: unknown): boolean => error instanceof FsError && error.code === "ENOSPC";

for (const [name, create] of [
  ["constructor", () => new MemoryFileSystem()],
  ["factory", () => createMemoryFileSystem()],
  ["configuration", () => createFileSystem({ type: "memory" }, { registry: createNodeFileSystemAdapterRegistry() })],
] as const) {
  test(`default ${name} stops metadata growth without an opt-in wrapper`, async () => {
    const filesystem = await create();
    for (let index = 0; index < 4_999; index++) await filesystem.mkdir(`/d${index}`);
    await assert.rejects(filesystem.mkdir("/overflow"), storageFull);
    assert.equal((await filesystem.readdir("/")).length, 4_999);
    await filesystem.rmdir!("/d0");
    await filesystem.mkdir("/replacement");
  });
}

test("new Shell executions and borrowed replacements reset work, not Memory storage", async context => {
  const filesystem = await createFileSystem({
    type: "memory", options: { maxFileBytes: 0, maxRetainedBytes: 32, maxMetadataUnits: 3 },
  }, { registry: createNodeFileSystemAdapterRegistry() });
  const commands = new CommandRegistry([{ name: "seed", async execute({ fs, args, signal }) {
    await fs.mkdir(args[0]!, { signal });
    return { exitCode: 0 };
  } }]);
  const shell = new Shell({ fs: filesystem, commands, limits: { maxFileSystemOperations: 1 } });
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("seed /first")).exitCode, 0);
  const full = await shell.exec("seed /second");
  assert.equal(full.exitCode, 1);
  assert.ok(full.stderr.includes("ENOSPC"));
  const replacement = createMemoryFileSystem({ maxMetadataUnits: 3 });
  assert.equal((await shell.exec("seed /other", { fs: replacement })).exitCode, 0);
  const replacementFull = await shell.exec("seed /extra", { fs: replacement });
  assert.equal(replacementFull.exitCode, 1);
  assert.ok(replacementFull.stderr.includes("ENOSPC"));
  assert.deepEqual((await filesystem.readdir("/")).map(entry => entry.name), ["first"]);
  assert.deepEqual((await replacement.readdir("/")).map(entry => entry.name), ["other"]);
  await shell.dispose();
  await assert.rejects(filesystem.mkdir("/after-dispose"), storageFull);
  await filesystem.rmdir!("/first");
  await filesystem.mkdir("/reclaimed");
});
