import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { basicCommands } from "../../src/commands/basic.js";

for (const source of [
  'set -e; eval "echo HELLO; false"; echo unreachable',
  'n=0; eval \'((n++)); printf "%04x\\n" 10\'; echo "n=$n"',
  'n=0; eval \'((n++)); eval "echo inner; false"; printf "%04x\\n" 10\'; echo "n=$n"',
  'false; echo "$(for ((i=1; i<=2; i++)); do echo "item_$i"; done) | pipe0=${PIPESTATUS[0]}"',
  'i=0; set -a; out="$(for ((i=1; i<=2; i++)); do echo "item_$i"; done)"; declare -p i',
  'i=9; out="$(for ((i = 1; i<=2; i++)); do echo "item_$i"; done)"; echo "$out:$i"',
  'i=$\'\\377\'; out="$(for ((i=1; i<=2; i++)); do echo "item_$i"; done)"; printf "%s" "$i"',
]) {
  test(`eval and loop substitution preserve Bash effects: ${source}`, async () => {
    const oracle = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source]);
    assert.equal(oracle.error, undefined);
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(source);
      assert.deepEqual(result.stdoutBytes, new Uint8Array(oracle.stdout));
      assert.equal(result.stderr, oracle.stderr.toString());
      assert.equal(result.exitCode, oracle.status);
    } finally { await shell.dispose(); }
  });
}

test("for-echo substitution and batched echo work without global Buffer", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  try {
    Reflect.deleteProperty(globalThis, "Buffer");
    const result = await shell.exec('x="$(for ((i=1; i<=2; i++)); do echo "item_$i"; done)"; echo "x=$x"; for ((i=0;i<3;i++)); do echo "é_$i"; done');
    assert.equal(result.stdout, "x=item_1\nitem_2\né_0\né_1\né_2\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally {
    Object.defineProperty(globalThis, "Buffer", descriptor);
    await shell.dispose();
  }
});
