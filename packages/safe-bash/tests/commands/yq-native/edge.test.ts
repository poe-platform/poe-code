import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { native, nativeOptions, run } from "./helpers.js";

export const edges: readonly { args: readonly string[]; input: string }[] = [
  { args: ["-e", "."], input: "" },
  { args: ["-o=json", "."], input: "" },
  { args: ["-n", "."], input: "" },
  { args: ["-n", "{a: 1}"], input: "" },
  { args: ["-n", "map"], input: "" },
  { args: ["-n", "select"], input: "" },
  { args: ["-n", "length(1)"], input: "" },
  { args: ["-n", "["], input: "" },
  { args: ["-n", ".a = 9223372036854775807 | .a += 1"], input: "" },
  { args: ["-n", ".a = 9223372036854775807 | .a *= 2"], input: "" },
  { args: ["-o=json", "."], input: "a: .inf" },
  { args: ["-n", "-r=bad", "."], input: "" },
  { args: ["-ne", ".a = 1"], input: "" },
  { args: ["--", "-n"], input: "" },
  { args: ["-ojson", "-I0", "."], input: "a: 1" },
  { args: ["-n", ".a |= select(false)"], input: "" },
  { args: [".a | tag"], input: "a: !thing 1" },
  { args: ["-o=json", ".a"], input: "a: !thing 1" },
  { args: ["."], input: "base: &base {x: 1}\nitem: {<<: *base, y: 2}" },
];

const capture = JSON.parse(await readFile(new URL("./ORACLE_EDGE.json", import.meta.url), "utf8")) as { results: { status: number; stdout: string; stderr: string }[] };
for (const [index, entry] of edges.entries()) test(`native edge ${index}: ${JSON.stringify(entry.args)}`, async () => {
  assert.deepEqual(await run(entry.args, entry.input), capture.results[index]);
});
test("live edge oracle confirms preserved observations", nativeOptions, async () => {
  for (const [index, entry] of edges.entries()) assert.deepEqual(await native(entry.args, entry.input), capture.results[index]);
});

const malformed = [
  ["a: [\n", "while parsing a flow node at line 1: did not find expected node content"],
  ["[1,", "while parsing a flow node at line 1: did not find expected node content"],
  ['"unclosed', "while scanning a quoted scalar at line 1: line 1, column 10: found unexpected end of stream"],
  ["a: *absent", "line 1, column 5: unknown anchor 'absent' referenced"],
  ["[foo # comment\nbar]", "while parsing a flow sequence at <unknown position>: line 1: did not find expected ',' or ']'"],
] as const;
for (const [input, message] of malformed) test(`malformed YAML: ${JSON.stringify(input)}`, async () => {
  assert.deepEqual(await run(["."], input), { status: 1, stdout: "", stderr: `Error: bad file '-': yaml: ${message}\n` });
});
test("selected alias retains native alias notation", async () => {
  assert.deepEqual(await run([".c"], "a: &x {key: 1}\nc: *x"), { status: 0, stdout: "*x\n", stderr: "" });
});
test("live oracle confirms malformed YAML and selected alias", nativeOptions, async () => {
  for (const [input, message] of malformed) assert.deepEqual(await native(["."], input), { status: 1, stdout: "", stderr: `Error: bad file '-': yaml: ${message}\n` });
  assert.deepEqual(await native([".c"], "a: &x {key: 1}\nc: *x"), { status: 0, stdout: "*x\n", stderr: "" });
});

const mergeInput = "base: &base {x: 1, z: 4}\nother: &other {x: 8, y: 2}\nitem: {x: 3, <<: [*base, *other]}\n";
const merges = [
  [".item.x", "3\n"], [".item.z", "4\n"], [".item | .[]", "3\n2\n4\n"],
  [".item.z = 9", "base: &base {x: 1, z: 9}\nother: &other {x: 8, y: 2}\nitem: {x: 3, !!merge <<: [*base, *other]}\n"],
  [".item.z |= . + 1", "base: &base {x: 1, z: 5}\nother: &other {x: 8, y: 2}\nitem: {x: 3, !!merge <<: [*base, *other]}\n"],
] as const;
for (const [query, stdout] of merges) test(`spec merge: ${query}`, async () => {
  assert.deepEqual(await run(["--yaml-fix-merge-anchor-to-spec", query], mergeInput), { status: 0, stdout, stderr: "" });
});
test("live oracle confirms spec merges", nativeOptions, async () => {
  for (const [query, stdout] of merges) assert.deepEqual(await native(["--yaml-fix-merge-anchor-to-spec", query], mergeInput), { status: 0, stdout, stderr: "" });
});

