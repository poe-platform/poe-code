import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createZipCodec, type ZipLimits } from "@poe-code/office-package/zip";
import { readDocument, convert } from "./engine.js";
import { createPandocCommand } from "./safe-bash.js";
import { Volume } from "memfs";
import type { ResourceFileSystem } from "./types.js";
import { createCompressionCodec } from "@poe-code/office-package/compression";

const encode = (s: string) => new TextEncoder().encode(s);
const zipLimits: ZipLimits = {maxArchiveBytes: 1e6, maxEntryBytes: 1e6, maxTotalBytes: 1e6,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 65535,
  maxTextBytes: 65535, chunkSize: 4096};
const codec = createZipCodec({compression: createCompressionCodec(), yieldTurn: async () => {}, fail: message => {throw new Error(message);}});
const xhtml = (body: string, lang = "en") => `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}"><head><title>Chapter</title></head><body>${body}</body></html>`;
function entries(): Record<string, string> {
  return {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="Book/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "Book/package.opf": '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Original Book</dc:title><dc:creator>Writer</dc:creator><dc:language>fr</dc:language></metadata><manifest><item id="two" href="Text/two.xhtml" media-type="application/xhtml+xml"/><item id="one" href="Text/one.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="Images/cover%20art.png" media-type="image/png" properties="cover-image"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="one"/><itemref idref="two" linear="no"/></spine></package>',
    "Book/Text/one.xhtml": xhtml('<h1 id="same">First</h1><p><a href="two.xhtml#same">next</a><img src="../Images/cover%20art.png" alt="cover"/><a epub:type="noteref" href="two.xhtml#note">note</a></p>', "fr"),
    "Book/Text/two.xhtml": xhtml('<h1 id="same">Second</h1><aside epub:type="footnote" id="note"><p>Original note</p></aside>'),
    "Book/Images/cover art.png": "abc",
    "Book/nav.xhtml": xhtml('<nav epub:type="toc"><ol><li><a href="Text/one.xhtml#same">First</a></li><li><a href="Text/two.xhtml#same">Second</a></li></ol></nav>')
  };
}
async function archive(parts = entries(), duplicate?: string) {
  const signal = new AbortController().signal;
  const members = await Promise.all(Object.entries(parts).map(([name, text]) => codec.makeZipEntry(name, encode(text), {modified: new Date("2000-01-01T00:00:00Z"), mode: 0o644, directory: false, symlink: false, compression: "store"}, zipLimits, signal)));
  if (duplicate) members.push(members.find(e => e.name === duplicate)!);
  return codec.writeZipArchive({entries: members, comment: new Uint8Array()}, zipLimits, signal);
}
const read = async (parts = entries(), limits = {}) => readDocument({bytes: await archive(parts), source: "original.epub"}, {from: "epub"}, {limits, yield: async () => {}});

