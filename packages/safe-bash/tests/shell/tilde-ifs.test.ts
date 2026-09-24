import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/core.js";

const env = { HOME: "/home/alice", OLDPWD: "/var/log", PATH: "/usr/bin:/bin", LC_ALL: "C" };
const cases = [
  ["default and alternate operands", "unset u; s=yes; printf '<%s>\\n' ${u-~/dir} ${u:-~/dir} ${s+~/dir} ${s:+~/dir} ${u:=~/dir}; printf '<%s>\\n' \"$u\""],
  ["assignment colons", "p=~/a:~/b:~+/c:~-/d; printf '<%s>\\n' \"$p\""],
  ["declarations", "export ex=~/a:~/b; declare dx=~/a:~/b; readonly rx=~/a:~/b; f() { local lx=~/a:~/b; printf '<%s>\\n' \"$lx\"; }; f; printf '<%s>\\n' \"$ex\" \"$dx\" \"$rx\""],
  ["working directories", "printf '<%s>\\n' ~+ ~+/sub ~- ~-/sub; unset OLDPWD; printf '<%s>\\n' ~-"],
  ["quoted prefixes", "printf '<%s>\\n' ~\"\" ~\"foo\" ~'' ~\"/foo\" ~/\"foo\" \"~\"/foo ~\\+ ~missing"],
  ["mixed IFS across parts", "IFS=' :'; x='a '; y=': b'; printf '<%s>\\n' $x$y; x=' '; y=':b'; printf '<%s>\\n' \"a\"$x$y"],
  ["IFS boundaries and literal suffixes", "IFS=' :'; x='a '; y=' b '; z=': c'; printf '<%s>\\n' $x$y$z; printf '<%s>\\n' $x\"\"$z $x/end; x='a:'; y=':b'; printf '<%s>\\n' $x$y"],
  ["protected home expansion", "HOME='/home/a b:*'; IFS=' :'; printf '<%s>\\n' ~ ${u:-~/dir}; p=~/a:~/b; printf '<%s>\\n' \"$p\""],
  ["quoted operands and assignment delimiters", "unset u; printf '<%s>\\n' \"${u:-~/dir}\" ${u:-~\"\"} ${u:-~/a:~/b}; p=~\"\":~/b; q=~/a\\:~/b; printf '<%s>\\n' \"$p\" \"$q\""],
  ["raw byte splitting", "IFS=' :'; x=$'a\\377 '; y=$': b\\376'; printf '<%s>\\n' $x$y"],
  ["empty quotes after IFS whitespace", "IFS=' :'; x='a '; z=':c'; printf '<%s>\\n' $x\"\" $x''$z $x${missing}"],
  ["raw bytes before empty quoted fields", "IFS=' :'; x=$'a\\377 '; z=$':c\\376'; printf '<%s>\\n' $x\"\"$z"],
] as const;

for (const [name, script] of cases) {
  test(`tilde and IFS: ${name}`, async context => {
    const source = `OLDPWD=/var/log; ${script}`;
    const expected = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { cwd: "/", env, timeout: 2000 });
    assert.equal(expected.error, undefined);
    assert.equal(expected.signal, null);
    assert.equal(expected.status, 0);
    const shell = new Shell({ fs: createMemoryFileSystem(), env }).use(agentCommands());
    context.after(() => shell.dispose());
    const actual = await shell.exec(source);
    assert.deepEqual({ stdout: Buffer.from(actual.stdoutBytes).toString("hex"), stderr: Buffer.from(actual.stderrBytes).toString("hex"), status: actual.exitCode },
      { stdout: expected.stdout.toString("hex"), stderr: expected.stderr.toString("hex"), status: expected.status });
  });
}
