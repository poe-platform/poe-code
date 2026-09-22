import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlqBytes, type HtmlOptions } from "./index.js";

function options(): HtmlOptions {
  return {
    signal: new AbortController().signal,
    limits: {
      inputBytes: 10000, decodedBytes: 20000, retainedBytes: 100000,
      nodes: 1000, attributes: 1000, depth: 100, tokenBytes: 10000,
      work: 100000, outputBytes: 10000
    }
  };
}
async function query(selector: string, settings = options()): Promise<string> {
  async function* source() {
    yield new TextEncoder().encode('<p id="ab" title="ab">joined</p><p id="a�b" title="a�b">replacement</p>');
  }
  let result = "";
  for await (const chunk of htmlqBytes(source(), [selector, "-t"], settings))
    result += new TextDecoder().decode(chunk);
  return result;
}

test("CSS quoted continuation consumes CRLF as one newline", async () => {
  for (const newline of ["\n", "\r", "\r\n", "\f"])
    assert.equal(await query('[title="a\\' + newline + 'b"]'), "joined\n");
});

test("CSS hex escape terminator consumes CRLF in identifiers and strings", async () => {
  for (const newline of ["\n", "\r", "\r\n", "\f"])
    for (const selector of ['#\\61' + newline + 'b', '[title="\\61' + newline + 'b"]'])
      assert.equal(await query(selector), "joined\n");
});

test("CSS literal and escaped NUL become replacement in names and strings", async () => {
  for (const selector of ['#a\0b', '#a\\\0b', '[title="a\0b"]', '[title="a\\\0b"]'])
    assert.equal(await query(selector), "replacement\n");
});

test("unescaped quoted newlines and escaped identifier newlines remain invalid", async () => {
  for (const newline of ["\n", "\r", "\r\n", "\f"])
    for (const selector of ['[title="a' + newline + 'b"]', '#a\\' + newline + 'b'])
      await assert.rejects(query(selector), { code: "E_SELECTOR" });
});

test("escape scanning observes cancellation and token admission", async () => {
  const cancelled = options();
  cancelled.signal = AbortSignal.abort();
  await assert.rejects(query('#\\61\r\nb', cancelled), { code: "E_CANCELLED" });
  const limited = options();
  limited.limits.tokenBytes = 4;
  await assert.rejects(query('#\\61\r\nb', limited), { code: "E_LIMIT", resource: "tokenBytes" });
});
