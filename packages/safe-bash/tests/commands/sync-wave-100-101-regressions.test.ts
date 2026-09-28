import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createStreamFormatCommands } from "../../src/commands/stream-format/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases = [
  ["octal escape", String.raw`out+=$(printf '%s\077\n' "$w" | head -n 1)`, "1?2?"],
  ["control escape", String.raw`out+=$(printf '%s\a\b\e\f\v\n' "$w" | head -n 1)`, "1\x07\b\x1b\f\v2\x07\b\x1b\f\v"],
  ["unicode precision", String.raw`out+=$(printf '%.2s\n' "$v" | head -n 1)`, "éé"],
  ["hex escape", String.raw`out+=$(printf '%s\x41\n' "$w" | head -n 1)`, "1A2A"],
  ["zero width", String.raw`out+=$(printf '%05s\n' "$w" | head -n 1)`, "    1    2"],
  ["large width", String.raw`out+=$(printf '%200s\n' "$w" | head -n 1)`, " ".repeat(199) + "1" + " ".repeat(199) + "2"],
  ["large precision", String.raw`out+=$(printf '%.200s\n' "$w" | head -n 1)`, "12"],
  ["unterminated tac", 'out+=$(printf "%s" "$w" | tac)', "12"],
  ["unicode width", String.raw`out+=$(printf '%5s\n' "$wide" | head -n 1)`, "中文中文"],
] as const;
for (const [name, body, expected] of cases) {
  for (const loop of ['for w in 1 2', 'for ((w=1;w<=2;w++))', 'w=0; while ((w++<2))']) {
    test(`${name}: ${loop}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createStreamFormatCommands()]) });
      try {
        const result = await shell.exec(`v=é; wide=中文; ${loop}; do ${body}; done; printf '%s' "$out"`);
        assert.equal(result.stdout, expected);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}
for (const name of ['basename', 'dirname']) for (const append of [true, false]) {
  for (const loop of ['for p in /a/b.txt -x', 'for ((i=0;i<2;i++))', 'i=0; while ((i++<2))']) test(`${name} dynamic option ${loop} ${append}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const update = loop.startsWith('for p') ? '' : `if ((i==${loop.startsWith('for ((') ? 0 : 1})); then p=/a/b.txt; else p=-x; fi;`;
      const result = await shell.exec(`${loop}; do ${update} out${append ? '+' : ''}=$(${name} "$p"); status=$?; done; printf '%s:%s' "$out" "$status"`);
      const first = append ? (name === 'basename' ? 'b.txt' : '/a') : '';
      assert.equal(result.stdout, `${first}:1`);
      assert.match(result.stderr, /invalid option/);
    } finally { await shell.dispose(); }
  });
}
for (const [input, flag, locale, expected] of [
  [String.raw`a\tb\n`, '-L', '', '9'], ['中文\\n', '-L', '', '4'],
  [String.raw`abc\rde\n`, '-L', '', '3'], [String.raw`abc\fde\n`, '-L', '', '3'],
  ['é\\n', '-L', '', '1'], [String.raw`a\ab\n`, '-L', '', '2'],
  ['é\\n', '-m', 'export LC_ALL=C;', '3'], ['中文\\n', '-L', 'export LC_CTYPE=C;', '0'],
] as const) for (const source of ['pipeline', 'redirect']) test(`wc ${flag} ${source} ${input} ${locale}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
  try {
    const body = source === 'pipeline' ? `printf '${input}' | wc ${flag}` : `wc ${flag} < /input`;
    const result = await shell.exec(`${locale} printf '${input}' > /input; for i in 1 2; do out=$(${body}); done; printf '%s' "$out"`);
    assert.equal(result.stdout, expected);
  } finally { await shell.dispose(); }
});
