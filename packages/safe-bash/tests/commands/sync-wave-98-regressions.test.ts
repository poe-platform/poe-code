import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

for (const separator of ["\r", "\v", "\f", "\u00a0", "\u2028"]) {
  for (const flag of ["", "-F ' '"]) for (const loop of [false, true]) {
    test(`awk preserves field characters ${JSON.stringify(separator)} ${flag} loop=${loop}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands()]), env: { input: ` a${separator}b\t c${separator} ` } });
      try {
        const body = `out=$(awk ${flag} '{ print "[" $1 "][" $2 "]" }' <<< "$input")`;
        const result = await shell.exec(`${loop ? `for i in 1 2; do ${body}; done` : body}; printf '%s' "$out"`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, `[a${separator}b][c${separator}]`);
      } finally { await shell.dispose(); }
    });
  }
}
for (const input of ["a\u2028b", "\u2028", "a\rb\vc\fd", " \t\n\r\v\f"]) {
  test(`wc -w uses ASCII whitespace ${JSON.stringify(input)}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands()]), env: { input, LC_ALL: "C" } });
    try {
      const result = await shell.exec(`out=$(wc -w <<< "$input"); printf '%s' "$out"`);
      assert.equal(result.stdout, input === "a\rb\vc\fd" ? "4" : input === " \t\n\r\v\f" ? "0" : "1");
    } finally { await shell.dispose(); }
  });
}
for (const [command, input, bytes, status] of [
  ['cat <<< "😀"', '', 5, 0],
  ["sed 's/a/😀/' <<< a", '', 5, 0],
  ['cat /input', 'abc', 3, 0],
  ['cat < /input', '', 0, 0],
  ['cat /input', 'a\n\n\n', 4, 0],
  ['grep xyz <<< abc', '', 0, 1],
  ["grep '^$' <<< ''", '', 1, 0],
  ["sed -n '/xyz/p' <<< abc", '', 0, 0],
  ['head -n 0 <<< abc', '', 0, 0],
  ['head -n 1 < /input', 'a\n\n', 2, 0],
  ['tail -n 1 < /input', 'a\n\n', 1, 0],
  ['head -c 1 <<< abc', '', 1, 0],
  ['tail -c 1 <<< abc', '', 1, 0],
  ['head -n 1 < /input', 'abc', 3, 0],
  ['tail -n 1 < /input', 'abc', 3, 0],
  ["sed 's/a/b/' < /input", 'a', 1, 0],
  ['cut -c 1 < /input', 'abc', 2, 0],
  ['uniq < /input', 'abc', 4, 0],
  ['sort < /input', 'b\na', 4, 0],
  ['wc -c < /input', 'abc', 2, 0],
  ["tr -d a <<< a", '', 1, 0],
  ["awk '{ print $1 }' < /input", '', 0, 0],
] as const) {
  for (const limit of [...new Set([bytes, Math.max(0, bytes - 1)])]) {
    test(`substitution charges emitted bytes: ${command} ${JSON.stringify(input)} limit=${limit}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile('/input', new TextEncoder().encode(input));
      const shell = new Shell({ fs, commands: new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands()]), limits: { maxOutputBytes: limit } });
      try {
        if (limit < bytes) {
          await assert.rejects(shell.exec(`out=$(${command})`), { name: "ShellLimitError", limit: "maxOutputBytes" });
        } else {
          const result = await shell.exec(`out=$(${command})`);
          assert.equal(result.exitCode, status);
          assert.equal(result.stderr, "");
        }
      } finally { await shell.dispose(); }
    });
  }
}
