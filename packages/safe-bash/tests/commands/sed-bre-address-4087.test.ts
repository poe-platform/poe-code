import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";

const cases = [
  ...[["a+b", "aab"], ["a?b", "ab"], ["foo(1)", "foo1"], ["a|b", "ab"], ["a{2}", "aa"], ["a}b", "ab"]].map(([pattern, other]) => [
    `sed BRE literal ${pattern}`, `sed '/${pattern}/d' <<< '${pattern}\n${other}'`, `${other}\n`,
  ] as const),
  ["sed BRE escaped repetition", String.raw`sed '/a\{2\}/d' <<< 'aa
keep'`, "keep\n"],
  ["sed BRE bracket literals", `sed '/^[+?(){}|]$/d' <<< '+\n?\n(\n)\n{\n}\n|\nkeep'`, "keep\n"],
  ["sed ERE address", `sed -E '/a+b/d' <<< 'a+b\naab'`, "a+b\n"],
] as const;

for (const [name, command, expected] of cases) {
  for (const mode of ["direct", "substitution", "loop"] as const) {
    test(`${name}: ${mode}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem() });
      shell.use(standardCommands()).use(textProgramCommands());
      try {
        const capture = `x=$(${command}); printf '%s\\n' "$x"`;
        const script = mode === "direct" ? command : mode === "substitution" ? capture : `for i in 1 2; do ${capture}; done`;
        const result = await shell.exec(script);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, mode === "loop" ? expected.repeat(2) : expected);
      } finally { await shell.dispose(); }
    });
  }
}
