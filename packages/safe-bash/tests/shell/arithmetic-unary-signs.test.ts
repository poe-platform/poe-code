import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

for (const [source, stdout, exitCode = 0] of [
  ['x=2; echo "$((++(x))):$x"', "2:2\n"],
  ['echo "$((--3))"', "3\n"],
  ['x=2; echo "$((++(x++))):$x"', "2:3\n"],
  ['x=2; echo "$((++x)):$x"', "3:3\n"],
  ['x=2; echo "$((-(-x))):$x"', "2:2\n"],
  ['x=2; echo "$((--(x--))):$x"', "2:1\n"],
  ['x=2; echo "$((--x)):$x"', "1:1\n"],
  ['x=2; echo "$((++ (x))):$x"', "2:2\n"],
  ['x=2; echo "$((++ x)):$x"', "3:3\n"],
  ['echo "$((++3)):$((---3))"', "3:-3\n"],
  ['x=2; echo "$((+++x)):$x"', "3:3\n"],
  ['x=2; echo "$((++++x)):$x"', "3:3\n"],
  ['x=2; echo "$((++--x)):$x"', "1:1\n"],
  ['x=2; echo "$((--!x)):$x"', "0:2\n"],
  ['a=(2); echo "$((++a[0])):${a[0]}"', "3:3\n"],
  ['a=(2); echo "$((++(a[0]++))):${a[0]}"', "2:3\n"],
  ['x=0; ((++(x))); echo "$?:$x"', "1:0\n"],
  ['x=0; ((++(x++))); echo "$?:$x"', "1:1\n"],
  ['x=0; ((++(x)))', "", 1],
  ['x=2; let "++(x++)"; echo "$?:$x"', "0:3\n"],
  ['x=2; value="++(x++)"; echo "$((value)):$x"', "2:3\n"],
  ['x=2; for ((i=0;i<2;i++)); do echo "$((++(x++))):$x"; done', "2:3\n3:4\n"],
] as const) test(`arithmetic unary signs match Bash: ${source}`, async context => {
  const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], {
    encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 10000,
  });
  assert.ifError(native.error);
  assert.equal(native.stdout, stdout);
  assert.equal(native.stderr, "");
  assert.equal(native.status, exitCode);

  const { shell } = setup();
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.commands.register(command);
  const result = await shell.exec(source);
  assert.equal(result.stdout, native.stdout);
  assert.equal(result.stderr, native.stderr);
  assert.equal(result.exitCode, native.status);
});
