import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { structuredCommands } from "../../src/commands/structured/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

async function execute(source: string) {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) }).use(structuredCommands()).use(textProgramCommands());
  try { return await shell.exec(source); } finally { await shell.dispose(); }
}
const loops = [
  (body: string) => `for i in 1 2; do ${body}; done`,
  (body: string) => `i=0; while [ $i -lt 2 ]; do ${body}; i=$((i+1)); done`,
  (body: string) => `i=0; until [ $i -ge 2 ]; do ${body}; i=$((i+1)); done`,
  (body: string) => `for ((i=0; i<2; i++)); do ${body}; done`,
];
for (const [initial, invalid, command] of [
  ['{"a":1}', "bad", "jq -r .a"],
  ["1024", "bad", "numfmt --to=iec"],
  ["42", "1e400", "awk '{print int($1)}'"],
]) {
  for (const piped of [false, true]) {
    const sub = piped ? `cat <<< $j | ${command}` : `${command} <<< $j`;
    for (const output of [`echo "$( ${sub} )"`, `printf '%s\\n' "$( ${sub} )"`, `x="$( ${sub} )"; echo "$?:$x"`]) {
      for (const [index, loop] of loops.entries()) {
        test(`function mutation: ${command}, piped=${piped}, loop=${index}, ${output}`, async () => {
          const setup = `mut() { j=${invalid}; }; j='${initial}'; `;
          const body = `mut; ${output}`;
          const expected = await execute(`${setup}${body}; ${body}`);
          assert.notEqual(expected.stderr, "");
          assert.deepEqual(await execute(setup + loop(body)), expected);
        });
      }
    }
  }
}
for (const mutation of [
  'read j <<< bad', 'unset j', 'declare j=bad', 'typeset j=bad', 'local j=bad', 'export j=bad',
  'mapfile j <<< bad', 'readarray j <<< bad', "printf -v j '%s' bad",
  'read "j" <<< bad', 'unset "j"', 'declare "j=bad"', 'typeset "j=bad"', 'local "j=bad"', 'export "j=bad"',
  'mapfile "j" <<< bad', 'readarray "j" <<< bad', "printf -v 'j' '%s' bad",
]) {
  test(`builtin mutation: ${mutation}`, async () => {
    const body = `${mutation}; x="$(jq -r .a <<< $j)"; echo "$?:$x"`;
    const wrap = (source: string) => `run() { j='{"a":1}'; ${source}; }; run`;
    assert.deepEqual(await execute(wrap(loops[0]!(body))), await execute(wrap(`${body}; ${body}`)));
  });
}

for (const call of ['mut', '"mut"', 'outer']) {
  test(`successful function mutations are observed: ${call}`, async () => {
    const setup = `mut() { j='{"a":2}'; }; outer() { mut; }; j='{"a":1}'; `;
    const body = `${call}; echo "$(jq -r .a <<< $j)"`;
    const result = await execute(setup + loops[0]!(body));
    assert.equal(result.stdout, "2\n2\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}
