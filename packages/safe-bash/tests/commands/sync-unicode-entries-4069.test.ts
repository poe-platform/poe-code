import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createStructuredCommands } from "../../src/commands/structured/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases = [
  ['tr accent', 'tr "é" "e"', 'é', 'ee'],
  ['tr two replacements', 'tr "é" "ab"', 'é', 'ab'],
  ['tr squeeze', 'tr -s "é"', 'éé', 'éé'],
  ['tr astral', 'tr "😀" "X"', '😀', 'XXXX'],
  ['tr non-ASCII target', 'tr "a" "é"', 'a', '�'],
  ['entries Value', "jq -c 'from_entries'", '[{"key":"a","Value":1}]', '{"a":1}'],
  ['entries Key', "jq -c 'from_entries'", '[{"Key":"a","Value":1}]', '{"a":1}'],
  ['entries Name', "jq -c 'from_entries'", '[{"Name":"a","Value":1}]', '{"a":1}'],
  ['entries false key fallback', "jq -c 'from_entries'", '[{"key":false,"Key":"a","value":false,"Value":1}]', '{"a":false}'],
  ['entries empty key', "jq -c 'from_entries'", '[{"key":"","Key":"a","value":null,"Value":1}]', '{"":null}'],
  ['entries no v alias', "jq -c 'from_entries'", '[{"key":"a","v":1}]', '{"a":null}'],
  ['split astral', `jq -c 'split("")'`, '"😀a"', '["😀","a"]'],
  ['split empty', `jq -c 'split("")'`, '""', '[]'],
  ['split delimiter', `jq -c 'split("a")'`, '"😀aé"', '["😀","é"]'],
] as const;
for (const [name, command, input, expected] of cases) {
  for (const mode of ['direct', 'substitution', 'loop', 'arithmetic-loop'] as const) {
    test(`${name}: ${mode}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createStructuredCommands()]) });
      try {
        const invocation = `${command} <<< '${input}'`;
        const assignment = `out=$(${invocation})`;
        const source = mode === 'direct' ? invocation : mode === 'substitution' ? `${assignment}; printf '%s\\n' "$out"` : `${mode === 'loop' ? 'for i in 1 2' : 'for ((i=0;i<2;i++))'}; do ${assignment}; done; printf '%s\\n' "$out"`;
        const result = await shell.exec(source);
        assert.equal(result.stdout, `${expected}\n`);
        assert.equal(result.stderr, '');
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}
for (const mode of ['direct', 'substitution', 'loop', 'arithmetic-loop'] as const) {
  test(`entries reject k alias: ${mode}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createStructuredCommands()]) });
    try {
      const invocation = `jq -c 'from_entries' <<< '[{"k":"a","v":1}]'`;
      const source = mode === 'direct' ? invocation : mode === 'substitution' ? `out=$(${invocation})` : `${mode === 'loop' ? 'for i in 1 2' : 'for ((i=0;i<2;i++))'}; do out=$(${invocation}); done`;
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 5);
      assert.equal(result.stdout, '');
      assert.notEqual(result.stderr, '');
    } finally { await shell.dispose(); }
  });
}
