import assert from "node:assert/strict";
import { test } from "node:test";
import { portableRuntime } from "../helpers/portable-runtime.js";

const cases: [string, number, string?][] = [
  ['trap "echo hi" EXIT; trap -p', 0], ["read -d $'\\x80' x", 1],
  ["read -d é x <<< aé; echo \"$x\"", 0, "a\n"],
  [`echo '{"a":1}' | jq .a`, 0, "1\n"], ["echo 'a: 1' | yq .a", 0, "1\n"],
  ["echo hello | sed 's/h/H/'", 0, "Hello\n"], ["echo 'a b' | awk '{print $2}'", 0, "b\n"],
  ["echo hello | rg ell", 0, "hello\n"], ["echo a > f1; echo b > f2; diff -u f1 f2", 1],
  ["echo a > f1; stat f1", 0], ["echo a | nl", 0], ["seq 1 3", 0, "1\n2\n3\n"],
  ["printf 'a\\nb\\n' | tac", 0, "b\na\n"], ["date -u +%Y", 0], ["mkdir -p t/sub; tree t", 0],
  ["printf 'a b\\nc d\\n' | column -t", 0], ["expr 1 + 2", 0, "3\n"],
  ["printf 'a\\nb\\n' > sp; split -l 1 sp", 0], ["echo hi > f1; du f1", 1],
  ["echo hi > f1; du --apparent-size f1", 0],
  ["echo hi > f1; tar -cf a.tar f1", 0], ["echo hi > f1; zip -q a.zip f1", 0],
];
test("reported commands execute without a host Buffer or Node globals", async context => {
  const { api: core } = await portableRuntime('export * from "./packages/safe-bash/src/core.ts";');
  for (const [source, exitCode, stdout] of cases) {
    await context.test(source, async () => {
      const commands = new core.CommandRegistry();
      const shell = new core.Shell({ fs: new core.MemoryFileSystem(), commands }).use(core.agentCommands());
      for (const command of core.createYqCommands()) commands.register(command, { replace: true });
      try {
        const result = await shell.exec(source);
        assert.equal(result.exitCode, exitCode, result.stderr);
        assert.equal(result.stderr.includes("internal error"), false, result.stderr);
        if (stdout !== undefined) assert.equal(result.stdout, stdout);
      } finally { await shell.dispose(); }
    });
  }
});
