import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {openRetainedXmlDocument} from "@poe-code/office-xml/retained-xml-document";
import {ExecutionContext} from "./execution.js";
import {parseEpubXml, xhtmlTree} from "./epub-xml.js";
import {htmlTreeDocument} from "./html.js";
import {RetainedRtfAst} from "./retained-rtf-ast.js";
import {BackedJson} from "./backed-json.js";
import {readRetainedXhtml} from "./retained-xhtml-reader.js";

async function* byteSource(bytes: Uint8Array) {yield bytes;}

it.each([
  '<table><tbody><tr><td rowspan="00" colspan="00">Span</td><td>First</td></tr><tr><td>Second</td></tr></tbody></table>',
  '<table><tbody><tr><td rowspan="000" colspan="invalid">Span</td><td>First</td></tr><tr id="empty"></tr><tr><td>Second</td></tr></tbody></table>',
  '<table><tr id="empty"></tr><tr><th>A</th><th>B</th></tr></table>',
  '<table><tbody id="empty-group"></tbody><tr><th>A</th><th>B</th></tr></table>',
  '<table><tfoot><tr id="tail"></tr></tfoot><thead><tr><th rowspan="99">Top</th><th>Heading</th></tr><tr id="head-empty"></tr></thead><tbody><tr><th rowspan="0">Label</th><td>First</td></tr><tr id="body-empty"></tr><tr><td>Second</td></tr></tbody></table>',
  '<table><tbody><tr id="a"></tr><tr id="b"></tr></tbody></table>',
  '<table><tbody id="section"><tr><th>A</th><th>B</th></tr><tr><th>Label</th><td>Value</td></tr></tbody></table>',
  '<table><thead><tr><th>Top</th><td>Top data</td></tr></thead><tbody><tr><th>Section</th><th>Other</th></tr><tr><td>Data</td><th>Nonprefix</th></tr></tbody><tfoot><tr><th>Footer</th><td>Value</td></tr></tfoot></table>',
  '<table><tbody><tr><th><pre>header code</pre></th><td>Data</td></tr><tr><td scope="row">Data</td><th role="cell"><pre>other header</pre></th></tr></tbody></table>',
  '<table><tfoot><tr><th rowspan="99" colspan="2">Foot</th></tr></tfoot><tbody id="group"><tr><th rowspan="0">Header</th><th>Second</th></tr><tr><td>Data</td></tr></tbody><tbody><tr><td>Next</td><td>Group</td></tr></tbody></table>',
  '<table><tbody><tr><th colspan="2">Label</th><td>Data</td></tr><tr><th>A</th><th>B</th><td>Next</td></tr></tbody></table>',
  '<table><tbody><tr><th rowspan="2" scope="ROW">Label</th><td>Data</td></tr><tr><th role="cell" scope="invalid">Later</th></tr></tbody></table>',
  '<html xmlns="http://www.w3.org/1999/xhtml" dir="rtl"><body dir="ltr"><p dir="rtl">Text</p></body></html>',
  '<html xmlns="http://www.w3.org/1999/xhtml" dir="invalid"><body id="body" class="custom" dir="rtl"><p>Text</p></body></html>',
  '<html xmlns="http://www.w3.org/1999/xhtml" dir="ltr" style="direction:rtl"><body><p>Text</p></body></html>',
  '<p dir="rtl">Outer <span dir="ltr">Inner</span><bdi>Auto</bdi><bdi dir="ltr">Isolated</bdi><bdo dir="rtl" style="color:red">Override</bdo><bdo>Missing</bdo></p>',
  '<ol dir="rtl" reversed=""><li id="item" dir="ltr"><p>First</p><ol dir="rtl"><li>Nested</li></ol></li><li value="7">Second</li><li>Third</li></ol>',
  '<ul style="direction:rtl"><li dir="ltr">Item</li></ul><dl dir="rtl"><dt dir="ltr">Term</dt><dd dir="ltr"><p>Definition</p></dd></dl>',
  '<article dir="rtl"><nav dir="ltr"><p>Navigation</p></nav><blockquote dir="ltr"><p>Quote</p></blockquote><details dir="ltr"><summary dir="rtl">Summary</summary><p>Details</p></details></article>',
  '<p><unknown dir="rtl">Unknown</unknown><kbd style="direction:rtl;unicode-bidi:isolate">Keys</kbd><bdo style="color:red" dir="ltr">Order</bdo><bdi dir="auto">Auto</bdi></p>',
  '<figure><figcaption dir="rtl">Caption</figcaption><p>Body</p></figure><table dir="rtl"><caption dir="ltr">Caption</caption><thead dir="ltr"><tr dir="rtl"><th dir="ltr">Head</th></tr></thead><tbody dir="ltr"><tr><td dir="rtl">Cell</td></tr></tbody></table>',
  '<p><span dir="sideways">Invalid</span><bdi dir="">Empty</bdi><bdo dir="auto">Auto</bdo></p>',
  '<ol><li>One</li><li value="5">Five</li><li>Six</li></ol>',
  '<ol reversed=""><li>Three</li><li>Two</li><li>One</li></ol>',
  '<ol reversed="" start="8"><li>Eight</li><li value="5">Five</li><li>Four</li></ol>',
  '<ol start="-2"><li>Negative</li><li value="0">Zero</li><li>One</li></ol>',
  '<ol reversed="" start="0"><li>Zero</li><li value="-2">Negative</li><li>Lower</li></ol>',
  '<ol type="I" reversed="" start="8"><li id="item"><p>Outer</p><ol><li>Inner</li></ol></li><li>Next</li></ol>',
  '<ul reversed="" start="5"><li value="8">One</li><li>Two</li></ul>',

  '<table><tr><th scope="row">Label</th><td>Value</td></tr></table>',
  '<table><thead><tr><th>First</th><th>Second</th></tr></thead><tr><td rowspan="2">Label</td><td>Value</td></tr><tr><td>Next</td></tr></table>',

  '<table><tr><th scope="row">Label <em>detail</em></th><td>Value</td></tr></table>',
  '<table><tr><th><p>First</p><div id="inside"><p>Second</p></div><ul><li>Nested</li></ul></th><td><p>Regular</p></td></tr></table>',
  '<table><tr><th>First</th><th>Second</th></tr><tr><td>Data</td><td>Value</td></tr></table>',

  '<p><a href="#head">HEADLINK</a> <a href="#foot">FOOTLINK</a></p><table><thead id="head" class="heading" data-kind="labels"><tr><th>Head</th></tr></thead><tbody><tr><td>Body</td></tr></tbody><tfoot id="foot" class="summary" title="Totals"><tr><td>Foot</td></tr></tfoot></table>',
  '<table><tbody><tr><td><p>One</p><p>Two</p></td><td>Right</td></tr></tbody></table>',
  '<table><thead><tr><th><p>One</p><p>Two</p></th><th>Right</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table>',
  '<table><tbody><tr><td>A</td><td>B</td></tr></tbody><tfoot><tr><td colspan="2"><p>One</p><p>Two</p></td></tr></tfoot></table>',
  '<table><colgroup><col/><col/></colgroup><tbody><tr><td><p>One</p><p>Two</p></td><td>Right</td></tr></tbody></table>',
  '<table><colgroup><col width="20%"/><col style="width:80%"/></colgroup><tbody><tr><td>Left</td><td>Right</td></tr></tbody></table>',
  ...["section", "main", "aside", "header"].map(tag => `<${tag} id="x" class="custom" title="Label"><p>One</p></${tag}>`),
  '<article id="x"><p>One</p><p>Two</p></article>',
  '<footer id="x"><p>One</p><p>Two</p></footer>',
  '<nav id="x"><p>One</p><p>Two</p></nav>',
  '<details><summary>More</summary><p>Hidden</p></details>',
  '<details><summary><em>More</em></summary><details><summary>Nested</summary><p>Hidden</p></details><p>Last</p></details>',
  '<table><tbody><tr id="heading"><th>A</th><th>B</th></tr><tr><td>x</td><td>y</td></tr></tbody></table>',
  '<table><tbody><tr><th>A</th><td>B</td></tr></tbody><tbody><tr><th>C</th></tr></tbody></table>',

  '<dl id="list"><dt id="term">A</dt><dt>B</dt><dd id="definition">Shared</dd><dd><p>Another</p><dl><dt>Inner</dt><dd>Meaning</dd></dl></dd><dt>Next</dt><dd>Last</dd></dl>',
  '<h2>Hello World</h2><div><h3>Hello World</h3></div><h4>Hello World</h4>',
  '<h1 id="hello">First</h1><h2>Hello</h2><h3 id="hello">Explicit</h3>',
  '<h2>33. <em>Hello</em>, <a href="/url">World</a> <code>A_B.C</code>!</h2><h2>123 !!!</h2><h2>École 中文</h2>',
  '<ol type="i" start="3"><li>Roman</li></ol><ol type="constructor"><li>Default</li></ol>',
  '<table><tbody><tr>' + '<td rowspan="2">a</td>'.repeat(96) + '</tr><tr><td>b</td></tr></tbody></table>',
  '<pre id="p" title="outer" class="a a"><code id="c" title="inner" class="a b">literal<span> child</span><script>drop</script></code></pre>',
  '<p>a<![CDATA[ b & c]]>&#13;d&#10;e</p>',
  '<div>' + '<span>'.repeat(96) + 'deep' + '</span>'.repeat(96) + '</div>',
  '<p><em></em>a<unknown>b</unknown>c <unknown> </unknown> d</p>',
  '<figure><figcaption>first</figcaption><p>body</p><figcaption>second</figcaption></figure>',
  '<ol start="9007199254740992"><li>one</li></ol><table><tbody><tr><td colspan="1001">wide</td></tr></tbody></table>',

  '<p>Hello <em>world</em>! <strong class="loud">Bold</strong><br/>next</p>',
  '<h1 id="title">Heading</h1><div class="box"><p>First</p><p>Second</p></div>',
  '<p>a <span id="s"> b </span> c <code class="language-js"> x  y </code><img src="image.png" alt="An image" title="Title"/></p>',
  '<ul id="list"><li id="item">one<ul><li>nested</li></ul></li><li>two</li></ul><ol start="7"><li>seven</li></ol>',
  '<pre id="pre" class="outer"><code class="inner outer" title="code">a\n b</code></pre>',
  '<figure id="fig"><p>body</p><figcaption>caption</figcaption></figure>',
  '<table><caption>Caption</caption><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td rowspan="2">x</td><td>y</td></tr><tr><td>z</td></tr></tbody><tfoot><tr><td colspan="2">end</td></tr></tfoot></table>',
  '<p><a name="anchor" href="#x">link</a><mark id="mark">Marked</mark><abbr title="term">AB</abbr></p><hr id="rule"/>',
  '<blockquote id="quote"><p>Quote</p></blockquote><dl><dt id="term">Term</dt><dd>Meaning</dd></dl>',
  '<p xmlns:f="urn:attr" f:lost="value">a<foreign xmlns="urn:foreign"><x/></foreign>b</p>',
  '<p>before<script>discard</script><foreign xmlns="urn:foreign">lost</foreign>after</p>'
])("maps retained XHTML without materializing its document tree: %s", async body => {
  const bytes = new TextEncoder().encode(body.startsWith("<html ") ? body : `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en"><head><title>Book</title></head><body>${body}</body></html>`);
  const expectedContext = new ExecutionContext("read", {yield: async () => {}});
  const context = new ExecutionContext("read", {yield: async () => {}});
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole reads forbidden"));
  const storage = new PagedStorage(owner, 1), output = new PagedStorage(owner, 1);
  const xml = await openRetainedXmlDocument(byteSource(bytes), {workingStorage: {fs, directory: "/", cacheBytes: 16384}});
  try {
    const expected = await htmlTreeDocument(xhtmlTree(await parseEpubXml(bytes, "chapter.xhtml", expectedContext), expectedContext, "chapter.xhtml"), expectedContext);
    const ast = new RetainedRtfAst(storage, units => context.cooperate(units));
    const result = await readRetainedXhtml(xml, ast, storage, context, "chapter.xhtml");
    const wire = new BackedJson(output, units => context.cooperate(units));
    await ast.write(result.blocks, wire);
    let text = ""; for await (const bytes of wire.chunks()) text += new TextDecoder().decode(bytes);
    expect(JSON.parse(text)).toEqual(expected.blocks);
    let language = "";
    if (result.language) for await (const chunk of ast.text.chunks(await ast.range(result.language))) language += chunk;
    expect(language || undefined).toBe(expected.language);
    expect(result.direction).toBe(expected.direction);
    expect(context.snapshotDiagnostics()).toEqual(expectedContext.snapshotDiagnostics());
  } finally {await xml.close(); await storage.close(); await output.close(); await expectedContext.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("spools a long text run in chunks rather than allocating one backing record per character", async () => {
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const storage = new PagedStorage(owner, 1), context = new ExecutionContext("read", {yield: async () => {}});
  const body = "x".repeat(16384);
  const xml = await openRetainedXmlDocument(byteSource(new TextEncoder().encode(`<html xmlns="http://www.w3.org/1999/xhtml"><body><p>${body}</p></body></html>`)), {workingStorage: {fs, directory: "/", cacheBytes: 16384}});
  try {
    const start = storage.allocate(0), ast = new RetainedRtfAst(storage, units => context.cooperate(units));
    const result = await readRetainedXhtml(xml, ast, storage, context, "chapter.xhtml");
    expect(await ast.count(result.blocks)).toBe(1);
    expect(storage.allocate(0) - start).toBeLessThan(body.length * 12 + 32768);
  } finally {await xml.close(); await storage.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["<wrong/>", '<html xmlns="http://www.w3.org/1999/xhtml"/>', '<html xmlns="http://www.w3.org/1999/xhtml"><body/><body/></html>'])("preserves EPUB parse errors for %s", async source => {
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const storage = new PagedStorage(owner, 1), context = new ExecutionContext("read", {yield: async () => {}});
  const xml = await openRetainedXmlDocument(byteSource(new TextEncoder().encode(source)), {workingStorage: {fs, directory: "/", cacheBytes: 16384}});
  try {await expect(readRetainedXhtml(xml, new RetainedRtfAst(storage, units => context.cooperate(units)), storage, context, "bad.xhtml")).rejects.toMatchObject({code: "E_PARSE", format: "epub", location: "bad.xhtml"});}
  finally {await xml.close(); await storage.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["cancel", "storage", "references", "tableCells"] as const)("preserves %s failures and leaves backing ownership with the caller", async failure => {
  const controller = new AbortController(), fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: controller.signal};
  const storage = new PagedStorage(owner, 1), context = new ExecutionContext("read", {signal: controller.signal, yield: async () => {}, ...(failure === "references" || failure === "tableCells" ? {limits: {[failure]: 0}} : {})});
  const xml = await openRetainedXmlDocument(byteSource(new TextEncoder().encode('<html xmlns="http://www.w3.org/1999/xhtml"><body><table><tbody><tr><td>cell</td></tr></tbody></table></body></html>')), {workingStorage: {fs, directory: "/", cacheBytes: 16384}});
  const stop = new Error("backing write failed");
  try {
    if (failure === "storage") vi.spyOn(storage, "write").mockRejectedValueOnce(stop);
    if (failure === "cancel") {
      const cooperate = context.cooperate.bind(context); let calls = 0;
      vi.spyOn(context, "cooperate").mockImplementation(async units => {if (++calls === 20) controller.abort(); await cooperate(units);});
    }
    const result = readRetainedXhtml(xml, new RetainedRtfAst(storage, units => context.cooperate(units)), storage, context, "chapter.xhtml");
    if (failure === "storage") await expect(result).rejects.toBe(stop);
    else await expect(result).rejects.toMatchObject({code: failure === "cancel" ? "E_CANCELLED" : "E_LIMIT"});
  } finally {await xml.close(); await storage.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
});
