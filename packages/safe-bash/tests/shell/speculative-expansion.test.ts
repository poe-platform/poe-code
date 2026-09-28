import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { predicateCommands } from "../../src/commands/predicates.js";
import { streamCommands } from "../../src/commands/streams.js";

const cases = [
  ['[ $((x+=1)) -eq $(echo 1 | cat) ]; echo "x=$x status=$?"', "x=1 status=0\n"],
  ['test $((x+=1)) -eq $(echo 1 | cat); echo "x=$x status=$?"', "x=1 status=0\n"],
  ['echo $((x+=1)) $(echo hi | cat); echo "x=$x"', "1 hi\nx=1\n"],
  ['printf -v out "%b" $((x+=1)); echo "x=$x out=$out"', "x=1 out=1\n"],
  ['printf -v out "%s %s" $((x+=1)) $(echo hi | cat); echo "x=$x out=$out"', "x=1 out=1 hi\n"],
  ['f() { echo "$1 $2"; }; f $((x+=1)) $(echo hi | cat); echo "x=$x"', "1 hi\nx=1\n"],
  ['echo "${y:=$((x+=1))}" $(echo hi | cat); echo "x=$x y=$y"', "1 hi\nx=1 y=1\n"],
  ['echo "${y:-$((x+=1))}" $(echo hi | cat); echo "x=$x"', "1 hi\nx=1\n"],
  ['a="x+=1"; echo $((a)) $(echo hi | cat); echo "x=$x"', "1 hi\nx=1\n"],
  ['echo "${y:=default}" $(echo hi | cat); echo "y=$y"', "default hi\ny=default\n"],
  ['printf "%b" $((x+=1)); echo " x=$x"', "1 x=1\n"],
  ['a="b"; b="x++"; echo $((a)) $(echo hi | cat); echo "x=$x"', "0 hi\nx=1\n"],
  ['echo $((++x)) ""; echo "x=$x"', "1 \nx=1\n"],
  ['echo $((x-=1)) $(echo hi | cat); echo "x=$x"', "-1 hi\nx=-1\n"],
  ['a=abcdef; echo "${a:$((x+=1)):2}" $(echo hi | cat); echo "x=$x"', "bc hi\nx=1\n"],
] as const;

for (const [command, stdout] of cases) {
  test(`speculative expansion executes side effects once: ${command}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([
      ...basicCommands(), ...predicateCommands(), ...streamCommands(),
    ]) });
    try {
      const source = `x=0; ${command}`;
      const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", timeout: 2000 });
      assert.equal(native.error, undefined);
      assert.equal(native.status, 0);
      assert.equal(native.stdout, stdout);
      for (let run = 0; run < 2; run++) {
        const result = await shell.exec(source);
        assert.equal(result.stderr, native.stderr);
        assert.equal(result.exitCode, native.status);
        assert.equal(result.stdout, stdout);
      }
    } finally {
      await shell.dispose();
    }
  });
}
