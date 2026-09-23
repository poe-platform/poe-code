import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { mikeYqCommands } from "../../../src/commands/yq/mike.js";
import { Shell } from "../../../src/shell/shell.js";
import { native, nativeOptions, run } from "./helpers.js";

const cases = [
  ["sort", "[2,1]\n", "[1, 2]\n"],
  ["reverse", "[2,1]\n", "[1, 2]\n"],
  ["sort_by(.n)", "- n: 2\n- n: 1\n", "- n: 1\n- n: 2\n"],
  ["to_entries", "a: 1\n", "- key: a\n  value: 1\n"],
  ["with_entries(.key |= upcase)", "a: 1\n", "A: 1\n"],
  ['pick(["a"])', "a: 1\nb: 2\n", "a: 1\n"],
  ["sort", "['z', 'a', 'a']\n", "['a', 'a', 'z']\n"],
  ["sort_by(.n)", "[{n: 1, id: a}, {n: 0, id: b}, {n: 1, id: c}]\n", "[{n: 0, id: b}, {n: 1, id: a}, {n: 1, id: c}]\n"],
  ["reverse", "- 'a' # first\n- !custom b\n", "- !custom b\n- 'a' # first\n"],
  ["to_entries | from_entries", "a: 'one' # keep\nb: !custom two\n", "a: 'one' # keep\nb: !custom two\n"],
  ['with_entries(select(.key == "b"))', "a: 1\nb: 'two'\n", "b: 'two'\n"],
  ['pick(["b", "a"])', "a: 'one'\nb: !custom two\nc: 3\n", "b: !custom two\na: 'one'\n"],
  ["to_entries", "[a, b]\n", "- key: 0\n  value: a\n- key: 1\n  value: b\n"],
  ['pick([2, 0])', "[a, b, c]\n", "[c, a]\n"],
  ["sort", "[z, 10, 2, true, null, false, a]\n", "[null, false, true, 2, 10, a, z]\n"],
  ["sort", "{b: 2, a: 1}\n", "{a: 1, b: 2}\n"],
  ["sort_by(.n)", "{b: {n: 2}, a: {n: 1}}\n", "{a: {n: 1}, b: {n: 2}}\n"],
  ["to_entries", "null\n", ""],
  ["with_entries(.)", "null\n", ""],
  ["to_entries", "# header\na: 1\n", "# header\n- key: a\n  value: 1\n"],
  ["with_entries(.key |= upcase)", "# header\na: 1\n", "# header\nA: 1\n"],
  ["with_entries(.key |= upcase)", "{a: 1}\n", "A: 1\n"],
  ["from_entries", "[{key: a, value: 1}]\n", "{a: 1}\n"],
  ['pick(["a", "a"])', "a: 1\n", "a: 1\na: 1\n"],
  ["sort_by(.a,.b)", "[{a: 1, b: 2}, {a: 1, b: 1}]\n", "[{a: 1, b: 1}, {a: 1, b: 2}]\n"],
] as const;

for (const [expression, input, stdout] of cases) test(`Mike yq collection operator: ${expression} on ${input.trim()}`, async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.yaml", Buffer.from(input));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`yq '${expression}' input.yaml`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, stdout);
  assert.equal(Buffer.from(await fs.readFile("/input.yaml")).toString(), input);
});

test("collection operators match pinned Mike yq v4.53.3", nativeOptions, async () => {
  for (const [expression, input] of cases) {
    assert.deepEqual(await run([expression], input), await native([expression], input), expression);
  }
});

test("collection operators retain quota enforcement", async () => {
  const input = "[3, 2, 1]\n";
  const options = { limits: { maxNodes: 12 } };
  assert.deepEqual(await run(["."], input, {}, options), { status: 0, stdout: "[3, 2, 1]\n", stderr: "" });
  for (const expression of ["sort", "sort_by(.)", "reverse", "to_entries", "with_entries(.)", "pick([0])"]) {
    const result = await run([expression], input, {}, options);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /yq limit exceeded: maxNodes/u);
  }
});
