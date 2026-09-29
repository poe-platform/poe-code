import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { Runtime } from "../../src/shell/runtime.js";
import { registerYieldCheckpoint } from "../../src/contracts/yield.js";

for (const [setup, substitution, value] of [
  ['a=hello;', 'echo "x${a@U}"', 'xHELLO'],
  ['a=HELLO;', 'echo "${a@L}"', 'hello'],
  ['a=hello;', 'echo "${a@u}"', 'Hello'],
  ['a=hello;', 'echo "${a@Q}"', "'hello'"],
  ['prefix_one=1;', 'echo "x${!prefix_*}"', 'xprefix_one'],
  ['', 'echo "x$(echo y)"', 'xy'],
  ['a=hello;', 'printf "%s" "${a@U}"', 'HELLO'],
  ['a=HELLO;', 'dirname -- "/tmp/${a@L}/b"', '/tmp/hello'],
  ['a=HELLO;', 'basename -- "/tmp/${a@L}"', 'hello'],
  ['a=hello; f() { echo "$1"; };', 'f "${a@U}"', 'HELLO'],
] as const) {
  for (const mode of ['echo', 'assign', 'append'] as const) {
    test(`loop substitution ${mode}: ${substitution}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
      const body = mode === 'echo' ? `echo "$(${substitution})"` : `out${mode === 'append' ? '+' : ''}=$(${substitution})`;
      try {
        const result = await shell.exec(`${setup} out=; for i in 1 2; do ${body}; done; ${mode === 'echo' ? '' : 'printf "%s\\n" "$out"; declare -p out >/dev/null'}`);
        assert.equal(result.stdout, mode === 'echo' ? `${value}\n${value}\n` : `${mode === 'append' ? value + value : value}\n`);
        assert.equal(result.stderr, '');
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}

for (const initialCommands of [124, 125, 126, 127]) {
  test(`loop substitutions cross yield checkpoints from command ${initialCommands}`, async context => {
    let checkpoints = 0;
    const runUnit = Runtime.prototype.runUnit;
    context.mock.method(Runtime.prototype, "runUnit", function (this: Runtime, ...args: Parameters<Runtime["runUnit"]>) {
      this.budget.commands = initialCommands;
      registerYieldCheckpoint(this.signal, () => { checkpoints++; });
      return runUnit.apply(this, args);
    });
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const result = await shell.exec('for i in {1..300}; do :; echo "$(echo "x$i")"; done');
      assert.equal(result.stdout, Array.from({ length: 300 }, (_, i) => `x${i + 1}\n`).join(''));
      assert.equal(result.stderr, '');
      assert.equal(result.exitCode, 0);
      assert.ok(checkpoints > 0);
    } finally { await shell.dispose(); }
  });
}

for (const loop of [
  'for ((i=0; i<2; i++)); do',
  'i=0; while ((i++ < 2)); do',
  'i=0; until ((i++ >= 2)); do',
  'for i in 1 2; do',
]) {
  test(`substitution preserves effects and mutable operands: ${loop}`, async () => {
    const source = `a=hello; out=; n=0; ${loop} n=$((n+1)); a="$a$i"; out+=$(echo "x$(echo "$a")"); echo "$(echo "x$(echo "$i")")"; done; printf "%s:%s\\n" "$n" "$out"; declare -p out`;
    const expected = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.equal(expected.error, undefined);
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const actual = await shell.exec(source);
      assert.equal(actual.stdout, expected.stdout);
      assert.equal(actual.stderr, expected.stderr);
      assert.equal(actual.exitCode, expected.status);
    } finally { await shell.dispose(); }
  });
}
