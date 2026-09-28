import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

async function execute(source: string) {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands()]) });
  try { return await shell.exec(source); } finally { await shell.dispose(); }
}

for (const command of ["echo $'\\xc3\\xa9' | cut -b 1", "cut -b 1 <<< $'\\xc3\\xa9'", "cut -b 1 <<< \"$i\""]) {
  for (const body of [`echo "a$(${command})"`, `x+=$(${command})`, `x=$(${command})`]) {
    test(`non-ASCII cut substitution: ${body}`, async () => {
      const result = await execute(`x=prev; for i in é é; do ${body}; done; printf '<%s>\\n' "$x"`);
      const reference = await execute(`x=prev; i=é; ${body}; ${body}; printf '<%s>\\n' "$x"`);
      assert.deepEqual(result, reference);
    });
  }
}
for (const command of ["dirname ~", "basename ~", "dirname ~/foo", "basename ~/foo"]) {
  for (const body of [`echo "a$(${command})"`, `x+=$(${command})`, `x=$(${command})`]) {
    test(`tilde option substitution: ${body}`, async () => {
      const tail = '; printf "status=%s x=<%s>\\n" "$?" "${x-UNSET}"';
      const result = await execute(`HOME=-a; for i in 1 2; do ${body}; done${tail}`);
      const reference = await execute(`HOME=-a; ${body}; ${body}${tail}`);
      assert.deepEqual(result, reference);
    });
  }
}
for (const args of ["-a foo.txt -s .txt bar.txt", "foo.txt -s .txt bar.txt", "-a foo.txt -- -s .txt"]) {
  test(`basename options after operands: ${args}`, async () => {
    const reference = await execute(`basename ${args}`);
    for (const source of [`x=$(basename ${args}); echo "$x"`, `for i in 1 2; do x=$(basename ${args}); done; echo "$x"`]) {
      assert.deepEqual(await execute(source), reference);
    }
  });
}

test("basename suffix option after operand produces stripped paths", async () => {
  const result = await execute('x=$(basename -a foo.txt -s .txt bar.txt); echo "$x"');
  assert.equal(result.stdout, "foo\nbar\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

for (const command of ["dirname ~", "basename ~"]) {
  test(`HOME can become an option on a later iteration: ${command}`, async () => {
    const body = `HOME=$i; x=$(${command}); printf '%s:<%s>\\n' "$?" "$x"`;
    assert.deepEqual(await execute(`for i in /a/b -a; do ${body}; done`), await execute(`i=/a/b; ${body}; i=-a; ${body}`));
  });
}
for (const command of ["dirname -- ~", "basename -- ~", "dirname '~'", "basename '~'"]) {
  test(`tilde operands protected from options: ${command}`, async () => {
    const body = `x=$(${command}); printf '%s:<%s>\\n' "$?" "$x"`;
    assert.deepEqual(await execute(`HOME=-a; for i in 1 2; do ${body}; done`), await execute(`HOME=-a; ${body}; ${body}`));
  });
}
