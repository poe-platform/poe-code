import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlqBytes, type HtmlOptions } from "./index.js";
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
async function run(source: string, argv: readonly string[]): Promise<string> {
  const bytes = (async function* () {
    yield new TextEncoder().encode(source);
  })();
  let result = "";
  for await (const chunk of htmlqBytes(bytes, argv, options))
    result += new TextDecoder().decode(chunk);
  return result;
}
// Independent literal expectations transcribed from the pinned acceptance matrix;
// they qualify these fixtures, never complete HTML5/selector/URL grammar parity.
const matrix: readonly [string, string, readonly string[], string][] = [
  ["A01", "<p>A</p>", [], "<html><head></head><body><p>A</p></body></html>\n"],
  ["A02", "<p>A</p>", [".absent"], ""],
  ["A03", "<p>B</p><p>A</p>", ["p", "-t"], "B\nA\n"],
  ["A04", '<p id="a">A</p><p id="b">B</p>', ["#b,p", "-t"], "A\nB\n"],
  ["A05", '<p title="T" id="I">X</p>', ["p", "-a", "id", "-a", "title", "-t", "-p"], "I\nT\n"],
  ["A06", '<p title="">X</p>', ["p", "-a", "missing", "-a", "title"], "\n"],
  ["A07", '<p title="&amp;&quot;&lt;&#160;">X</p>', ["p", "--attributes", "title"], '&"< \n'],
  ["A08", "<p>A<b>B</b>C</p>", ["p", "-t", "-p"], "ABC\n"],
  ["A09", "<p> <b>A</b> <i>B</i> </p>", ["p", "-t", "-i"], "A\nB\n\n"],
  ["A10", "<p> A <b>B</b></p>", ["p", "-t", "-i"], " A \nB\n\n"],
  ["A11", "<p>A<b>B</b></p>", ["p", "-i"], "<p>A<b>B</b></p>\n"],
  [
    "A12",
    '<p title="&amp;&quot;&lt;&gt;&#160;">&amp;&lt;&gt;&#160;</p>',
    ["p"],
    '<p title="&amp;&quot;<>&nbsp;">&amp;&lt;&gt;&nbsp;</p>\n'
  ],
  [
    "A13",
    "<div><script>a < b && c</script><style>x>y{}</style></div>",
    ["div"],
    "<div><script>a < b && c</script><style>x>y{}</style></div>\n"
  ],
  [
    "A14",
    "<div><script>a < b && c</script><style>x>y{}</style></div>",
    ["div", "-t"],
    "a < b && cx>y{}\n"
  ],
  ["A15", "<template><p>T</p></template>", ["template"], "<template></template>\n"],
  ["A16", "<template><p>T</p></template>", ["template", "-t"], "\n"],
  ["A17", "<template><p>T</p></template>", ["p", "-t"], ""],
  [
    "A18",
    '<div id="a"><span>1</span><span>2</span></div><div id="b"><span>3</span></div>',
    ["div", "-r", "span"],
    '<div id="a"><span>2</span></div>\n'
  ],
  [
    "A19",
    '<div id="a"><span>1</span><span>2</span></div><div id="b"><span>3</span></div>',
    ["div", "-r", "span:last-child"],
    '<div id="a"><span>1</span></div>\n<div id="b"></div>\n'
  ],
  [
    "A20",
    '<div id="a"><span>1</span><span>2</span></div><div id="b"><span>3</span></div>',
    ["div,span", "-r", "span"],
    '<div id="a"><span>2</span></div>\n<span>1</span>\n'
  ],
  ["A21", "<div><span>X</span></div>", ["div", "-r", "div"], "<div><span>X</span></div>\n"],
  ["A22", "<div><b>B</b><i>I</i></div>", ["div", "-r", "i", "-r", "b"], "<div><i>I</i></div>\n"],
  ["A23", "<p>X</p>", ["p", "-r", "["], "<p>X</p>\n"],
  [
    "A24",
    '<a href="child">X</a>',
    ["a", "-a", "href", "-b", "https://e.test/dir/"],
    "https://e.test/dir/child\n"
  ],
  [
    "A25",
    '<base href="https://d.test/x/"><a href="child">X</a>',
    ["a", "-a", "href", "-B", "-b", "https://e.test/"],
    "https://d.test/x/child\n"
  ],
  [
    "A26",
    '<base><base href="https://d.test/"><a href="child">X</a>',
    ["a", "-a", "href", "-B", "-b", "https://e.test/"],
    "https://e.test/child\n"
  ],
  ["A27", '<a href="child">X</a>', ["a", "-a", "href", "-b", "relative"], "child\n"],
  [
    "A28",
    '<div><a href="child">X</a><img src="child"></div>',
    ["div", "-b", "https://e.test/"],
    '<div><a href="child">X</a><img src="child"></div>\n'
  ],
  [
    "A29",
    '<a href="/////host/path">X</a>',
    ["a", "-a", "href", "-b", "https://e.test/"],
    "host/path\n"
  ],
  [
    "A30",
    '<a href="http://[">X</a>',
    ["a", "-a", "href", "-b", "https://e.test/dir/"],
    "https://e.test/dir/\n"
  ],
  [
    "A31",
    '<a href="javascript:alert(1)">X</a>',
    ["a", "-a", "href", "-b", "https://e.test/"],
    "javascript:alert(1)\n"
  ],
  ["A32", "<div><span>X</span></div>", ["div", "-p"], "\n<div><span>X</span>\n</div>\n"],
  ["A33", "<pre> \n </pre>", ["pre", "-p"], "\n<pre>\n</pre>\n"],
  ["A34", "<p> <b>​</b></p>", ["p", "-t", "-i"], "​\n\n"],
  ["A35", "<p>A\r\nB\rC\u0000D&#0;&#128;</p>", ["p", "-t"], "A\nB\nCD�€\n"],
  ["A36", "<input checked disabled>", [":checked,:disabled,:enabled,:visited", "-t"], ""],
  ["A37", '<p id="a">X</p>', ['[id="A" i]', "-t"], "X\n"],
  ["A38", '<p id="a">X</p>', ['[id="A" s]', "-t"], ""],
  ["A39", '<a href="">X</a><area href=""><link href="">', [":any-link", "-a", "href"], "\n\n\n"],
  ["A40", "<p>X</p>", [":scope"], "<html><head></head><body><p>X</p></body></html>\n"]
];
for (const [id, source, argv, expected] of matrix)
  test(`acceptance ${id}`, async () => assert.equal(await run(source, argv), expected));
