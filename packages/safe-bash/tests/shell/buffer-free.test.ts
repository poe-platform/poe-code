import assert from "node:assert/strict";
import { test } from "node:test";
import { portableRuntime } from "../helpers/portable-runtime.js";

const cases: [string, number, string?][] = [
  ["printf 'b:a\\n%.0s' {1..128} > /in.txt; for i in 1 2; do cat /in.txt | tr a c | cut -d: -f2 | sort; done", 0, 'c\n'.repeat(256)],
  ['arr=(1 2); echo "${arr[0]}"', 0, '1\n'],
  ['echo pre{1..3}suf', 0, 'pre1suf pre2suf pre3suf\n'],
  ['value="préfixe"; echo "${value#pré}" "${value%ixe}"', 0, 'fixe préf\n'],
  ['FOO=bar printenv FOO', 0, 'bar\n'],
  ['env -i FOO=bar printenv FOO', 0, 'bar\n'],
  ['[[ a < b ]]', 0, ''],
  ["printf 'hello world\\n%.0s' {1..32} > /in.txt; grep hello /in.txt; grep hello /in.txt", 0, 'hello world\n'.repeat(64)],
  ["printf 'hello world\\n%.0s' {1..32} > /in.txt; cut -d ' ' -f1 /in.txt", 0, 'hello\n'.repeat(32)],
  ["echo hello > /in.txt; rg --json hello /in.txt", 0],
  ['for i in {1..4}; do echo "val:$i"; done', 0, 'val:1\nval:2\nval:3\nval:4\n'],
  ['for ((i=0;i<2;i++)); do v="café"; echo "x_${v#c}"; done', 0, 'x_afé\nx_afé\n'],
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
for (const removeBuffer of [false, true]) test(`reported commands execute without Node globals (remove portable global Buffer: ${removeBuffer})`, async context => {
  const { api: core } = await portableRuntime('export * from "./packages/safe-bash/src/core.ts";', { removeBuffer });
  for (const [source, exitCode, stdout] of cases) {
    await context.test(source, async () => {
      const commands = new core.CommandRegistry();
      const shell = new core.Shell({ fs: new core.MemoryFileSystem(), commands }).use(core.agentCommands());
      try {
        const result = await shell.exec(source);
        assert.equal(result.exitCode, exitCode, result.stderr);
        assert.equal(result.stderr.includes("internal error"), false, result.stderr);
        if (stdout !== undefined) assert.equal(result.stdout, stdout);
        if (source.includes('rg --json')) {
          const events = result.stdout.trim().split('\n').map(line => JSON.parse(line));
          assert.deepEqual(events.map(event => event.type), ['begin', 'match', 'end', 'summary']);
          assert.equal(events[1].data.path.text, '/in.txt');
          assert.equal(events[1].data.lines.text, 'hello\n');
        }
      } finally { await shell.dispose(); }
    });
  }
});
