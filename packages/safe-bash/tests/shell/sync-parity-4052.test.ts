import assert from "node:assert/strict";
import test from "node:test";
import { createNumfmtCommands } from "../../src/commands/numfmt/index.js";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";
import { streamCommands } from "../../src/commands/streams.js";
import { textCommands } from "../../src/commands/text.js";
import { createStreamFormatCommands } from "../../src/commands/stream-format/index.js";
import { createTableTextCommands } from "../../src/commands/table-text/index.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";

for (const [name, source, expected] of [
  ["uniq ASCII folding", "printf 'é\\nÉ\\nA\\na\\n' | uniq -i", "é\nÉ\nA\n"],
  ["nl UTF-8 padding", "printf 'a\\n\\nb\\n' | nl -s '→'", "     1→a\n         \n     2→b\n"],
  ["paste code points", "printf 'a\\nb\\nc\\nd\\n' | paste -d '😀' - -", "a😀b\nc😀d\n"],
  ["tr translation bytes", "printf 'aéb\\n' | tr 'é' 'x'", "axxb\n"],
  ["tr complement bytes", "printf 'aéb\\n' | tr -c 'a\\n' 'x'", "axxx\n"],
  ["tr deletion bytes", "printf 'aéb\\n' | tr -d 'é'", "ab\n"],
  ["tr squeeze bytes", "printf 'éé\\n' | tr -s 'é'", "éé\n"],
  ["numfmt pipeline whitespace", "printf '   1000\\n' | numfmt --to=si", "   1.0k\n"],
  ["numfmt whitespace", "numfmt --to=si <<< '   1000'", "   1.0k\n"],
  ["sed number newline", "cat /no_nl.txt | sed -n '$=' | wc -c", "2\n"],
  ["sed substitution partial line", "cat /no_nl.txt | sed -n '1p; 2s/b/y/p' | wc -c", "3\n"],
] as const) {
  test(`issue 4052: ${name}`, async context => {
    const { shell, commands, fs } = setup();
    context.after(() => shell.dispose());
    for (const command of [...createNumfmtCommands(), ...basicCommands(), ...streamCommands(), ...textCommands(), ...createStreamFormatCommands(), ...createTableTextCommands(), ...createTextProgramCommands()]) commands.register(command, { replace: true });
    await fs.writeFile("/no_nl.txt", new TextEncoder().encode("a\nb"));
    const direct = await shell.exec(source);
    assert.equal(direct.stdout.trimEnd(), expected.trimEnd());
    for (const prefix of ["", "for ((i=0;i<2;i++)); do "]) {
      const result = await shell.exec(`${prefix}x=$(${source}); ${prefix ? "done; " : ""}printf '%s\\n' "$x"`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
    }
  });
}
