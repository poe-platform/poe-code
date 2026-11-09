import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";

for (const bounded of [false, true]) for (const selector of ["@", "*"]) for (const quoted of [false, true]) {
  for (const [operator, argumentsSource, values] of [
    ["", "one.txt two.txt", ["one.txt", "two.txt"]],
    ["%.txt", "one.txt two.txt", ["one", "two"]],
    ["%%.*", "one.part.txt two.part.txt", ["one", "two"]],
    ["#dir/", "dir/one dir/two", ["one", "two"]],
    ["##*/", "dir/sub/one dir/sub/two", ["one", "two"]],
  ] as const) test(`empty IFS positional expansion: ${selector}${operator}, quoted=${quoted}, bounded=${bounded}`, async t => {
    const { shell } = setup(bounded ? { limits: { maxExpansionBytes: 1024 * 1024 } } : {});
    t.after(() => shell.dispose());
    const expansion = `\${${selector}${operator}}`;
    const result = await shell.exec(`IFS=; set -- ${argumentsSource}; set -- ${quoted ? `"${expansion}"` : expansion}; args "$@"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), quoted && selector === "*" ? [values.join("")] : values);
  });
}

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

for (const [prefix, word, expected, argumentsSource = "a b"] of [
  ["IFS=:", '${v:-$@}', ["a b"]],
  ["IFS=:", '${v-$@}', ["a b"]],
  ["IFS=:; v=set", '${v:+$@}', ["a b"]],
  ["IFS=:; v=set", '${v+$@}', ["a b"]],
  ["IFS=:", '${v:-${@}}', ["a b"]],
  ["IFS=:", '${v:-${other:-$@}}', ["a b"]],
  ["IFS=:", 'pre${v:-$@}post', ["prea bpost"]],
  ["IFS=:", '${v:-$@}', ["a:b c:d"], "'a:b' 'c:d'"],
  ["IFS=:", '${v:-$@}', [""], "''"],
  ["IFS=:", '${v:-$@}', [" "], "'' ''"],
  ["IFS=:", '${v:-$@}', [], ""],
  ["IFS=': '", '${v:-$@}', ["a:b", "c d"], "'a:b' 'c d'"],
  ["IFS=': '", '${v:-$@}', ["", ""], "'' ''"],
  ["IFS=' : '", '${v:-$@}', ["a", "b", "c", "d"], "'a:b' 'c d'"],
  ["IFS=:", '${v:-"$@"}', ["a", "b"]],
  ["IFS=:", '"${v:-$@}"', ["a", "b"]],
  ["IFS=:", '${v:-$*}', ["a", "b"]],
  ["IFS=:", '$@', ["a", "b"]],
  ["IFS=:", '${v:=$@}', ["a b"]],
  ["IFS=':'; v=kept", '${v:-$@}', ["kept"]],
  ["IFS=''", '${v:-$@}', ["a", "b"]],
  ["unset IFS", '${v:-$@}', ["a", "b"]],
] as const) test(`positional fallback field splitting: ${prefix}; ${word}`, async t => {
  const { shell } = setup();
  t.after(() => shell.dispose());
  const result = await shell.exec(`unset v other; ${prefix}; set -- ${argumentsSource}; set -- ${word}; args "$@"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), expected);
});

test("unquoted positional fallback protects glob characters with colon IFS", async t => {
  const { shell, fs } = setup();
  t.after(() => shell.dispose());
  await fs.writeFile("/match", new Uint8Array());
  const result = await shell.exec('IFS=:; set -- "*"; args ${v:-$@}');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), ["*"]);
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
