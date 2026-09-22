import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHtml, serializeHtml, detachHtmlNode, htmlText, type HtmlOptions } from "./index.js";
const limits = {
  inputBytes: 100000,
  decodedBytes: 200000,
  retainedBytes: 1000000,
  nodes: 10000,
  attributes: 10000,
  depth: 100,
  tokenBytes: 100000,
  work: 1000000,
  outputBytes: 100000
};
function options(overrides = {}): HtmlOptions {
  return { signal: new AbortController().signal, limits: { ...limits, ...overrides } };
}
async function* bytes(s: string, width = 100000) {
  const b = new TextEncoder().encode(s);
  for (let i = 0; i < b.length; i += width) yield b.slice(i, i + width);
}
async function rendered(s: string) {
  return serializeHtml(await parseHtml(bytes(s), options()), options());
}
test("HTML wrappers, first attribute wins, voids and nonvoid slash recovery", async () => {
  assert.equal(
    await rendered('<DIV A="1" a="2"/><br>x'),
    '<html><head></head><body><div a="1"><br>x</div></body></html>'
  );
});
test("comments, raw script/style/noscript remain inert and intact", async () => {
  assert.equal(
    await rendered(
      "<script>if(a<b && c>d){}</script><style>a>b{}</style><!--x--><noscript><b>x</b></noscript>"
    ),
    "<html><head><script>if(a<b && c>d){}</script><style>a>b{}</style><!--x--><noscript><b>x</b></noscript></head><body></body></html>"
  );
});
test("complete named entities, numeric replacement, attribute legacy ambiguity", async () => {
  assert.equal(
    await rendered(
      '<p title="&notit; &copy=">&notit; &CounterClockwiseContourIntegral; &#128; &#0; &NotEqualTilde;</p>'
    ),
    '<html><head></head><body><p title="&amp;notit; &amp;copy=">¬it; ∳ € � ≂̸</p></body></html>'
  );
});
test("implicit table sections and foster parenting", async () => {
  assert.equal(
    await rendered("<table>x<tr><td>A<td>B</table>y"),
    "<html><head></head><body>x<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>y</body></html>"
  );
});
test("misnested formatting reconstructs active elements", async () => {
  assert.equal(
    await rendered("<p><b>1<i>2</b>3</i>4"),
    "<html><head></head><body><p><b>1<i>2</i></b><i>3</i>4</p></body></html>"
  );
  assert.equal(
    await rendered("<b>one<p>two</b>three"),
    "<html><head></head><body><b>one</b><p><b>two</b>three</p></body></html>"
  );
});
test("foreign namespaces, integration points and SVG name adjustment", async () => {
  const doc = await parseHtml(
    bytes(
      '<svg viewbox="0 0"><foreignobject><p>x</p></foreignobject><circle/></svg><math><mi>x</mi></math>'
    ),
    options()
  );
  assert.equal(
    serializeHtml(doc, options()),
    '<html><head></head><body><svg viewBox="0 0"><foreignObject><p>x</p></foreignObject><circle></circle></svg><math><mi>x</mi></math></body></html>'
  );
  const svg = doc.children[0]!.children[1]!.children[0]!;
  assert.equal(svg.namespace, "svg");
  assert.equal(svg.children[0]!.children[0]!.namespace, "html");
});
test("template content is a separate fragment omitted by ordinary traversal", async () => {
  const doc = await parseHtml(bytes("<template><b>x</b></template><p>y"), options());
  const template = doc.children[0]!.children[0]!.children[0]!;
  assert.equal(template.children.length, 0);
  assert.equal(template.templateContents?.children[0]?.name, "b");
  assert.equal(htmlText(doc, options()), "y");
  assert.equal(
    serializeHtml(doc, options()),
    "<html><head><template></template></head><body><p>y</p></body></html>"
  );
});
test("BOM, lossy UTF8, CR and literal NUL are chunk invariant", async () => {
  const s = "\uFEFFA\uFEFFB\r\nC\rD\0&#0;";
  for (let width = 1; width < 10; width++)
    assert.equal(
      htmlText(await parseHtml(bytes(s, width), options()), options()),
      "A\uFEFFB\nC\nD�"
    );
  async function* invalid() {
    yield new Uint8Array([0xe2]);
    yield new Uint8Array([0x28, 0xa1]);
  }
  assert.equal(htmlText(await parseHtml(invalid(), options()), options()), "�(�");
});
test("original serialization preserves admitted source bytes as lossy text", async () => {
  const doc = await parseHtml(bytes("<P a=x>Hi &copy;</P>"), options());
  assert.equal(serializeHtml(doc, options(), "original"), "<P a=x>Hi &copy;</P>");
});
test("detach repairs parent and sibling links; original mode rejects mutated trees", async () => {
  const doc = await parseHtml(bytes("<p>A</p><p>B</p><p>C</p>"), options());
  const body = doc.children[0]!.children[1]!;
  const [a, b, c] = body.children;
  detachHtmlNode(b!, options());
  assert.equal(b!.parent, null);
  assert.equal(a!.nextSibling, c);
  assert.equal(c!.previousSibling, a);
  assert.throws(() => serializeHtml(doc, options(), "original"), { code: "E_MUTATED" });
});
test("limits, cancellation and source cleanup", async () => {
  let closed = false;
  async function* source() {
    try {
      yield new TextEncoder().encode("abcdef");
    } finally {
      closed = true;
    }
  }
  await assert.rejects(parseHtml(source(), options({ inputBytes: 3 })), {
    code: "E_LIMIT",
    resource: "inputBytes"
  });
  assert.equal(closed, true);
  const signal = AbortSignal.abort();
  await assert.rejects(parseHtml(bytes("x"), { ...options(), signal }), { code: "E_CANCELLED" });
  await assert.rejects(parseHtml(bytes("<b><b><b>x"), options({ depth: 3 })), {
    code: "E_LIMIT",
    resource: "depth"
  });
  const doc = await parseHtml(bytes("hello"), options());
  assert.throws(() => serializeHtml(doc, options({ outputBytes: 2 })), {
    code: "E_LIMIT",
    resource: "outputBytes"
  });
});
test("table whitespace stays in table; fostered nonwhitespace stays outside", async () => {
  assert.equal(
    await rendered("<table> \n<tr><td>x</td></tr></table>"),
    "<html><head></head><body><table> \n<tbody><tr><td>x</td></tr></tbody></table></body></html>"
  );
});
test("CDATA is foreign text and HTML bogus comments remain comments", async () => {
  assert.equal(
    await rendered("<svg><![CDATA[a<b&c]]></svg><!x>"),
    "<html><head></head><body><svg>a&lt;b&amp;c</svg><!--x--></body></html>"
  );
});
test("select recovery ignores ordinary tags and closes options implicitly", async () => {
  assert.equal(
    await rendered("<select><option>a<div>b<option>c</select>"),
    "<html><head></head><body><select><option>ab</option><option>c</option></select></body></html>"
  );
});
test("foreign breakout returns HTML insertion mode", async () => {
  assert.equal(
    await rendered("<svg><g><p>x"),
    "<html><head></head><body><svg><g></g></svg><p>x</p></body></html>"
  );
});
test("script escaped double-escaped states preserve embedded end tag", async () => {
  assert.equal(
    await rendered("<script><!--<script></script>--></script><p>x"),
    "<html><head><script><!--<script></script>--></script></head><body><p>x</p></body></html>"
  );
});
test("token and node budgets reject excessive retained structures", async () => {
  await assert.rejects(parseHtml(bytes('<div title="abcdef">'), options({ tokenBytes: 5 })), {
    code: "E_LIMIT",
    resource: "tokenBytes"
  });
  await assert.rejects(parseHtml(bytes("x"), options({ nodes: 4 })), {
    code: "E_LIMIT",
    resource: "nodes"
  });
  await assert.rejects(parseHtml(bytes("<p a=b>"), options({ attributes: 0 })), {
    code: "E_LIMIT",
    resource: "attributes"
  });
});
test("external mutation cannot corrupt engine-owned links or source identity", async () => {
  const doc = await parseHtml(bytes("<p>x"), options());
  assert.throws(() => {
    Object.defineProperty(doc.children, "length", { value: 0 });
  }, TypeError);
  assert.throws(() => {
    Object.defineProperty(doc.children[0]!, "name", { value: "evil" });
  }, TypeError);
});
test("cancel pending byte read and release source exactly once", async () => {
  let closed = 0;
  const controller = new AbortController();
  const source: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise(() => {}),
        return: async () => {
          closed++;
          return { done: true, value: undefined };
        }
      };
    }
  };
  const pending = parseHtml(source, { ...options(), signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: "E_CANCELLED" });
  assert.equal(closed, 1);
});
test("byte serialization agrees with normalized serialization and observes cancellation", async () => {
  const { serializeHtmlBytes } = await import("./index.js");
  const doc = await parseHtml(bytes('<p title="&quot;">a&b</p>'), options());
  let out = "";
  for await (const chunk of serializeHtmlBytes(doc, options()))
    out += new TextDecoder().decode(chunk);
  assert.equal(out, serializeHtml(doc, options()));
  const controller = new AbortController();
  const stream = serializeHtmlBytes(doc, { ...options(), signal: controller.signal });
  assert.equal((await stream.next()).done, false);
  controller.abort();
  await assert.rejects(stream.next(), { code: "E_CANCELLED" });
});
test("adoption agency reparents intervening formatting and furthest block", async () => {
  assert.equal(
    await rendered("<b><i>one<p>two</b>three</i>four"),
    "<html><head></head><body><b><i>one</i></b><i></i><p><i><b>two</b>three</i>four</p></body></html>"
  );
  assert.equal(
    await rendered("<p><b>1<i>2<div>3</b>4</i>5"),
    "<html><head></head><body><p><b>1<i>2</i></b></p><div><b><i>3</i></b><i>4</i>5</div></body></html>"
  );
  assert.equal(
    await rendered("<b><div><i>1</b>2</i>3"),
    "<html><head></head><body><b></b><div><b><i>1</i></b><i>2</i>3</div></body></html>"
  );
});
test("lazy inclusive traversal precomputes its next edge before detach", async () => {
  const { inclusiveHtmlDescendants } = await import("./index.js");
  const doc = await parseHtml(
    bytes('<div id="a"><span>1</span><span>2</span></div><div id="b"><span>3</span></div>'),
    options()
  );
  const output: string[] = [];
  for (const node of inclusiveHtmlDescendants(doc, options()))
    if (node.name === "div") {
      for (const candidate of inclusiveHtmlDescendants(node, options()))
        if (candidate.name === "span") {
          detachHtmlNode(candidate, options());
          break;
        }
      output.push(serializeHtml(node, options()));
    }
  assert.deepEqual(output, ['<div id="a"><span>2</span></div>']);
  const doc2 = await parseHtml(bytes("<p>x</p>"), options());
  const p = doc2.children[0]!.children[1]!.children[0]!;
  assert.equal(inclusiveHtmlDescendants(p, options()).next().value, p);
});
test("template formatting markers isolate contents without discarding outer formatting", async () => {
  assert.equal(
    await rendered("<b>a<template>x</template><p>b</b>c"),
    "<html><head></head><body><b>a<template></template></b><p><b>b</b>c</p></body></html>"
  );
});
test("nested anchors use adoption recovery instead of nesting HTML anchors", async () => {
  assert.equal(
    await rendered("<a href=one>1<a href=two>2</a>3"),
    '<html><head></head><body><a href="one">1</a><a href="two">2</a>3</body></html>'
  );
});
test("token ceiling measures token storage rather than markup lookahead", async () => {
  const doc = await parseHtml(bytes("<p>x"), options({ tokenBytes: 6 }));
  assert.equal(htmlText(doc, options()), "x");
});
test("comment start/end states recover abrupt close, EOF and NUL", async () => {
  for (const source of ["<!-->", "<!--->"])
    assert.equal(await rendered(source), "<!----><html><head></head><body></body></html>");
  for (const source of ["<!--a-", "<!--a--", "<!--a--!"])
    assert.equal(await rendered(source), "<!--a--><html><head></head><body></body></html>");
  assert.equal(await rendered("<!--a\0b-->"), "<!--a�b--><html><head></head><body></body></html>");
});
test("empty byte feeds consume work and still clean up on budget failure", async () => {
  let closed = false;
  async function* source() {
    try {
      for (let i = 0; i < 100; i++) yield new Uint8Array();
    } finally {
      closed = true;
    }
  }
  await assert.rejects(parseHtml(source(), options({ work: 10 })), {
    code: "E_LIMIT",
    resource: "work"
  });
  assert.equal(closed, true);
});
test("interior BOM remains at pinned 4096-byte decoder defect boundaries", async () => {
  for (const n of [0, 4094, 4095, 4096, 8191, 8192]) {
    const source = "A".repeat(n) + "\uFEFFB";
    const expected = "A".repeat(n) + (n === 0 ? "" : "\uFEFF") + "B";
    for (const width of [3, 4096, 100000])
      assert.equal(htmlText(await parseHtml(bytes(source, width), options()), options()), expected);
  }
});

