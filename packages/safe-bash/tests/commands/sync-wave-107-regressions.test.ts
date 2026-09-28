import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";
import { createSearchCommands } from "../../src/commands/search/index.js";
import { createByteCommands } from "../../src/commands/bytes/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases = [
  ["string inequality", "printf 'foo\\n0\\nbar\\n' | awk '$1 != 0 { print $1 }'", "foo\nbar"],
  ["missing equality", "printf 'onlyone\\ntwo 0\\n' | awk '$2 == 0 { print $1 }'", "two"],
  ["missing less equal", "printf 'onlyone\\ntwo 0\\n' | awk '$2 <= 0 { print $1 }'", "onlyone\ntwo"],
  ["missing greater equal", "printf 'onlyone\\ntwo 0\\n' | awk '$2 >= 0 { print $1 }'", "two"],
  ["string greater", "printf 'foo\\n-5\\n' | awk '$1 > 0 { print $1 }'", "foo"],
  ["string greater equal", "printf 'foo\\n0\\n' | awk '$1 >= 0 { print $1 }'", "foo\n0"],
  ["string less", "printf 'foo\\n2\\n' | awk '$1 < 9 { print $1 }'", "2"],
  ["string less equal", "printf 'foo\\n9\\n' | awk '$1 <= 9 { print $1 }'", "9"],
  ["numeric input classification", "printf '0x10\\n1e2\\n+2\\n' | awk '$1 > 9 { print $1 }'", "1e2"],
  ["empty record", "printf '\\n0\\n' | awk '$0 == 0 { print NR }'", "2"],
  ["ASCII folding", "printf 'Ä\\nA\\na\\n' | grep -Fi 'a'", "A\na"],
] as const;

async function execute(source: string) {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands(), ...createSearchCommands(), ...createByteCommands()]) });
  try { return await shell.exec(source); } finally { await shell.dispose(); }
}
for (const [name, pipeline, expected] of cases) {
  for (const mode of ["direct", "substitution", "loop"] as const) {
    test(`${name}: ${mode}`, async () => {
      const source = mode === "direct" ? pipeline : mode === "substitution"
        ? `x=$(${pipeline}); printf '%s\\n' "$x"`
        : `for i in 1 2; do x=$(${pipeline}); done; printf '%s\\n' "$x"`;
      const result = await execute(source);
      assert.equal(result.stdout, expected + "\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
}
for (const locale of ["", "LC_ALL=C; "]) {
  test(`Unicode fixed grep does not fold: ${locale}`, async () => {
    const result = await execute(`${locale}x=$(printf 'Ä\\n' | grep -Fi 'ä'); s=$?; printf '%s:%s\\n' "$x" "$s"`);
    assert.equal(result.stdout, ":1\n");
    assert.equal(result.stderr, "");
  });
}
for (const decode of ["printf '//8=\\n' | base64 -d", 'base64 -d <<< "//8="']) {
  for (const mode of ["substitution", "loop"] as const) {
    test(`binary base64 ${decode}: ${mode}`, async () => {
      const assign = `x=$(${decode})`;
      const result = await execute(`${mode === "loop" ? `for i in 1 2; do ${assign}; done` : assign}; printf '%s' "$x" | base64`);
      assert.equal(result.stdout, "//8=\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
}
