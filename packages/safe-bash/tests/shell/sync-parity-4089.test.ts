import assert from "node:assert/strict";
import test from "node:test";
import { createNumfmtCommands } from "../../src/commands/numfmt/index.js";
import { createNlCommands } from "../../src/commands/nl/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

const cases: ReadonlyArray<readonly [string, string, string]> = [
  ["IEC down", "numfmt --to=iec --round=down 1599", "1.5K\n"],
  ["SI nearest", "numfmt --to=si --round=nearest 10400", "10k\n"],
  ["IEC towards zero", "numfmt --to=iec --round=towards-zero -- -1599", "-1.5K\n"],
  ["IEC negative up", "numfmt --to=iec --round=up -- -1599", "-1.5K\n"],
  ["IEC-i down", "numfmt --to=iec-i --round=down 1599", "1.5Ki\n"],
  ["IEC default away from zero", "numfmt --to=iec 1599", "1.6K\n"],
  ["nl pipeline file", "printf 'stdin_line\\n' | nl /f", "     1\tfile_line\n"],
  ["nl here-string file", "nl /f <<< 'stdin_line'", "     1\tfile_line\n"],
  ["nl pipeline literal plus BRE", "printf 'a+b\\naab\\n' | nl -b 'pa+b'", "     1\ta+b\n       aab\n"],
  ["nl literal plus BRE", "nl -b 'pa+b' <<< $'a+b\\naab'", "     1\ta+b\n       aab\n"],
  ["nl escaped plus BRE", "nl -b 'pa\\+b' <<< $'a+b\\naab'", "       a+b\n     1\taab\n"],
  ["nl literal group BRE", "nl -b 'p(a|b)?' <<< $'(a|b)?\\na'", "     1\t(a|b)?\n       a\n"],
];

for (const [name, source, expected] of cases) {
  test(`issue 4089: ${name}`, async context => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs });
    for (const command of [...createNumfmtCommands(), ...createNlCommands(), ...basicCommands()]) shell.commands.register(command);
    context.after(() => shell.dispose());
    await fs.writeFile("/f", new TextEncoder().encode("file_line\n"));
    for (const script of [
      source,
      `x=$(${source}); printf '%s\\n' "$x"`,
      `for ((i=0;i<40;i++)); do x=$(${source}); printf '%s\\n' "$x"; done`,
    ]) {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0, `${script}: ${result.stderr}`);
      assert.equal(result.stderr, "", script);
      assert.equal(result.stdout, script.startsWith("for ") ? expected.repeat(40) : expected, script);
    }
  });
}