test("EOF discards unfinished tags without losing preceding text", async () => {
  for (const suffix of ["<div", "<div ", '<div a="x', "<div a=x", "<div/", "</p"])
    assert.equal(
      await rendered("<p>before" + suffix),
      "<html><head></head><body><p>before</p></body></html>"
    );
  assert.equal(
    await rendered("<script>x</script "),
    "<html><head><script>x</script></head><body></body></html>"
  );
});

test("NUL recovery distinguishes HTML text, foreign text and markup", async () => {
  assert.equal(
    await rendered("<p>a\0b</p><svg>a\0b</svg><math>a\0b</math>"),
    "<html><head></head><body><p>ab</p><svg>a�b</svg><math>a�b</math></body></html>"
  );
  assert.equal(
    await rendered("<x\0y a\0b=c\0d></x\0y><!a\0b><?a\0b>"),
    '<html><head></head><body><x�y a�b="c�d"></x�y><!--a�b--><!--?a�b--></body></html>'
  );
});

test("empty end tags are ignored; incomplete tag-open states recover as text", async () => {
  assert.equal(
    await rendered("<p>a</>b<"),
    "<html><head></head><body><p>ab&lt;</p></body></html>"
  );
  assert.equal(
    await rendered("<p>a</"),
    "<html><head></head><body><p>a&lt;/</p></body></html>"
  );
});

