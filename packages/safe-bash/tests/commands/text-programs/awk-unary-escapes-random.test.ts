import assert from "node:assert/strict";
import test from "node:test";
import { runVirtual } from "./helpers.js";

for (const [expression, expected] of [
  ['"v=" !0', "v=1"], ['"v=" ++x', "v=2"], ['"v=" --x', "v=0"],
  ['(2+3) ++x', "52"], ['"v=" x++', "v=1"], ['"v=" x--', "v=1"],
] as const) {
  test(`awk concatenation with ${expression}`, async () => {
    const result = await runVirtual("awk", { args: [`BEGIN { x=1; print ${expression} }`] });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), `${expected}\n`);
  });
}

test("awk decodes hex strings and octal, hex, and backspace regex escapes", async () => {
  const result = await runVirtual("awk", { args: [String.raw`BEGIN {
    print "\x41\x42", "\x4aZ", "\x41" ~ /\101/, "a b" ~ /a\040b/
    print "a\bb" ~ /a\bb/, "abb" ~ /a\bb/, "A" ~ /[\101]/, "B" ~ /\x42/
    print "A" ~ "\\101", "a b" ~ "a\\040b"
  }`] });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "AB JZ 1 1\n1 0 1 1\n1 1\n");
});

test("awk rand is repeatable after srand and returns values in [0,1)", async () => {
  const program = `BEGIN {
    srand(1); a=rand(); b=rand(); print srand(42); print srand(1)
    print a==rand(), b==rand(), a!=b
    for (i=0; i<100; i++) { r=rand(); if (r<0 || r>=1) exit 1 }
    old=srand(); print old; current=srand(7); print current==int(current)
  }`;
  const result = await runVirtual("awk", { args: [program] });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "1\n42\n1 1 1\n1\n1\n");
  const other = await runVirtual("awk", { args: ["BEGIN { srand(1); print rand(), rand() }"] });
  const again = await runVirtual("awk", { args: ["BEGIN { srand(1); print rand(), rand() }"] });
  assert.deepEqual(other.stdout, again.stdout);
});
