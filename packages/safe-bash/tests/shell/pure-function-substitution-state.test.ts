import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { streamCommands } from "../../src/commands/streams.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const regressionCases: [string, string][] = [];
for (const output of ['echo -e "STEP2\\tTAB"', 'echo -n STEP2', 'printf "%04x\\n" 15', 'echo "$(echo STEP2)"', 'echo $\'STEP2\\0TAIL\'']) {
  const body = `echo STEP1; (( count++ )); ${output}`;
  for (const compound of [`if (( 1 )); then ${body}; fi`, `case x in x) ${body};; esac`, `{ ${body}; }`, `fn(){ ${body}; }; fn`, `fn(){ ${body}; }; fn argument`]) {
    regressionCases.push([`compound executes once: ${compound}`, `count=0; for _ in 1; do ${compound}; done; echo "count=$count"`]);
  }
}
for (const expression of ["$inc", "inc"]) {
  for (const output of ['echo done', 'echo -e "done\\t1"', 'printf "%04x\\n" 15']) {
    regressionCases.push([`substitution isolates ${expression} before ${output}`, `count=0; inc="count += 10"; fn(){ (( ${expression} )); ${output}; }; for _ in 1; do res=$(fn); done; echo "res=[$res] count=$count"`]);
  }
}
regressionCases.push(
  ["assignment substitution preserves last argument and locals", 'fn(){ local a=1; echo INNER; }; a=outer; for _ in 1; do : OUTER; x="$(fn 1)" y="$_"; done; echo "$x $y $a"'],
  ["expanded arithmetic exports its destination", 'set -a; target=exported_arith_var; for _ in 1; do (( $target = 42 )); done; declare -p exported_arith_var'],
  ["expanded comparison reads LINENO", 'x=0; for _ in 1; do if (( $x < LINENO )); then echo yes; else echo no; fi; done'],
  ["simple comparison reads LINENO", 'x=0; for _ in 1 2; do (( $x < LINENO )); echo "$?"; done'],
  ["expanded comparison reads BASH_SUBSHELL", 'x=0; ( for _ in 1; do if (( $x < BASH_SUBSHELL )); then echo yes; else echo no; fi; done )'],
  ["subshell levels preserve the parent", 'echo "$BASH_SUBSHELL"; ( echo "$BASH_SUBSHELL"; ( echo "$BASH_SUBSHELL"; ); ); echo "$BASH_SUBSHELL"'],
  ["substitution reads its own subshell level", 'echo "$(echo "$BASH_SUBSHELL")"; echo "$(echo "$((BASH_SUBSHELL))")"; echo "$BASH_SUBSHELL"'],
  ["function substitutions read their own subshell level", 'f(){ echo "$BASH_SUBSHELL"; }; for _ in 1 2; do x=$(f); y=$(echo "$((BASH_SUBSHELL))"); echo "$x $y $BASH_SUBSHELL"; done'],
  ["pipeline reads its own subshell level", 'echo ignored | { echo "$BASH_SUBSHELL"; }; echo "$BASH_SUBSHELL"'],
  ["expanded comparison reads assigned SECONDS", 'SECONDS=100; x=50; for _ in 1; do if (( $x < SECONDS )); then echo yes; else echo no; fi; done'],
  ["expanded comparison reads RANDOM", 'RANDOM=1; x=0; for _ in 1; do if (( $x < RANDOM )); then echo yes; else echo no; fi; done'],
);

for (const [name, source] of regressionCases) {
  for (const unbounded of [false, true]) {
    test(`${name}, unbounded=${unbounded}`, async context => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()), ...(unbounded ? { limits: { maxExpansionFields: Infinity, maxExpansionBytes: Infinity } } : {}) });
      context.after(() => shell.dispose());
      const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { timeout: 2000 });
      assert.equal(native.error, undefined);
      const result = await shell.exec(source);
      assert.equal(result.stdout, native.stdout.toString());
      assert.equal(result.stderr, native.stderr.toString());
      assert.equal(result.exitCode, native.status);
    });
  }
}

for (const body of ["if true; then echo sub_arg; fi", "echo first; echo sub_arg", "local a=1; echo sub_arg", "echo é_arg"]) {
  for (const portable of [false, true]) {
    test(`previously defined function substitution restores parent last argument: ${body}, portable=${portable}`, async context => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
      context.after(() => shell.dispose());
      const source = `f(){ ${body}; }; : parent_arg; echo "$(f)" "$_"; echo "$_"`;
      const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source]);
      const original = globalThis.Buffer;
      let result;
      try {
        if (portable) Reflect.deleteProperty(globalThis, "Buffer");
        result = await shell.exec(source);
      } finally {
        globalThis.Buffer = original;
      }
      assert.equal(result.stdout, native.stdout.toString());
      assert.equal(result.exitCode, native.status, result.stderr);
    });
  }
}

test("cat substitution filename expansion does not mutate the parent", async context => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/0", new TextEncoder().encode("data\n"));
  const shell = new Shell({ fs, commands: new CommandRegistry([...basicCommands(), ...streamCommands()]) });
  context.after(() => shell.dispose());
  const result = await shell.exec('count=0; for _ in 1 2; do res=$(cat "/$((count++))"); echo "$res count=$count"; done');
  assert.equal(result.stdout, "data count=0\ndata count=0\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});
