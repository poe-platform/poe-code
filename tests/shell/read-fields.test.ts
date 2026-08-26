import assert from "node:assert/strict";
import { test } from "node:test";
import { bashResult } from "./bash-bugfix-helpers.js";
import { setup } from "./helpers.js";

for (const fixture of [
  { read: "read first second", stdin: "a\\ b c\n" },
  { read: 'IFS=" :" read first second third', stdin: " a : b : c \n" },
  { read: "IFS=: read first second", stdin: "a:b:\n" },
  { read: "IFS=: read first second", stdin: "a:b::\n" },
  { read: "IFS=: read first second", stdin: "one::two:three:\n" },
  { read: "IFS=: read first second third", stdin: "::\n" },
  { read: 'IFS=" :" read first second', stdin: " a: b : c : \n" },
  { read: "read first second", stdin: "\\ a b\\ \n" },
  { read: "read first second", stdin: "é\\ é rest\n" },
  { read: "IFS=: read first second", stdin: "a\\:b:c\n" },
  { read: "read -r first second", stdin: "a\\ b c\n" },
  { read: "IFS= read first second", stdin: " a\\ b c \n" },
  { read: "read first second", stdin: "a\\" },
  { read: "read first second", stdin: "one\\\n two three\n" },
  { read: "read", stdin: " a\\ b c \n" },
]) {
  test(`read retains escaping through field splitting: ${JSON.stringify(fixture)}`, async () => {
    const source = `${fixture.read}; status=$?; say "<$first>|<$second>|<$third>|<$REPLY>:$status"`;
    const expected = bashResult('say() { printf "%s\\n" "$*"; }; ' + source, { stdin: fixture.stdin });
    const { shell } = setup();
    const actual = await shell.exec(source, { stdin: fixture.stdin });
    assert.deepEqual({ stdout: actual.stdout, stderr: actual.stderr, exitCode: actual.exitCode }, { stdout: expected.stdout, stderr: expected.stderr, exitCode: expected.exitCode });
  });
}

test("escaped separators survive byte-chunk boundaries", async () => {
  const { shell } = setup();
  const bytes = new TextEncoder().encode("é\\ é\\\n rest\ntail");
  const stdin = { async *[Symbol.asyncIterator]() { for (const byte of bytes) yield new Uint8Array([byte]); } };
  assert.equal((await shell.exec('read first second; args "$first" "$second"; pass', { stdin })).stdout, '["é é","rest"]tail');
});
