import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ownWeb from "../dist/plugin-web.js";
import referenceWeb from "../../poe-agent/dist/plugins/poe-agent-plugin-web.js";
const native = createRequire(import.meta.url)("../dist/poe-agent-rust.node");
const tool = (plugin, name) => plugin.tools.find((tool) => tool.name === name);
const ctx = { signal: new AbortController().signal };
test("web HTML pages agree with original Turndown over structural fixture combinations", async () => {
  const bodies = [
    "plain &amp; text",
    "<h1>Title</h1><p>Hello <strong>world</strong>.</p>",
    "<p>A <em>word</em> and <code>x_y</code>.</p>",
    "<a href='/a(b)' title='a &quot;title&quot;'>link</a>",
    "<img src='image.png' alt='a_*b' title='title'>",
    "<blockquote><p>first</p><p>second</p></blockquote>",
    "<ul><li>first</li><li>second</li></ul>",
    "<ol start='3'><li>first</li><li><p>second</p></li></ol>",
    "<pre><code class='language-js'>let x = 1;\n```\n</code></pre>",
    "<p>a<br>b</p><hr><p>end</p>",
    "<p> &nbsp; hi &copy; &#x80; &#x1f30d; </p>",
    "<p>symbols * _ [] ` and \\ end</p>",
    "<p><strong> padded </strong>next</p>",
    "<p>left <em> padded </em> right</p>",
    "<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>",
    "<p>before</p><table><tr><td>one</td><td>two</td></tr></table><p>after</p>"
  ];
  const mismatches = [];
  for (const body of bodies)
    for (const wrapper of [
      (s) => s,
      (s) => "<div>\n" + s + "\n</div>",
      (s) => "<html><body>" + s + "</body></html>"
    ]) {
      const html = wrapper(body),
        fetch = async () =>
          new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      const run = async (factory) =>
        tool(factory({ fetch }), "fetch_url").call({ url: "https://example.test/page" }, ctx);
      const actual = await run(ownWeb),
        expected = await run(referenceWeb);
      if (actual !== expected) mismatches.push({ html, actual, expected });
    }
  assert.deepEqual(mismatches, []);
});

test("web host and exact UTF16 pagination match the original", async () => {
  for (const url of [
    "https://example.test",
    "http://LOCALHOST./x",
    "http://127.1",
    "http://0x7f000001",
    "http://[::ffff:127.0.0.1]/",
    "http://[2001:4860::8888]/",
    "file:///tmp/x",
    "invalid"
  ])
    for (const offset of [0, 19999, 20000, Number.MAX_VALUE]) {
      const fetch = async () =>
        new Response("x".repeat(19999) + "🌍\ud800tail", {
          headers: { "content-type": "TEXT/PLAIN; charset=utf-8" }
        });
      const run = async (factory) => {
        try {
          return { value: await tool(factory({ fetch }), "fetch_url").call({ url, offset }, ctx) };
        } catch (error) {
          return { error: error.message };
        }
      };
      assert.deepEqual(await run(ownWeb), await run(referenceWeb), JSON.stringify({ url, offset }));
    }
});

test("named and numeric HTML entity decoding matches the original web response", async () => {
  for (const text of [
    "&amp;&lt;&gt;&quot;&apos;&nbsp;",
    "&notin;&notit;&CounterClockwiseContourIntegral;",
    "&#0;&#xD800;&#x110000;&#x80;",
    "&copy without semicolon &unknown;",
    "&acE;&Afr;&NotEqualTilde;"
  ]) {
    const fetch = async () =>
      new Response("<p>" + text + "</p>", { headers: { "content-type": "text/html" } });
    const run = (factory) =>
      tool(factory({ fetch }), "fetch_url").call({ url: "https://example.test/" }, ctx);
    assert.equal(await run(ownWeb), await run(referenceWeb), text);
  }
  assert.throws(
    () => native.agentHtmlMarkdown("<div>".repeat(129) + "x" + "</div>".repeat(129)),
    /nesting/
  );
});

test("fetch_url aborts a pending body read and releases its reader and listener", async () => {
  let canceled = 0;
  const response = new Response(
    new ReadableStream({
      cancel() {
        canceled++;
      }
    })
  );
  const controller = new AbortController(),
    reason = new Error("stop body");
  const pending = tool(ownWeb({ fetch: async () => response }), "fetch_url").call(
    { url: "https://example.test/" },
    { signal: controller.signal }
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(reason);
  let timeout;
  try {
    await assert.rejects(
      Promise.race([
        pending,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("pending body did not cancel")), 100);
        })
      ]),
      (error) => error === reason
    );
  } finally {
    clearTimeout(timeout);
  }
  assert.equal(canceled, 1);
  assert.equal(response.body.locked, false);
  assert.equal(
    createRequire(import.meta.url)("node:events").getEventListeners(controller.signal, "abort")
      .length,
    0
  );
});
