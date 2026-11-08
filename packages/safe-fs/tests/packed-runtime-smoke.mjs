import assert from "node:assert/strict";
import { FsError, createMemoryFileSystem } from "poe-code/safe-fs";
import { Shell, standardCommands, FsError as ShellFsError } from "poe-code/safe-bash";

assert.equal(ShellFsError, FsError);
const fs = createMemoryFileSystem();
await fs.writeFile("/input", new TextEncoder().encode("hello"));
const shell = new Shell({ fs }).use(standardCommands());
try {
  const result = await shell.exec("cat /input > /copy; cat /copy");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello");
  assert.equal(new TextDecoder().decode(await fs.readFile("/copy")), "hello");
  await assert.rejects(fs.readFile("/missing"), error => error instanceof FsError && error.code === "ENOENT" && error.errno < 0);
} finally {
  await shell.dispose();
}
console.log("Direct packed filesystem and shell smoke passed");