const mergeWarning = ' level=WARN msg="--yaml-fix-merge-anchor-to-spec is false; causing merge anchors to override the existing values which isn\'t to the yaml spec. This flag will default to true in late 2025. See https://mikefarah.gitbook.io/yq/operators/traverse-read for more details."\n';
test("legacy merge precedence warns once per invocation", async () => {
  const result = await run([".item.x, .item.z"], mergeInput);
  assert.equal(result.status, 0); assert.equal(result.stdout, "8\n4\n");
  assert.ok(result.stderr.startsWith("time="));
  const separator = result.stderr.indexOf(" level=");
  assert.ok(Number.isFinite(Date.parse(result.stderr.slice(5, separator))));
  assert.equal(result.stderr.slice(separator), mergeWarning);
});
test("live legacy merge warning has a nondeterministic timestamp", nativeOptions, async () => {
  const result = await native([".item.x, .item.z"], mergeInput);
  assert.equal(result.status, 0); assert.equal(result.stdout, "8\n4\n");
  assert.ok(result.stderr.startsWith("time="));
  const separator = result.stderr.indexOf(" level=");
  assert.ok(Number.isFinite(Date.parse(result.stderr.slice(5, separator))));
  assert.equal(result.stderr.slice(separator), mergeWarning);
});

const indentGrammar = [
  ["-I0x4", "a:\n    b: 1\n"], ["-I010", "a:\n        b: 1\n"],
  ["-I0b10", "a:\n  b: 1\n"], ["-I0o4", "a:\n    b: 1\n"],
  ["-I0_4", "a:\n    b: 1\n"], ["-I+2", "a:\n  b: 1\n"],
] as const;
for (const [option, stdout] of indentGrammar) test(`base-zero indent grammar: ${option}`, async () => {
  assert.deepEqual(await run([option, "."], "a:\n  b: 1\n"), { status: 0, stdout, stderr: "" });
});
for (const option of ["08", "2_", "9223372036854775808"]) test(`invalid indent grammar: ${option}`, async () => {
  const result = await run([`-I${option}`, "."]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.startsWith(`Error: invalid argument "${option}" for "-I, --indent" flag: strconv.ParseInt: parsing "${option}": ${option.length > 10 ? "value out of range" : "invalid syntax"}\n`));
});
test("unused negative YAML indent and negative JSON indent", async () => {
  assert.deepEqual(await run(["-n", "-I-1", "."]), { status: 0, stdout: "\n", stderr: "" });
  assert.deepEqual(await run(["-I-1", "."], "abc"), { status: 0, stdout: "abc\n", stderr: "" });
  assert.deepEqual(await run(["-o=json", "-I-1", "."], "a: 1"), { status: 0, stdout: '{"a":1}\n', stderr: "" });
});
test("live oracle confirms indent and unknown-flag grammar", nativeOptions, async () => {
  for (const [option] of indentGrammar) assert.deepEqual(await run([option, "."], "a:\n  b: 1\n"), await native([option, "."], "a:\n  b: 1\n"));
  for (const args of [["--toString", "."], ["-Q", "."], ["eval", "--toString", "."], ["-I08", "."], ["-I2_", "."], ["-I9223372036854775808", "."], ["-n", "-I-1", "."], ["-o=json", "-I-1", "."]]) assert.deepEqual(await run(args, "a: 1"), await native(args, "a: 1"));
});

