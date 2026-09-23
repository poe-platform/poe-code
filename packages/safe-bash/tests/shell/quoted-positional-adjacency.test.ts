import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";

for (const word of ['"$@""$@"', '"$@$@"', '"${@}${@}"', '"$@""$@""$@"']) {
  test(`empty adjacent positional expansions disappear: ${word}`, async () => {
    const { shell, fs } = setup();
    try {
      await fs.writeFile("/case.sh", new TextEncoder().encode(`set -- First Second; shift 2; args ${word}`));
      for (const command of ["sh", "bash"]) {
        const result = await shell.exec(`${command} /case.sh`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.deepEqual(JSON.parse(result.stdout), []);
      }
    } finally { await shell.dispose(); }
  });
}

for (const [word, expected] of [
  ['"$@"', []], ['"${@}"', []], ['"$@" "$@"', []],
  ['"""$@""$@"', [""]], ['"$@""$@"""', [""]],
  ['"$@""""$@"', [""]], ['"$@"prefix"$@"', ["prefix"]],
  ['"$@""$*""$@"', [""]], ['"$@""$unset""$@"', [""]],
] as const) {
  test(`empty positional expansions preserve independent presence: ${word}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`set --; args ${word}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), expected);
    } finally { await shell.dispose(); }
  });
}

test("adjacent quoted positional expansions preserve empty members and concatenation", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('set -- "" "two words"; args "$@""$@"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ["", "two words", "two words"]);
  } finally { await shell.dispose(); }
});
