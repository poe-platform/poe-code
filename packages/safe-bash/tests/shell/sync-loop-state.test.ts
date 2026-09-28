import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { basicCommands } from "../../src/commands/basic.js";

const cases = [
  ['getopts diagnostics', 'OPTERR=0; run_opts() { local OPTIND=1 opt; while getopts "ab:" opt "$@"; do total=$((total+1)); done; }; total=0; for ((i=0;i<3;i++)); do if ((i==2)); then run_opts -a -x; else run_opts -a -b val; fi; done; echo "total=$total"', 'total=6\n'],
  ['getopts missing argument', 'OPTERR=0; total=0; f() { local OPTIND=1 opt; while getopts "ab:" opt "$@"; do total=$((total+1)); done; }; for ((i=0;i<3;i++)); do if ((i==2)); then f -a -b; else f -a -b val; fi; done; echo "$total"', '6\n'],
  ['getopts slice', 'set -- -x -a; getopts ":ab" opt "${@:2}"; echo "opt=$opt OPTARG=$OPTARG"', 'opt=a OPTARG=\n'],
  ['local array', 'arr=initial; f() { local -a arr=(x y); }; for ((i=0;i<2;i++)); do arr="iter_$i"; f; echo "$arr"; done', 'iter_0\niter_1\n'],
  ['exported local', 'OPTERR=0; export x=outer; f() { local x=inner; if ((i==1)); then getopts a opt -z; fi; }; for ((i=0;i<2;i++)); do f; done; declare -p x', 'declare -x x="outer"\n'],
  ['mapfile later scalar', 'total=0; for ((i=0;i<3;i++)); do total=$((total+1)); if ((i==2)); then unset arr; arr=scalar; fi; mapfile -t arr <<< "$i"; done; echo "$total:${arr[0]}"', '3:2\n'],
  ['mapfile scalar', 'arr=scalar; total=0; for ((i=0;i<3;i++)); do total=$((total+1)); mapfile -t arr <<< "$i"; done; echo "$total:${arr[0]}"', '3:2\n'],
  ['mapfile growing input', 'text=x; total=0; for ((i=0;i<3;i++)); do total=$((total+1)); if ((i==2)); then for ((j=0;j<300;j++)); do text+=$\'\\n\'x; done; fi; mapfile -t arr <<< "$text"; done; echo "$total:${#arr[@]}"', '3:301\n'],
] as const;
for (const [name, source, expected] of cases) {
  test(`sync loops preserve ${name}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
    } finally { await shell.dispose(); }
  });
}

for (const expansion of ["${@:2}", "${@#prefix}", "${@/a/b}", "${#@}", "$@", "${@}"]) {
  test(`getopts expands ${expansion} like Bash`, async () => {
    const source = `set -- -x -a; getopts ":ab" opt "${expansion}"; echo "$?:$opt:$OPTARG:$OPTIND"`;
    const expected = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.stdout, expected.stdout);
      assert.equal(result.stderr, expected.stderr);
      assert.equal(result.exitCode, expected.status);
    } finally { await shell.dispose(); }
  });
}
for (const loop of [
  'for ((i=0;i<3;i++)); do BODY; done',
  'for i in 0 1 2; do BODY; done',
  'i=0; while ((i<3)); do BODY; ((i++)); done',
  'i=0; until ((i>=3)); do BODY; ((i++)); done',
]) {
  test(`local state survives ${loop.split(";")[0]}`, async () => {
    const source = 'arr=initial; export x=outer; f() { local -a arr=(x y); local x=inner; }; ' + loop.replace('BODY', 'arr="iter_$i"; f; echo "$arr"') + '; declare -p x';
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, 'iter_0\niter_1\niter_2\ndeclare -x x="outer"\n');
    } finally { await shell.dispose(); }
  });
}

test("getopts respects quoted positional transformation", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
  try {
    const result = await shell.exec('set -- -x -a; getopts ":ab" opt "${@@Q}"; echo "$?:$opt:$OPTARG:$OPTIND"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "1:?::1\n");
  } finally { await shell.dispose(); }
});
