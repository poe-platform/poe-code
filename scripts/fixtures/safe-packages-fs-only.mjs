import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { FsError, createMemoryFileSystem } from "@poe-platform/safe-fs/core";
import { createMemoryFileSystem as directMemory } from "@poe-platform/safe-fs/fs/memory";
import { createRealFileSystem, FsError as NodeFsError } from "@poe-platform/safe-fs/node";

const require = createRequire(import.meta.url);
for (const dependency of ["poe-code", "@poe-platform/safe-js", "@poe-platform/safe-bash", "yaml", "jose"]) {
  assert.throws(() => require.resolve(dependency), { code: "MODULE_NOT_FOUND" });
}
assert.equal(FsError, NodeFsError);
assert.equal(createMemoryFileSystem, directMemory);
const memory = createMemoryFileSystem();
await memory.writeFile("/note", new TextEncoder().encode("standalone"));
assert.equal(new TextDecoder().decode(await memory.readFile("/note")), "standalone");
await assert.rejects(memory.readFile("/missing"), error => error instanceof FsError && error.code === "ENOENT");
const real = await createRealFileSystem({ root: process.cwd() });
assert.ok((await real.readFile("/package.json")).length > 0);
console.log("Standalone SafeFS: memory, Node adapter, error identity and no CLI/interpreter dependency passed");
