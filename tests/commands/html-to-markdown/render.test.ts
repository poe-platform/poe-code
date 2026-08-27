import assert from "node:assert/strict";
import test from "node:test";
import { byteChunks, convert } from "./helpers.js";

const cases: readonly [string, string, string][] = [
  ["empty", "", ""],
  ["whitespace", " \n\t ", ""],
  ["paragraph", "<p>Hello world.</p><p>Next</p>", "Hello world.\n\nNext\n"],
  ["headings", "<H1>Release</H1><h6>Notes</h6>", "# Release\n\n###### Notes\n"],
  ["inline", "a <em>very</em> <strong>good</strong> <s>old</s> day", "a *very* **good** ~~old~~ day\n"],
  ["inline whitespace", "<b> x </b><i>y</i>", "**x** *y*\n"],
  ["line breaks", "<p>a<br>b</p><hr><p>c</p>", "a  \nb\n\n---\n\nc\n"],
  ["unknown elements", "<custom>left <odd>right</odd></custom>", "left right\n"],
  ["malformed tail", "before <b unfinished", "before \\<b unfinished\n"],
  ["literal less than", "a < b < 4", "a \\< b \\< 4\n"],
  ["mismatched closing", "<p><b>x</p>y</b>", "**x**\n\ny\n"],
  ["omitted paragraphs", "<p>one<p>two", "one\n\ntwo\n"],
  ["comment and doctype", "<!DOCTYPE html>a<!-- ignored -->b", "ab\n"],
  ["unterminated comment", "keep<!-- no end", "keep\n"],
  ["script raw text", "a<script>if (x < 2) '<h1>bad</h1>';</script>b", "ab\n"],
  ["style raw text", "a<STYLE>.x{content:'<b>'}</StYlE >b", "ab\n"],
  ["unterminated script", "keep<script>drop forever", "keep\n"],
  ["safe links", '<a href="https://example.test/a?q=1&amp;b=2">docs</a>', "[docs](<https://example.test/a?q=1&b=2>)\n"],
  ["relative spaces", '<a href="../a file(1).md#part">read</a>', "[read](<../a%20file%281%29.md#part>)\n"],
  ["fragment", '<a href="#part">part</a>', "[part](<#part>)\n"],
  ["mailto", '<a href="mailto:team@example.test">mail</a>', "[mail](<mailto:team@example.test>)\n"],
  ["image", '<img src="/logo.png" alt="A [logo]">', "![A \\[logo\\]](</logo.png>)\n"],
  ["image data denied", '<img src="data:image/png;base64,AA" alt="logo">', "logo\n"],
  ["duplicate attributes first wins", '<a href="/first" href="javascript:x">x</a>', "[x](</first>)\n"],
  ["quoted greater than", '<a title="a > b" href="/x">link</a>', "[link](</x>)\n"],
  ["unquoted URL trailing slash", "<a href=https://example.test/>x</a>", "[x](<https://example.test/>)\n"],
  ["entities", "&lt;x&gt; &amp; &copy; &#x1f600; &#233;", "\\<x\\> \\& © 😀 é\n"],
  ["unknown and nonrecursive entities", "&madeup; &amp;lt;", "\\&madeup; \\&lt;\n"],
  ["invalid scalar entities", "&#0; &#xD800; &#1114112;", "� � �\n"],
  ["NBSP", "a&nbsp;b", "a\u00a0b\n"],
  ["code span", "<code>a ` b</code>", "``a ` b``\n"],
  ["code span padding", "<code>`edge`</code>", "`` `edge` ``\n"],
  ["code whitespace", "<code> a\nb </code>", "`  a b  `\n"],
  ["pre fence", '<pre><code class="language-js">a\n```\nb</code></pre>', "````js\na\n```\nb\n````\n"],
  ["pre blank lines", "<pre>a\n\n\n</pre>", "```\na\n\n\n```\n"],
  ["unordered list", "<ul><li>one<li>two</ul>", "- one\n- two\n"],
  ["ordered start", '<ol start="3"><li>one</li><li>two</li></ol>', "3. one\n4. two\n"],
  ["nested list", "<ul><li>outer<ul><li>inner</li></ul></li></ul>", "- outer\n\n  - inner\n"],
  ["blockquote", "<blockquote><p>one</p><p>two</p></blockquote>", "> one\n>\n> two\n"],
  ["table header", "<table><tr><th>A</th><th>B</th></tr><tr><td>x</td><td>y</td></tr></table>", "| A | B |\n| --- | --- |\n| x | y |\n"],
  ["table no invented data header", "<table><tr><td>x</td></tr></table>", "|  |\n| --- |\n| x |\n"],
  ["table caption and ragged rows", "<table><caption>Data</caption><tr><th>A</th><th>B</th></tr><tr><td>x</td></tr></table>", "Data\n\n| A | B |\n| --- | --- |\n| x |  |\n"],
  ["table cell pipes", "<table><tr><th>A</th></tr><tr><td>a|b <code>x|y</code></td></tr></table>", "| A |\n| --- |\n| a\\|b `x\\|y` |\n"],
  ["UTF8 and CRLF", "<p>中文 café 😀\r\nnext</p>", "中文 café 😀 next\n"],
  ["leading BOM", "\ufeff<p>x</p>", "x\n"],
  ["textarea RCDATA", "<textarea><b>literal</b> &amp;</textarea><p>after</p>", "\\<b\\>literal\\</b\\> \\&\n\nafter\n"],
  ["title RCDATA", "<title>A <b> &amp; B</title>", "A \\<b\\> \\& B\n"],
  ["raw literal iframe", "<iframe><b>literal</b>&amp;</iframe>", "\\<b\\>literal\\</b\\>\\&amp;\n"],
  ["raw missing close", "<textarea>keep <strong>all", "keep \\<strong\\>all\n"],
  ["raw false close", "<textarea>keep </textarea x> all</textarea>", "keep \\</textarea x\\> all\n"],
  ["raw close whitespace", "<textarea>x</textarea   ><p>y</p>", "x\n\ny\n"],
  ["plaintext never parses tail", "<plaintext>literal <b>x</b>&amp;", "literal \\<b\\>x\\</b\\>\\&amp;\n"],
  ["nested link repair", '<a href="/a">one<a href="/b">two</a>three</a>', "[one](</a>)[two](</b>)three\n"],
  ["anchor boundary spaces", 'before<a href="/a"> link </a>after', "before [link](</a>) after\n"],
  ["blocked anchor boundary spaces", 'before<a href="javascript:x"> link </a>after', "before link after\n"],
  ["adjacent inline spaces", "one <b> two </b> three", "one **two** three\n"],
];

