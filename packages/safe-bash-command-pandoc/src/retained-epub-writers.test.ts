import {createLuaFilterCapability} from "./lua-filters.js";
import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createZipCodec} from "@poe-code/office-package/zip";
import {createCompressionCodec} from "@poe-code/compression";
import {convert, convertToOutput} from "./engine.js";
import * as epubXml from "./epub-xml.js";

it.each(["html5", "latex", "rtf", "odt", "rst", "commonmark", "gfm", "json"].flatMap(to => ["standalone", "fragment", "rtl", "override", "empty", "long", "lua", "json-filter", "media", "notes"].map(mode => ({to, mode}))))("retains EPUB sidecars through $to output ($mode)", async ({to, mode}) => {
  const encoder = new TextEncoder(), signal = new AbortController().signal;
  const codec = createZipCodec({compression: createCompressionCodec(), yieldTurn: async () => {}, fail(message) {throw new Error(message);}});
  const limits = {maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity, maxMembers: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity, chunkSize: 4096};
  const page = (body: string) => '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>' + body + '</body></html>';
  const files = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "package.opf": '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Retained book</dc:title><dc:language>fr</dc:language></metadata><manifest><item id="first" href="first.xhtml" media-type="application/xhtml+xml"/><item id="second" href="second.xhtml" media-type="application/xhtml+xml"/><item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/></manifest><spine page-progression-direction="ltr"><itemref idref="first"/><itemref idref="second"/></spine></package>',
    "first.xhtml": page('<h1 id="start">First</h1>' + '<p>Growing chapter text.</p>'.repeat(2) + '<p>See <a href="second.xhtml#end">next</a>.<a epub:type="noteref" href="notes.xhtml#note">1</a></p>'),
    "second.xhtml": page('<h1 id="end">Second</h1><p>Return <a href="first.xhtml#start">home</a>.<a epub:type="noteref" href="notes.xhtml#note">1</a></p>'),
    "notes.xhtml": page('<aside id="note" epub:type="footnote"><p>Shared footnote.</p></aside>')
  };
  if (mode !== "notes" && ["rtf", "odt"].includes(to)) {
    files["first.xhtml"] = files["first.xhtml"].replace('<a epub:type="noteref" href="notes.xhtml#note">1</a>', "");
    files["second.xhtml"] = files["second.xhtml"].replace('<a epub:type="noteref" href="notes.xhtml#note">1</a>', "");
  }
  if (mode === "media") {
    files["package.opf"] = files["package.opf"].replace("</manifest>", '<item id="picture" href="picture.png" media-type="image/png"/></manifest>');
    files["first.xhtml"] = files["first.xhtml"].replace("</body>", '<p><img src="picture.png" alt="Picture"/></p></body>');
  }
  const entries = [];
  for (const [name, text] of Object.entries(files)) entries.push(await codec.makeZipEntry(name, encoder.encode(name === "package.opf" ? text.replace("<dc:language>fr</dc:language>", "<dc:language>" + (mode === "empty" ? "" : mode === "long" ? "abcdefghijk" : "fr") + "</dc:language>").replace('page-progression-direction="ltr"', mode === "rtl" ? 'page-progression-direction="rtl"' : 'page-progression-direction="ltr"') : text), {modified: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false, compression: "store"}, limits, signal));
  if (mode === "media") entries.push(await codec.makeZipEntry("picture.png", Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg=="), character => character.charCodeAt(0)), {modified: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false, compression: "store"}, limits, signal));
  const archive = await codec.writeZipArchive({entries, comment: new Uint8Array()}, limits, signal);
  const filters = mode === "lua" ? createLuaFilterCapability({readStream: () => [encoder.encode("function Pandoc(doc) return doc end")]}) : {async apply(document: import("./types.js").Document) {return document;}, async applyJsonStream({stdin, stdout}: Parameters<NonNullable<import("./types.js").FilterCapability["applyJsonStream"]>>[0]) {for await (const bytes of stdin) await stdout.write(bytes);}};
  const options: import("./types.js").ConversionOptions = {from: "epub", to, lossy: true, standalone: mode !== "fragment", ...(mode === "media" && to === "html5" ? {embedResources: true} : {}), ...(["lua", "json-filter"].includes(mode) ? {filters: [{kind: mode === "lua" ? "lua" as const : "json" as const, path: "/identity"}]} : {}), ...(mode === "override" ? {metadata: {lang: {t: "MetaString", c: "de"}, dir: {t: "MetaString", c: "ltr"}}} : {})};
  const expected = await convert([{bytes: archive}], options, {filters, yield: async () => {}}).then(value => ({value}), error => ({error}));
  if (mode === "media" && ["html5", "rtf", "odt"].includes(to)) expect(expected).not.toHaveProperty("error");
  const fs = new MemoryFileSystem();
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole-file reads forbidden"));
  const buffered = vi.spyOn(epubXml, "parseEpubXml").mockRejectedValue(new Error("Buffered XML forbidden"));
  const output: number[] = [];
  try {
    const result = await convertToOutput([{bytes: archive}], options, {filters, limits: {references: 1000000, retainedBytes: 16777216}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, yield: async () => {}, output: {async write(bytes) {await Promise.resolve(); output.push(...bytes);}, async close() {}, async abort() {}}}).then(() => ({}), error => ({error}));
    if ("error" in expected) expect(result).toMatchObject({error: {code: expected.error.code, message: expected.error.message}});
    else {expect(result).toEqual({}); expect(new Uint8Array(output)).toEqual(expected.value.kind === "text" ? new TextEncoder().encode(expected.value.text) : expected.value.bytes);}
    expect(buffered).not.toHaveBeenCalled();
  } finally {buffered.mockRestore(); expect(await fs.readdir("/")).toEqual([]);}
});
