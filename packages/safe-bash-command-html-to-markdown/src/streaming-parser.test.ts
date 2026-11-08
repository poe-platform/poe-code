import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { Inputs } from "./input.js";
import { Budget } from "./budget.js";
import { settings } from "./options.js";
import { Parser, type HtmlEvent, type HtmlNode } from "./parser.js";

function commandContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    command: "html-to-markdown", args: [], env: {}, cwd: "/",
    fs: new MemoryFileSystem(), stdin: toByteSource(""),
    stdout: { write() { throw new Error("unexpected stdout"); } },
    stderr: { write() { throw new Error("unexpected stderr"); } },
    signal: new AbortController().signal, ...overrides,
  };
}

function budget(signal = new AbortController().signal): Budget {
  return new Budget(commandContext({ signal }), settings({}));
}

function treeSink() {
  const root: HtmlNode = { tag: "root", attributes: new Map(), children: [] };
  const stack = [root];
  return { root, write(event: HtmlEvent) {
    if (event.type === "close") { assert.equal(stack.pop()!.tag, event.tag); return; }
    const node: HtmlNode = event.type === "text"
      ? { tag: "text", attributes: new Map(), children: [], text: event.text }
      : { tag: event.tag, attributes: event.attributes, children: [] };
    stack.at(-1)!.children.push(node);
    if (event.type === "open") stack.push(node);
  } };
}

for (const html of [
  '<p>one<p>two</div><ul><li>a<li>b</ul>tail',
  '<table><tr><td>a<td>b<tr><th>c</table>',
  '<a href="/a">one<a href="/b">two</a><img alt="x"/><br>',
  '<textarea>a &amp; b</textarea/><xmp>&amp;</xmp><plaintext>tail <b>',
  '<script>hidden</script><style>hidden</style><!-- hidden --><div><b>open',
  '<p title="a&amp;b">é😀 &amp; &unknown; < broken</p>',
]) test(`event parsing preserves tree recovery: ${html}`, async () => {
  const sink = treeSink();
  const streamed = new Parser(budget(), sink.write);
  const buffered = new Parser(budget());
  for (const character of html) { await streamed.feed(character); await buffered.feed(character); }
  await streamed.finish();
  assert.deepEqual(sink.root, await buffered.finish());
  assert.deepEqual(streamed.root.children, []);
});

test("flat generated documents retain no completed nodes or text", async () => {
  let opens = 0, closes = 0, bytes = 0;
  const parser = new Parser(budget(), event => {
    if (event.type === "open") opens++;
    else if (event.type === "close") closes++;
    else bytes += event.text.length;
  });
  const chunk = "<p>" + "x".repeat(4096) + "</p>";
  for (let index = 0; index < 100; index++) {
    await parser.feed(chunk);
    assert.equal(parser.root.children.length, 0);
  }
  await parser.finish();
  assert.equal(opens, 100); assert.equal(closes, 100); assert.equal(bytes, 409600);
});

test("event sinks are awaited before the parser advances", async () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const events: string[] = [];
  const parser = new Parser(budget(), async event => {
    events.push(event.type);
    if (event.type === "open") { entered(); await gate; }
  });
  const feeding = parser.feed("<p>text</p>");
  await waiting;
  assert.deepEqual(events, ["open"]);
  release(); await feeding; await parser.finish();
  assert.deepEqual(events, ["open", "text", "close"]);
});

test("sink failures stop event delivery and preserve their identity", async () => {
  const failure = new Error("sink failure");
  let delivered = 0;
  const parser = new Parser(budget(), () => { delivered++; throw failure; });
  await assert.rejects(parser.feed("<p>text</p><p>later</p>"), error => error === failure);
  assert.equal(delivered, 1);
});

test("cancellation while a sink is pending prevents subsequent events", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled");
  let delivered = 0;
  const parser = new Parser(budget(controller.signal), async () => {
    delivered++; await Promise.resolve(); controller.abort(reason);
  });
  await assert.rejects(parser.feed("<p>text</p>"), error => error === reason);
  assert.equal(delivered, 1);
});

test("injected filesystem input streams events without payload reads", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.html", new TextEncoder().encode("<p>" + "x".repeat(10000) + "</p>"));
  fs.readFile = async () => { throw new Error("payload-wide readFile"); };
  const context = commandContext({ fs });
  const inputs = new Inputs(context, budget(context.signal));
  let textBytes = 0, maximum = 0;
  try {
    const root = await inputs.document("/input.html", event => {
      if (event.type === "text") { textBytes += event.text.length; maximum = Math.max(maximum, event.text.length); }
    });
    assert.equal(root.children.length, 0);
    assert.equal(textBytes, 10000); assert.ok(maximum <= 4096);
  } finally { await inputs.close(); }
});

test("reused producer chunks remain correct and stop at a pending event sink", async () => {
  const bytes = new TextEncoder().encode("<p>aaaa</p>");
  let produced = 0, closed = 0, release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const stdin = { async *[Symbol.asyncIterator]() {
    try {
      for (let index = 0; index < 20; index++) {
        bytes.fill(97 + index, 3, 7); produced++; yield bytes;
      }
    } finally { closed++; bytes.fill(0); }
  } };
  const context = commandContext({ stdin });
  const inputs = new Inputs(context, budget(context.signal));
  const text: string[] = [];
  try {
    const consuming = inputs.document("-", async event => {
      if (event.type === "text") {
        text.push(event.text);
        if (text.length === 1) { entered(); await gate; }
      }
    });
    await waiting;
    assert.equal(produced, 1);
    release(); await consuming;
    assert.deepEqual(text, Array.from({ length: 20 }, (_, index) => String.fromCharCode(97 + index).repeat(4)));
  } finally { release(); await inputs.close(); }
  assert.equal(closed, 1);
});

test("input cursor closes once when the event writer rejects", async () => {
  const failure = new Error("writer rejected");
  let closed = 0;
  const stdin = { async *[Symbol.asyncIterator]() {
    try { yield new TextEncoder().encode("<p>text</p>"); throw new Error("read too far"); }
    finally { closed++; }
  } };
  const context = commandContext({ stdin });
  const inputs = new Inputs(context, budget(context.signal));
  try { await assert.rejects(inputs.document("-", () => { throw failure; }), error => error === failure); }
  finally { await inputs.close(); }
  assert.equal(closed, 1);
});
