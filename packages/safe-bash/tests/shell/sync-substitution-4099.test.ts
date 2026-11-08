import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { createBcCommands } from "../../src/commands/bc/index.js";
import { createExprCommands } from "../../src/commands/expr/index.js";
import { createOdCommands } from "../../src/commands/od/index.js";
import { createXxdCommands } from "../../src/commands/xxd/index.js";

function createShell(fs = new MemoryFileSystem()): Shell {
  const shell = new Shell({ fs });
  for (const command of [...basicCommands(), ...createBcCommands(), ...createExprCommands(), ...createOdCommands(), ...createXxdCommands()]) shell.commands.register(command);
  return shell;
}

const cases = [
  ["bc scale changes", 'bc <<< "scale=$((i * 15)); $i + 1"', "23", "3"],
  ["expr operand grows", 'expr "$((i * 999999999999999999))" + 1', "10000000000000000001999999999999999999", "1999999999999999999"],
  ["xxd binary output", 'xxd -r -p <<< "$((i * 40))"', "@�", "�"],
] as const;
for (const loop of ["for ((i=1;i<=2;i++))", "for i in 1 2"]) {
  for (const [name, command, expected, last] of cases) {
    for (const append of [false, true]) {
      test(`${loop}: ${name}, append=${append}`, async () => {
        const shell = createShell();
        try {
          const result = await shell.exec(`x=init; count=0; ${loop}; do count=$((count+1)); x${append ? "+" : ""}=$(${command}); done; printf '%s:%s' "$count" "$x"`);
          assert.equal(result.stdout, `2:${append ? "init" + expected : last}`);
          assert.equal(result.stderr, "");
          assert.equal(result.exitCode, 0);
        } finally { await shell.dispose(); }
      });
    }
  }
}
for (const expression of ["0.50 - 0.50", "scale=2; 0 / 5", "0.0 + 0.0", "0.00 * 5"]) {
  test(`bc scaled zero: ${expression}`, async () => {
    const shell = createShell();
    try {
      const result = await shell.exec(`x=$(bc <<< "${expression}"); echo "$?:$x"`);
      assert.equal(result.stdout, "0:0\n");
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}
for (const operand of ["00", "-0", "000"]) {
  test(`expr numeric zero status: ${operand}`, async () => {
    const shell = createShell();
    try {
      const result = await shell.exec(`x=$(expr -- ${operand}); echo "$?:$x"`);
      assert.equal(result.stdout, `1:${operand}\n`);
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}
for (const options of ["-tx1 -tu1", "-t x1 -t u1", "-c -tx1", "-b -tu1"]) {
  test(`od additive formats: ${options}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", new TextEncoder().encode("AB"));
    const shell = createShell(fs);
    try {
      const ordinary = await shell.exec(`od -An ${options} /input`);
      const substituted = await shell.exec(`x=$(od -An ${options} /input); printf '%s\n' "$x"`);
      assert.equal(substituted.stdout, ordinary.stdout);
      assert.equal(substituted.stderr, ordinary.stderr);
      assert.equal(substituted.exitCode, ordinary.exitCode);
      assert.equal(ordinary.stdout.trim().split("\n").length, 2);
    } finally { await shell.dispose(); }
  });
}

for (const command of ['bc <<< "5 / $((2-i))"', 'expr 5 / "$((2-i))"', 'xxd -r -p <<< "$((80-i*40))"']) {
  test(`declined later value preserves effects and status: ${command}`, async () => {
    const shell = createShell();
    try {
      const body = `count=$((count+1)); x+=$(${command}); status=$?`;
      const tail = `printf '%s:%s:%s' "$count" "$status" "$x"`;
      const reference = await shell.exec(`x=init; count=0; i=1; ${body}; i=2; ${body}; ${tail}`);
      for (const setup of ["", "i=7;"]) {
        const actual = await shell.exec(`${setup} x=init; count=0; for ((i=1;i<=2;i++)); do ${body}; done; ${tail}`);
        assert.deepEqual(actual, reference);
      }
    } finally { await shell.dispose(); }
  });
}

test("dynamic reverse xxd substitution retains original bytes", async () => {
  const shell = createShell();
  try {
    const result = await shell.exec('x=""; for ((i=1;i<=2;i++)); do x+=$(xxd -r -p <<< "$((i*40))"); done; printf "%s" "$x"');
    assert.deepEqual(result.stdoutBytes, new Uint8Array([0x40, 0x80]));
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});
