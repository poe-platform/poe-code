import { createTacCommands } from "../../src/commands/tac/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases = [
  ["suffix case", "printf '1m\\n2K\\n1k\\n1M\\n1g\\n1G\\n1t\\n' | sort -hs", "1m\n1g\n1t\n1k\n2K\n1M\n1G\n", 0],
  ["largest suffixes", "printf '1Q\\n1R\\n1Y\\n1\\n' | sort -h", "1\n1Y\n1R\n1Q\n", 0],
  ["folded suffixes", "printf '2m\\n1K\\n1M\\n' | sort -hfs", "1K\n1M\n2m\n", 0],
  ["key reverse override", "printf 'a:2G\\nb:11M\\nc:2G\\n' | sort -r -t : -k2,2h -s", "b:11M\na:2G\nc:2G\n", 0],
  ["key numeric override", "printf 'a:2G\\nb:11M\\nc:2G\\n' | sort -h -t : -k2,2n -s", "a:2G\nc:2G\nb:11M\n", 0],
  ["key month override", "printf 'a:JAN\\nb:FEB\\n' | sort -r -t : -k2,2M -s", "a:JAN\nb:FEB\n", 0],
  ["key dictionary override", "printf 'a:2!\\nb:11\\n' | sort -n -t : -k2,2d -s", "b:11\na:2!\n", 0],
  ["key fold override", "printf 'a:a\\nb:B\\n' | sort -r -t : -k2,2f -s", "a:a\nb:B\n", 0],
  ["key blanks override", "printf 'a: z\\nb:a\\n' | sort -r -t : -k2b,2 -s", "b:a\na: z\n", 0],
  ["global fold overridden", "printf 'a:a\\nb:B\\n' | sort -f -t : -k2,2r -s", "a:a\nb:B\n", 0],
  ["global blanks overridden", "printf 'a: z\\nb:a\\n' | sort -b -t : -k2,2r -s", "b:a\na: z\n", 0],
  ["global dictionary overridden", "printf 'a:2\\nb:11\\n' | sort -d -t : -k2,2n -s", "a:2\nb:11\n", 0],
  ["explicit override of incompatible globals", "printf '2G\\n11M\\n' | sort -hn -k1,1h", "11M\n2G\n", 0],
  ["tac unterminated tr", "tr -d '\\n' <<< 'abc' | tac", "abc", 0],
  ["tac unterminated head", "head -c 3 <<< 'abc' | tac", "abc", 0],
  ["tac unterminated multiline", "printf 'a\\nb' | tac", "ba\n", 0],
  ...["-hn", "-nh", "-hM", "-nM", "-hd", "-nd", "-Md", "-k1,1hn", "--human-numeric-sort --numeric-sort"].map(flags =>
    [`incompatible ${flags}`, `printf '2G\\n1M\\n' | sort ${flags}`, "", 2] as const),
] as const;

for (const [name, pipeline, expected, status] of cases) {
  for (const mode of ["direct", "substitution", "loop", "arithmetic-loop"] as const) {
    test(`${name}: ${mode}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createTacCommands()]) });
      try {
        const assignment = `out=$(${pipeline}); status=$?; printf '%s' "$out"; exit "$status"`;
        const source = mode === "direct" ? pipeline : mode === "substitution" ? assignment
          : mode === "loop" ? `for i in 1 2; do out=$(${pipeline}); status=$?; done; printf '%s' "$out"; exit "$status"`
          : `for ((i=0;i<2;i++)); do out=$(${pipeline}); status=$?; done; printf '%s' "$out"; exit "$status"`;
        const result = await shell.exec(source);
        assert.equal(result.stdout, mode === "direct" ? expected : expected.trimEnd());
        assert.equal(result.exitCode, status);
        if (status === 0) assert.equal(result.stderr, "");
        else assert.match(result.stderr, /incompatible/);
      } finally { await shell.dispose(); }
    });
  }
}

test("tac in loop echo handles an unterminated upstream stage", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createTacCommands()]) });
  try {
    const result = await shell.exec(`for i in 1 2; do echo "a$(tr -d '\\n' <<< 'abc' | tac)"; done`);
    assert.equal(result.stdout, "aabc\naabc\n");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});
