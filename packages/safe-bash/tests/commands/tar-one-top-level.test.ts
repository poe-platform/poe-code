import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { agentCommands } from "../../src/plugins/index.js";
import { Shell } from "../../src/shell/index.js";

test("tar --one-top-level supports inferred and explicit extraction directories", async t => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec('echo hi > a; tar cf pkg.tar a; rm a; tar xf pkg.tar --one-top-level; echo "st=$?"; find . | sort; tar xf pkg.tar --one-top-level=top; find top');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "st=0\n.\n./pkg\n./pkg.tar\n./pkg/a\ntop\ntop/a\n");
});