it("assembles original spine order, chapter provenance, scoped IDs, cross-chapter notes and cover MediaBag", async () => {
  const doc = await read();
  expect(doc.language).toBe("fr");
  expect(doc.metadata.title).toEqual({t: "MetaString", c: "Original Book"});
  expect(doc.blocks.map(b => b.t === "Div" ? b.c[0] : null)).toEqual([
    ["Book/Text/one.xhtml", ["epub-chapter"], [["data-epub-source", "Book/Text/one.xhtml"], ["data-epub-item-id", "one"], ["data-epub-linear", "yes"], ["lang", "fr"]]],
    ["Book/Text/two.xhtml", ["epub-chapter"], [["data-epub-source", "Book/Text/two.xhtml"], ["data-epub-item-id", "two"], ["data-epub-linear", "no"], ["lang", "en"]]]
  ]);
  const ast = JSON.stringify(doc.blocks);
  expect(ast).toContain('Book/Text/one.xhtml#same');
  expect(ast).toContain('#Book/Text/two.xhtml#same');
  expect(ast).toContain('"t":"Note"');
  expect(doc.metadata["cover-image"]).toEqual({t: "MetaString", c: "Book/Images/cover art.png"});
  expect(doc.resources.map(r => [r.id, createHash("sha256").update(r.bytes).digest("hex")])).toEqual([
    ["Book/Images/cover art.png", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"]
  ]);
  expect(JSON.stringify(doc.metadata["epub-toc"])).toContain('#Book/Text/one.xhtml#same');
});
it("reads EPUB2 NCX and legacy metadata cover without requiring an image reference", async () => {
  const p = entries();
  p["Book/package.opf"] = p["Book/package.opf"]!.replace('version="3.0"', 'version="2.0"').replace('properties="cover-image"', '').replace('<dc:title>', '<meta name="cover" content="cover"/><dc:title>').replace('<spine>', '<spine toc="ncx">').replace('</manifest>', '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>');
  p["Book/toc.ncx"] = '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="n"><navLabel><text>First</text></navLabel><content src="Text/one.xhtml#same"/></navPoint></navMap></ncx>';
  p["Book/Text/one.xhtml"] = xhtml('<p>No cover reference</p>');
  const doc = await read(p);
  expect(doc.resources).toHaveLength(1);
  expect(JSON.stringify(doc.metadata["epub-toc"])).toContain("First");
});
it("selects the first supported rootfile and diagnoses additional renditions", async () => {
  const p = entries();
  p["META-INF/container.xml"] = p["META-INF/container.xml"]!.replace('</rootfiles>', '<rootfile full-path="other.opf" media-type="application/oebps-package+xml"/></rootfiles>');
  const result = await convert([{bytes: await archive(p)}], {from: "epub", to: "plain"}, {yield: async () => {}});
  expect(result.diagnostics.some(d => d.message.includes("rootfile"))).toBe(true);
});
it.each([
  ["malformed XHTML", (p: Record<string, string>) => {p["Book/Text/one.xhtml"] = xhtml('<p><b>bad</p>');}],
  ["DTD", (p: Record<string, string>) => {p["Book/Text/one.xhtml"] = '<!DOCTYPE html [<!ENTITY x SYSTEM "file:///secret">]>' + xhtml('<p>&x;</p>');}],
  ["missing spine", (p: Record<string, string>) => {delete p["Book/Text/one.xhtml"];}],
  ["DRM", (p: Record<string, string>) => {p["META-INF/encryption.xml"] = '<encryption/>';}],
  ["fixed layout", (p: Record<string, string>) => {p["Book/package.opf"] = p["Book/package.opf"]!.replace('</metadata>', '<meta property="rendition:layout">pre-paginated</meta></metadata>');}],
  ["encoded traversal", (p: Record<string, string>) => {p["Book/Text/one.xhtml"] = xhtml('<img src="%2e%2e/%2e%2e/%2e%2e/secret"/>');}],
  ["recursive notes", (p: Record<string, string>) => {p["Book/Text/two.xhtml"] = xhtml('<aside epub:type="footnote" id="note"><a epub:type="noteref" href="#note">loop</a></aside>');}]
])("rejects %s", async (_name, mutate) => {const p = entries(); mutate(p); await expect(read(p)).rejects.toMatchObject({code: "E_PARSE"});});
it("rejects duplicate ZIP identity and bounds parts and expanded bytes", async () => {
  await expect(readDocument({bytes: await archive(entries(), "Book/Text/one.xhtml")}, {from: "epub"}, {})).rejects.toThrow();
  await expect(read(entries(), {parts: 2})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(read(entries(), {expandedBytes: 100})).rejects.toMatchObject({code: "E_LIMIT"});
});
it("diagnoses missing media, CSS and overlays without fetching external resources", async () => {
  const p = entries();
  delete p["Book/Images/cover art.png"];
  p["Book/Text/one.xhtml"] = xhtml('<style>p {position:absolute}</style><p><img src="../Images/cover%20art.png"/><a href="https://example.org">remote</a></p>');
  p["Book/package.opf"] = p["Book/package.opf"]!.replace('id="one"', 'media-overlay="smil" id="one"');
  const resolve = vi.fn();
  const result = await convert([{bytes: await archive(p)}], {from: "epub", to: "plain"}, {resources: {resolve}, yield: async () => {}});
  expect(result.diagnostics.map(d => d.message).join(" ")).toContain("CSS");
  expect(result.diagnostics.map(d => d.message).join(" ")).toContain("overlay");
  expect(result.diagnostics.some(d => d.code === "W_RESOURCE_MISSING")).toBe(true);
  expect(resolve).not.toHaveBeenCalled();
});
it("uses the existing thin safe-bash adapter for binary EPUB input", async () => {
  const bytes = await archive();
  const output: Uint8Array[] = [];
  const ctx = {args: ["-f", "epub", "-t", "plain"], stdin: [bytes], stdout: {write: async (b: Uint8Array) => {output.push(b);}}, stderr: {write: async () => {}}, signal: new AbortController().signal};
  expect(await createPandocCommand().execute(ctx)).toEqual({exitCode: 0});
  expect(new TextDecoder().decode(Buffer.concat(output))).toContain("First");
});
it("keeps unreferenced manifest images and independent hashes when extracting the EPUB MediaBag to memfs", async () => {
  const p = entries();
  p["Book/package.opf"] = p["Book/package.opf"]!.replace('</manifest>', '<item id="unused" href="Images/orphan.png" media-type="image/png"/></manifest>');
  p["Book/Images/orphan.png"] = "hello";
  const volume = Volume.fromJSON({});
  const fs: ResourceFileSystem = {
    lstat: async path => ({type: volume.lstatSync(path).isDirectory() ? "directory" : "file"}),
    mkdir: async path => {volume.mkdirSync(path, {recursive: true});},
    writeFile: async (path, bytes) => {volume.writeFileSync(path, bytes);},
    readFile: async () => {throw new Error("EPUB must not read host media");}
  };
  await convert([{bytes: await archive(p)}], {from: "epub", to: "html", extractMedia: "/media"}, {resourceFiles: fs, yield: async () => {}});
  expect(createHash("sha256").update(volume.readFileSync("/media/orphan.png") as Buffer).digest("hex")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  expect(volume.readFileSync("/media/cover art.png", "utf8")).toBe("abc");
});
it("retains fragment targets on list items and body, and warns for missing link fragments", async () => {
  const p = entries();
  p["Book/Text/one.xhtml"] = xhtml('<ul id="list"><li id="item">List target</li></ul><p><a href="#item">item</a><a href="#gone">missing</a></p>').replace('<body>', '<body id="body">');
  const result = await convert([{bytes: await archive(p)}], {from: "epub", to: "html"}, {yield: async () => {}});
  const doc = await read(p);
  const attrs: string[] = [];
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value) && value.length === 3 && typeof value[0] === "string" && Array.isArray(value[1]) && Array.isArray(value[2])) attrs.push(value[0]);
    for (const child of Object.values(value)) walk(child);
  };
  walk(doc.blocks);
  expect(attrs).toContain("Book/Text/one.xhtml#item");
  expect(attrs).toContain("Book/Text/one.xhtml#body");
  expect(result.diagnostics.some(d => d.message.includes("fragment"))).toBe(true);
});
it("bounds note expansion before large copies and rejects fallback cycles", async () => {
  const p = entries();
  p["Book/Text/two.xhtml"] = xhtml('<aside epub:type="footnote" id="note"><p>' + 'text '.repeat(100) + '</p></aside>');
  p["Book/Text/one.xhtml"] = xhtml('<p>' + '<a epub:type="noteref" href="two.xhtml#note">n</a>'.repeat(20) + '</p>');
  await expect(read(p, {nodes: 500})).rejects.toMatchObject({code: "E_LIMIT"});
  p["Book/package.opf"] = p["Book/package.opf"]!.replace('id="one"', 'fallback="two" id="one"').replace('id="two"', 'fallback="one" id="two"');
  await expect(read(p)).rejects.toMatchObject({code: "E_PARSE"});
});
it("rejects raw ZIP traversal before opening EPUB parts", async () => {
  const bytes = await archive();
  const original = encode("Book/Text/one.xhtml");
  const unsafe = encode("../X/Text/one.xhtml");
  for (let i = 0; i <= bytes.length - original.length; i++) if (original.every((b, j) => bytes[i + j] === b)) bytes.set(unsafe, i);
  await expect(readDocument({bytes}, {from: "epub"}, {})).rejects.toMatchObject({code: "E_PARSE"});
});
it("preserves guide cover chapter identity, inherited language and direction", async () => {
  const p = entries();
  p["Book/package.opf"] = p["Book/package.opf"]!.replace('<spine>', '<spine page-progression-direction="rtl">').replace('</package>', '<guide><reference type="cover" title="Cover" href="Text/one.xhtml"/></guide></package>');
  p["Book/Text/one.xhtml"] = xhtml('<p>Cover page</p>').replace(' xml:lang="en"', '');
  const doc = await read(p);
  expect(doc.direction).toBe("rtl");
  expect(doc.metadata["epub-cover-page"]).toEqual({t: "MetaString", c: "Book/Text/one.xhtml"});
  expect(doc.blocks[0]?.t === "Div" && doc.blocks[0].c[0][2]).toContainEqual(["lang", "fr"]);
});
it("loads notes in admitted non-spine XHTML and keeps their provenance without adding a chapter", async () => {
  const p = entries();
  p["Book/package.opf"] = p["Book/package.opf"]!.replace('</manifest>', '<item id="notes" href="Notes/notes.xhtml" media-type="application/xhtml+xml"/></manifest>');
  p["Book/Notes/notes.xhtml"] = xhtml('<aside epub:type="footnote" id="n"><p>Outside spine note</p></aside>');
  p["Book/Text/one.xhtml"] = xhtml('<p><a epub:type="noteref" href="../Notes/notes.xhtml#n">note</a></p>');
  const doc = await read(p);
  expect(doc.blocks).toHaveLength(2);
  expect(JSON.stringify(doc.blocks)).toContain('"t":"Note"');
  expect(JSON.stringify(doc.blocks)).toContain('"c":"Outside"');
  expect(JSON.stringify(doc.blocks)).toContain("Book/Notes/notes.xhtml");
});
it("diagnoses unsafe active attributes, and never executes or fetches EPUB scripts and remote images", async () => {
  const p = entries();
  p["Book/Text/one.xhtml"] = xhtml('<script src="https://example.org/a.js">throw Error()</script><p onclick="alert(1)">safe</p><img src="https://example.org/image.png"/>');
  const resolve = vi.fn();
  const result = await convert([{bytes: await archive(p)}], {from: "epub", to: "plain"}, {resources: {resolve}, yield: async () => {}});
  expect(result.diagnostics.some(d => d.message.includes("script"))).toBe(true);
  expect(result.diagnostics.some(d => d.message.includes("remote"))).toBe(true);
  expect(resolve).not.toHaveBeenCalled();
});
it("preserves literal percent and Unicode part identity and percent-encoded cross-chapter fragments", async () => {
  const p = entries();
  p["Book/package.opf"] = p["Book/package.opf"]!.replace('href="Text/two.xhtml"', 'href="Text/part%2520%20%C3%A9.xhtml"');
  p["Book/Text/part%20 é.xhtml"] = xhtml('<h1 id="a b">Encoded target</h1>');
  delete p["Book/Text/two.xhtml"];
  p["Book/Text/one.xhtml"] = xhtml('<p><a href="part%2520%20%C3%A9.xhtml#a%20b">go</a></p>');
  p["Book/nav.xhtml"] = xhtml('<nav epub:type="toc"><a href="Text/part%2520%20%C3%A9.xhtml#a%20b">Target</a></nav>');
  const doc = await read(p);
  const first = doc.blocks[0];
  const second = doc.blocks[1];
  if (first?.t !== "Div" || second?.t !== "Div") throw new Error("Expected chapters");
  const heading = second.c[1][0];
  const paragraph = first.c[1][0];
  if (heading?.t !== "Header" || paragraph?.t !== "Para" || paragraph.c[0]?.t !== "Link") throw new Error("Expected link and heading");
  expect(decodeURIComponent(paragraph.c[0].c[2][0].slice(1))).toBe(heading.c[1][0]);
  expect(second.c[0][2]).toContainEqual(["data-epub-source", "Book/Text/part%20 é.xhtml"]);
});
it("preserves nested EPUB3 navigation and cover landmarks", async () => {
  const p = entries();
  p["Book/nav.xhtml"] = xhtml('<nav epub:type="toc"><ol><li><a href="Text/one.xhtml">Parent</a><ol><li><a href="Text/two.xhtml">Child</a></li></ol></li></ol></nav><nav epub:type="landmarks"><a epub:type="cover" href="Text/one.xhtml">Cover</a></nav>');
  const doc = await read(p);
  expect(doc.metadata["epub-cover-page"]).toEqual({t: "MetaString", c: "Book/Text/one.xhtml"});
  const toc = doc.metadata["epub-toc"];
  if (toc?.t !== "MetaList" || toc.c[0]?.t !== "MetaMap") throw new Error("Expected TOC");
  expect(toc.c).toHaveLength(1);
  expect(JSON.stringify(toc.c[0].c.children)).toContain("Child");
});
it("finds nested note definitions and removes duplicated note prose from chapter flow", async () => {
  const p = entries();
  p["Book/Text/two.xhtml"] = xhtml('<h1>Second</h1><blockquote><aside epub:type="footnote" id="note"><p>UniqueNoteText</p></aside></blockquote>');
  const doc = await read(p);
  expect(JSON.stringify(doc.blocks).split("UniqueNoteText")).toHaveLength(2);
});
it("rejects EPUB2 fixed-layout metadata", async () => {
  const p = entries();
  p["Book/package.opf"] = p["Book/package.opf"]!.replace('</metadata>', '<meta name="fixed-layout" content="true"/></metadata>');
  await expect(read(p)).rejects.toMatchObject({code: "E_PARSE"});
});
it("does not confuse foreign attributes with XHTML fragment attributes", async () => {
  const q = entries();
  q["Book/Text/one.xhtml"] = xhtml('<h1 xmlns:foreign="urn:foreign" foreign:id="fake">Header</h1>');
  const doc = await read(q);
  expect(JSON.stringify(doc.blocks)).not.toContain("#fake");
});
it("retains unfamiliar inline fragment targets and body language scope", async () => {
  const p = entries();
  p["Book/Text/one.xhtml"] = xhtml('<p><abbr id="term">Term</abbr><a href="#term">reference</a></p>').replace('<body>', '<body xml:lang="de">');
  const doc = await read(p);
  const chapter = doc.blocks[0];
  if (chapter?.t !== "Div") throw new Error("Expected chapter");
  const paragraph = chapter.c[1][0];
  expect(paragraph?.t).toBe("Div");
  if (paragraph?.t !== "Div") throw new Error("Expected body scope");
  expect(paragraph.c[0][2]).toContainEqual(["lang", "de"]);
  const text = paragraph.c[1][0];
  if (text?.t !== "Para" || text.c[0]?.t !== "Span") throw new Error("Expected fragment span");
  expect(text.c[0].c[0][0]).toBe("Book/Text/one.xhtml#term");
});
