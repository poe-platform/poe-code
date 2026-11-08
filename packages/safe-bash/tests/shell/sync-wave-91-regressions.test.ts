import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { basicCommands } from "../../src/commands/basic.js";

const cases: ReadonlyArray<readonly [string, string, string, string?]> = [
  ["multiply and add subscript", 'for i in 0 1 2; do arr[i*2+1]="v$i"; done; echo "${!arr[@]} : ${arr[@]}"', "1 3 5 : v0 v1 v2\n"],
  ["chained addition subscript", 'for i in 0 1 2; do arr[i+1+1]="v$i"; done; echo "${!arr[@]} : ${arr[@]}"', "2 3 4 : v0 v1 v2\n"],
  ["negative subscript", 'arr=(a b c); for ((i=0;i<2;i++)); do arr[-1]="z"; done; echo "${arr[@]}"', "a b z\n"],
  ["alternation captures", 's=ab; while [[ "$s" =~ ^(a|ab)(b?)$ ]]; do echo "m1=${BASH_REMATCH[1]} m2=${BASH_REMATCH[2]}"; s=""; done', "m1=ab m2=\n"],
  ["adjacent quantifiers", 's=a:b:c; while [[ "$s" =~ ^([a-z]*?):([a-z:]+)$ ]]; do echo matched; s=""; done', "", "shell: line 1: [[ unsupported ERE profile at 8: stacked repetition\n"],
  ["alternation in loop body", 'for i in 1 2; do [[ ab =~ ^(a|ab)(b?)$ ]]; echo "${BASH_REMATCH[1]}:${BASH_REMATCH[2]}"; done', "ab:\nab:\n"],
  ["negative subscript append", 'arr=(a b c); for i in 1 2; do arr[-1]+=z; done; echo "${arr[@]}"', "a b czz\n"],
  ["nested element assignment", 'for i in 0 1; do for j in 0 1; do arr[i*2+j]="$i$j"; done; done; echo "${arr[@]}"', "00 01 10 11\n"],
  ["zero iteration while assignment", 'while false; do arr[0]=x; done; declare -p arr 2>/dev/null || echo unset', "unset\n"],
  ["zero iteration element assignment", 'for ((i=0;i<0;i++)); do arr[0]=x; done; declare -p arr 2>/dev/null || echo unset', "unset\n"],
  ["zero iteration compound assignment", 'for ((i=0;i<0;i++)); do arr=(x); done; declare -p arr 2>/dev/null || echo unset', "unset\n"],
] as const;

for (const [name, source, expected, diagnostic] of cases) {
  test(name, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, diagnostic ?? "");
      assert.equal(result.exitCode, 0);
    } finally {
      await shell.dispose();
    }
  });
}
