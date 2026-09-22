import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtml, selectHtml, htmlqBytes, parseHtmlqArguments, HtmlError, type HtmlOptions } from "./index.js";
const options: HtmlOptions = {
  signal: new AbortController().signal,
  limits: {
    inputBytes: 100000,
    decodedBytes: 200000,
    retainedBytes: 4000000,
    nodes: 10000,
    attributes: 10000,
    depth: 100,
    tokenBytes: 100000,
    work: 1000000,
    outputBytes: 100000
  }
};
async function* input(s: string) {
  yield new TextEncoder().encode(s);
}
async function run(s: string, argv: readonly string[]) {
  let result = "";
  for await (const chunk of htmlqBytes(input(s), argv, options))
    result += new TextDecoder().decode(chunk);
  return result;
}
test("selector lists, all combinators, attributes and structural arithmetic", async () => {
  const doc = await parseHtml(
    input('<div><p id="a" class="x y" title="Ab-c">A</p> <p>B</p><span>C</span><p>D</p></div>'),
    options
  );
  for (const [selector, names] of [
    ["#a,div > p:nth-child(2),div p:last-child", ["p", "p", "p"]],
    ["p + span", ["span"]],
    ["#a ~ p", ["p", "p"]],
    ['.x.y[title^="ab" i][title|="Ab"]', ["p"]],
    ["p:nth-of-type(-n+2):not(:first-child)", ["p"]],
    [":scope", ["html"]],
    ["div:empty", []]
  ] as const)
    assert.deepEqual(
      [...selectHtml(doc, selector, options)].map((n) => n.name),
      names
    );
});
test("legacy unsupported grammar is explicit; state predicates always false", async () => {
  const doc = await parseHtml(
    input('<input checked disabled><a href="">X</a><p class="x y">Y</p>'),
    options
  );
  assert.equal([...selectHtml(doc, ":checked,:disabled,:enabled,:visited", options)].length, 0);
  assert.equal([...selectHtml(doc, ":any-link", options)].length, 1);
  assert.equal([...selectHtml(doc, ".x", options)].length, 0);
  for (const selector of [
    ":is(p)",
    ":where(p)",
    ":has(p)",
    ":lang(en)",
    ":not(:not(p))",
    "ns|p",
    "[",
    "p >"
  ])
    assert.throws(
      () => [...selectHtml(doc, selector, options)],
      (e: unknown) => e instanceof HtmlError && e.code === "E_SELECTOR"
    );
});
test("projections retain raw text, ordered attributes and whitespace rules", async () => {
  assert.equal(
    await run('<p title="" id="I">A<b>B</b></p>', [
      "p",
      "-a",
      "missing",
      "-a",
      "title",
      "-a",
      "id",
      "-t",
      "-p"
    ]),
    "\nI\n"
  );
  assert.equal(await run("<p> <b>A</b> <i>B</i> </p>", ["p", "-t", "-i"]), "A\nB\n\n");
  assert.equal(await run("<p> <b>​</b></p>", ["p", "-t", "-i"]), "​\n\n");
  assert.equal(await run("<script>a < b && c</script>", ["script", "-t"]), "a < b && c\n");
  assert.equal(await run("<p>X</p>", [".absent"]), "");
  assert.equal(await run("<template><p>T</p></template>", ["template"]), "<template></template>\n");
});
test("removal uses live queued traversal and first inclusive match", async () => {
  const s = '<div id="a"><span>1</span><span>2</span></div><div id="b"><span>3</span></div>';
  assert.equal(await run(s, ["div", "-r", "span"]), '<div id="a"><span>2</span></div>\n');
  assert.equal(
    await run(s, ["div", "-r", "span:last-child"]),
    '<div id="a"><span>1</span></div>\n<div id="b"></div>\n'
  );
  assert.equal(
    await run(s, ["div,span", "-r", "span"]),
    '<div id="a"><span>2</span></div>\n<span>1</span>\n'
  );
  assert.equal(
    await run("<div><span>X</span></div>", ["div", "-r", "div"]),
    "<div><span>X</span></div>\n"
  );
  assert.equal(await run("<p>X</p>", ["p", "-r", "["]), "<p>X</p>\n");
});
test("URL rewrite only selected links; first invalid base falls back", async () => {
  assert.equal(
    await run('<base href="relative"><base href="https://other.test/"><a href="child">X</a>', [
      "a",
      "-a",
      "href",
      "-B",
      "-b",
      "https://e.test/dir/"
    ]),
    "https://e.test/dir/child\n"
  );
  assert.equal(
    await run('<base href="https://d.test/x/"><a href="child">X</a>', [
      "a",
      "-a",
      "href",
      "-B",
      "-b",
      "https://e.test/"
    ]),
    "https://d.test/x/child\n"
  );
  assert.equal(
    await run('<a href="/////host/path">X</a>', ["a", "-a", "href", "-b", "https://e.test/"]),
    "host/path\n"
  );
  assert.equal(
    await run('<a href="http://[">X</a>', ["a", "-a", "href", "-b", "https://e.test/dir/"]),
    "https://e.test/dir/\n"
  );
  assert.equal(
    await run('<div><a href="child">X</a><img src="child"></div>', [
      "div",
      "-b",
      "https://e.test/"
    ]),
    '<div><a href="child">X</a><img src="child"></div>\n'
  );
});
test("stateful pretty formatting and argument validation", async () => {
  assert.equal(
    await run("<div><span>X</span></div>", ["div", "-p"]),
    "\n<div><span>X</span>\n</div>\n"
  );
  assert.equal(await run("<pre> \n </pre>", ["pre", "-p"]), "\n<pre>\n</pre>\n");
  for (const argv of [["--attribute", "id"], ["--tex"], ["p", "file"]])
    await assert.rejects(run("<p>X</p>", argv));
});
test("escaped identifiers and strict nth token boundaries", async () => {
  const doc = await parseHtml(input('<p id="1:a" class="é x">A</p><p>B</p>'), options);
  assert.equal([...selectHtml(doc, "#\\31 \\:a.é", options)].length, 1);
  assert.equal([...selectHtml(doc, "p:nth-child(2n + 1)", options)].length, 1);
  for (const selector of [
    "p:nth-child(1 2)",
    "p:nth-child(2 n)",
    "p:nth-child(n + -1)",
    "123",
    ".1",
    "#1",
    "[id=1]"
  ])
    assert.throws(
      () => [...selectHtml(doc, selector, options)],
      (e: unknown) => e instanceof HtmlError && e.code === "E_SELECTOR"
    );
});
test("decoded bytes and repeated projection output use invocation ceilings", async () => {
  const small = { ...options, limits: { ...options.limits, decodedBytes: 1 } };
  await assert.rejects(
    async () => {
      for await (const _chunk of htmlqBytes(input("<p>X</p>"), ["p"], small)) void _chunk;
    },
    (e: unknown) => e instanceof HtmlError && e.resource === "decodedBytes"
  );
  const output = { ...options, limits: { ...options.limits, outputBytes: 3 } };
  await assert.rejects(
    async () => {
      for await (const _chunk of htmlqBytes(input("<p>A</p><p>B</p>"), ["p", "-t"], output))
        void _chunk;
    },
    (e: unknown) => e instanceof HtmlError && e.resource === "outputBytes"
  );
  const cancelled = new AbortController();
  cancelled.abort();
  assert.throws(
    () => selectHtml({} as never, "*", { ...options, signal: cancelled.signal }),
    (e: unknown) => e instanceof HtmlError && e.code === "E_CANCELLED"
  );
});
test("selectors 0.22 negation accepts exactly one simple selector and nth coefficients are i32", async () => {
  const doc = await parseHtml(input('<p class="x y">A</p><p>B</p>'), options);
  for (const selector of [
    ":not(p,div)",
    ":not(.x.y)",
    ":not(div > p)",
    "p:nth-child(2147483648)",
    "p:nth-child(-2147483649n)"
  ])
    assert.throws(
      () => [...selectHtml(doc, selector, options)],
      (e: unknown) => e instanceof HtmlError && e.code === "E_SELECTOR"
    );
  assert.equal([...selectHtml(doc, "p:not(.x)", options)].length, 1);
});
test("selector work includes long ID comparisons and retained AST strings", async () => {
  const id = "a".repeat(100);
  const document = await parseHtml(input(`<p id="${id}">X</p>`), options);
  assert.throws(
    () => [
      ...selectHtml(document, "#" + id, { ...options, limits: { ...options.limits, work: 180 } })
    ],
    (error: unknown) => error instanceof HtmlError && error.resource === "work"
  );
  assert.throws(
    () =>
      selectHtml(document, "#" + id, {
        ...options,
        limits: { ...options.limits, retainedBytes: 400 }
      }),
    (error: unknown) => error instanceof HtmlError && error.resource === "retainedBytes"
  );
});
test("separate option values obey the same token ceiling as attached values", () => {
  const limited = { ...options, limits: { ...options.limits, tokenBytes: 32 } };
  const value = "x".repeat(17);
  for (const flag of ["-f", "-o", "-b", "-a", "-r", "--filename", "--output", "--base", "--attributes", "--remove-nodes"])
    assert.throws(
      () => parseHtmlqArguments([flag, value], limited),
      (error: unknown) => error instanceof HtmlError && error.resource === "tokenBytes",
      flag
    );
  assert.equal(parseHtmlqArguments(["-a", "x".repeat(16)], limited).attributes[0]?.length, 16);
});
