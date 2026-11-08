import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases: readonly (readonly [string, string, string])[] = [
  ["arithmetic index", "arr=(a b c); for i in 0 1; do unset 'arr[i+1]'; done; echo ${arr[@]}", "a\n"],
  ["expanded arithmetic index", 'arr=(a b c); for i in 0 1; do unset "arr[$i+1]"; done; echo ${arr[@]}', "a\n"],
  ["negative index", "arr=(a b c); for i in 1 2; do unset 'arr[-1]'; done; echo ${arr[@]}", "a\n"],
  ...["@", "*"].flatMap(subscript => [
    [`indexed ${subscript}`, `arr=(a b c); for i in 1 2; do unset 'arr[${subscript}]'; done; echo count=\${#arr[@]}`, "count=0\n"],
    [`associative ${subscript}`, `declare -A arr=([a]=1 [b]=2); for i in 1 2; do unset 'arr[${subscript}]'; done; echo count=\${#arr[@]}`, "count=2\n"],
    [`associative literal ${subscript}`, `declare -A arr=([a]=1 [${subscript}]=special); for i in 1 2; do unset 'arr[${subscript}]'; done; echo count=\${#arr[@]} value=\${arr[a]}`, "count=1 value=1\n"],
  ] as const),
  ["unset then export", "x=old; for i in 1 2; do unset x; export x; done; x=hello; env | grep '^x='", "x=hello\n"],
  ["local then export", "f() { for i in 1 2; do local x; export x; done; x=hello; env | grep '^x='; }; f", "x=hello\n"],
  ["inherited local export", "export x=outer; f() { for i in 1 2; do local x; done; x=inner; env | grep '^x='; }; f; echo $x", "x=inner\nouter\n"],
  ["unset clears export", "export x=old; for i in 1 2; do unset x; done; x=hello; env | grep '^x='; echo status=$?", "status=1\n"],
] as const;

for (const [name, source, stdout] of cases) {
  test(name, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.stdout, stdout);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}
