import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

for (const [name, script, stdout] of [
  ["disable, discover, restore and list", "enable -n test; echo $?; type -t test; enable test; type -t test; enable | head -2", "0\nfile\nbuiltin\nenable .\nenable :\n"],
  ["list disabled builtins", "enable -n test echo; enable -n; enable test; enable -n", "enable -n echo\nenable -n test\nenable -n echo\n"],
  ["list all builtin states", "enable -n test; enable -a | grep ' test$'; enable test; enable -a | grep ' test$'", "enable -n test\nenable test\n"],
  ["disabled builtin-only commands fail", "enable -n cd; cd / 2>/dev/null; echo $?; enable cd; cd /; echo $?", "127\n0\n"],
  ["builtin cannot bypass disabling", "enable -n test; builtin test x 2>/dev/null; echo $?; enable test; builtin test x; echo $?", "1\n0\n"],
  ["subshell changes stay local", "enable -n test; (enable test; type -t test); type -t test; enable test; (enable -n test); type -t test", "builtin\nfile\nbuiltin\n"],
  ["new interpreter enables builtins", "enable -n test; bash -c 'type -t test'; type -t test", "builtin\nfile\n"],
  ["disabled builtins honor PATH", "enable -n test echo true; PATH=/missing; test x 2>/dev/null; printf '%s\\n' $?; echo x 2>/dev/null; printf '%s\\n' $?; true 2>/dev/null; printf '%s\\n' $?", "127\n127\n127\n"],
  ["disabled builtin discovery resolves paths", "enable -n test; type -t test; type -p test; command -v test; command test x; echo $?", "file\n/bin/test\n/bin/test\n0\n"],
  ["functions retain precedence", "test() { echo function; }; enable -n test; test; command test x; echo $?; enable test; test", "function\n0\nfunction\n"],
  ["invalid names and options fail", "enable missing 2>/dev/null; echo $?; enable -z 2>/dev/null; echo $?; enable -- test; echo $?", "1\n2\n0\n"],
  ["command substitution and pipeline changes stay local", "enable -n test; echo \"$(enable test; type -t test)\"; type -t test; enable test | cat; type -t test", "builtin\nfile\nfile\n"],
  ["loop and substitution shortcuts honor disabling", "enable -n echo; PATH=/missing; for n in 1 2; do echo bad 2>/dev/null; printf '%s\\n' $?; done; value=$(echo bad 2>/dev/null); printf '%s:%s\\n' $? \"$value\"", "127\n127\n127:\n"],
  ["disable enable itself", "enable -n enable; enable test 2>/dev/null; echo $?; builtin enable test 2>/dev/null; echo $?", "127\n1\n"],
] as const) {
  test(`enable: ${name}`, async context => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(script);
    assert.equal(result.stdout, stdout, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

test("enable: external PATH files take precedence over virtual commands", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/test", new TextEncoder().encode("#!/bin/sh\necho external"), { mode: 0o755 });
  const shell = new Shell({ fs, env: { PATH: "/work:/bin" } }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("enable -n test; test x; enable test; test x; echo $?");
  assert.equal(result.stdout, "external\n0\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("enable: session state persists without affecting other sessions", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const session = shell.createSession();
  assert.equal((await session.exec("enable -n test")).exitCode, 0);
  assert.equal((await session.exec("type -t test")).stdout, "file\n");
  assert.equal((await shell.exec("type -t test")).stdout, "builtin\n");
  assert.equal((await session.exec("enable test; type -t test")).stdout, "builtin\n");
});

test("enable: extension builtins can be disabled and restored", async context => {
  let calls = 0;
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [{ name: "sample",
    create: () => ({ builtins: [{ name: "sample", execute() { calls++; return 0; } }] }),
  }] }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("sample; enable -n sample; sample 2>/dev/null; echo $?; enable sample; sample");
  assert.equal(result.stdout, "127\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(calls, 2);
});
