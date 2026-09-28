import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases = [
  { name: "negative index", setup: "arr=(a b c)", body: 'printf -v "arr[-1]" "val_%s" "$i"', output: 'echo "${arr[*]}"', expected: "a b val_2\n" },
  { name: "parenthesized arithmetic", setup: "arr=(a b c d)", body: 'printf -v "arr[(i+1)]" "val_%s" "$i"', output: 'echo "${arr[*]}"', expected: "a b val_1 val_2\n" },
  { name: "unset array with local nameref", setup: 'x=10; f() { local -n ref=x; printf -v "uninit[0]" "val_%s" "$1"; }', body: 'f "$i"', output: 'echo "${uninit[*]}"', expected: "val_2\n" },
  { name: "unset array through local nameref", setup: 'f() { local -n ref=uninit; printf -v "ref[0]" "val_%s" "$1"; }', body: 'f "$i"', output: 'echo "${uninit[*]}"', expected: "val_2\n" },
  { name: "dynamic index", setup: "arr=(a b c)", body: 'printf -v "arr[$i]" "val_%s" "$i"', output: 'echo "${arr[*]}"', expected: "a val_1 val_2\n" },
] as const;

for (const entry of cases) for (const loop of ["for", "while", "arithmetic for"] as const) {
  test(`printf -v ${entry.name} does not replay a ${loop} loop`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    const body = `echo "iter=$i"; ${entry.body}`;
    const source = loop === "for" ? `for i in 1 2; do ${body}; done`
      : loop === "while" ? `i=1; while ((i<=2)); do ${body}; i=$((i+1)); done`
      : `for ((i=1;i<=2;i++)); do ${body}; done`;
    try {
      const result = await shell.exec(`${entry.setup}; ${source}; ${entry.output}`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `iter=1\niter=2\n${entry.expected}`);
    } finally { await shell.dispose(); }
  });
}
