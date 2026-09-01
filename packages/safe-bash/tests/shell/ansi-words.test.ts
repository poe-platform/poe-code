import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

for (const [word, value] of [
  [String.raw`$'\u00e9\U0001f600'`, "é😀"],
  [String.raw`$'\u1\u12\u123\u1234\u12345'`, "\u0001\u0012ģሴሴ5"],
  [String.raw`$'\q\xZ\uXY\8\cA\c?\c'`, "\\q\\xZ\\uXY\\8\u0001\u007f\\c"],
  [String.raw`$'\c\\'`, "\u001c"],
] as const) {
  test(`ANSI-C modern escapes from pinned GNU 5.3 capture: ${word}`, async () => {
    const result = await setup().shell.exec(`args ${word}`);
    assert.equal(result.stdout, JSON.stringify([value]));
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

test("ANSI-C words compose with assignments, substitutions and literal patterns", async () => {
  const result = await setup().shell.exec(String.raw`value=$'a\'b'; args "$value" "$(say $'a\nb')"; case '*' in $'*') say match;; esac`);
  assert.equal(result.stdout, '["a\'b","a\\nb"]match\n');
  assert.equal(result.stderr, "");
});

test("ANSI-C words preserve expansion and malformed-source guards", async () => {
  const { shell, fs } = setup();
  await assert.rejects(shell.exec(String.raw`args $'\u00e9\u00e9'`, { limits: { maxExpansionBytes: 3 } }), /maxExpansionBytes/u);
  const result = await shell.exec("say before >marker; args $'unterminated\\'");
  assert.equal(result.exitCode, 2);
  assert.deepEqual(await fs.readdir("/"), []);
  for (const escape of [String.raw`\uD800`, String.raw`\U00110000`]) {
    const invalid = await shell.exec(`say before >marker; args $'${escape}'`);
    assert.equal(invalid.exitCode, 2);
    assert.match(invalid.stderr, /Unsupported non-scalar/u);
    assert.deepEqual(await fs.readdir("/"), []);
  }
});

test("GNU 5.3 C-locale Unicode escapes retain canonical ASCII spellings", async () => {
  const result = await setup().shell.exec(String.raw`args $'\U000000e9\u0080\u000A\U0001f600'`, { env: { LC_ALL: "C" } });
  assert.equal(result.stdout, JSON.stringify(["\\u00E9\\u0080\n\\U0001F600"]));
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("ANSI-C locale follows input-unit parsing, not later same-unit assignments", async () => {
  for (const [separator, value] of [["; ", "\\u00E9"], ["\n", "é"]] as const) {
    const result = await setup().shell.exec(`LC_ALL=en_US.UTF-8${separator}args $'\\u00e9'`, { env: { LC_ALL: "C" } });
    assert.equal(result.stdout, JSON.stringify([value]));
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  }
});
