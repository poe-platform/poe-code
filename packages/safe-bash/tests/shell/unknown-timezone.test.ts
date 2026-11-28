import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { agentCommands } from "../../src/plugins/index.js";

for (const script of [
  `TZ=Nope/Zone date -d @0 '+%z %T'; echo "rc=$?"`,
  `value=$(TZ=Nope/Zone date -d @0 '+%z %T'); rc=$?; echo "$value"; echo "rc=$rc"`,
]) {
  test(`unknown TZ falls back to UTC through the shell: ${script}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/work" }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(script);
    assert.equal(result.stdout, "+0000 00:00:00\nrc=0\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}