const tagCases = [
  [[".a tag = \"!!int\""], 'a: "12"', 'a: "12"\n'],
  [[".a tag = \"!!int\" | .a += 1"], 'a: "12"', 'a: "13"\n'],
  [["-o=json", ".a tag = \"!!int\""], 'a: "12"', '{\n  "a": 12\n}\n'],
  [[".a tag = \"!!bool\""], 'a: "true"', 'a: "true"\n'],
  [[".a = .a + 1"], "a: !!int 1", "a: !!int 2\n"],
  [[".a = 2"], "a: !!str foo", "a: 2\n"],
  [[".a style = \"folded\""], 'a: "a b"', 'a: >-\n  a b\n'],
  [["-o=json", "."], "a: !thing 001", '{\n  "a": 1\n}\n'],
  [["-o=json", "."], "a: !thing +001", '{\n  "a": 1\n}\n'],
  [[".a"], "1", ""],
] as const;
for (const [args, input, stdout] of tagCases) test(`tag and scalar semantics: ${JSON.stringify(args)} ${input}`, async () => {
  assert.deepEqual(await run(args, input), { status: 0, stdout, stderr: "" });
});
test("unknown scalar styles are rejected", async () => {
  assert.deepEqual(await run(['.a style = "weird"'], "a: abc"), { status: 1, stdout: "", stderr: "Error: unknown style weird\n" });
});
test("live oracle confirms tags and scalar semantics", nativeOptions, async () => {
  for (const [args, input, stdout] of tagCases) assert.deepEqual(await native(args, input), { status: 0, stdout, stderr: "" });
  assert.deepEqual(await run(['.a style = "weird"'], "a: abc"), await native(['.a style = "weird"'], "a: abc"));
});

test("eval publishes earlier documents before a later YAML parse error", async () => {
  assert.deepEqual(await run(["."], "a: 1\n---\na: [\n"), { status: 1, stdout: "a: 1\n", stderr: "Error: bad file '-': yaml: while parsing a flow node at line 3: did not find expected node content\n" });
});
test("eval-all publishes nothing on a later YAML parse error", async () => {
  assert.deepEqual(await run(["ea", "."], "a: 1\n---\na: [\n"), { status: 1, stdout: "", stderr: "Error: bad file '-': yaml: while parsing a flow node at line 3: did not find expected node content\n" });
});
test("missing file uses the native open diagnostic", async () => {
  assert.deepEqual(await run([".", "/no-such-yq-native-20260904-input"]), { status: 1, stdout: "", stderr: "Error: open /no-such-yq-native-20260904-input: no such file or directory\n" });
});
test("live oracle confirms partial output and missing-file diagnostics", nativeOptions, async () => {
  for (const args of [["."], ["ea", "."]]) assert.deepEqual(await run(args, "a: 1\n---\na: [\n"), await native(args, "a: 1\n---\na: [\n"));
  assert.deepEqual(await run([".", "/no-such-yq-native-20260904-input"]), await native([".", "/no-such-yq-native-20260904-input"]));
});

const boundaries = JSON.parse(await readFile(new URL("./ORACLE_BOUNDARIES.json", import.meta.url), "utf8")) as { records: { args: string[]; input: string; native: { status: number; stdout: string; stderr: string } }[] };
for (const index of [2, 3, 5, 7]) test(`repair preserved boundary ${index}`, async () => {
  const entry = boundaries.records[index]!;
  assert.deepEqual(await run(entry.args, entry.input), entry.native);
});
test("live oracle confirms four repaired boundaries", nativeOptions, async () => {
  for (const index of [2, 3, 5, 7]) {
    const entry = boundaries.records[index]!;
    assert.deepEqual(await native(entry.args, entry.input), entry.native);
  }
});

const slices = [
  [".[0:2]", "[1,2,3]", "- 1\n- 2\n"],
  [".[1:]", "[1,2,3]", "- 2\n- 3\n"],
  [".[:2]", "[1,2,3]", "- 1\n- 2\n"],
  [".[-2:]", "[1,2,3]", "- 2\n- 3\n"],
  [".[1:3]", '"a😀bc"', "😀b\n"],
  [".[-20:100]", '"a😀bc"', "a😀bc\n"],
  [".[3:1]", "[1,2,3]", "[]\n"],
  [".[1:2]", "{a: 1,b: 2}", "!!map\n- 1\n"],
  [".[1:2]", "1", "!!int []\n"],
  [".[0:2]=[9]", "[1,2,3]", "[1, 2, 3]\n"],
  [".[0:2][] = 9", "[1,2,3]", "[1, 2, 3]\n"],
  [".[0:length]", "[1,2,3]", "- 1\n- 2\n- 3\n"],
] as const;
for (const [query, input, stdout] of slices) test(`slice: ${query} ${input}`, async () => {
  assert.deepEqual(await run([query], input), { status: 0, stdout, stderr: "" });
});
const badSlices = [
  [".[0.5:2]", 'strconv.ParseInt: parsing "0.5": invalid syntax'],
  [".[(0,1):2]", "expected to find 1 number, got 2 instead"],
  [".[null:2]", 'strconv.ParseInt: parsing "null": invalid syntax'],
] as const;
for (const [query, error] of badSlices) test(`invalid slice: ${query}`, async () => {
  assert.deepEqual(await run([query], "[1,2,3]"), { status: 1, stdout: "", stderr: `Error: ${error}\n` });
});
test("live oracle confirms slices and index diagnostics", nativeOptions, async () => {
  for (const [query, input, stdout] of slices) assert.deepEqual(await native([query], input), { status: 0, stdout, stderr: "" });
  for (const [query, error] of badSlices) assert.deepEqual(await native([query], "[1,2,3]"), { status: 1, stdout: "", stderr: `Error: ${error}\n` });
});

