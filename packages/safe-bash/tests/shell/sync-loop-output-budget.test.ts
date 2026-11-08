import "../../src/shell/sync-extra-evaluators.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/shell/sync-extra-evaluators.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";

const loops = [
  (body: string) => `for ((i=0;i<3;i++)); do ${body}; done`,
  (body: string) => `for ((i=0;i<6;i+=2)); do ${body}; done`,
  (body: string) => `for i in 1 2 3; do ${body}; done`,
];

function fixture() {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs });
  for (const command of basicCommands()) shell.commands.register(command);
  return { shell, fs };
}

for (const [index, loop] of loops.entries()) {
  for (const command of ['echo "hello world"', 'printf "%s\\n" "hello world"']) {
    for (const redirect of [">", ">>"]) {
      test(`loop ${index} bounds ${command} ${redirect} before writing`, async t => {
        const { shell, fs } = fixture();
        t.after(() => shell.dispose());
        await assert.rejects(shell.exec(loop(`${command} ${redirect} /out`), { limits: { maxOutputBytes: 20 } }),
          error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
        assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "hello world\n");
      });
    }
  }
  for (const [body, bytes] of [
    ['echo "hello world" > /dev/null', 36],
    ['echo "é😀" > /dev/null', 21],
    ['dirname "é/a" > /dev/null', 9],
    ['basename "/é😀" > /dev/null', 21],
    ['basename "/é😀.txt" .txt > /dev/null', 21],
    ['basename -s .txt "/é😀.txt" > /dev/null', 21],
    ['msg="é😀"; echo "prefix$msg" > /dev/null', 39],
    ['msg="é😀"; echo "$msg" > /dev/null', 21],
    ['dirname "//a" > /dev/null', 6],
    ['pwd > /dev/null', 6],
  ] as const) {
    test(`loop ${index} charges exact discarded bytes: ${body}`, async t => {
      const { shell } = fixture();
      t.after(() => shell.dispose());
      await assert.rejects(shell.exec(loop(body), { limits: { maxOutputBytes: bytes - 1 } }),
        error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
      assert.equal((await shell.exec(loop(body), { limits: { maxOutputBytes: bytes } })).exitCode, 0);
    });
  }
  for (const [command, flag] of [['dirname', '--invalid'], ['basename', '--invalid'], ['echo', '-n'], ['echo', '-e'], ['echo', '-E']] as const) {
    test(`loop ${index} preserves expanded ${command} option ${flag}`, async t => {
      const { shell } = fixture();
      t.after(() => shell.dispose());
      const direct = await shell.exec(`flag="${flag}"; ${command} "$flag" > /dev/null`);
      const actual = await shell.exec(`flag="${flag}"; ${loop(`${command} "$flag" > /dev/null`)}`);
      assert.equal(actual.exitCode, direct.exitCode);
      assert.equal(actual.stderr, direct.stderr.repeat(3));
      const bounded = await shell.exec(`flag="${flag}"; ${loop(`${command} "$flag" > /dev/null`)}`, { limits: { maxOutputBytes: 1000 } });
      assert.equal(bounded.exitCode, direct.exitCode);
      if (command === "echo") {
        assert.equal((await shell.exec(`flag="${flag}"; ${loop(`${command} "$flag" > /dev/null`)}`, { limits: { maxOutputBytes: flag === "-n" ? 0 : 3 } })).exitCode, 0);
      }
    });
  }
}