test("whitespace normalization spans tokenizer text fragments", async () => {
  const input = "x".repeat(4095) + " \n  end";
  assert.equal((await convert(input)).stdout, "x".repeat(4095) + " end\n");
});

for (const [name, html, markdown] of cases) test(name, async () => {
  const actual = await convert(html);
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stderr, ""); assert.equal(actual.stdout, markdown);
});

for (const size of [1, 2, 3, 7, 4096]) test(`chunk boundaries ${size}`, async () => {
  const input = '<h1>中文 😀 &amp; café</h1><a href="/a b">link</a><!-- comment --><script>bad <b>x</b></script><p>after</p>';
  assert.deepEqual((await convert(byteChunks(input, size))).bytes, (await convert(input)).bytes);
  const raw = '<textarea>中文 &amp; <b>raw</b></textarea ><script>drop</script>';
  assert.deepEqual((await convert(byteChunks(raw, size))).bytes, (await convert(raw)).bytes);
});

test("entities straddling tokenizer flush boundary", async () => {
  const html = "x".repeat(4093) + "&nbsp;y";
  assert.equal((await convert(byteChunks(html, 1))).stdout, "x".repeat(4093) + "\u00a0y\n");
});

for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java&#x73;cript:alert(1)", "javascript&colon;alert(1)", "java&#9;script:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "//example.test/x", "https:\\evil.test", "https://example.test/%0afoo", "javascript&madeup;:x"]) test(`inactive destination ${url}`, async () => {
  const result = await convert(`<a href="${url}"><strong>label</strong></a>`);
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, "**label**\n"); assert.equal(result.stderr, "");
});

test("invalid UTF8 is a visible error, not lossy successful conversion", async () => {
  const result = await convert(new Uint8Array([0xc0, 0xaf]));
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /html-to-markdown:/u);
});
