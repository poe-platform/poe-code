import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../src/shell/shell.js";
import { standardCommands } from "../../src/commands/index.js";

const cases = [
  ['unicode offset mutation', 's="café"; x=0; echo "${s:$((x+=1)):1}" "x=$x"', 'a x=1\n'],
  ['split offset mutation', 's="hello world"; x=0; echo ${s:$((x+=1)):8} "x=$x"', 'ello wor x=1\n'],
  ['length mutation', 's="café"; x=0; echo "${s:0:$((x+=1))}" "x=$x"', 'c x=1\n'],
  ['unset offset', 'unset s; x=0; echo "${s:$((x=1)):1}" "x=$x"', ' x=0\n'],
  ['unset length', 'unset s; x=0; echo "${s:0:$((x=1))}" "x=$x"', ' x=0\n'],
  ['later word bailout', 's=abcd; x=0; echo "${s:$((x+=1)):1}$(echo z)" "x=$x"', 'bz x=1\n'],
  ['line offset', 's=abcdefghij; echo "${s:LINENO:2}"', 'bc\n'],
  ['line length', 's=abcdefghij; echo "${s:0:LINENO}"', 'a\n'],
  ['bare offset mutation', 's=abcd; x=0; echo "${s:x+=1:1}" "x=$x"', 'b x=1\n'],
  ['unset bare offset', 'unset s; x=0; echo "${s:x=1:1}" "x=$x"', ' x=0\n'],
  ['unset failing operand', 'unset s; echo "${s:$((1/0)):1}"', '\n'],
  ['literal octal', 's=abcdefghijk; echo "${s:010:1}"', 'i\n'],
] as const;
for (const [name, source, stdout] of cases) {
  for (const loop of [false, true]) test(`substring evaluation: ${name}, loop=${loop}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxExpansionBytes: Infinity } }).use(standardCommands());
    context.after(() => shell.dispose());
    const script = loop ? `for i in 1 2; do ${source}; done` : source;
    const result = await shell.exec(script);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, stdout.repeat(loop ? 2 : 1));
  });
}
test('substring nounset diagnoses the parameter before its operands', async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxExpansionBytes: Infinity } }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec('set -u; echo "${unset_first:$unset_second}"');
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes('unset_first: unbound variable'), result.stderr);
});
