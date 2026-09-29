import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell } from "../../src/shell/shell.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";

const cases = [
  ['long literal', 'x'.repeat(130), 'x'.repeat(130)],
  ['long variable', 'x'.repeat(130), '$p'],
  ['quoted variable', 'x'.repeat(130), '"$p"'],
  ['quoted parentheses', '(abc)', '"(a"*'],
  ['extglob', 'abc', '@(abc|xyz)'],
  ['POSIX class', 'abc', '[[:alpha:]]*'],
  ['escaped bracket', ']', '[\\]]'],
  ['caret', '^', '[a^b]'],
  ['unicode', 'é', '[é]'],
  ['unclosed bracket', '[abc', '[*'],
  ['multiple stars', 'abc', 'a*b*c'],
  ['long subject', 'x'.repeat(513), '*'],
] as const;

for (const [name, subject, pattern] of cases) {
  for (const operator of ['==', '!=', '=']) {
    for (const loop of ['for', 'while', 'until']) {
      test(`${loop} ${operator} ${name} matches Bash`, async () => {
        const setup = `p='${'x'.repeat(130)}'; s='${subject}'; i=0;`;
        const condition = `[[ "$s" ${operator} ${pattern} ]]`;
        const source = loop === 'for'
          ? `${setup} for i in 1 2; do if ${condition}; then echo yes:$i; else echo no:$i; fi; done`
          : `${setup} ${loop} ${condition} ${loop === 'until' ? '|| ((i>=2))' : '&& ((i<2))'}; do echo body:$i; ((i++)); done; echo end:$i`;
        await compare(source);
      });
    }
  }
}

for (const [name, subject, pattern] of cases) {
  for (const operator of ['==', '!=', '=']) {
    test(`arithmetic loop ${operator} ${name} preserves pattern status`, async () => {
      const source = `p='${'x'.repeat(130)}'; s='${subject}'; n=0; for ((i=0;i<2;i++)); do if [[ "$s" ${operator} ${pattern} ]]; then ((n++)); fi; done; echo $n`;
      await compare(source);
    });
  }
}

for (const source of [
  `p=x; n=0; for ((i=0;i<2;i++)); do if [[ x != $p ]]; then ((n++)); fi; p='${'z'.repeat(130)}'; done; echo $n`,
  's=abc; n=0; while [[ $s == [[:alpha:]]* ]]; do ((n++)); s=1; done; echo $n',
  's=abc; n=0; until [[ $s != [[:alpha:]]* ]]; do ((n++)); s=1; done; echo $n',
  's=abc; n=0; while [[ $s != [[:digit:]]* ]]; do ((n++)); s=1; done; echo $n',
  'f() { [[ $s == [[:alpha:]]* ]]; }; s=abc; n=0; for ((i=0;i<2;i++)); do if f; then ((n++)); fi; done; echo $n',
]) {
  test(`changing loop pattern matches Bash: ${source}`, async () => {
    await compare(source);
  });
}

async function compare(source: string): Promise<void> {
  const expected = spawnSync('/bin/bash', ['--noprofile', '--norc', '-O', 'extglob', '-c', source], { encoding: 'utf8' });
  assert.equal(expected.error, undefined);
  const shell = new Shell({ fs: new MemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  try {
    const actual = await shell.exec(source);
    assert.equal(actual.stdout, expected.stdout);
    assert.equal(actual.stderr, expected.stderr);
    assert.equal(actual.exitCode, expected.status);
  } finally { await shell.dispose(); }
}