const expressionReview = [
  [".a == .b", "a: 01\nb: 1\n", "false\n"],
  [".a == .b", "a: TRUE\nb: true\n", "false\n"],
  [".a == .b", 'a: "null"\nb: null\n', "true\n"],
  [".a == .b", 'a: null\nb: "null"\n', "false\n"],
  [".a | length", 'a: "😀é"\n', "6\n"],
  [".a | length", "a: 001\n", "3\n"],
  [".a | length", "a: TRUE\n", "4\n"],
  [".a = .missing.deep", "a: 1\n", "a: 1\n"],
  [".a = .missing[0]", "a: 1\n", "a: 1\n"],
  [".a = .missing", "{}\n", "a: null\n"],
  [".a = .b", "a: 1\nb: null\n", "a: null\nb: null\n"],
  [".a |= .missing", "a: 1\n", "a: 1\n"],
  [".a = (.missing == null)", "a: 1\n", "a: true\n"],
  [".a = (.missing + 2)", "a: 1\n", "a: 2\n"],
  [".a = (2 + .missing)", "a: 1\n", "a: 2\n"],
  [".a = (.missing + .absent)", "a: 1\n", "a: 1\n"],
  [".a + .b", "a: null\nb: {x: 3}\n", "{x: 3}\n"],
] as const;
for (const [query, input, stdout] of expressionReview) test(`expression review: ${query} ${JSON.stringify(input)}`, async () => {
  assert.deepEqual(await run([query], input), { status: 0, stdout, stderr: "" });
});
test("live oracle confirms expression review boundaries", nativeOptions, async () => {
  for (const [query, input, stdout] of expressionReview) assert.deepEqual(await native([query], input), { status: 0, stdout, stderr: "" });
});

const nextPhaseCases: readonly {
  name: string;
  args: readonly string[];
  input: string;
  expected: { status: number; stdout: string; stderr: string };
}[] = [
  { name: "JSON large-number rounding control", args: ["-p=json", "-o=json", "."], input: '{"value":9007199254740993}', expected: { status: 0, stdout: '{\n  "value": 9007199254740992\n}\n', stderr: "" } },
  { name: "JSON exponent and negative-zero control", args: ["-p=json", "-o=json", "."], input: '{"value":1e3,"negative":-0}', expected: { status: 0, stdout: '{\n  "value": 1000,\n  "negative": 0\n}\n', stderr: "" } },
  { name: "duplicate JSON object members", args: ["-p=json", "-o=json", "."], input: '{"a":1,"a":2}', expected: { status: 0, stdout: '{\n  "a": 1,\n  "a": 2\n}\n', stderr: "" } },
  { name: "star wildcard equality", args: ['.a == "foo*"'], input: "a: foobar\n", expected: { status: 0, stdout: "true\n", stderr: "" } },
  { name: "read-only array traversal still extends the array", args: [".a = .items[2]"], input: "a: 1\nitems: []\n", expected: { status: 0, stdout: "a: null\nitems:\n  - null\n  - null\n  - null\n", stderr: "" } },
  { name: "unsupported alternative-assignment diagnostic", args: [".a //= 2"], input: "a: null\n", expected: { status: 1, stdout: "", stderr: "Error: '//' expects 2 args but there is 1\n" } },
  { name: "numeric plus string assignment", args: ['.a += "!"'], input: "a: 1\n", expected: { status: 0, stdout: "a: 1!\n", stderr: "" } },
  { name: "custom-tagged integer addition", args: [".a + 1"], input: "a: !thing 1\n", expected: { status: 0, stdout: "2\n", stderr: "" } },
  { name: "string tag preserves lexical boolean spelling", args: ['(.a | tag) = "!!str"'], input: "a: TRUE\n", expected: { status: 0, stdout: "a: TRUE\n", stderr: "" } },
  { name: "float-expression tag control", args: ["-n", ".a = 1.20 | .a | tag"], input: "", expected: { status: 0, stdout: "!!float\n", stderr: "" } },
  { name: "JSON missing value diagnostic", args: ["-p=json", "."], input: '{"x":}', expected: { status: 1, stdout: "", stderr: "Error: bad file '-': json: value of object unexpected end of JSON input\n" } },
  { name: "unindented multiline quoted YAML", args: ["."], input: 'a: "hello\nworld"\n', expected: { status: 0, stdout: 'a: "hello world"\n', stderr: "" } },
  { name: "JSON numeric-looking member order", args: ["-p=json", "-o=json", "."], input: '{"10":1,"2":2,"x":3}', expected: { status: 0, stdout: '{\n  "10": 1,\n  "2": 2,\n  "x": 3\n}\n', stderr: "" } },
  { name: "question-mark wildcard equality", args: ['.a == "f?o"'], input: "a: foo\n", expected: { status: 0, stdout: "true\n", stderr: "" } },
  { name: "brackets remain literal in wildcard equality control", args: ['.a == "f[oa]o"'], input: "a: foo\n", expected: { status: 0, stdout: "false\n", stderr: "" } },
  { name: "hexadecimal arithmetic spelling", args: [".a += 1"], input: "a: 0x10\n", expected: { status: 0, stdout: "a: 0x11\n", stderr: "" } },
  { name: "sequence plus scalar", args: [".a + 2"], input: "a: [1]\n", expected: { status: 0, stdout: "[1, 2]\n", stderr: "" } },
];
for (const entry of nextPhaseCases) test(`next-phase regression: ${entry.name}`, async () => {
  assert.deepEqual(await run(entry.args, entry.input), entry.expected);
});
test("live oracle confirms all seventeen next-phase observations", nativeOptions, async () => {
  for (const entry of nextPhaseCases) assert.deepEqual(await native(entry.args, entry.input), entry.expected, entry.name);
});

