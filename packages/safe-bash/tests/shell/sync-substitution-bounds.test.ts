import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";
import { createEncodingCommands } from "../../src/commands/bytes/encoding/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases: [string, string][] = [];
for (const command of ['head -n 1', 'tail -n 1', 'cut -c 1-5', 'uniq', "sed 's/h/H/'"]) {
  const output = command.startsWith('sed') ? 'Hello' : 'hello';
  cases.push([`printf hello >/f; for i in 1 2; do echo "$(${command} /f)"; done`, `${output}\n${output}\n`]);
  cases.push([`printf 'hello\\n' >/f; for i in 1 2; do echo "$(${command} /f)"; printf hello >/f; done`, `${output}\n${output}\n`]);
}
cases.push(['printf "%9000s" "" >/f; for i in 1 2; do echo "$(cat /f | wc -c)"; done', '9000\n9000\n']);
for (const [sub, count] of [ ['echo "x$s" | wc -c', 9002], ['printf "%s" "$s" | wc -c', 9000], ['tr " " a <<< "$s" | wc -c', 9001], ['echo "x$s" | base64 | wc -c', 12162] ] as const) {
  cases.push([`s=$(printf "%9000s" ""); for i in 1 2; do echo "$(${sub})"; done`, `${count}\n${count}\n`]);
}
cases.push(['s=$(printf "%17000s" ""); for i in 1 2; do echo "$(wc -c <<< "$s")"; done', '17001\n17001\n']);
cases.push(['s=$(printf "%17000s" ""); for i in 1 2; do echo "$(tr " " a <<< "$s")"; done', `${'a'.repeat(17000)}\n${'a'.repeat(17000)}\n`]);
for (const [program, counter, expected] of [["s/b/B/p", "-c", "1"], ["s/b/B/p", "-l", "0"], ["=", "-c", "4"], ["=", "-l", "2"]]) {
  cases.push([`echo "$(printf 'a\\nb' | sed -n '${program}' | wc ${counter})"`, `${expected}\n`]);
}
cases.push(['s=$(printf "%6200s" ""); for i in 1 2; do echo "$(echo "x$s" | base64 | wc -c)"; done', '8381\n8381\n']);
cases.push(['s=x; for i in 1 2; do echo "$(echo "x$s" | wc -c)"; s=$(printf "%9000s" ""); done', '3\n9002\n']);
cases.push(['printf x >/f; for i in 1 2; do echo "$(cat /f | wc -c)"; printf "%9000s" "" >/f; done', '1\n9000\n']);
for (const [program, expected] of [['=;p', '3'], ['p;=', '4']]) {
  cases.push([`echo "$(printf a | sed -n '${program}' | wc -c)"`, `${expected}\n`]);
}
for (const [original, expected] of cases) for (const source of new Set([original, original.replace("for i in 1 2", "for ((i=1;i<=2;i++))")])) {
  test(source, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands(), ...createEncodingCommands()]) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}
