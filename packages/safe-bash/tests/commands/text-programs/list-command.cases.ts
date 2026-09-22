import assert from "node:assert/strict";
import test from "node:test";
import { runVirtual } from "./helpers.js";

test("sed l escapes backslashes unambiguously rather than copying BSD's ambiguous literal", async () => {
  const actual = await runVirtual("sed", { args: ["-n", "l"], stdin: "\\t\n" });
  assert.equal(actual.exitCode, 0);
  assert.equal(actual.stdout.toString(), "\\\\t$\n");
});

// Expected bytes captured from GNU sed 4.9 with LC_ALL=C.
for (const [name, input, expected] of [
  ["thirty control bytes", "\x01".repeat(30), "\\001".repeat(17) + "\\\n" + "\\001".repeat(13) + "$\n"],
  ["high bytes", "\xff".repeat(30), "\\377".repeat(17) + "\\\n" + "\\377".repeat(13) + "$\n"],
  ["end marker at the width", "a".repeat(69), "a".repeat(69) + "$\n"],
  ["printable byte past the width", "a".repeat(70), "a".repeat(69) + "\\\na$\n"],
  ["octal escape past the width", "a".repeat(66) + "\x01", "a".repeat(66) + "\\\n\\001$\n"],
  ["short escape before the width", "a".repeat(67) + "\t", "a".repeat(67) + "\\t$\n"],
  ["short escape at the width", "a".repeat(68) + "\t", "a".repeat(68) + "\\\n\\t$\n"],
  ["repeated short escapes", "\t".repeat(35), "\\t".repeat(34) + "\\\n\\t$\n"],
] as const) {
  test(`sed l uses GNU wrapping for ${name}`, async () => {
    const bytes = Buffer.from(input + "\n", "latin1");
    const actual = await runVirtual("sed", { args: ["-n", "l", "input"], files: { input: bytes } });
    assert.equal(actual.exitCode, 0);
    assert.equal(actual.stderr.length, 0);
    assert.deepEqual(actual.stdout, Buffer.from(expected));
    assert.deepEqual(actual.files, { input: bytes });
  });
}
