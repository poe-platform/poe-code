import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { cloudflareWorkerLimits } from "../../src/shell/worker-limits.js";

test("provided-device Worker shell bounds cyclic memory symlink expansion", async context => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, deviceView: "provided", limits: cloudflareWorkerLimits }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec('x=a/; for ((i=0; i<16; i++)); do x="$x$x"; done; x="$x${x:0:65536}"; ln -s "l/$x" /l; cat /l');
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /ENAMETOOLONG/);
  assert.equal((await fs.readlink("/l")).length, 196_610);
  assert.equal((await shell.exec("echo healthy")).stdout, "healthy\n");
});
