import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { streamCommands } from "../../src/commands/streams.js";
import { createEncodingCommands } from "../../src/commands/bytes/encoding/index.js";

async function execute(source: string) {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...basicCommands(), ...streamCommands(), ...createEncodingCommands()]) });
  try { return await shell.exec(source); } finally { await shell.dispose(); }
}

for (const input of ["not-valid-base64!", "YWJ", "====", "Y===", "YWJj=", "YWJj", "YWI=", ""]) {
  test(`here-string base64 decode preserves command behavior: ${input}`, async () => {
    const reference = await execute(`base64 -d <<< "${input}"`);
    const result = await execute(`x=$(base64 -d <<< "${input}"); rc=$?; printf '%s' "$x"; exit "$rc"`);
    assert.deepEqual(result, { ...reference, stdout: reference.stdout.replace(/\n+$/, "") });
  });
}

for (const locale of ["", "export LC_ALL=C;"]) {
  // GNU/Linux coreutils 9.4 wc.c counts only printable non-space bytes in C.
  for (const [input, utf8Count, cCount] of [
    ["a\\xc2\\xa0b", 2, 1], ["\\xc2\\xa0", 0, 0], [" a b ", 2, 2],
    ["\\x01 \\x02", 0, 0], ["a\\x01b", 1, 1], ["\\x7f", 0, 0],
  ] as const) {
    test(`pipeline wc words matches direct command: ${locale} ${input}`, async () => {
      const prefix = `${locale} s=$'${input}';`;
      const reference = await execute(`${prefix} x=$(wc -w <<< "$s"); printf '%s\\n' "$x"`);
      const result = await execute(`${prefix} x=$(printf '%s\\n' "$s" | wc -w); printf '%s\\n' "$x"`);
      assert.deepEqual(result, reference);
      assert.equal(result.stdout, `${locale ? cCount : utf8Count}\n`);
    });
  }
}

for (const header of ["for i in 1 2", "for ((i=0;i<2;i++))"]) {
  for (const command of ["wc -w <<< \"$s\"", "wc -w <<< $'a\\xc2\\xa0b'", "sort <<< b", "wc -c <<< \"$s\""]) {
    for (const body of [`echo "$(${command})"`, `out+=$(${command})`, `out=$(${command})`, `printf '%s\\n' "$(${command})"`, `f() { local x=$(${command}); echo "$x"; }; f`]) {
      test(`loop declining substitution preserves state: ${header} ${body}`, async () => {
        const prefix = command.startsWith("sort") ? "LC_ALL=C;" : "";
        const initialization = `${prefix} out=init; s=$'a\\xc2\\xa0b';`;
        const tail = '; declare -p out';
        assert.deepEqual(await execute(`${initialization} ${header}; do ${body}; s=$(printf '%17000s' ''); done${tail}`),
          await execute(`${initialization} ${body}; s=$(printf '%17000s' ''); ${body}; s=$(printf '%17000s' '')${tail}`));
      });
    }
  }
}
