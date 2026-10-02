import assert from "node:assert/strict";
import test from "node:test";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createXmllintCommand, type XmllintCommandsOptions } from "./index.js";

const document = '<root><item id="a" n="10">First</item><item id="b" n="20"><sub>Second</sub></item></root>';
async function run(args: string[], input = document, options: XmllintCommandsOptions = {}) {
  let output = "", errors = "";
  const files = new Map<string, Uint8Array>();
  const carrier = createCommandArguments(args);
  const context = {
    args: carrier.args, arguments: carrier, command: "xmllint", cwd: "/", env: {},
    signal: new AbortController().signal, stdin: toByteSource(input),
    fs: { async writeFile(path: string, bytes: Uint8Array) { files.set(path, bytes.slice()); } },
    stdout: { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors += new TextDecoder().decode(bytes); } },
  } as unknown as CommandContext;
  const result = await createXmllintCommand(options).execute(context);
  return { ...result, output, errors, files };
}
for (const [query, expected] of [
  ['concat(/root/item[1], "-", /root/item[2]/sub)', "First-Second"],
  ['//item[contains(., "Fir")]/@id', ' id="a"'],
  ['//item[starts-with(@id, "a")]/text()', "First"],
  ['string-length(/root/item[1])', "5"],
  ['normalize-space("  a   b  ")', "a b"],
  ['substring("12345", 1.5, 2.6)', "234"],
  ['substring("12345", 0, 3)', "12"],
  ['substring-before("a-b-c", "-")', "a"],
  ['substring-after("a-b-c", "-")', "b-c"],
  ['translate("bar", "abc", "ABC")', "BAr"],
  ['name(/root/*[1])', "item"],
  ['local-name(/root/*[1])', "item"],
  ['namespace-uri(/root)', ""],
  ['not(/root/nonexistent)', "true"],
  ['boolean(/root/item)', "true"],
  ['true()', "true"], ['false()', "false"],
  ['sum(//item/@n)', "30"],
  ['number(/root/item[1]/@n)', "10"],
  ['floor(1.9)', "1"], ['ceiling(1.1)', "2"], ['round(-1.5)', "-1"],
  ['concat(substring("😀abc", 2), string-length("😀a"))', "abc2"],
  ['//item[string-length(.) > 5]/@id', ' id="b"'],
  ['//item[name() = "item" and number(@n) > 15]/@id', ' id="b"'],
  ['string()', "FirstSecond"],
  ['normalize-space()', "FirstSecond"],
  ['name()', ""],
  ['number("1e3")', "1000"],
  ['sum(/root/item[1]/@n | /root/item[2]/@n)', "30"],
  ['substring("abc", number(""))', ""],
  ['//item[sum(@n)>15]/@id', ' id="b"'],
  ['//item[contains(sub/text(), "Sec")]/@id', ' id="b"'],
  ['concat(true(), "-", false(), "-", number("bad"))', "true-false-NaN"],
] as const) test(query, async () => {
  const result = await run(["--xpath", query]);
  assert.equal(result.exitCode, 0, result.errors);
  assert.equal(result.output, expected + "\n");
});

for (const [query, expected] of [
  ["sum(//price)", "30"],
  ["number(//price[1])", "10"],
  ["normalize-space(//title[1])", "XML Guide"],
  ["concat(//title[1], ' - ', //title[2])", "  XML  Guide  - Reference"],
  ["contains(//title[1], 'XML')", "true"],
  ["starts-with(//title[2], 'Ref')", "true"],
  ["substring(//title[2], 2, 3)", "efe"],
  ["string-length(//title[2])", "9"],
  ["name(/*)", "books"],
  ["local-name(/*)", "books"],
] as const) test(`core functions on element node sets: ${query}`, async () => {
  const result = await run(["--xpath", query],
    "<books><title>  XML  Guide </title><title>Reference</title><price>10</price><price>20</price></books>");
  assert.equal(result.exitCode, 0, result.errors);
  assert.equal(result.output, expected + "\n");
});

test("namespace naming functions", async () => {
  const result = await run(["--xpath", 'concat(name(/*), "|", local-name(/*), "|", namespace-uri(/*))'], '<p:root xmlns:p="urn:p"/>');
  assert.equal(result.exitCode, 0, result.errors);
  assert.equal(result.output, "p:root|root|urn:p\n");
});

for (const flag of ["--output", "-o"]) test(flag, async () => {
  const result = await run([flag, "out.xml", "--noblanks", "--format", "--encode", "UTF-8", "-"], "<root>\n <item/>\n</root>");
  assert.equal(result.exitCode, 0, result.errors);
  assert.equal(result.output, "");
  assert.equal(new TextDecoder().decode(result.files.get("/out.xml")), '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <item/>\n</root>\n');
});
test("noblanks affects XPath text nodes", async () => {
  const result = await run(["--noblanks", "--xpath", "count(/root/text())"], "<root>\n <item/>\n</root>");
  assert.equal(result.exitCode, 0, result.errors);
  assert.equal(result.output, "0\n");
});
test("exclusive canonicalization omits unused namespaces", async () => {
  const result = await run(["--exc-c14n"], '<root xmlns:p="urn:p"><p:item/></root>');
  assert.equal(result.exitCode, 0, result.errors);
  assert.equal(result.output, '<root><p:item xmlns:p="urn:p"></p:item></root>');
});
test("recover closes truncated elements", async () => {
  const result = await run(["--recover"], "<root><item>value");
  assert.equal(result.exitCode, 0, result.errors);
  assert.equal(result.output, '<?xml version="1.0"?>\n<root><item>value</item></root>\n');
});

