import assert from "node:assert/strict";
import test from "node:test";
import { compare, native, text, virtual, type Probe } from "./harness.js";

const probes: Probe[] = [
  { name: "directory negation does not rescue excluded children", args: ["--files", "."], files: { ".ignore": "*\n!src/\n", "src/a.txt": "foo\n" } },
  { name: "unclosed ignore bracket remains literal and retains later rules", args: ["--files", "."], files: { ".ignore": "[\n*.txt\n", "a.txt": "foo\n" } },
  { name: "nested repository resets parent VCS ignores", args: ["--files", "."], files: { ".gitignore": "*.txt\n", "nested/.git/config": "", "nested/a.txt": "foo\n" } },
  { name: "ignored followed cycle still reports native error", args: ["-L", "foo", "."], files: { ".ignore": "loop\n", "z.txt": "foo\n" }, links: { loop: "." } },
  { name: "before context stops binary no-match search", args: ["-C1", "foo", "-"], stdin: "no\0foo\n" },
  { name: "fragmented before context stops binary no-match search", args: ["-C1", "foo", "-"], stdin: "no\0foo\n", chunkSize: 1 },
  { name: "single-write binary warning after early match", args: ["foo", "-"], stdin: "foo\n\0\nno\n" },
  { name: "summary JSON member order after timing-only normalization", args: ["-a", "-F", "--json", "�", "-"], stdin: [255, 10] },
];
const actual = virtual(probes);
for (const [index, probe] of probes.entries()) test(`review ${probe.name}`, () => compare(actual[index]!, native(probe), probe));

test("back-to-back virtual chunks retain prior output, not a whole-write oracle", () => {
  const result = virtual([{ name: "fragmented binary", args: ["foo", "-"], stdin: "foo\n\0\nno\n", chunkSize: 1 }])[0]!;
  assert.equal(result.code, 0); assert.equal(text(result.stderr), "");
  assert.equal(text(result.stdout), 'foo\nbinary file matches (found "\\0" byte around offset 4)\n');
});
