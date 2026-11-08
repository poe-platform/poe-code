import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

async function execute(source: string) {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
  try { return await shell.exec(source); } finally { await shell.dispose(); }
}

for (const branch of ['echo -n hello', 'echo -E hello', 'echo "$opt"', 'echo a $opt', 'echo "prefix:$opt"', 'echo', 'printf "%s" "$opt"']) {
  for (const substitute of [`if ((1)); then ${branch}; fi`, `case x in x) ${branch} ;; esac`]) {
    test(`loop substitution preserves echo arguments: ${substitute}`, async () => {
      const body = `opt=$i; echo "$( ${substitute} )"`;
      const expected = await execute(`i=hello; ${body}; i=-a; ${body}`);
      const actual = await execute(`opt=hello; for i in hello -a; do ${body}; done`);
      assert.deepEqual(actual, expected);
      assert.equal(actual.stderr, "");
      assert.equal(actual.exitCode, 0);
    });
  }
}

for (const condition of ['[[ a == $pat ]]', '[[ a = $pat ]]', '[[ a != $pat ]]', '[[ -n a && a == $pat ]]', '[[ ! ( a != $pat ) ]]', '[[ a == "$pat" ]]', '[ a = "$pat" ]', 'test a != "$pat"']) {
  test(`loop substitution preserves changing condition: ${condition}`, async () => {
    const body = `pat=$i; echo "$(if ${condition}; then echo hi; else echo lo; fi)"`;
    assert.deepEqual(await execute(`pat=a; for i in a '[z-a]'; do ${body}; done`), await execute(`i=a; ${body}; i='[z-a]'; ${body}`));
  });
}

for (const condition of ['[[ a == $pat ]]', '[[ a = $pat ]]', '[[ a != $pat ]]', '[[ -n a && a == $pat ]]', '[[ ! ( a != $pat ) ]]']) {
  test(`literal assignment invalidates admitted pattern: ${condition}`, async () => {
    const body = `pat="[z-a]"; echo "$(if ${condition}; then echo hi; else echo lo; fi)"`;
    assert.deepEqual(await execute(`pat=a; for i in 1 2; do ${body}; done`), await execute(`pat=a; ${body}; ${body}`));
  });
}
