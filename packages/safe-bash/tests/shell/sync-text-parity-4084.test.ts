import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";
import { basicCommands } from "../../src/commands/basic.js";

const cases = [
  [String.raw`sed -E 's/[a-z]+/[\2]/' <<< 'hello world'`, "", 2],
  [String.raw`sed 's/\(hello\)/[\3]/' <<< 'hello world'`, "", 2],
  [String.raw`sed 's/\(hello\)/[\9]/' <<< 'no match'`, "", 2],
  [String.raw`sed 's/a\|ab/X/' <<< 'ab'`, "X", 0],
  [String.raw`sed 's/\(a\)^b/\1/' <<< 'a^b'`, "a", 0],
  [String.raw`sed 's/a+^b/X/' <<< 'a+^b'`, "X", 0],
  [String.raw`sed 's/\(hello\)/[\1]/' <<< 'hello world'`, "[hello] world", 0],
  [String.raw`sed -E 's/(a)(b)/\2\1/' <<< 'ab'`, "ba", 0],
  [String.raw`sed 's/^a/X/' <<< 'ab'`, "Xb", 0],
  ...["(", ")", "+", "?", "|"].map(atom => [`sed 's/[\\${atom}]/X/g' <<< '\\${atom}'`, "XX", 0] as const),
  [`awk -v n=99 '{ n = split($1, a, ":"); print n + 1 }' <<< 'x:y'`, "3", 0],
  [`awk '{ n = split($1, a, ":"); print n, a[1], a[2] }' <<< 'x:y'`, "2 x y", 0],
  [`awk '{ OFS = split($1, a, ":"); print a[1], a[2] }' <<< 'x:y'`, "x2y", 0],
  [`awk '{ NR = split($1, a, ":"); print NR, a[1] }' <<< 'x:y'`, "2 x", 0],
  [`awk '{ NF = split($1, a, ":"); print NF, $2 }' <<< 'x:y z q'`, "2 z", 0],
  [`awk '{ NR = split($1, a, ":"); print NR }' <<< $'x:y\nz'`, "2\n1", 0],
] as const;

for (const [source, expected, status] of cases) {
  test(`issue 4084: ${source}`, async context => {
    const { shell, commands } = setup();
    context.after(() => shell.dispose());
    for (const command of [...basicCommands(), ...createTextProgramCommands()]) commands.register(command, { replace: true });
    const direct = await shell.exec(source);
    assert.equal(direct.stdout.trimEnd(), expected);
    assert.equal(direct.exitCode, status);
    for (const loop of [false, true]) {
      const result = await shell.exec(`${loop ? "for ((i=0;i<2;i++)); do " : ""}x=$(${source}); rc=$?; ${loop ? "done; " : ""}printf '%s\\n%s\\n' "$rc" "$x"`);
      assert.equal(result.stdout, `${status}\n${expected}\n`);
      assert.equal(result.stderr, direct.stderr.repeat(loop ? 2 : 1));
      assert.equal(result.exitCode, 0);
    }
  });
}
