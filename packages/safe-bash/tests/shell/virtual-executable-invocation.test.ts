import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { standardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { whichCommands } from "../../src/commands/which/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { workerRuntimeContexts } from "../../src/worker/runtime-context.js";

for (const middleware of [false, true]) {
  for (const command of [":", "cd", "absent"]) {
    test(`exec rejects missing executables instead of running ${command}, middleware=${middleware}`, async () => {
      const shell = new Shell({ fs: createMemoryFileSystem() }).use(standardCommands());
      if (middleware) shell.use((_context, next) => next());
      try {
        const result = await shell.exec(`PATH=.; exec ${command}; echo unreachable`);
        assert.equal(result.exitCode, 127);
        assert.equal(result.stdout, "");
        assert.ok(result.stderr.includes(`${command}: command not found`), result.stderr);
      } finally { await shell.dispose(); }
    });
  }

  for (const command of [":", "cd", "f"]) {
    for (const redirect of [false, true]) {
      test(`exec runs executable ${command} on PATH, redirect=${redirect}, middleware=${middleware}`, async () => {
        const fs = createMemoryFileSystem();
        await fs.writeFile(`/${command}`, new TextEncoder().encode('#!/bin/sh\necho external:$1\n'), { mode: 0o755 });
        const shell = new Shell({ fs }).use(standardCommands());
        if (middleware) shell.use((_context, next) => next());
        try {
          const result = await shell.exec(`f() { echo function; }; export -f f; PATH=.; exec ${command} arg${redirect ? " >/output" : ""}; echo unreachable`);
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stderr, "");
          assert.equal(result.stdout, redirect ? "" : "external:arg\n");
          if (redirect) assert.equal(new TextDecoder().decode(await fs.readFile("/output")), "external:arg\n");
        } finally { await shell.dispose(); }
      });
    }
  }
}

test("virtual executable directory spellings cannot invoke commands", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
  for (const path of ["/bin/sh/", "/bin/sh/.", "/usr/bin/sh/..", "bin/sh/"]) {
    const result = await shell.exec(`${path} -c 'echo must-not-run'`);
    assert.notEqual(result.exitCode, 0, path);
    assert.equal(result.stdout, "", path);
  }
});

test("absolute interpreter paths retain the original zeroth argument", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
  assert.equal((await shell.exec("/bin/sh -c 'echo \"$0\"'")).stdout, "/bin/sh\n");
});

test("path invocation retains invocation-owned worker state and argument identity", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxCommands: 100 } });
  let invoked = false;
  shell.commands.register({ name: "context-probe", execute(context) {
    invoked = true;
    const state = workerRuntimeContexts.get(context);
    assert.ok(state);
    assert.equal(state.umask, 0o077);
    assert.equal(state.budget.limits.maxCommands, 100);
    assert.ok(state.ignoredSignals.includes(2));
    assert.equal(context.command, "context-probe");
    assert.equal(context.argv0, "/bin/context-probe");
    assert.deepEqual(context.args, ["argument"]);
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec("umask 077; trap '' INT; /bin/context-probe argument")).exitCode, 0);
  assert.equal(invoked, true);
});

test("middleware preserves the child shell's executable search state", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(whichCommands())
    .use((_context, next) => next());
  shell.commands.register({ name: "tool", execute: () => ({ exitCode: 0 }) });
  const result = await shell.exec("sh -c 'unset PATH; which tool'");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
});

test("which respects shell PATH assignments when PATH is not exported", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(whichCommands());
  shell.commands.register({ name: "tool", execute: () => ({ exitCode: 0 }) });
  assert.equal((await shell.exec("PATH=/usr/bin; which tool")).stdout, "/usr/bin/tool\n");
  assert.equal((await shell.exec("PATH=/tools; which tool")).exitCode, 1);
  assert.equal((await shell.exec("unset PATH; PATH=/usr/bin; which tool")).stdout, "/usr/bin/tool\n");
});
