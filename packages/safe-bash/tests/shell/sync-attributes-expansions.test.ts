import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases: readonly [string, string, string][] = [
  ["loop attribute added between iterations", 'for word in hello world; do echo "$word"; declare -u word; done', "hello\nWORLD\n"],
  ["printf attribute declared in loop", 'for i in 1 2; do echo "iter=$i"; declare -u out; printf -v out hi; echo "$out"; done', "iter=1\nHI\niter=2\nHI\n"],
  ["uppercase loop", 'declare -u word; for word in hello world; do echo "$word"; done', "HELLO\nWORLD\n"],
  ["lowercase loop", 'declare -l word; for word in HELLO WORLD; do echo "$word"; done', "hello\nworld\n"],
  ["integer loop", 'declare -i num; for num in "1+2" "3+4"; do echo "$num"; done', "3\n7\n"],
  ["nameref loop", 'target=init; declare -n ref=target; for ref in first second; do echo "$target:$ref"; done', "init:\ninit:\n"],
  ["nameref loop retargets each word", 'target=init; first=one; second=two; declare -n ref=target; for ref in first second; do echo "$target:$ref"; ref=changed; done; echo "$first:$second:$target"', "init:one\ninit:two\nchanged:changed:init\n"],
  ["printf attributes", 'declare -u upper; declare -l lower; declare -i num; for i in 1 2; do echo "iter=$i"; printf -v upper hi; printf -v lower HI; printf -v num "3+4"; echo "$upper:$lower:$num"; done', "iter=1\nHI:hi:7\niter=2\nHI:hi:7\n"],
  ["standalone printf attributes", 'declare -u upper; declare -l lower; declare -i num; printf -v upper hi; printf -v lower HI; printf -v num "3+4"; echo "$upper:$lower:$num"', "HI:hi:7\n"],
  ["printf through attributed nameref", 'declare -u upper; declare -n ref=upper; for i in 1 2; do echo "iter=$i"; printf -v ref hi; echo "$upper:$ref"; done', "iter=1\nHI:HI\niter=2\nHI:HI\n"],
  ["quoted prefix arguments", 'pre_1=a; pre_2=b; for i in 1 2; do echo "iter=$i"; printf "<%s>" "${!pre@}"; echo; done', "iter=1\n<pre_1><pre_2>\niter=2\n<pre_1><pre_2>\n"],
  ["nameref prefix", 'other_1=wrong; pre_1=a; pre_2=b; declare -n pre=other_1; for i in 1 2; do x="${!pre*}"; echo "$x"; done', "pre pre_1 pre_2\npre pre_1 pre_2\n"],
  ["unquoted star prefix", 'pre_1=a; pre_2=b; for i in 1 2; do echo "iter=$i"; echo ${!pre*}; done', "iter=1\npre_1 pre_2\niter=2\npre_1 pre_2\n"],
  ["unquoted at prefix", 'pre_1=a; pre_2=b; for i in 1 2; do echo "iter=$i"; echo ${!pre@}; done', "iter=1\npre_1 pre_2\niter=2\npre_1 pre_2\n"],
];
for (const op of ["Q", "U", "L", "u"]) {
  for (const value of ["hello\tworld", "hello\nworld", "hello\u0001world", "héllo", "hello world", ""]) {
    for (const quoted of [true, false]) {
      const expansion = "${var@" + op + "}";
      test(`transform ${op} ${JSON.stringify(value)} quoted=${quoted} executes once`, async () => {
        const { shell } = setup({ env: { var: value }, commands: new CommandRegistry(basicCommands()) });
        try {
          const result = await shell.exec('for i in 1 2; do echo "iter=$i"; x=' + (quoted ? '"' + expansion + '"' : expansion) + '; done');
          assert.equal(result.exitCode, 0);
          assert.equal(result.stderr, "");
          assert.equal(result.stdout, "iter=1\niter=2\n");
          const commandResult = await shell.exec('for i in 1 2; do echo "iter=$i"; printf "<%s>" ' + (quoted ? '"' + expansion + '"' : expansion) + '; echo; done');
          assert.equal(commandResult.exitCode, 0);
          assert.equal(commandResult.stderr, "");
          assert.equal(commandResult.stdout.split("iter=1\n").length, 2);
          assert.equal(commandResult.stdout.split("iter=2\n").length, 2);
        } finally { await shell.dispose(); }
      });
    }
  }
}
for (const [name, source, expected] of cases) test(name, async () => {
  const { shell } = setup({ commands: new CommandRegistry(basicCommands()) });
  try {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  } finally { await shell.dispose(); }
});
