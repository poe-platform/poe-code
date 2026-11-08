import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { structuredCommands } from "../../src/commands/structured/index.js";

const cases = [
  // jq 1.8.1's grammar places // below assignment; the issue's claim reverses it.
  ["jq assignment alternative", `jq -c '.a = .b // 5' <<< '{"b":null}'`, '{"b":null,"a":null}\n'],
  ["jq update alternative", `jq -c '.a |= . // 5' <<< '{"a":null}'`, '{"a":null}\n'],
  ["jq addition alternative", `jq -c '.a += .b // 5' <<< '{"a":2,"b":null}'`, '{"a":2,"b":null}\n'],
  ["jq assignment RHS alternative", `jq -c '.a = (.b // 5)' <<< '{"b":null}'`, '{"b":null,"a":5}\n'],
  ["jq update RHS alternative", `jq -c '.a |= (. // 5)' <<< '{"a":null}'`, '{"a":5}\n'],
  ["jq addition RHS alternative", `jq -c '.a += (.b // 5)' <<< '{"a":2,"b":null}'`, '{"a":7,"b":null}\n'],
  ["jq subtraction RHS alternative", `jq -c '.a -= (.b // 5)' <<< '{"a":9,"b":null}'`, '{"a":4,"b":null}\n'],
  ["jq multiplication RHS alternative", `jq -c '.a *= (.b // 5)' <<< '{"a":2,"b":null}'`, '{"a":10,"b":null}\n'],
  ["jq parenthesized assignment alternative", `jq -c '(.a = .b) // 5' <<< '{"b":null}'`, '{"b":null,"a":null}\n'],
] as const;

for (const [name, command, expected] of cases) {
  for (const mode of ["direct", "substitution", "loop"] as const) {
    test(`${name}: ${mode}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem() });
      shell.use(standardCommands()).use(structuredCommands());
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
