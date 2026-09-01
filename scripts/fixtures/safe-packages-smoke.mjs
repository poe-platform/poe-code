import assert from "node:assert/strict";
import { Budget, run } from "@poe-platform/safe-js";
import { FsError, createMemoryFileSystem } from "@poe-platform/safe-fs";
import { FsError as CompatibilityFsError } from "@poe-platform/safe-js/fs";
import { FsError as CoreFsError } from "@poe-platform/safe-js/fs/core";
import { FsError as NodeFsError } from "@poe-platform/safe-js/fs/node";
import { Shell, standardCommands, FsError as ShellFsError, createMountFileSystem } from "@poe-platform/safe-bash";

assert.equal(FsError, ShellFsError);
assert.equal(FsError, CompatibilityFsError);
assert.equal(FsError, CoreFsError);
assert.equal(FsError, NodeFsError);
const result = await run("return values.map(value => value * 2);", {
  bindings: { values: [2, 3] }, budget: new Budget({ maxSteps: 1000 }),
});
assert.equal(result.ok, true);
assert.deepEqual(result.returnValue, [4, 6]);
for (const streaming of [true, false]) {
  const fs = createMemoryFileSystem();
  if (!streaming) Object.defineProperty(fs, "readStream", { value: undefined });
  await fs.writeFile("/large", new Uint8Array(65_537));
  const shell = new Shell({ fs, limits: { maxInputBytes: 65_537, maxOutputBytes: 65_536 } }).use(standardCommands());
  try {
    const output = await shell.exec("wc -c < /large");
    assert.equal(output.exitCode, 0, output.stderr);
    assert.equal(output.stdout.trim(), "65537");
  } finally { await shell.dispose(); }
}
const source = createMemoryFileSystem();
const target = createMemoryFileSystem();
await source.writeFile("/input", new Uint8Array([42]));
const write = target.writeStream.bind(target);
target.writeStream = async (path, bytes, options) => {
  assert.ok(!Object.hasOwn(options, "exclusive"));
  await write(path, bytes, options);
};
const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/source": source, "/target": target } });
await mounted.copyFile("/source/input", "/target/copy", { exclusive: true });
assert.deepEqual(await target.readFile("/copy"), new Uint8Array([42]));
console.log("Scoped SafeJS, shell, canonical filesystem, copy options and input limits passed");
