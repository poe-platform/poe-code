import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

import { basicCommands } from "../../src/commands/basic.js";

import { predicateCommands } from "../../src/commands/predicates.js";

const cases = [
  ['[ 10000000000000000 -eq 10000000000000000 ]', 'yes'],
  ['[ 9223372036854775807 -gt 9223372036854775806 ]', 'yes'],
  ['[ -9223372036854775808 -lt -9223372036854775807 ]', 'yes'],
  ['[[ 9223372036854775807 -gt 9223372036854775806 ]]', 'yes'],
  ['[ $((10**16)) -eq 10000000000000000 ]', 'yes'],
  ['[[ "]" == []a] ]]', 'yes'],
  ['[[ b == [!]a] ]]', 'yes'],
  ['[[ a == [[:alpha:]]* ]]', 'yes'],
  ['[[ "(a" == "(a"* ]]', 'yes'],
  ['[[ a == [ ]]', 'no'],
  [`[[ a == ${'a'.repeat(128)}* ]]`, 'no'],
  ['[[ ! a =~ b ]]', 'yes'],
  ['[[ a == a && a =~ a ]]', 'yes'],
  ['[[ a == b || a =~ a ]]', 'yes'],
  ['[[ ! "]" != []a] ]]', 'yes'],
  ['[[ a == a && a == [[:alpha:]]* ]]', 'yes'],
];
for (const [condition, expected] of cases) {
  for (const substitution of [false, true]) {
    test(`total conditional (${substitution ? 'substitution' : 'loop'}): ${condition}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem() });
      for (const command of [...basicCommands(), ...predicateCommands()]) shell.commands.register(command);
      const body = `if ${condition}; then echo yes; else echo no; fi`;
      try {
        const result = await shell.exec(`for i in 1 2; do ${substitution ? `echo "$(${body})"` : body}; done`);
        assert.equal(result.stdout, `${expected}\n${expected}\n`);
        assert.equal(result.stderr, '');
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}