const quoteBoundaries = [
  ["a: 'hello\nworld'\n", "a: 'hello world'\n"],
  ['a:\n  b: "hello\nworld"\n', 'a:\n  b: "hello world"\n'],
  ['a: "hello\nworld" # tail\nb: 2\n', 'a: "hello world" # tail\nb: 2\n'],
  ['{a: "hello\nworld", b: 2}\n', '{a: "hello world", b: 2}\n'],
  ["a: 'one''two\nthree'\n", "a: 'one''two three'\n"],
  ['a: "hello\n\nworld"\n', 'a: "hello\\nworld"\n'],
  ['a: |\n  "hello\n  world"\n', 'a: |\n  "hello\n  world"\n'],
] as const;
for (const [input, stdout] of quoteBoundaries) test(`quoted continuation boundary: ${JSON.stringify(input)}`, async () => {
  assert.deepEqual(await run(["."], input), { status: 0, stdout, stderr: "" });
});
test("a quoted continuation cannot consume a document indicator", async () => {
  assert.deepEqual(await run(["."], 'a: "hello\n---\nworld"\n'), { status: 1, stdout: "", stderr: "Error: bad file '-': yaml: while scanning a quoted scalar at line 1, column 4: line 2: found unexpected document indicator\n" });
});
test("live oracle confirms quoted continuation boundaries", nativeOptions, async () => {
  for (const [input, stdout] of quoteBoundaries) assert.deepEqual(await native(["."], input), { status: 0, stdout, stderr: "" });
  assert.deepEqual(await native(["."], 'a: "hello\n---\nworld"\n'), { status: 1, stdout: "", stderr: "Error: bad file '-': yaml: while scanning a quoted scalar at line 1, column 4: line 2: found unexpected document indicator\n" });
});

test("a later quoted-document error retains earlier eval output", async () => {
  assert.deepEqual(await run(["."], 'a: 1\n---\nb: "hello\n---\nworld"\n'), { status: 1, stdout: "a: 1\n", stderr: "Error: bad file '-': yaml: while scanning a quoted scalar at line 3, column 4: line 4: found unexpected document indicator\n" });
});
test("double-quote styling retains the original scalar spelling", async () => {
  assert.deepEqual(await run(['.a style="double"'], "a: TRUE\n"), { status: 0, stdout: 'a: "TRUE"\n', stderr: "" });
});
test("live oracle confirms late quote failure and scalar styling", nativeOptions, async () => {
  assert.deepEqual(await native(["."], 'a: 1\n---\nb: "hello\n---\nworld"\n'), { status: 1, stdout: "a: 1\n", stderr: "Error: bad file '-': yaml: while scanning a quoted scalar at line 3, column 4: line 4: found unexpected document indicator\n" });
  assert.deepEqual(await native(['.a style="double"'], "a: TRUE\n"), { status: 0, stdout: 'a: "TRUE"\n', stderr: "" });
});

