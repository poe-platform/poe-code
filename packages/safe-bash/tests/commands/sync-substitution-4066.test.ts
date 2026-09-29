import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

async function execute(source: string) {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/alpha", new Uint8Array());
  await fs.writeFile("/beta", new Uint8Array());
  const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()) });
  try { return await shell.exec(source); } finally { await shell.dispose(); }
}

for (const command of ["echo a $x", "basename -- $x", "dirname -- $x"]) {
  for (const value of ["", "b c", "*", "alpha"]) {
    test(`unquoted substitution in loop: ${command}, ${JSON.stringify(value)}`, async () => {
      const setup = `x='${value}'; `;
      const body = `echo "$( ${command} )"`;
      assert.deepEqual(await execute(`${setup}for i in 1 2; do ${body}; done`), await execute(`${setup}${body}; ${body}`));
    });
  }
  test(`substitution operand changes after loop admission: ${command}`, async () => {
    const body = `x=$i; echo "$( ${command} )"`;
    assert.deepEqual(await execute(`x=alpha; for i in alpha '' 'b c' '*'; do ${body}; done`), await execute(`i=alpha; ${body}; i=''; ${body}; i='b c'; ${body}; i='*'; ${body}`));
  });
}

for (const [command, stdout] of [
  ["basename /foo/bar-a -a", "bar\n"],
  ["basename /foo/bar-sfoo -sfoo", "bar\n"],
  ["basename /foo/bar-x -x", "bar\n"],
  ["basename -a /foo/bar-a -a", "bar-a\n-a\n"],
  ["dirname /foo/bar -z", "/foo\n.\n"],
  ["basename -- /foo/bar-a -a", "bar\n"],
] as const) {
  for (const source of [command, `${command} > out; cat out`, `echo "$(${command})"`, `for i in 1 2; do echo "$(${command})"; done`]) {
    test(`pathname options stop at operand: ${source}`, async () => {
      const result = await execute(source);
      assert.equal(result.stdout, source.startsWith("for ") ? stdout + stdout : stdout);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
}
