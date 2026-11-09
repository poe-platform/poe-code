import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";

for (const operator of ["-", ":-", "+", ":+"]) for (const [argumentsSource, expected] of [
  ["", []],
  ['""', [""]],
  ['"" "two words"', ["", "two words"]],
] as const) test(`quoted positional fallback preserves argument count: ${operator}, set -- ${argumentsSource}`, async t => {
  const { shell } = setup();
  t.after(() => shell.dispose());
  const result = await shell.exec(`${operator.endsWith("+") ? "v=set" : "unset v"}; set -- ${argumentsSource}; args \${v${operator}"$@"}`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), expected);
});

for (const [word, expected] of [
  ['${v:-"$@"""}', [""]], ['${v:-"""$@"}', [""]],
  ['pre${v:-"$@"}post', ["prepost"]], ['${v:-"x$@y"}', ["xy"]],
  ['${v:-"$*"}', [""]], ['${v:-"$empty"}', [""]],
  ['${v:-${w:-"$@"}}', []], ['${v:-"$@"}""', [""]],
] as const) test(`positional fallbacks preserve surrounding fields: ${word}`, async t => {
  const { shell } = setup();
  t.after(() => shell.dispose());
  const result = await shell.exec(`unset v w empty; set --; args ${word}`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), expected);
});

for (const nounset of [false, true]) for (const [argumentsSource, value, alternate] of [
  ["", "none", ""],
  ['""', "", "yes"],
  ['"value"', "value", "yes"],
] as const) test(`positional default operators distinguish unset from empty: nounset=${nounset}, set -- ${argumentsSource}`, async t => {
  const { shell } = setup();
  t.after(() => shell.dispose());
  const result = await shell.exec(`${nounset ? "set -u;" : ""} s=none; set -- ${argumentsSource}; args "\${*-$s}|\${*+yes}|\${@+yes}" "\${*-$s}" "\${*+yes}" "\${@+yes}"; say end`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `${JSON.stringify([`${value}|${alternate}|${alternate}`, value, alternate, alternate])}end\n`);
});

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
