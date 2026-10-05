import * as epubXml from "./epub-xml.js";
import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {createZipCodec} from "@poe-code/office-package/zip";
import {createCompressionCodec} from "@poe-code/compression";
import {ExecutionContext} from "./execution.js";
import {BackedJson} from "./backed-json.js";
import {convert, convertToOutput} from "./engine.js";
import {epubReader} from "./epub.js";
import {readRetainedEpubBook} from "./epub-retained-book.js";

const page = (body: string) => `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>${body}</body></html>`;
function parts(): Record<string, string> {return {
  mimetype: "application/epub+zip",
  "META-INF/container.xml": '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  "book.opf": '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Book</dc:title><dc:creator>One</dc:creator><dc:creator>Two</dc:creator><dc:language>fr</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/></manifest><spine page-progression-direction="rtl"><itemref idref="one"/><itemref idref="two" linear="no"/></spine></package>',
  "one.xhtml": page('<h1 id="same">First</h1><p><a href="two.xhtml#same">next</a><img src="cover.png" alt="cover"/><a epub:type="noteref" href="two.xhtml#note">note</a></p>'),
  "two.xhtml": page('<h1 id="same">Second</h1><aside epub:type="footnote" id="note"><p>Shared note.</p></aside>'),
  "nav.xhtml": page('<nav epub:type="toc"><ol><li><a href="one.xhtml#same">First</a><ol><li><a href="two.xhtml#same">Second</a></li></ol></li></ol></nav>'),
  "cover.png": "image bytes"
};}
async function archive(files: Record<string, string>) {
  const codec = createZipCodec({compression: createCompressionCodec(), yieldTurn: async () => {}, fail(message) {throw new Error(message);}});
  const limits = {maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity, maxMembers: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity, chunkSize: 4096};
  const signal = new AbortController().signal, entries = [];
  for (const [name, text] of Object.entries(files)) entries.push(await codec.makeZipEntry(name, new TextEncoder().encode(text), {modified: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false, compression: "store"}, limits, signal));
  return codec.writeZipArchive({entries, comment: new Uint8Array()}, limits, signal);
}
const variants: [string, (files: Record<string, string>) => void][] = [
  ["spine, nested navigation, metadata, notes, resources and direction", () => {}],
  ["NCX and legacy cover", p => {p["book.opf"] = p["book.opf"]!.replace('version="3.0"', 'version="2.0"').replace('properties="cover-image"', '').replace('</metadata>', '<meta name="cover" content="cover"/></metadata>').replace('<spine ', '<spine toc="ncx" ').replace('</manifest>', '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>'); p["toc.ncx"] = '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint><navLabel><text>First</text></navLabel><content src="one.xhtml"/><navPoint><navLabel><text>Second</text></navLabel><content src="two.xhtml"/></navPoint></navPoint></navMap></ncx>';}],
  ["external note dependencies", p => {p["book.opf"] = p["book.opf"]!.replace('</manifest>', '<item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/></manifest>'); p["one.xhtml"] = page('<p><a epub:type="noteref" href="notes.xhtml#external">1</a><a epub:type="noteref" href="notes.xhtml#external">2</a></p>'); p["notes.xhtml"] = page('<aside epub:type="footnote" id="external"><p>External <a epub:type="noteref" href="two.xhtml#note">nested</a></p></aside>');}],
  ["foreign namespaces and attributes", p => {p["one.xhtml"] = page('<h1 id="same">First</h1><p xmlns:f="urn:foreign" f:lost="x" title="t" role="note" data-custom="a" aria-label="b">A<foreign xmlns="urn:other"><b id="same">dropped</b></foreign>B</p>');}],
  ["dropped content diagnostics", p => {p["one.xhtml"] = page('<h1 id="same">First</h1><style>x</style><p style="color:red" onclick="x">Text</p><video/><script>x</script>');}],
  ["missing and unsupported media", p => {delete p["cover.png"]; p["one.xhtml"] = page('<h1 id="same">First</h1><p><img src="cover.png"/><img src="https://example.test/x.png"/><img src="one.xhtml"/></p>');}],
  ["guide and landmarks", p => {p["book.opf"] = p["book.opf"]!.replace('</package>', '<guide><reference type="cover" href="one.xhtml"/></guide></package>'); p["nav.xhtml"] += ''; p["nav.xhtml"] = page('<nav epub:type="landmarks"><a epub:type="cover" href="two.xhtml">Cover</a></nav><nav epub:type="toc"><a href="one.xhtml">First</a></nav>');}],
  ["tables and shared attributes", p => {p["one.xhtml"] = page('<h1 id="same">First</h1><table id="t"><caption>Caption</caption><tbody><tr><td rowspan="2" id="c">A</td><td>B</td></tr><tr><td>C</td></tr></tbody></table><pre id="p"><code id="code">a b</code></pre>');}],
  ["missing note", p => {p["two.xhtml"] = page('<h1 id="same">Second</h1>');}],
  ["recursive notes", p => {p["two.xhtml"] = page('<h1 id="same">Second</h1><aside id="note" epub:type="footnote"><a epub:type="noteref" href="#note">loop</a></aside>');}],
  ["fallback cycle", p => {p["book.opf"] = p["book.opf"]!.replace('id="one"', 'id="one" fallback="two"').replace('id="two"', 'id="two" fallback="one"');}],
  ["duplicate ID", p => {p["one.xhtml"] = page('<p id="same">A</p><p id="same">B</p>');}],
  ["missing spine part", p => {delete p["one.xhtml"];}],
  ["unsupported version", p => {p["book.opf"] = p["book.opf"]!.replace('version="3.0"', 'version="4.0"');}],
  ["fixed layout", p => {p["book.opf"] = p["book.opf"]!.replace('</metadata>', '<meta property="rendition:layout">pre-paginated</meta></metadata>');}],
  ["xml base", p => {p["one.xhtml"] = page('<p xml:base="other/">text</p>');}],
  ["malformed XML", p => {p["one.xhtml"] = page('<p><b>bad</p>');}],
  ["external DTD", p => {p["one.xhtml"] = '<!DOCTYPE html SYSTEM "file:///secret">' + p["one.xhtml"];}],
  ["duplicate spine", p => {p["book.opf"] = p["book.opf"]!.replace('</spine>', '<itemref idref="one"/></spine>');}],
  ["invalid direction", p => {p["book.opf"] = p["book.opf"]!.replace('direction="rtl"', 'direction="other"');}],
  ["unadmitted navigation", p => {p["nav.xhtml"] = page('<nav epub:type="toc"><a href="missing.xhtml">Missing</a></nav>');}],
  ["traversal", p => {p["one.xhtml"] = page('<img src="%2e%2e/secret"/>');}]
];
it.each(variants)("preserves buffered EPUB semantics for %s", async (_label, change) => {
  const files = parts(); change(files); const bytes = await archive(files);
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const storage = new PagedStorage(owner, 1), wire = new PagedStorage(owner, 1);
  const ctx = new ExecutionContext("read", {workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}});
  const reference = new ExecutionContext("read", {yield: async () => {}});
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole reads forbidden"));
  let book: Awaited<ReturnType<typeof readRetainedEpubBook>> | undefined;
  try {
    const expected = await epubReader.read({bytes}, reference).then(value => ({value}), error => ({error}));
    const result = await readRetainedEpubBook({chunks: (async function* () {const window = new Uint8Array(4096); for (let offset = 0; offset < bytes.length; offset += 4096) {const length = Math.min(4096, bytes.length - offset); window.set(bytes.subarray(offset, offset + length)); yield window.subarray(0, length); window.fill(255);}})()}, storage, ctx).then(value => ({value}), error => ({error}));
    if ("error" in expected) {expect(result).toHaveProperty("error"); if ("error" in result) expect(result.error).toMatchObject({code: expected.error.code}); return;}
    if ("error" in result) throw result.error;
    book = result.value;
    const tree = new BackedJson(wire, units => ctx.cooperate(units));
    await tree.begin("object"); await tree.key("blocks"); await book.ast.write(book.blocks, tree); await tree.key("metadata"); await book.ast.write(book.metadata, tree); await tree.end();
    let serialized = ""; for await (const chunk of tree.chunks()) serialized += new TextDecoder().decode(chunk);
    expect(JSON.parse(serialized)).toEqual({blocks: expected.value.blocks, metadata: expected.value.metadata});
    let language: string | undefined;
    if (book.language) {language = ""; for await (const chunk of book.ast.text.chunks(await book.ast.range(book.language))) language += chunk;}
    expect(language).toBe(expected.value.language); expect(book.direction).toBe(expected.value.direction);
    const resources = [];
    for await (const id of book.mediaParts) {const record = (await book.archive.partRecord(id))!; if (record instanceof Uint8Array) throw new Error("Expected retained media"); let value = ""; for await (const chunk of book.archive.partChunks(record)) value += new TextDecoder().decode(chunk); resources.push([id, value]);}
    expect(resources).toEqual(expected.value.resources.map(resource => [resource.id, new TextDecoder().decode(resource.bytes)]));
    expect(ctx.snapshotDiagnostics()).toEqual(reference.snapshotDiagnostics());
  } finally {await book?.archive.close(); await storage.close(); await wire.close(); await ctx.close(); await reference.close(); expect(await fs.readdir("/")).toEqual([]);}
});