const repairedOperatorControls = [
  { args: ["-p=json", ".a"], input: '{"a":1,"a":2}', stdout: "2\n" },
  { args: ["-p=json", "-o=json", ".a=3"], input: '{"a":1,"a":2}', stdout: '{\n  "a": 1,\n  "a": 3\n}\n' },
  { args: ["-p=json", "-o=json", "."], input: '{"__proto__":{"a":1},"x":{"a":1,"a":2},"constructor":0}', stdout: '{\n  "__proto__": {\n    "a": 1\n  },\n  "x": {\n    "a": 1,\n    "a": 2\n  },\n  "constructor": 0\n}\n' },
  { args: ['.a == "*"'], input: 'a: ""\n', stdout: "true\n" },
  { args: ['.a == "f?o"'], input: "a: f😀o\n", stdout: "false\n" },
  { args: ['.a == "f????o"'], input: "a: f😀o\n", stdout: "true\n" },
  { args: ['.a tag="!!str"'], input: "a: TRUE\n", stdout: 'a: "TRUE"\n' },
] as const;
for (const entry of repairedOperatorControls) test(`repaired operator control: ${JSON.stringify(entry.args)} ${entry.input}`, async () => {
  assert.deepEqual(await run(entry.args, entry.input), { status: 0, stdout: entry.stdout, stderr: "" });
});
test("live oracle confirms duplicate-member and byte-wildcard controls", nativeOptions, async () => {
  for (const entry of repairedOperatorControls) assert.deepEqual(await native(entry.args, entry.input), { status: 0, stdout: entry.stdout, stderr: "" });
});

const followupReviewCases = [
  { name: "multiline key diagnostic identifies colon after whitespace", args: ["."], input: '"one\ntwo"  : 3\n', expected: { status: 1, stdout: "", stderr: "Error: bad file '-': yaml: line 2, column 7: mapping values are not allowed in this context\n" } },
  { name: "signed YAML float cannot inject a non-JSON numeric spelling", args: ["-o=json", "-I0", "."], input: "a: !!float +1.5\n", expected: { status: 0, stdout: '{"a":1.5}\n', stderr: "" } },
  { name: "signed custom hexadecimal arithmetic retains native parse refusal", args: [".a + .b"], input: "a: !number -0x10\nb: 1\n", expected: { status: 1, stdout: "", stderr: 'Error: strconv.ParseInt: parsing "-0x10": invalid syntax\n' } },
  { name: "surrogate replacement preserves valid pairs and member order", args: ["-p=json", "-o=json", "-I0", "."], input: '{"\\ud800":"\\udc00","pair":"\\ud83d\\ude00"}', expected: { status: 0, stdout: '{"�":"�","pair":"😀"}\n', stderr: "" } },
  { name: "native omitted object commas do not require whitespace", args: ["-p=json", "-o=json", "-I0", "."], input: '{"a":1"b":{"x":true "y":false}}', expected: { status: 0, stdout: '{"a":1,"b":{"x":true,"y":false}}\n', stderr: "" } },
  { name: "pinned int64 conversion and exponent thresholds", args: ["-p=json", "-o=json", "-I0", "."], input: '[9223372036854775807,9223372036854775808,9223372036854777856,-9223372036854775809,1e20,1e-4,1e-5,1e-6,1e-7]', expected: { status: 0, stdout: '[9223372036854775807,9223372036854775807,9.223372036854778e+18,-9223372036854775808,1e+20,0.0001,1e-05,1e-06,1e-07]\n', stderr: "" } },
] as const;
for (const entry of followupReviewCases) test(`review repair boundary: ${entry.name}`, async () => {
  assert.deepEqual(await run(entry.args, entry.input), entry.expected);
});
test("live oracle confirms review repair boundaries", nativeOptions, async () => {
  for (const entry of followupReviewCases) assert.deepEqual(await native(entry.args, entry.input), entry.expected, entry.name);
});
