import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/core.js";

const cases = [
  ["unset default operands", "unset x; printf '%s\\n' ${x-~/sub} ${x:-~/sub}", "/home/alice/sub\n/home/alice/sub\n"],
  ["set alternate operands", "x=1; printf '%s\\n' ${x+~/sub} ${x:+~/sub}", "/home/alice/sub\n/home/alice/sub\n"],
  ["empty parameter distinguishes colon operators", "x=; printf '<%s>\\n' ${x-~/sub} ${x:-~/sub} ${x+~/sub} ${x:+~/sub}", "</home/alice/sub>\n</home/alice/sub>\n"],
  ["assigning default operand", "unset x; printf '%s\\n' ${x:=~/sub} \"$x\"", "/home/alice/sub\n/home/alice/sub\n"],
  ["declaration assignments", "export ex=~/sub; declare dx=~/sub; readonly rx=~/sub; f() { local lx=~/sub; printf '%s\\n' \"$lx\"; }; f; printf '%s\\n' \"$ex\" \"$dx\" \"$rx\"", "/home/alice/sub\n/home/alice/sub\n/home/alice/sub\n/home/alice/sub\n"],
  ["colon separated assignment prefixes", "FOO=/a:~/sub:~/end; export PATH=/usr/bin:~/bin; printf '%s\\n' \"$FOO\" \"$PATH\"", "/a:/home/alice/sub:/home/alice/end\n/usr/bin:/home/alice/bin\n"],
  ["configured current and previous directories", "printf '%s|%s|%s|%s\\n' ~+ ~+/sub ~- ~-/sub", "/work|/work/sub|/old|/old/sub\n"],
] as const;

for (const [name, source, stdout] of cases) {
  test(`issue 892: ${name}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/work", env: { HOME: "/home/alice", OLDPWD: "/old" } }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }, { stdout, stderr: "", exitCode: 0 });
  });
}
