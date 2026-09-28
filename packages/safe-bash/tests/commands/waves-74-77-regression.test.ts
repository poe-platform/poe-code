import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createByteCommands } from "../../src/commands/bytes/index.js";
import { createStreamFormatCommands } from "../../src/commands/stream-format/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases = [
  ['branch redirects', 'for ((i=1;i<=2;i++)); do if ((i==1)); then echo "hello_$i" > /f; else echo "hello_$i" >> /f; fi; done; cat /f', 'hello_1\nhello_2\n'],
  ['branch discard', 'for ((i=1;i<=2;i++)); do if ((i==1)); then echo hidden >/dev/null; else echo visible; fi; done', 'visible\n'],
  ['ordered branch stdout', 'for ((i=1;i<=2;i++)); do echo "before_$i"; if ((i==1)); then echo "inside_$i"; fi; done', 'before_1\ninside_1\nbefore_2\n'],
  ['while completion', 'i=0; while ((i<3000)); do i=$((i+1)); done; echo "$i"', '3000\n'],
  ['until completion', 'i=0; until ((i>=3000)); do i=$((i+1)); done; echo "$i"', '3000\n'],
  ['tr range here string', 'v=$(tr -d "0-9" <<< "abc123xyz"); echo "$v"', 'abcxyz\n'],
  ['tr range file', 'echo abc123xyz > /f; v=$(tr -d "0-9" < /f); echo "$v"', 'abcxyz\n'],
  ['nl blank lines', 'v=$(nl <<< $\'a\\n\\nb\'); echo "$v"', '     1\ta\n       \n     2\tb\n'],
  ['nl blank lines from file', 'printf "a\\n\\nb\\n" >/f; v=$(nl < /f); echo "$v"', '     1\ta\n       \n     2\tb\n'],
  ['nested elif redirects', 'for ((i=1;i<=3;i++)); do if ((i==1)); then echo first >/f; elif ((i==2)); then if ((i==2)); then echo second >>/f; fi; else echo third >>/f; fi; done; cat /f', 'first\nsecond\nthird\n'],
  ['ordered case stdout', 'for ((i=1;i<=2;i++)); do echo "before_$i"; case "$i" in 1) echo inside;; esac; done', 'before_1\ninside\nbefore_2\n'],
  ['tr range pipeline', 'v=$(echo abc123xyz | tr -d "0-9"); echo "$v"', 'abcxyz\n'],
  ['base64 wrapping', `v=$(base64 <<< "${'a'.repeat(90)}"); echo "$v"`, Buffer.from('a'.repeat(90)+'\n').toString('base64').match(/.{1,76}/g)!.join('\n')+'\n'],
] as const;
for (const [name, source, expected] of cases) test(name, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createByteCommands(), ...createStreamFormatCommands()]) });
  try {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  } finally { await shell.dispose(); }
});
for (const loop of ['while ((i<3000))', 'until ((i>=3000))']) test(`${loop} enforces loop budget`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()), limits: { maxLoopIterations: 10 } });
  try {
    await assert.rejects(shell.exec(`i=0; ${loop}; do i=$((i+1)); done`), /maxLoopIterations/);
  } finally { await shell.dispose(); }
});
test('branch stdout enforces output budget', async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()), limits: { maxOutputBytes: 5 } });
  try {
    await assert.rejects(shell.exec('for ((i=1;i<=2;i++)); do if ((i==1)); then echo abcdef; fi; done'), /maxOutputBytes/);
  } finally { await shell.dispose(); }
});
test('base64 here strings encode and decode without global Buffer', async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createByteCommands()]) });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer')!;
  Object.defineProperty(globalThis, 'Buffer', { configurable: true, value: undefined });
  try {
    const encoded = await shell.exec('v=$(base64 <<< hello); echo "$v"');
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    assert.equal(encoded.stdout, 'aGVsbG8K\n');
    const decoded = await shell.exec('v=$(base64 -d <<< aGVsbG8K); echo "$v"');
    assert.equal(decoded.exitCode, 0, decoded.stderr);
    assert.equal(decoded.stdout, 'hello\n');
  } finally {
    Object.defineProperty(globalThis, 'Buffer', descriptor);
    await shell.dispose();
  }
});
test('substitution reads respect filesystem budget', async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createByteCommands(), ...createStreamFormatCommands()]), limits: { maxFileSystemOperations: 5 } });
  try {
    await assert.rejects(shell.exec('echo value > /f; for ((i=1;i<=50;i++)); do v=$(cat /f); done'), /maxFileSystemOperations/);
  } finally { await shell.dispose(); }
});
