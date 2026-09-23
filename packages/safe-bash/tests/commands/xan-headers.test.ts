import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { xanCommands } from "../../src/commands/xan/index.js";
import { fixture } from "./helpers.js";

for (const [script, stdout] of [
  ["xan headers data", "0 name\n1 n\n"],
  ["xan headers --start=7 --color=never data", "7 name\n8 n\n"],
  ["xan headers --just-names data", "name\nn\n"],
] as const) test(`${script} matches XAN 0.61.0 header spacing`, async () => {
  const shell = new Shell({ fs: await fixture({ data: "name,n\nAda,1\nGrace,2\n" }), cwd: "/work" }).use(xanCommands());
  try {
    const result = await shell.exec(script);
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, stdout, ""]);
  } finally { await shell.dispose(); }
});
