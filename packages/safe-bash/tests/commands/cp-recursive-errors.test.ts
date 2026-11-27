import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

test("recursive cp reports failure but copies later entries with redirected diagnostics", async context => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("mkdir s; echo 1 > s/b; echo 2 > s/c; mkdir -p t/s/b; cp -r s t 2>/dev/null; echo $?; ls t/s");
  assert.equal(result.stdout, "1\nb\nc\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/t/s/c")), "2\n");
  assert.equal((await fs.stat("/work/t/s/b")).type, "directory");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/s/b")), "1\n");
});