test("output is admitted before a destination file is replaced", async () => {
  const result = await run(["--output", "out.xml"], "<root/>", { limits: { maxOutputBytes: 3 } });
  assert.equal(result.exitCode, 5);
  assert.equal(result.files.size, 0);
});
test("function results obey output, source, results and nesting limits", async () => {
  for (const [query, limits] of [
    ['concat("abc", "def")', { maxOutputBytes: 5 }],
    ['sum(//item/@n)', { maxResults: 1 }],
    ['not(not(true()))', { maxDepth: 2 }],
    ['string-length("abc")', { maxSourceBytes: 5 }]
  ] as const) {
    const result = await run(["--xpath", query], document, { limits });
    assert.equal(result.exitCode, 5, result.errors);
    assert.equal(result.output, "");
  }
});
test("malformed function arguments are rejected without input reads", async () => {
  const carrier = createCommandArguments(["--xpath", 'concat(/root/, "x")']);
  const context = { command: "xmllint", ...carrier, signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() { return { async next() { assert.fail("input was read"); } }; } },
    stderr: { async write() {} }
  } as unknown as CommandContext;
  assert.equal((await createXmllintCommand().execute(context)).exitCode, 10);
});
test("noout does not create an output file", async () => {
  const result = await run(["--noout", "-o", "out.xml"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.files.size, 0);
});
test("noblanks preserves xml:space and text-only whitespace", async () => {
  const result = await run(["--noblanks"], '<root xml:space="preserve"> <item> </item> </root>');
  assert.equal(result.output, '<?xml version="1.0"?>\n<root xml:space="preserve"> <item> </item> </root>\n');
});
for (const query of ['concat("a")', 'sum("1")', 'name("x")', 'contains("a")', 'true(1)']) test(`reject ${query}`, async () => {
  assert.equal((await run(["--xpath", query])).exitCode, 10);
});

test("output encoding preserves XML declaration attribute order", async () => {
  const result = await run(["--encode", "UTF-8"], '<?xml version="1.0" standalone="yes"?><root/>');
  assert.equal(result.output, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<root/>\n');
});
for (const [encoding, expected] of [
  ["US-ASCII", '<?xml version="1.0" encoding="US-ASCII"?>\n<root>&#233;&#128512;</root>\n'],
  ["ISO-8859-1", '<?xml version="1.0" encoding="ISO-8859-1"?>\n<root>é&#128512;</root>\n']
] as const) test(encoding + " output bytes", async () => {
  const result = await run(["--encode", encoding, "-o", "out.xml"], "<root>é😀</root>");
  assert.equal(result.exitCode, 0, result.errors);
  assert.deepEqual(result.files.get("/out.xml"), Uint8Array.from(expected, char => char.charCodeAt(0)));
});
test("UTF-16 output includes its BOM and is limited by bytes", async () => {
  const result = await run(["--encode", "UTF-16", "-o", "out.xml"], "<root>😀</root>");
  const bytes = result.files.get("/out.xml")!;
  assert.deepEqual([...bytes.slice(0, 2)], [255, 254]);
  assert.equal(new TextDecoder("utf-16").decode(bytes), '<?xml version="1.0" encoding="UTF-16"?>\n<root>😀</root>\n');
  const limited = await run(["--encode", "UTF-16", "-o", "out.xml"], "<root>😀</root>", { limits: { maxOutputBytes: bytes.length - 1 } });
  assert.equal(limited.exitCode, 5);
  assert.equal(limited.files.size, 0);
});

for (const [query, expected] of [
  ["string(//item[@id=2])", "Beta"],
  ["//item[@id!=1]/text()", "Beta"],
  ["//item[@id<2]/text()", "Alpha"],
  ["//item[@id<=1]/text()", "Alpha"],
  ["//item[@id>1]/text()", "Beta"],
  ["//item[@id>=2]/text()", "Beta"],
  ["//item[contains(@class, 'foo')]/text()", "Alpha"],
  ["//item[starts-with(@class, 'ba')]/text()", "Beta"],
  ["//item[not(@id='1')]/text()", "Beta"],
  ["//item[@id='1' and @class='foo bar']/text()", "Alpha"],
  ["//item[@id='1' or @id='2']/text()", "Alpha\nBeta"],
  ["number(//item/@id)", "1"],
  ["concat(//item[1]/text(), '-', //item[2]/text())", "Alpha-Beta"],
] as const) test(`attribute predicate parity: ${query}`, async () => {
  const result = await run(["--xpath", query],
    '<root><item id="1" class="foo bar">Alpha</item><item id="2" class="bar">Beta</item></root>');
  assert.equal(result.exitCode, 0, result.errors);
  assert.equal(result.output, expected + "\n");
});

for (const [query, expected] of [["-1 + 2", "1\n"], ["-number(/root/item[1]/@n)", "-10\n"]]) {
  test(`XPath accepts unary minus: ${query}`, async () => {
    const result = await run(["--xpath", query!]);
    assert.equal(result.exitCode, 0, result.errors);
    assert.equal(result.output, expected);
  });
}

