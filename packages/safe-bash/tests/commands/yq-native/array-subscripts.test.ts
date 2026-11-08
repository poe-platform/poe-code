import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./helpers.js";

const input = "items: [ChangedFirst, ChangedMiddle, ChangedLast]\n";
for (const [expression, source, stdout] of [
  ["select(.[3] == null)", "[1, 2]\n", "[1, 2]\n"],
  ["select(.[999999999] == null)", "[1, 2]\n", "[1, 2]\n"],
  ["del(.[5])", "[1, 2]\n", "[1, 2]\n"],
  ["del(.[2], .[0])", "[10, 20, 30]\n", "[20]\n"],
  ["del(.[0], .[2])", "[10, 20, 30]\n", "[20]\n"],
  ["del(.[0], .[0])", "[10, 20, 30]\n", "[20, 30]\n"],
  ["del(.[-1], .[2])", "[10, 20, 30]\n", "[10, 20]\n"],
  ["del(.b, .a)", "{a: 10, b: 20, c: 30}\n", "{c: 30}\n"],
  ["del(.a, .a)", "{a: 10, b: 20, c: 30}\n", "{b: 20, c: 30}\n"],
  ["del(.a[0], .b[0], .a[0])", "{a: [1, 2], b: [3, 4]}\n", "{a: [2], b: [4]}\n"],
  [".[3] = 4", "[1, 2]\n", "[1, 2, null, 4]\n"],
] as const) test(`Mike yq preserves slots for ${expression} on ${source.trim()}`, async () => {
  assert.deepEqual(await run([expression], source, {}, { limits: { maxNodes: 100 } }), { status: 0, stdout, stderr: "" });
});
for (const [query, spelling] of [
  ["2.0", "2.0"], ["-1.0", "-1.0"], ["true", "true"],
  ["false", "false"], ["null", "null"], ['""', ""],
  ['"1e0"', "1e0"], ['"1.0"', "1.0"],
] as const) {
  test(`array traversal rejects ${query}`, async () => {
    const expected = { status: 1, stdout: "", stderr: `Error: cannot index array with '${spelling}' (strconv.ParseInt: parsing ${JSON.stringify(spelling)}: invalid syntax)\n` };
    assert.deepEqual(await run([`.items[${query}]`], input), expected);
    assert.deepEqual(await run([`.items[${query}] = "changed"`], input), expected);
  });
}
for (const [query, stdout] of [["1", "ChangedMiddle\n"], ["-1", "ChangedLast\n"], ['"1"', "ChangedMiddle\n"], ['"-1"', "ChangedLast\n"], ['"+1"', "ChangedMiddle\n"]] as const) {
  test(`array traversal accepts signed integer ${query}`, async () => {
    assert.deepEqual(await run([`.items[${query}]`], input), { status: 0, stdout, stderr: "" });
  });
}
