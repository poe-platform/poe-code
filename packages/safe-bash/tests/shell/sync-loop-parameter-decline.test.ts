import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

const cases = [
  ['POSIX class trim', 's=abc123def; sub="[[:digit:]]"', '${s#*$sub}'],
  ['escaped trim', 's=a:b:c; sub="\\:"', '${s#*$sub}'],
  ['prefix trim', 's=123abc; sub="[[:digit:]]"', '${s#$sub}'],
  ['suffix trim', 's=abc123def; sub="[[:digit:]]"', '${s%$sub*}'],
  ['longest prefix trim', 's=abc123def; sub="[[:digit:]]"', '${s##*$sub}'],
  ['longest suffix trim', 's=abc123def; sub="[[:digit:]]"', '${s%%$sub*}'],
  ['glob replacement', 's=abc123def; sub="*123*"; rep=X', '${s/$sub/$rep}'],
  ['empty replacement pattern', 's=abc123def; sub=""; rep=X', '${s/$sub/$rep}'],
  ['ampersand replacement', 's=abc123def; sub=123; rep="&"', '${s//$sub/$rep}'],
  ['escaped replacement', 's=abc123def; sub=123; rep="\\X"', '${s/$sub/$rep}'],
  ['tilde replacement', 's=abc123def; sub=123; rep="~X"', '${s/$sub/$rep}'],
  ['arithmetic substring offset', 's=abcdefghij', '${s:i*2+1:2}'],
  ['arithmetic substring length', 's=abcdefghij', '${s:1:i*2+1}'],
  ['changing pattern', 's=abc123def; sub=123; rep=X', '${s/$sub/$rep}', 'sub="*123*"'],
] as const;

for (const loop of ['for i in 0 1 2', 'for ((i=0;i<3;i++))', 'i=0; while ((i<3))']) {
  for (const [name, initialization, expansion, update] of cases) {
    for (const assign of [false, true]) {
      test(`${loop}: ${name} in ${assign ? 'assignment' : 'echo'}`, async () => {
        const value = assign ? `out="${expansion}"; echo "out=$out"` : `echo "${expansion}"`;
        const script = `${initialization}; count=0; ${loop}; do echo before; ${value}; ((count++)); ${update ?? ':'}; ${loop.includes('while') ? '((i++))' : ':'}; done; echo "count=$count"`;
        const native = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', script], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } });
        assert.ifError(native.error);
        const { shell, commands } = setup({ env: { LC_ALL: 'C' } });
        for (const command of basicCommands()) commands.register(command);
        try {
          const result = await shell.exec(script);
          assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode },
            // macOS Bash 3 predates Bash 5.2's default match substitution for &.
            name === 'ampersand replacement'
              ? { stdout: `before\n${assign ? 'out=' : ''}abc123def\n`.repeat(3) + 'count=3\n', stderr: '', exitCode: 0 }
              : { stdout: native.stdout, stderr: native.stderr, exitCode: native.status });
        } finally { await shell.dispose(); }
      });
    }
  }
}