test("source failure and cleanup failure remain observable, including falsey failures", async () => {
  const cleanup = new Error("cleanup failed");
  let returns = 0;
  const source: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => { throw undefined; },
        return: async () => { returns++; throw cleanup; }
      };
    }
  };
  await assert.rejects(parseHtml(source, options()), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [undefined, cleanup]);
    return true;
  });
  assert.equal(returns, 1);
});

test("implied nodes obey the same document depth limit as explicit nodes", async () => {
  await assert.rejects(parseHtml(bytes("x"), options({ depth: 2 })), {
    code: "E_LIMIT", resource: "depth"
  });
  await assert.rejects(parseHtml(bytes(""), options({ depth: 1 })), {
    code: "E_LIMIT", resource: "depth"
  });
});

test("list-item closure stops at nested list scope boundaries", async () => {
  assert.equal(await rendered("<ul><li>A<ul><li>B</ul><li>C"),
    "<html><head></head><body><ul><li>A<ul><li>B</li></ul></li><li>C</li></ul></body></html>");
});
test("paragraph end cannot cross a table cell scope boundary", async () => {
  assert.equal(await rendered("<!doctype html><p>A<table><tr><td>B</p>C</table>D"),
    "<!DOCTYPE html><html><head></head><body><p>A</p><table><tbody><tr><td>B<p></p>C</td></tr></tbody></table>D</body></html>");
});
test("late head tags are ignored without resetting the open body stack", async () => {
  assert.equal(await rendered("<body><head><title>X</title></head><p>Y"),
    "<html><head></head><body><title>X</title><p>Y</p></body></html>");
});
test("br end tags recover as a void start tag", async () => {
  assert.equal(await rendered("<p>A</br>B"),
    "<html><head></head><body><p>A<br>B</p></body></html>");
});
test("heading starts close an open heading and heading ends close any in-scope heading", async () => {
  assert.equal(await rendered("<h1>A<h2>B</h1>C"),
    "<html><head></head><body><h1>A</h1><h2>B</h2>C</body></html>");
});
test("repeated body and html tags merge only previously absent attributes", async () => {
  assert.equal(await rendered('<html a="1"><body a="1"><body b="2" a="3"><html b="2" a="3">X'),
    '<html a="1" b="2"><head></head><body a="1" b="2">X</body></html>');
});
test("nested buttons close the in-scope button before inserting another", async () => {
  assert.equal(await rendered("<div><button>A<button>B</button>C</div>"),
    "<html><head></head><body><div><button>A</button><button>B</button>C</div></body></html>");
});

