import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

async function execute(source: string) {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
  try { return await shell.exec(source); } finally { await shell.dispose(); }
}

for (const setup of ["", "LC_ALL=C;", "shopt -s nocasematch;"]) {
  for (const condition of ['[ "a" = "a" ]', 'test "a" != "b"', "[ 010 -eq 10 ]", "[ 08 -eq 8 ]", "[ 00 -eq 0 ]", "[ -0 -eq 0 ]", "[ -1000000000000 -eq -1000000000000 ]"]) {
    for (const body of [
      `if ${condition}; then echo YES; else echo NO; fi`,
      `echo "$(if ${condition}; then echo YES; else echo NO; fi)"`,
      `out=$(if ${condition}; then echo YES; else echo NO; fi); echo "$out"`,
      `out=; out+=$(if ${condition}; then echo YES; else echo NO; fi); echo "$out"`,
    ]) {
      test(`POSIX condition in loop: ${setup} ${body}`, async () => {
        const actual = await execute(`${setup} for i in 1 2; do ${body}; done`);
        assert.equal(actual.stdout, "YES\nYES\n");
        assert.equal(actual.stderr, "");
        assert.equal(actual.exitCode, 0);
      });
    }
  }
}
for (const loop of [
  'for i in 1; do test -n "$a"; done',
  'for ((i=0; i<1; i++)); do test -n "$a"; done',
  'for i in 1; do if test "$a" = nope; then :; fi; done',
  'while test -z "$a"; do :; done',
  'until test -n "$a"; do :; done',
  'for i in 1; do for j in 1; do test -n "$a"; done; done',
]) {
  test(`test last argument: ${loop}`, async () => {
    const actual = await execute(`a=hello; ${loop}; echo "$_"`);
    assert.equal(actual.stdout, loop.includes("nope") ? "nope\n" : "hello\n");
    assert.equal(actual.stderr, "");
  });
}
for (const loop of ["while [ 010 -eq 10 ]; do echo YES; break; done", "until [ 08 -ne 8 ]; do echo YES; break; done"]) {
  test(loop, async () => {
    assert.equal((await execute(loop)).stdout, "YES\n");
  });
}

for (const source of [
  'LC_ALL=C; for i in 1 2; do if [ a = a ]; then echo YES; fi; done',
  'shopt -s nocasematch; for i in 1 2; do if test A = a; then echo BAD; else echo OK; fi; done',
  'for i in 010 08 00 -0 -1000000000000; do n=$i; echo "$(if [ "$n" -eq "$i" ]; then echo YES; fi)"; done',
  'a=hello; for i in 1; do [ -n "$a" ]; done; echo "$_"',
  'a=hello; for i in 1; do if test -n ""; then :; fi; done; printf "<%s>\n" "$_"',
]) {
  test(`native Bash parity: ${source}`, async () => {
    const expected = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.equal(expected.error, undefined);
    const actual = await execute(source);
    assert.equal(actual.stdout, expected.stdout);
    assert.equal(actual.stderr, expected.stderr);
    assert.equal(actual.exitCode, expected.status);
  });
}
