import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { textCommands } from "../../src/commands/text.js";
import { basicCommands } from "../../src/commands/basic.js";
import { streamCommands } from "../../src/commands/streams.js";

for (const match of [
  '[[ $s == "$pfx"* ]]',
  '[[ $s == a\\** ]]',
  'case $s in "$pfx"*) true ;; *) false ;; esac',
]) {
  test(`escaped star followed by wildcard: ${match}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() });
    for (const command of basicCommands()) shell.commands.register(command);
    try {
      const result = await shell.exec(`pfx='a*'; s='a*hello'; if ${match}; then echo MATCH; else echo MISS; fi`);
      assert.equal(result.stdout, "MATCH\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

const bodies = [
  ['x="1+2"; (( x += 1 ))', 'x:4'],
  ['shift; (( x += $1 ))', 'x:6'],
  ['x=$(printf "hello world\\n" | wc -w)', 'x:2'],
  ['x=$(printf "hello\\n" | cut -c 1-3)', 'x:hel'],
  ['flag=-w; x=$(printf "hello world\\n" | wc "$flag")', 'x:2'],
  ['fmt=%b; x=$(printf "$fmt" hi)', 'x:hi'],
  ['x=$(echo hi)', 'x:hi'],
] as const;

test("arithmetic expansion fault does not replay earlier effects", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec('c=0; x=0; { c=$((c+1)); echo "step:$c"; x="1/0"; y=$((x+1)); }; echo final:$c');
    assert.equal(result.stdout, "step:1\n");
    assert.match(result.stderr, /division by 0/);
    assert.equal(result.exitCode, 1);
  } finally { await shell.dispose(); }
});
for (const [body, expected] of bodies) {
  for (const wrap of [
    (s: string) => `{ ${s}; }`,
    (s: string) => `if true; then ${s}; fi`,
    (s: string) => `case yes in yes) ${s} ;; esac`,
    (s: string) => `f() { ${s}; }; f 10 '1+2+3'`,
  ]) {
    for (const counter of ['c=$((c+1))', 'c="${c}1"']) {
      const command = `set -- 10 '1+2+3'; c=0; x=0; ${wrap(`${counter}; echo "step:$c"; ${body}`)}; echo "x:$x final:$c"`;
      const count = counter.includes('$((') ? '1' : '01';
      test(`compound executes once: ${command}`, async () => {
        const shell = new Shell({ fs: createMemoryFileSystem() });
        for (const command of basicCommands()) shell.commands.register(command);
        for (const command of textCommands()) shell.commands.register(command, { replace: true });
        for (const command of streamCommands()) shell.commands.register(command, { replace: true });
        try {
          const result = await shell.exec(command);
          assert.equal(result.stdout, `step:${count}\n${expected} final:${count}\n`);
          assert.equal(result.stderr, "");
          assert.equal(result.exitCode, 0);
        } finally { await shell.dispose(); }
      });
    }
  }
}