test("form pointer rejects nested forms and removes only its own open-stack entry", async () => {
  assert.equal(await rendered('<form id="a">A<form id="b">B</form>C</form>'),
    '<html><head></head><body><form id="a">AB</form>C</body></html>');
  assert.equal(await rendered('<form><div>A</form>B</div>C'),
    '<html><head></head><body><form><div>AB</div></form>C</body></html>');
});
test("caption closes before implicit table section and row construction", async () => {
  assert.equal(await rendered('<table><caption>A<tr><td>B</table>'),
    '<html><head></head><body><table><caption>A</caption><tbody><tr><td>B</td></tr></tbody></table></body></html>');
});
test("nonwhitespace exits colgroup before foster parenting table text", async () => {
  assert.equal(await rendered('<table><col>x<tr><td>y</table>'),
    '<html><head></head><body>x<table><colgroup><col></colgroup><tbody><tr><td>y</td></tr></tbody></table></body></html>');
});
test("optgroup starts close previous option and optgroup", async () => {
  assert.equal(await rendered('<select><optgroup label=a><option>A<optgroup label=b><option>B</select>'),
    '<html><head></head><body><select><optgroup label="a"><option>A</option></optgroup><optgroup label="b"><option>B</option></optgroup></select></body></html>');
});

test("colgroup retains leading whitespace before reprocessing nonwhitespace", async () => {
  assert.equal(await rendered('<table><col> \nx<tr><td>y</table>'),
    '<html><head></head><body>x<table><colgroup><col> \n</colgroup><tbody><tr><td>y</td></tr></tbody></table></body></html>');
});
test("caption end clears its formatting marker before later body text", async () => {
  assert.equal(await rendered('<table><caption><b>A</caption><tr><td>B</table>C'),
    '<html><head></head><body><table><caption><b>A</b></caption><tbody><tr><td>B</td></tr></tbody></table>C</body></html>');
});
test("table-only tags outside table insertion contexts are ignored", async () => {
  assert.equal(await rendered('<tr><td>A</td></tr>B'),
    '<html><head></head><body>AB</body></html>');
});
test("button scope prevents block start from closing an outer paragraph", async () => {
  assert.equal(await rendered('<p><button>A<div>B</div></button>C</p>'),
    '<html><head></head><body><p><button>A<div>B</div></button>C</p></body></html>');
});

