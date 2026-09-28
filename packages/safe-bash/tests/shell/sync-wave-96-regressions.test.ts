import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { basicCommands } from "../../src/commands/basic.js";

for (const [name, source, expected] of [
  ["Unicode positional read and length", 'set -- "😀x"; for ((i=0;i<10;i++)); do read -r -n 2 a <<< "$1"; read -r -N 1 b <<< "$1"; s="$1"; len="${#s}"; done; printf "%s|%s|%s|%s\\n" "$a" "$b" "${#a}" "$len"', "😀x|😀|2|2\n"],
  ["Unicode nonzero array element", 'arr=([2]="😀x"); for ((i=0;i<10;i++)); do read -r -N 1 a <<< "${arr[2]}"; s="${arr[2]}"; len="${#s}"; done; printf "%s|%s\\n" "$a" "$len"', "😀|2\n"],
  ["sparse duplicate-index replacement", 'arr=([1]=STALE_ONE [2]=old_two); arr=([0]=x [2]=y [2]=z); printf "%s|%s\\n" "${!arr[*]}" "${arr[*]}"', "0 2|x z\n"],
  ["sparse replacement in loop", 'arr=([1]=STALE_ONE [2]=old_two); for ((i=0;i<10;i++)); do arr=([0]=x [2]=y [2]=z); done; printf "%s|%s\\n" "${!arr[*]}" "${arr[*]}"', "0 2|x z\n"],
  ...["-N 5 -n 2", "-N5 -n2", "-n 2 -N 3", "-n2 -N3"].flatMap(options => [false, true].map(loop => [
    `read option order ${options}, loop=${loop}`,
    `s=$'a\\nb'; ${loop ? 'for ((i=0;i<10;i++)); do' : ''} read -r ${options} a <<< "$s"; ${loop ? 'done;' : ''} printf '<%s>\\n' "$a"`,
    options.startsWith("-N") ? "<a\n>\n" : "<a\nb>\n",
  ])),
  ...[false, true].map(loop => [
    `associative tilde keys, loop=${loop}`,
    `HOME=/tmp/home; declare -A map; ${loop ? 'for ((i=0;i<10;i++)); do' : ''} map=([~]=1 [~/sub]=2); ${loop ? 'done;' : ''} printf '%s|%s|%s\\n' "\${map[/tmp/home]}" "\${map[/tmp/home/sub]}" "\${#map[@]}"`,
    "1|2|2\n",
  ]),
] as const) {
  test(name!, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(source!);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
    } finally { await shell.dispose(); }
  });
}
