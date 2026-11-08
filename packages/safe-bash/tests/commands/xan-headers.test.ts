import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { xanCommands } from "../../src/commands/xan/index.js";
import { fixture } from "./helpers.js";

for (const [other, conclusion] of [
  ["", "All files don't have the same headers!\nDiverging headers: a\n"],
  ["b\n3\n", "All files don't have the same headers!\nDiverging headers: a, b\n"],
  ["a\n3\n", "All files have the same headers!\n"],
  ["a,a\n3,4\n", "All files have the same headers!\n"],
] as const) test(`xan headers counts duplicate names once per file: ${JSON.stringify(other)}`, async () => {
  const shell = new Shell({ fs: await fixture({ data: "a,a\n1,2\n", other }), cwd: "/work" }).use(xanCommands());
  try {
    const result = await shell.exec("xan headers data other");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.ok(result.stdout.endsWith(`\n${conclusion}`), result.stdout);
  } finally { await shell.dispose(); }
});

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
