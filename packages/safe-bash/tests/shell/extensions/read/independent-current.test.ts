import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { Shell } from "../../../../src/shell/shell.js";

function createShell() {
  const shell = new Shell({
    fs: createMemoryFileSystem(),
    extensions: [arraysExtension(), readExtension()],
    limits: { maxWallClockMs: 2000, maxOutputBytes: 65536 },
  });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

const arrayCases = [
  {
    name: "negative hex-looking count preserves the signed decimal diagnostic",
    args: "-n '-0x0' -a values",
    input: "abc def\nTAIL\n",
    stdout: "s=1;a=<OLD>;a=<KEEP>;tail=0:<abc def>",
    stderr: "shell: line 1: read: -0x0: invalid number\n",
  },
  {
    name: "positive hex-looking count preserves the signed decimal diagnostic",
    args: "-n '+0X2' -a values",
    input: "abc def\nTAIL\n",
    stdout: "s=1;a=<OLD>;a=<KEEP>;tail=0:<abc def>",
    stderr: "shell: line 1: read: +0X2: invalid number\n",
  },
  {
    name: "negative decimal zero clears the array without consuming input",
    args: "-n '-000' -a values",
    input: "abc def\nTAIL\n",
    stdout: "s=0;a=<>;tail=0:<abc def>",
    stderr: "",
  },
  {
    name: "invalid five-digit timeout suffix preserves array and retained input",
    args: "-t '1.12345x' -a values",
    input: "abc def\nTAIL\n",
    stdout: "s=1;a=<OLD>;a=<KEEP>;tail=0:<abc def>",
    stderr: "shell: line 1: read: 1.12345x: invalid timeout specification\n",
  },
  {
    name: "accepted six-digit timeout suffix assigns array and retains next record",
    args: "-t '1.123456x' -a values",
    input: "abc def\nTAIL\n",
    stdout: "s=0;a=<abc>;a=<def>;tail=0:<TAIL>",
    stderr: "",
  },
  {
    name: "exact count excludes NUL and retains the remaining record",
    args: "-N2 -a values",
    input: "a\0bc\nT\n",
    stdout: "s=0;a=<ab>;tail=0:<c>",
    stderr: "",
  },
  {
    name: "array target also named as scalar does not cause a second assignment",
    args: "-a values values",
    input: "one two\nTAIL\n",
    stdout: "s=0;a=<one>;a=<two>;tail=0:<TAIL>",
    stderr: "",
  },
] as const;

for (const entry of arrayCases) test(`independent read: ${entry.name}`, async context => {
  const shell = createShell();
  context.after(() => shell.dispose());
  const source = `values=(OLD KEEP);  read ${entry.args}; status=$?; printf 's=%s;' "$status"; printf 'a=<%s>;' "\${values[@]}";  IFS= read -r tail; printf 'tail=%s:<%s>' "$?" "$tail"`;
  const result = await shell.exec(source, { stdin: entry.input, env: { LC_ALL: "C" } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(entry.stdout));
  assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(entry.stderr));
});

const pipeCases = [
  { args: "-u3 -n0 value", stderr: "s=1;v=<>;a=<OLD>;a=<KEEP>;" },
  { args: "-u3 -t1 -n0 -a values", stderr: "s=1;v=<OLD>;a=<>;" },
  { args: "-u3 -N0 value", stderr: "s=1;v=<>;a=<OLD>;a=<KEEP>;" },
  { args: "-u3 -t0 -n0 value", stderr: "s=1;v=<OLD>;a=<OLD>;a=<KEEP>;" },
] as const;

for (const entry of pipeCases) test(`independent read: actual pipe write end ${entry.args}`, async context => {
  const shell = createShell();
  context.after(() => shell.dispose());
  const source = `sink() { local chunk; while IFS= read -r chunk; do :; done; }; { value=OLD; values=(OLD KEEP); read ${entry.args} 3>&1; status=$?; printf 's=%s;v=<%s>;' "$status" "$value" >&2; printf 'a=<%s>;' "\${values[@]}" >&2; } | sink`;
  const result = await shell.exec(source, { env: { LC_ALL: "C" } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.alloc(0));
  assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(entry.stderr));
});
