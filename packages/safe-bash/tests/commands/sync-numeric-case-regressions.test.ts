import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { Runtime } from "../../src/shell/runtime.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { predicateCommands } from "../../src/commands/predicates.js";
import { basicCommands } from "../../src/commands/basic.js";

const cases = [
  ['brace case', 'csum=0; for i in {1..2}; do case $i in 1) ((csum+=10));; *) ((csum+=1));; esac; done; echo "$csum"', '11\n'],
  ['array case', 'a=(1 2); n=0; for i in "${a[@]}"; do case $i in 1) ((n+=10));; *) ((n+=1));; esac; done; echo "$n"', '11\n'],
  ['quoted hyphen class', 'n=0; for i in b; do case $i in [a"-"c]) ((n+=1));; esac; done; echo "$n"', '0\n'],
  ['numeric branch', 'j=0; n=0; while [ $j -lt 4 ]; do if [ $j -lt 2 ]; then ((n+=1)); fi; ((j+=1)); done; echo "$n"', '2\n'],
  ['mixed quoted class', 'n=0; for i in b; do case $i in ["!a"]) ((n+=1));; esac; done; echo "$n"', '0\n'],
  ['quoted patterns', 'n=0; for i in "*" a b; do case $i in "*") ((n+=10));; "a"|"b") ((n+=1));; esac; done; echo "$n"', '12\n'],
  ['quoted numeric while', 'j=0; while [ "$j" -lt 4 ]; do ((j+=1)); done; echo "$j"', '4\n'],
  ['unquoted numeric until', 'j=0; until [ $j -ge 4 ]; do ((j+=1)); done; echo "$j"', '4\n'],
  ['arithmetic while', 'j=0; while ((j<4)); do ((j+=1)); done; echo "$j"', '4\n'],
  ['conditional until', 'j=0; until [[ $j -ge 4 ]]; do ((j+=1)); done; echo "$j"', '4\n'],
] as const;
for (const [name, source, expected] of cases) test(name, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxLoopIterations: 100 } });
  for (const command of [...basicCommands(), ...predicateCommands()]) shell.commands.register(command);
  try {
    const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.equal(native.status, 0, native.stderr);
    assert.equal(native.stdout, expected);
    const result = await shell.exec(source);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const source of [
  'j=0; while [ "$j" -lt 3000 ]; do ((j+=1)); done',
  'j=0; until [ $j -ge 3000 ]; do ((j+=1)); done',
  'IFS=:; j=0; until [ $j -ge 3000 ]; do ((j+=1)); done',
]) test(`numeric bracket loops yield and preserve arithmetic progress: ${source}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxLoopIterations: 4000 } });
  for (const command of [...basicCommands(), ...predicateCommands()]) shell.commands.register(command);
  let yielded = false;
  const turn = setImmediate(() => { yielded = true; });
  try {
    const result = await shell.exec(source + '; printf "%s" "$j"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "3000");
    assert.equal(result.stderr, "");
    assert.equal(yielded, true);
  } finally {
    clearImmediate(turn);
    await shell.dispose();
  }
});

for (const [name, source] of [
  ["enclosing binding", 'j=0; n=0; for j in 0 bad; do if [ "$j" -lt 2 ]; then ((n+=1)); fi; done; echo "done"'],
  ["printf assignment", 'j=0; while [ "$j" -lt 2 ]; do printf -v j bad; done; echo "done"'],
  ["unset", 'while [ "$missing" -lt 2 ]; do ((n+=1)); done; echo "done"'],
  ["if assignment", 'j=0; while [ "$j" -lt 2 ]; do if ((j==0)); then j=bad; fi; done; echo "done"'],
  ["case assignment", 'j=0; while [ "$j" -lt 2 ]; do case $j in 0) j=bad;; esac; done; echo "done"'],
  ["nested for binding", 'j=0; while [ "$j" -lt 2 ]; do for j in bad; do ((n+=1)); done; done; echo "done"'],
] as const) test(`invalid integer fallback: ${name}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxLoopIterations: 100 } });
  for (const command of [...basicCommands(), ...predicateCommands()]) shell.commands.register(command);
  try {
    const result = await shell.exec(source);
    assert.equal(result.stdout, "done\n");
    assert.match(result.stderr, /integer expression expected/);
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

test("quoted case patterns use synchronous loop steps", async () => {
  const prototype = Runtime.prototype as unknown as { execSyncCaseStep: (...args: unknown[]) => unknown };
  const original = prototype.execSyncCaseStep;
  let calls = 0;
  prototype.execSyncCaseStep = function (...args) {
    calls++;
    return original.apply(this, args);
  };
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxLoopIterations: 100 } });
  for (const command of [...basicCommands(), ...predicateCommands()]) shell.commands.register(command);
  try {
    const result = await shell.exec('x="*"; n=0; for i in {1..2}; do case $x in "*") ((n+=10));; "a"|"b") ((n+=1));; esac; done; echo "$n"');
    assert.equal(result.stdout, "20\n");
    assert.ok(calls > 0);
  } finally {
    prototype.execSyncCaseStep = original;
    await shell.dispose();
  }
});

test("unquoted numeric operands preserve IFS changes", async () => {
  const source = 'j=0; while [ $j -lt 2 ]; do IFS=1; ((j+=1)); done; echo "$j"';
  const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxLoopIterations: 100 } });
  for (const command of [...basicCommands(), ...predicateCommands()]) shell.commands.register(command);
  try {
    const result = await shell.exec(source);
    assert.equal(result.stdout, native.stdout);
    assert.equal(result.exitCode, native.status);
    assert.notEqual(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("unset POSIX integer operand reports status two", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxLoopIterations: 100 } });
  for (const command of [...basicCommands(), ...predicateCommands()]) shell.commands.register(command);
  try {
    const result = await shell.exec('[ "$missing" -lt 2 ]; echo "$?"');
    assert.equal(result.stdout, "2\n");
    assert.match(result.stderr, /integer expression expected/);
  } finally { await shell.dispose(); }
});

test("numeric conditions respect custom predicate commands", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxLoopIterations: 100 } });
  for (const command of basicCommands()) shell.commands.register(command);
  shell.commands.register({ name: "[", execute: () => ({ exitCode: 1 }) });
  try {
    const result = await shell.exec('j=0; while [ "$j" -lt 4 ]; do ((j+=1)); done; echo "$j"');
    assert.equal(result.stdout, "0\n");
  } finally { await shell.dispose(); }
});
