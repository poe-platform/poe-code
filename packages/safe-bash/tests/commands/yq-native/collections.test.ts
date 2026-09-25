import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { mikeYqCommands } from "../../../src/commands/yq/mike.js";
import { Shell } from "../../../src/shell/shell.js";
import { native, nativeOptions, run } from "./helpers.js";

const outputCases = [
  [["--nul-output", ".a"], "a: 1\n", "1\0"],
  [["-0", ".[]"], "[one, two]\n", "one\0two\0"],
  [["--nul-output=false", ".a"], "a: 1\n", "1\n"],
  [["-0", "-o=json", "."], "{a: 1}\n", '{\n  "a": 1\n}\0'],
  [["-0", ".a"], 'a: "line\\n"\n', "line\n\0"],
  [["-0", ".a"], "a: 1\n---\na: 2\n", "1\0---\n2\0"],
  [["--prettyPrint", "."], "{a: 1}\n", "a: 1\n"],
  [["-P", "."], "{a: ['one', {b: 2}]}\n", "a:\n  - one\n  - b: 2\n"],
  [["--prettyPrint=false", "."], "{a: 1}\n", "{a: 1}\n"],
  [["-P0", "."], "{a: 1}\n", "a: 1\0"],
  [["-P", "."], "a: 'one' # keep\n", "a: one # keep\n"],
] as const;

for (const [args, input, stdout] of outputCases) test(`Mike yq output options: ${args.join(" ")} on ${input.trim()}`, async () => {
  assert.deepEqual(await run(args, input), { status: 0, stdout, stderr: "" });
});

test("Mike yq NUL output rejects embedded NUL before writing the value", async () => {
  assert.deepEqual(await run(["-0", ".[]"], '["ok", "bad\\0value"]\n'), {
    status: 1, stdout: "ok\0",
    stderr: "Error: can't serialise value because it contains NUL char and you are using NUL separated output\n",
  });
  assert.deepEqual(await run(["-0", "--unwrapScalar=false", "."], '"bad\\0value"\n'), {
    status: 0, stdout: '"bad\\0value"\0', stderr: "",
  });
});

test("Mike yq output flags preserve bytes through shell redirection", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.yaml", Buffer.from("{a: 1}\n"));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("yq --prettyPrint --nul-output . input.yaml > output.yaml");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.deepEqual(Buffer.from(await fs.readFile("/output.yaml")), Buffer.from("a: 1\0"));
  assert.equal(Buffer.from(await fs.readFile("/input.yaml")).toString(), "{a: 1}\n");
});

test("output options match pinned Mike yq v4.53.3", nativeOptions, async () => {
  for (const [args, input] of outputCases) assert.deepEqual(await run(args, input), await native(args, input));
  for (const args of [["-0", ".[]"], ["-0", "--unwrapScalar=false", "."]]) {
    assert.deepEqual(await run(args, '["ok", "bad\\0value"]\n'), await native(args, '["ok", "bad\\0value"]\n'));
  }
});

test("Mike yq output flags retain output limits and in-place publication", async () => {
  const result = await run(["-P0", "."], "{a: 1}\n", {}, { limits: { maxOutputBytes: 4 } });
  assert.deepEqual(result, { status: 1, stdout: "", stderr: "Error: yq limit exceeded: maxOutputBytes\n" });
  const fs = createMemoryFileSystem();
  await fs.mkdir("/tmp");
  await fs.writeFile("/input.yaml", Buffer.from("{a: 1}\n"));
  assert.deepEqual(await run(["-iP0", ".", "input.yaml"], "", { fs, env: { TMPDIR: "/tmp" } }), {
    status: 0, stdout: "", stderr: "",
  });
  assert.deepEqual(Buffer.from(await fs.readFile("/input.yaml")), Buffer.from("a: 1\0"));
  assert.deepEqual(await fs.readdir("/tmp"), []);
});

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

test("Mike yq evaluator handles read-only/del out-of-bounds indices, deduplicated/unordered del, has(-1), and non-integer array pick", async () => {
  assert.deepEqual(await run(["-o", "json", "select(.[5] == null)"], "[1, 2]\n"), { status: 0, stdout: "[\n  1,\n  2\n]\n", stderr: "" });
  assert.deepEqual(await run(["-o", "json", "del(.[5])"], "[1, 2]\n"), { status: 0, stdout: "[\n  1,\n  2\n]\n", stderr: "" });
  assert.deepEqual(await run(["-o", "json", "del(.[1], .[0])"], "[\"a\", \"b\", \"c\"]\n"), { status: 0, stdout: "[\n  \"c\"\n]\n", stderr: "" });
  assert.deepEqual(await run(["-o", "json", "del(.[0], .[0])"], "[\"a\", \"b\", \"c\"]\n"), { status: 0, stdout: "[\n  \"b\",\n  \"c\"\n]\n", stderr: "" });
  assert.deepEqual(await run(["-o", "json", "has(-1)"], "[10, 20]\n"), { status: 0, stdout: "false\n", stderr: "" });
  assert.deepEqual(await run(["-o", "json", "pick([false, null, true])"], "[10, 20]\n"), { status: 0, stdout: "[]\n", stderr: "" });
});
