import assert from "node:assert/strict";
import test from "node:test";
import { HtmlBudget, parseHtml, parseHtmlSync, serializeHtml } from "./index.js";

test("HTML parsing processes completed tokens before requesting more input", async () => {
  const options = { signal: new AbortController().signal };
  const budget = new HtmlBudget(options);
  async function* source() {
    yield new TextEncoder().encode("<p>first</p>");
    assert.ok(budget.snapshot().nodes >= 6, "completed paragraph must already be parsed");
    yield new TextEncoder().encode("<p>second</p>");
  }
  const document = await parseHtml(source(), options);
  assert.equal(serializeHtml(document, { signal: options.signal }, "original"), "<p>first</p><p>second</p>");
});

test("incremental HTML recovery agrees with synchronous parsing at every byte boundary", async () => {
  const inputs = [
    "\ufeff<p a='one>two' =x q=unquoted/>A&amp;B\r\nC</p>",
    "<script><!--<script>x</script>y--></script><p>end",
    "<table> \ntext<tr><td><b>A</table>B</b>",
    "<svg><![CDATA[x]]><foreignObject><p>é</p></foreignObject></svg>",
    "<!--><!---><!--a--!><!--b-<!--c--!x-->\0",
    "<!DOCTYPE html PUBLIC 'x'><title>&amp;x</title><?bogus></wrong !>",
    "<textarea>\n&amp;é</textarea><plaintext>a<b>c",
    "<a a=x a=y b='incomplete",
    "<template><table><b>x<tr><td>y</template><p>z"
  ];
  for (const input of inputs) {
    const bytes = new TextEncoder().encode(input);
    const expected = serializeHtml(parseHtmlSync(input, { signal: new AbortController().signal }), { signal: new AbortController().signal });
    for (let boundary = 0; boundary <= bytes.length; boundary++) {
      async function* source() { yield bytes.subarray(0, boundary); yield bytes.subarray(boundary); }
      const document = await parseHtml(source(), { signal: new AbortController().signal });
      assert.equal(serializeHtml(document, { signal: new AbortController().signal }), expected, `${boundary}: ${input}`);
    }
  }
});

test("a large single input chunk cooperates with cancellation and releases its producer", async () => {
  const controller = new AbortController();
  let returned = 0;
  async function* source() {
    try { yield new TextEncoder().encode("<p>" + "x".repeat(32768) + "</p>"); }
    finally { returned++; }
  }
  const timer = setTimeout(() => controller.abort(), 0);
  try {
    await assert.rejects(parseHtml(source(), { signal: controller.signal }), { code: "E_CANCELLED" });
    assert.equal(returned, 1);
  } finally { clearTimeout(timer); }
});

test("early token admission failure awaits cleanup and preserves both failures", async () => {
  const cleanup = new Error("cleanup failed");
  let pulls = 0, returns = 0;
  const source: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        async next() { pulls++; return { done: false, value: new TextEncoder().encode('<p title="unfinished') }; },
        async return() { returns++; throw cleanup; }
      };
    }
  };
  await assert.rejects(parseHtml(source, { signal: new AbortController().signal, limits: { tokenBytes: 10 } }), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors[0].code, "E_LIMIT");
    assert.equal(error.errors[1], cleanup);
    return true;
  });
  assert.equal(pulls, 1);
  assert.equal(returns, 1);
});

test("discarding original source preserves normalized serialization and rejects original mode", async () => {
  const options = { signal: new AbortController().signal };
  async function* source() { yield new TextEncoder().encode("<P>A</P>"); }
  const document = await parseHtml(source(), options, "discard");
  assert.equal(serializeHtml(document, options), "<html><head></head><body><p>A</p></body></html>");
  assert.throws(() => serializeHtml(document, options, "original"), { code: "E_UNSUPPORTED" });
});
