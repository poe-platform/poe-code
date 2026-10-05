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
  const bytes = new TextEncoder().encode(`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en"><head><title>Book</title></head><body>${body}</body></html>`);
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
