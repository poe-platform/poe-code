import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const bodies = [
  'echo "keep_$i" >/dev/null; (( x = i + 1 ))',
  'echo "keep_$i"; (( x = i + 1 ))',
  'echo "keep_$i" >/dev/null; if [[ $i == 2 ]]; then case $i in 99) : ;; esac; fi',
  'echo "keep_$i" >/dev/null; case $i in 2) if [[ $i == 99 ]]; then true; fi ;; esac',
  'echo "keep_$i" >/dev/null; [[ $i == 2 ]]',
  'echo "keep_$i" >/dev/null; [ "$i" = 2 ]',
  'echo "keep_$i" >/dev/null; case $i in 99) echo never ;; esac',
  'echo "keep_$i" >/dev/null; if [[ $i == 99 ]]; then echo never; fi',
  'echo "keep_$i" >/dev/null; if (( 0 )); then echo never; fi',
  'echo "keep_$i" >/dev/null; if [ "$i" = 99 ]; then echo never; fi',
  'if [[ $i == 2 ]]; then echo hello >/dev/null; :; fi',
  'if [[ $i == 2 ]]; then echo hello >/dev/null; true; fi',
  'case $i in 2) echo hello >/dev/null; : ;; esac',
  '(( x = i + 1 ))',
  '[[ $i == 2 ]]',
  'case $i in 99) : ;; esac',
  'if (( 0 )); then true; fi',
  'case $i in 2) echo hello >/dev/null; true ;; esac',
  'echo "keep_$i" >/dev/null; if [[ $i == 2 ]]; then (( 1 )); fi',
  'echo "keep_$i" >/dev/null; case $i in 2) [[ $i == 2 ]] ;; esac',
  'echo "keep_$i" >/dev/null; if [ "$i" = 2 ]; then (( 1 )); fi',
  'echo "keep_$i" >/dev/null; if [[ $i == 99 ]]; then :; elif [ "$i" = 99 ]; then true; fi',
];
for (const header of ['for i in 1 2', 'for ((i=1;i<=2;i++))']) {
  for (const body of bodies) test(`${header}: ${body}`, async () => {
    const source = `echo seed >/dev/null; ${header}; do ${body}; done; printf '[%s]\\n' "$_"`;
    const oracle = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', source], { encoding: 'utf8' });
    assert.equal(oracle.status, 0);
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.stderr, oracle.stderr);
      assert.equal(result.exitCode, oracle.status);
      assert.equal(result.stdout, oracle.stdout);
    } finally { await shell.dispose(); }
  });
}

const issue3957Bodies = [
  '((i == 0)) && echo "redir_$i" >/f',
  '((i == 0)) && { echo "redir_$i" >/f; }',
  'echo "$v" >/f; ((v++))',
  'echo first >/f; echo "$v" >/f; ((v++))',
  'echo "before_$i" >/f; for y in "${empty[@]}"; do echo never; done',
  'echo "before_$i" >/f; for ((j=0;j<0;j++)); do echo never; done',
  'echo "before_$i" >/f; while [[ $i -lt 0 ]]; do echo never; done',
  'echo "before_$i" >/f; until (( 1 )); do echo never; done',
  'echo "before_$i" >/f; while [ "$i" -lt 0 ]; do echo never; done',
  'echo "before_$i" >/f; until [ "$i" -ge 0 ]; do echo never; done',
  'j=0; while [ "$j" -lt 2 ]; do echo "body_$j" >/f; ((j++)); done',
  'j=0; until [ "$j" -ge 2 ]; do echo "body_$j" >/f; ((j++)); done',
  'j="run"; while [ "$j" != "done" ]; do echo "body_$j" >/f; j="done"; done',
  'j="run"; until [ "$j" = "done" ]; do echo "body_$j" >/f; j="done"; done',
  'echo "before_$i" >/f; while [ "$i" = "never" ]; do echo never; done',
  'echo "before_$i" >/f; until [ "$i" != "never" ]; do echo never; done',
];
for (const header of ['for i in 0 1', 'for ((i=0;i<2;i++))']) {
  for (const body of issue3957Bodies) test(`3957 ${header}: ${body}`, async () => {
    const source = `v=0; empty=(); echo seed >/f; ${header}; do ${body}; done; printf '[%s]\\n' "$_"`;
    const oracle = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', source.replaceAll('>/f', '>/dev/null')], { encoding: 'utf8' });
    assert.equal(oracle.status, 0);
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.stderr, oracle.stderr);
      assert.equal(result.exitCode, oracle.status);
      assert.equal(result.stdout, oracle.stdout);
    } finally { await shell.dispose(); }
  });
}
for (const header of ['while [ "$j" -lt 2 ]', 'until [ "$j" -ge 2 ]', 'while [ "$j" -lt 0 ]', 'until [ "$j" -ge 0 ]']) {
  test(`3957 outer ${header}`, async () => {
    const source = `j=0; echo seed >/f; ${header}; do echo "body_$j" >/f; ((j++)); done; printf '[%s]\\n' "$_"`;
    const oracle = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', source.replaceAll('>/f', '>/dev/null')], { encoding: 'utf8' });
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.stderr, oracle.stderr);
      assert.equal(result.exitCode, oracle.status);
      assert.equal(result.stdout, oracle.stdout);
    } finally { await shell.dispose(); }
  });
}

test('3957 outer string bracket condition', async () => {
  const source = 'j="run"; while [ "$j" != "done" ]; do echo "body_$j" >/f; j="done"; done; printf "[%s]\\n" "$_"';
  const oracle = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', source.replaceAll('>/f', '>/dev/null')], { encoding: 'utf8' });
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, oracle.stderr);
    assert.equal(result.exitCode, oracle.status);
    assert.equal(result.stdout, oracle.stdout);
  } finally { await shell.dispose(); }
});
