import assert from "node:assert/strict";
import test from "node:test";
import { byteChunks, convert, renderCases as cases } from "./fixtures.js";



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
