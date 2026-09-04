import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";
import { ShellLimitError } from "../../src/shell/types.js";

test("escaped separators survive byte-chunk boundaries", async () => {
  const { shell } = setup();
  const bytes = new TextEncoder().encode("é\\ é\\\n rest\ntail");
  const stdin = { async *[Symbol.asyncIterator]() { for (const byte of bytes) yield new Uint8Array([byte]); } };
  assert.equal((await shell.exec('read first second; args "$first" "$second"; pass', { stdin })).stdout, '["é é","rest"]tail');
});

for (const raw of [false, true]) {
  test(`read avoids full-line character arrays before variable admission: raw=${raw}`, async context => {
    const line = "x".repeat(256);
    const original = Array.from;
    let conversions = 0;
    context.mock.method(Array, "from", function (...args: Parameters<typeof Array.from>) {
      if (args[0] === line) conversions++;
      return Reflect.apply(original, Array, args);
    });
    const { shell } = setup({ limits: { maxExpansionBytes: 128, maxOutputBytes: 4096 } });
    try {
      await assert.rejects(shell.exec(raw ? "read -r value" : "read value", { stdin: `${line}\n` }),
        error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
      assert.equal(conversions, 0);
    } finally { await shell.dispose(); }
  });
}

for (const [label, source, input, expected] of [
  ["one trailing separator", "IFS=, read first; args \"$first\"", "x,\n", ["x"]],
  ["extra empty field", "IFS=, read first; args \"$first\"", "x,,\n", ["x,,"]],
  ["empty fields and remainder", "IFS=, read first second; args \"$first\" \"$second\"", ",,z,\n", ["", ",z,"]],
  ["astral prefix before escaped space", "read first second; args \"$first\" \"$second\"", "😀\\ x y\n", ["😀 x", "y"]],
  ["escaped astral delimiter", "IFS=😀 read first second; args \"$first\" \"$second\"", "a\\😀b😀c😀d\n", ["a😀b", "c😀d"]],
  ["escaped trailing whitespace", "read first; args \"$first\"", "a\\ \n", ["a "]],
  ["many fields with one destination", "IFS=, read first; args \"$first\"", `${"x,".repeat(2048)}last\n`, [`${"x,".repeat(2048)}last`]],
] as const) {
  test(`read index spans preserve ${label}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(source, { stdin: input });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, JSON.stringify(expected));
    } finally { await shell.dispose(); }
  });
}

test("read preserves readonly partial assignment and consumed-line boundaries", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('second=old; readonly second; read first second third; args "$?" "$first" "$second" "$third"; pass', { stdin: "one two three\nTAIL" });
    assert.equal(result.stdout, '["2","one","old",""]TAIL');
    assert.match(result.stderr, /second: readonly variable/u);
  } finally { await shell.dispose(); }
});

for (const slashes of [1, 2, 3]) {
  test(`read retains newline continuation parity across chunks: ${slashes} slashes`, async () => {
    const { shell } = setup();
    const bytes = new TextEncoder().encode(`a${"\\".repeat(slashes)}\nb\nTAIL`);
    const stdin = { async *[Symbol.asyncIterator]() { for (const byte of bytes) yield Uint8Array.of(byte); } };
    try {
      const result = await shell.exec('read value; args "$value"; pass', { stdin });
      assert.equal(result.stdout, slashes === 1 ? '["ab"]TAIL' : slashes === 2 ? '["a\\\\"]b\nTAIL' : '["a\\\\b"]TAIL');
    } finally { await shell.dispose(); }
  });
}

test("read unescaping spans multiple bounded fragment batches", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('read value; args "$value"', { stdin: `${"\\😀".repeat(4097)}\n` });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, JSON.stringify(["😀".repeat(4097)]));
  } finally { await shell.dispose(); }
});
