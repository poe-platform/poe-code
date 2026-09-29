import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createPasteCommands } from "../../src/commands/paste/index.js";

function shell() {
  return new Shell({ fs: new MemoryFileSystem() }).use({ name: "regression", setup(host) {
    for (const command of [...createStandardCommands(), ...createPasteCommands()]) host.commands.register(command);
  } });
}

for (const [command, expected] of [
  ["paste -", "from-stdin\n"],
  ["paste /f1 -", "alpha\tfrom-stdin\n"],
  ["paste - /f1", "from-stdin\talpha\n"],
  ["paste - -", "from-stdin\t\n"],
  ["paste -s -", "from-stdin\n"],
  ["paste", "from-stdin\n"],
] as const) {
  for (const input of ["<<< 'from-stdin'", "", "< /input"]) {
    test(`paste substitution inherits stdin: ${command} ${input}`, async () => {
      const result = await shell().exec(`printf 'alpha\\n' > /f1; printf 'from-stdin\\n' > /input; printf 'from-stdin\\n' | { x=$(${command}); printf '%s\\n' "$x"; } ${input}`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected);
    });
  }
}

for (const input of ["<<< 'from-stdin'", "< /input"]) {
  test(`paste substitution reads its own redirected stdin: ${input}`, async () => {
    const result = await shell().exec(`printf 'alpha\\n' > /f1; printf 'from-stdin\\n' > /input; x=$(paste /f1 - ${input}); printf '%s\\n' "$x"`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "alpha\tfrom-stdin\n");
  });
}

test("paste substitution preserves file-only and empty stdin inputs", async () => {
  const instance = shell();
  const files = await instance.exec(`printf 'alpha\\n' > /f1; printf 'beta\\n' > /f2; x=$(paste /f1 /f2); printf '%s\\n' "$x"`);
  assert.equal(files.stderr, "");
  assert.equal(files.exitCode, 0);
  assert.equal(files.stdout, "alpha\tbeta\n");
  const empty = await instance.exec(`x=$(paste -); printf '<%s>\\n' "$x"`);
  assert.equal(empty.stderr, "");
  assert.equal(empty.exitCode, 0);
  assert.equal(empty.stdout, "<>\n");
});

for (const second of ["beta\\n", ""]) {
  test(`nl substitution preserves multiple file operands: ${JSON.stringify(second)}`, async () => {
    const setup = `printf 'alpha\\n' > /f1; printf '${second}' > /f2;`;
    const direct = await shell().exec(`${setup} nl /f1 /f2`);
    const substitution = await shell().exec(`${setup} x=$(nl /f1 /f2); printf '%s\\n' "$x"`);
    assert.equal(direct.stdout, second ? "     1\talpha\n     2\tbeta\n" : "     1\talpha\n");
    assert.deepEqual(substitution, direct);
  });
}
