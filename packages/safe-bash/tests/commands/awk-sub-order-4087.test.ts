import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";

const cases = [
  ["awk assignment before sub", `awk '{ $1 = "foo"; sub(/foo/, "bar", $1); print $1 }' <<< 'old'`, "bar\n"],
  ["awk assignment before gsub", `awk '{ $1 = "foofoo"; gsub(/foo/, "bar", $1); print $0 }' <<< 'old tail'`, "barbar tail\n"],
  ["awk assignment before record sub", `awk '{ $1 = "foo"; sub(/foo/, "bar"); print $0 }' <<< 'old tail'`, "bar tail\n"],
  ["awk extension before sub", `awk '{ $2 = "foo"; sub(/foo/, "bar", $2); print $0 }' <<< 'old'`, "old bar\n"],
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
