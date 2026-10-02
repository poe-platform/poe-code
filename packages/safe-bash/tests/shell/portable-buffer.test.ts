import assert from "node:assert/strict";
import test from "node:test";
import { portableRuntime } from "../helpers/portable-runtime.js";

test("explicit portable bootstrap remains compatible with the standalone shell", async () => {
  const { api: { Shell, MemoryFileSystem, CommandRegistry, createStandardCommands }, buffer } = await portableRuntime(`
    export { Shell } from "./packages/safe-bash/src/shell/index.ts";
    export { MemoryFileSystem } from "./packages/safe-bash/src/fs/memory/index.ts";
    export { CommandRegistry } from "./packages/safe-bash/src/contracts/command.ts";
    export { createStandardCommands } from "./packages/safe-bash/src/commands/index.ts";
  `, { bootstrapBuffer: true });
  assert.equal(buffer, undefined);
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
  try {
    const result = await shell.exec('printf -v x "%04d" 7', { limits: { maxExpansionBytes: 4096 } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    for (const maxExpansionBytes of [4096, Infinity]) {
      const arrays = await shell.exec([
        'arr=(); arr+=("hello")',
        'declare -A map; map["k"]="world"',
        'echo "arr=${arr[0]}" "map=${map[k]}"',
        'for i in 1 2 3; do arr+=("é$i"); done',
        'for ((i=0;i<3;i++)); do map["k$i"]="🌍$i"; done',
        'echo "${arr[@]}" "${map[k0]}" "${map[k1]}" "${map[k2]}"',
      ].join("\n"), { limits: { maxExpansionBytes } });
      assert.equal(arrays.stdout, "arr=hello map=world\nhello é1 é2 é3 🌍0 🌍1 🌍2\n");
      assert.equal(arrays.stderr, "");
      assert.equal(arrays.exitCode, 0);
    }
    for (const [source, stdin, stdout] of [
      ['read -r x; echo "$x"', "hi\n", "hi\n"],
      ['read -n 2 x; echo "$x"', "hi!", "hi\n"],
      ['read -r x <<< "hi"; echo "$x"', "", "hi\n"],
      ['mapfile -t arr <<< "hi"; echo "${arr[0]}"', "", "hi\n"],
      ['eval "x=1"; echo "$x"', "", "1\n"],
      ['v=abc; echo "${v/a/b}"', "", "bbc\n"],
      ['trap "echo hi" EXIT; trap -p', "", "trap -- 'echo hi' EXIT\nhi\n"],
      ['declare -A m; m[é]=1; echo "${m[é]}"', "", "1\n"],
      ['v="a]b"; echo "${v//[]a]/X}" "${v//[!]]/X}" "${v//[!]a]/X}"', "", "XXb X]X a]X\n"],
    ] as const) {
      const result = await shell.exec(source, { stdin });
      assert.equal(result.stdout, stdout, source);
      assert.equal(result.stderr, "", source);
      assert.equal(result.exitCode, 0, source);
    }
  } finally { await shell.dispose(); }

});

test("portable bootstrap preserves an existing native Buffer", async () => {
  const native = globalThis.Buffer;
  await import(new URL("../../src/portable-buffer.js?native", import.meta.url).href);
  assert.equal(globalThis.Buffer, native);
});
