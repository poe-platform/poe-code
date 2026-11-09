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
import { pasteCommands } from "../../src/commands/paste/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Runtime } from "../../src/shell/runtime.js";

test("captured paste stops parsing at the first operand in POSIX mode", () => {
  const runtime = { readSyncMemoryLines: (path: string) => path === "/rows" ? ["A", "B"] : path === "/-s" ? ["x", "y"] : undefined };
  for (const posix of [false, true]) {
    for (const args of [["rows", "-s"], ["--", "rows", "-s"], ["-d", ":", "rows", "-s"]]) {
      const delimiter = args[0] === "-d" ? ":" : "\t";
      const expected = posix || args[0] === "--" ? [`A${delimiter}x`, `B${delimiter}y`] : [`A${delimiter}B`];
      assert.deepEqual(Runtime.prototype.evalSyncPaste.call(runtime, undefined, args, "/", false, posix), expected);
    }
    assert.deepEqual(Runtime.prototype.evalSyncPaste.call(runtime, ["A", "B"], ["-", "-s"], "/", false, posix), posix ? ["A\tx", "B\ty"] : ["A\tB"]);
  }
});

for (const [environment, posix] of [
  ["unset POSIXLY_CORRECT", false],
  ["export POSIXLY_CORRECT=1", true],
  ["export POSIXLY_CORRECT=", true],
  ["unset POSIXLY_CORRECT; POSIXLY_CORRECT=1", false],
] as const) {
  for (const [source, literal, delimiter] of [
    ["paste rows -s", false, "\t"],
    ["paste -- rows -s", true, "\t"],
    ["paste -d : rows -s", false, ":"],
    ["paste rows -s | cat", false, "\t"],
    ["printf 'A\\nB\\n' | paste - -s", false, "\t"],
    ["paste - -s <<< $'A\\nB'", false, "\t"],
  ] as const) {
    test(`paste operand ordering in captures: ${environment}; ${source}`, async context => {
      const fs = new MemoryFileSystem();
      const shell = new Shell({ fs }).use(standardCommands()).use(pasteCommands());
      context.after(() => shell.dispose());
      await fs.writeFile("/rows", new TextEncoder().encode("A\nB\n"));
      await fs.writeFile("/-s", new TextEncoder().encode("x\ny\n"));
      const expected = posix || literal ? `A${delimiter}x\nB${delimiter}y\n` : `A${delimiter}B\n`;
      for (const body of [source, `x=$(${source}); printf '%s\\n' "$x"`, `for ((i=0;i<2;i++)); do x=$(${source}); done; printf '%s\\n' "$x"`]) {
        const result = await shell.exec(`${environment}; ${body}`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, expected, body);
      }
    });
  }
}

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