test("cell formatting markers prevent formatting from leaking into siblings or body", async () => {
  assert.equal(await rendered('<table><tr><td><b>A<td>B</table>C'),
    '<html><head></head><body><table><tbody><tr><td><b>A</b></td><td>B</td></tr></tbody></table>C</body></html>');
});
test("block end tags cannot escape a table cell scope boundary", async () => {
  assert.equal(await rendered('<div>A<table><tr><td>B</div>C</table>D'),
    '<html><head></head><body><div>A<table><tbody><tr><td>BC</td></tr></tbody></table>D</div></body></html>');
});
test("unknown end tags stop at special open elements", async () => {
  assert.equal(await rendered('<foo><div>A</foo>B</div>C'),
    '<html><head></head><body><foo><div>AB</div>C</foo></body></html>');
});

test("byte admission accepts cross-realm Uint8Array without accepting other views or impostors", async () => {
  const { runInNewContext } = await import('node:vm');
  const chunk = runInNewContext('new Uint8Array([65, 66])') as Uint8Array;
  assert.equal(chunk instanceof Uint8Array, false);
  async function* source() { yield chunk; }
  assert.equal(htmlText(await parseHtml(source(), options()), options()), 'AB');
  for (const invalid of [
    new Uint8ClampedArray([65]),
    new DataView(new ArrayBuffer(1)),
    Object.defineProperty(new Uint16Array([65]), Symbol.toStringTag, { value: 'Uint8Array' }),
    new Proxy(new Uint8Array([65]), {}),
    { [Symbol.toStringTag]: 'Uint8Array', byteLength: 1 }
  ]) {
    async function* invalidSource() { yield invalid as Uint8Array; }
    await assert.rejects(parseHtml(invalidSource(), options()), { code: 'E_UNSUPPORTED' });
  }
});

test("byte admission accounts intrinsic storage rather than shadowed byteLength", async () => {
  const chunk = Object.defineProperty(new Uint8Array([65, 66]), 'byteLength', { value: 0 });
  let cleanup = 0;
  async function* source() { try { yield chunk; } finally { cleanup++; } }
  await assert.rejects(parseHtml(source(), options({ inputBytes: 1 })), { code: 'E_LIMIT', resource: 'inputBytes' });
  assert.equal(cleanup, 1);
});
