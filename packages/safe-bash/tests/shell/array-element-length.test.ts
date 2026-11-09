import assert from "node:assert/strict";
import test from "node:test";
import { standardCommands } from "../../src/commands/index.js";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";
import { setup } from "./helpers.js";

test("missing array element length continues to the following command under nounset", async t => {
  const { shell } = setup({ extensions: [arraysExtension()] });
  shell.use(standardCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec('set -u; s=none; a=([3]=abc); printf \'<%s>\\n\' "${#a[1]}"; echo end');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "<0>\nend\n");
});

for (const explicitExtension of [false, true]) {
  for (const nounset of ["set -u", "set +u"]) {
    for (const initialization of ["a=([3]=abc)", "a=()", "declare -A a=([3]=abc)"]) {
      test(`array element length: ${explicitExtension}, ${nounset}, ${initialization}`, async t => {
        const { shell } = setup(explicitExtension ? { extensions: [arraysExtension()] } : {});
        t.after(() => shell.dispose());
        const result = await shell.exec(`${nounset}; s=none; ${initialization}; args "\${#a[1]}" "\${#a[3]}"; say end`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, `["0","${initialization === "a=()" ? "0" : "3"}"]end\n`);
      });
    }
  }
  for (const source of [
    'a=([3]=abc); args "${a[1]}"',
    'declare -A a=([3]=abc); args "${a[1]}"',
    'declare -a a; args "${#a[1]}"',
    'declare -A a; args "${#a[1]}"',
    'args "${#a[1]}"',
    'a=abc; args "${#a[1]}"',
    'args "${#missing}"',
  ]) {
    test(`nounset still rejects unset parameters: ${explicitExtension}, ${source}`, async t => {
      const { shell } = setup(explicitExtension ? { extensions: [arraysExtension()] } : {});
      t.after(() => shell.dispose());
      const result = await shell.exec(`set -u; ${source}; say end`);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /unbound variable/);
    });
  }
}