it("preserves public EPUB parse-error attribution without publishing output", async () => {
  const files = parts(); delete files["one.xhtml"];
  const bytes = await archive(files), input = {bytes, base: "/books", source: "book.epub"};
  const expected = await convert([input], {from: "epub", to: "plain"}, {yield: async () => {}}).then(() => {throw new Error("Expected malformed book failure");}, error => error);
  const fs = new MemoryFileSystem(), write = vi.fn(), close = vi.fn(), abort = vi.fn();
  await expect(convertToOutput([input], {from: "epub", to: "plain"}, {yield: async () => {}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, close, abort}})).rejects.toMatchObject({code: expected.code, message: expected.message, location: expected.location, format: expected.format});
  expect(write).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(abort).not.toHaveBeenCalled(); expect(await fs.readdir("/")).toEqual([]);
});

it.each(["xmlNodes", "xmlDepth", "attributes", "text", "nodes", "depth", "references", "resourceBytes"].flatMap(key => [0, 1, 8, 64, 512, 2048, 65536].flatMap(limit => [false, true].map(streamed => ({key, limit, streamed})))))("preserves public EPUB finite $key=$limit (streamed=$streamed)", async ({key, limit, streamed}) => {
  const bytes = await archive(parts()), input = {...(streamed ? {chunks: [bytes]} : {bytes}), source: "book.epub"};
  const options = {from: "epub", to: "plain"}, limits = {[key]: limit};
  const referenceFs = new MemoryFileSystem();
  const expected = await convert([input], options, {limits, workingFiles: {fs: referenceFs, directory: "/", cacheBytes: 16384}, yield: async () => {}}).then(value => ({value}), error => ({error}));
  const fs = new MemoryFileSystem(), write = vi.fn(), close = vi.fn(), abort = vi.fn();
  const buffered = vi.spyOn(epubXml, "parseEpubXml").mockRejectedValue(new Error("Buffered XML forbidden"));
  try {
    const result = await convertToOutput([input], options, {limits, yield: async () => {}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, close, abort}}).then(value => ({value}), error => ({error}));
    expect(buffered).not.toHaveBeenCalled();
    if ("error" in expected) {
      expect(result).toHaveProperty("error");
      if ("error" in result) expect({code: result.error.code, message: result.error.message, location: result.error.location, format: result.error.format}).toEqual({code: expected.error.code, message: expected.error.message, location: expected.error.location, format: expected.error.format});
      expect(write).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    } else {expect(result).toHaveProperty("value"); expect(close).toHaveBeenCalledOnce();}
  } finally {buffered.mockRestore(); expect(await fs.readdir("/")).toEqual([]);}
});
