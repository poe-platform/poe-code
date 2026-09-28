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
