import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { inflateRawSync } from "node:zlib";
import { encode as jpeg } from "jpeg-js";
import { SaxesParser } from "saxes";
import { writeDocument, convert } from "./engine.js";
import type { Block, Attr } from "./ast-types.js";
import type { Document } from "./types.js";
import { createPandocCommand } from "./safe-bash.js";

const attr: Attr = ["", [], []];
const heading = (text: string, id = ""): Block => ({t: "Header", c: [1, [id, [], []], [{t: "Str", c: text}]]});
const link = (target: string): Block => ({t: "Para", c: [{t: "Link", c: [attr, [{t: "Str", c: "go"}], [target, ""]]}]});
const book = (blocks: readonly Block[] = []): Document => ({blocks, metadata: {}, resources: []});
function checksum(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for(const byte of bytes) {
    value ^= byte;
    for(let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
// Independent local-header ZIP decoder, not the production ZIP reader.
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = new Map<string, Uint8Array>();
  const offsets: number[] = [];
  let offset = 0;
  while (v.getUint32(offset, true) === 0x04034b50) {
    expect(v.getUint16(offset + 6, true) & 8).toBe(0);
    const method = v.getUint16(offset + 8, true), size = v.getUint32(offset + 18, true);
    const nameSize = v.getUint16(offset + 26, true), extra = v.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameSize));
    const start = offset + 30 + nameSize + extra;
    const data = bytes.subarray(start, start + size);
    expect(parts.has(name)).toBe(false);
    const decoded = method === 0 ? new Uint8Array(data) : new Uint8Array(inflateRawSync(data));
    expect(decoded.length).toBe(v.getUint32(offset + 22, true));
    expect(checksum(decoded)).toBe(v.getUint32(offset + 14, true));
    parts.set(name, decoded); offsets.push(offset);
    offset = start + size;
  }
  expect(v.getUint32(offset, true)).toBe(0x02014b50);
  const centralStart = offset;
  let index = 0;
  while(v.getUint32(offset, true) === 0x02014b50) {
    const local = offsets[index++]!;
    expect(v.getUint32(offset + 42, true)).toBe(local);
    expect(v.getUint32(offset + 16, true)).toBe(v.getUint32(local + 14, true));
    expect(v.getUint16(offset + 10, true)).toBe(v.getUint16(local + 8, true));
    const nameLength = v.getUint16(offset + 28, true);
    expect(bytes.slice(offset + 46, offset + 46 + nameLength)).toEqual(bytes.slice(local + 30, local + 30 + v.getUint16(local + 26, true)));
    offset += 46 + nameLength + v.getUint16(offset + 30, true) + v.getUint16(offset + 32, true);
  }
  expect(v.getUint32(offset, true)).toBe(0x06054b50);
  expect(v.getUint16(offset + 10, true)).toBe(parts.size);
  expect(v.getUint32(offset + 16, true)).toBe(centralStart);
  expect(offset + 22 + v.getUint16(offset + 20, true)).toBe(bytes.length);
  return parts;
}
interface Tag {name: string; uri: string; attrs: Record<string, string>}
function xml(bytes: Uint8Array) {
  const tags: Tag[] = [], texts: string[] = [];
  const parser = new SaxesParser({xmlns: true});
  parser.on("error", e => {throw e;});
  parser.on("opentag", t => tags.push({name: t.local, uri: t.uri, attrs: Object.fromEntries(Object.values(t.attributes).map(a => [a.name, a.value]))}));
  parser.on("text", t => texts.push(t));
  parser.write(new TextDecoder().decode(bytes)).close();
  return {tags, text: texts.join("")};
}
async function output(doc = book(), to = "epub") {
  const result = await writeDocument(doc, {to, yes: true}, {yield: async () => {}});
  expect(result.kind).toBe("binary");
  if(result.kind !== "binary") throw new Error("Expected EPUB bytes");
  return {bytes: result.bytes, parts: unzip(result.bytes)};
}
function closure(parts: Map<string, Uint8Array>) {
  const files = new Map([...parts].filter(([p]) => p.endsWith(".xhtml")).map(([p, b]) => [p, xml(b)]));
  for(const [path, doc] of files) {
    expect(doc.tags[0]?.uri).toBe("http://www.w3.org/1999/xhtml");
    const ids = doc.tags.map(t => t.attrs.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    for(const tag of doc.tags) for(const key of ["href", "src"]) {
      const url = tag.attrs[key];
      if(!url || url.includes(":")) continue;
      const [part, fragment] = url.split("#");
      const target = part ? path.slice(0, path.lastIndexOf("/") + 1) + decodeURIComponent(part) : path;
      expect(parts.has(target), `${path} -> ${url}`).toBe(true);
      if(fragment) expect(files.get(target)?.tags.some(t => t.attrs.id === decodeURIComponent(fragment))).toBe(true);
    }
  }
}
it.each(["epub", "epub3"])("writes %s with stored first mimetype, namespace-valid package, metadata and spine", async to => {
  const {bytes, parts} = await output(book([heading("First"), heading("Second")]), to);
  const v = new DataView(bytes.buffer);
  expect(v.getUint16(8, true)).toBe(0);
  expect(v.getUint16(28, true)).toBe(0);
  expect(new TextDecoder().decode(bytes.subarray(30, 38))).toBe("mimetype");
  expect(new TextDecoder().decode(parts.get("mimetype"))).toBe("application/epub+zip");
  expect(xml(parts.get("META-INF/container.xml")!).tags.find(t => t.name === "rootfile")?.attrs["full-path"]).toBe("EPUB/package.opf");
  const opf = xml(parts.get("EPUB/package.opf")!);
  expect(opf.tags[0]).toMatchObject({name: "package", uri: "http://www.idpf.org/2007/opf", attrs: {version: "3.0", "unique-identifier": "publication-id"}});
  expect(opf.text).toContain("Untitled");
  expect(opf.text).toContain("2000-01-01T00:00:00Z");
  expect(opf.text).toContain("urn:sha256:");
  expect(opf.tags.filter(t => t.name === "itemref").map(t => t.attrs.idref)).toEqual(["chapter-1", "chapter-2"]);
  const manifest = opf.tags.filter(t => t.name === "item");
  expect(parts.get("EPUB/style.css")!.length).toBeLessThan(2048);
  expect(new TextDecoder().decode(parts.get("EPUB/style.css"))).not.toContain("url(");
  expect(manifest.find(t => t.attrs.properties === "nav")).toBeDefined();
  for(const t of manifest) expect(parts.has("EPUB/" + decodeURIComponent(t.attrs.href!))).toBe(true);
  closure(parts);
});
it("allocates duplicate headings globally and rewrites forward/backward and note links across chapters", async () => {
  const {parts} = await output(book([heading("Same"), link("#same-1"), heading("Same"), link("#same"), {t: "Para", c: [{t: "Note", c: [link("#same")]}]}]));
  expect(new TextDecoder().decode(parts.get("EPUB/chapter-1.xhtml"))).toContain('href="chapter-2.xhtml#same-1"');
  expect(xml(parts.get("EPUB/nav.xhtml")!).text).toContain("SameSame");
  closure(parts);
});
it("handles empty and bounded long books deterministically without empty trailing chapters", async () => {
  const empty = await output(); closure(empty.parts);
  const para: Block = {t: "Para", c: [{t: "Str", c: "Original long text ".repeat(4000)}]};
  const doc = book([para, para, heading("End")]);
  const first = await output(doc), second = await output(doc);
  expect(second.bytes).toEqual(first.bytes);
  expect([...first.parts.keys()].filter(p => p.includes("chapter-")).length).toBe(3);
  expect((await output(book([heading("Changed")]))).bytes).not.toEqual(empty.bytes);
  closure(first.parts);
});
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ioAAAAASUVORK5CYII=", "base64"));
it("declares PNG, original JPEG pixels and original GIF pixels with matching media types", async () => {
  const gif = Uint8Array.from([71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,255,255,255,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59]);
  const jpg = new Uint8Array(jpeg({width: 1, height: 1, data: Uint8Array.from([40,160,180,255])}, 90).data);
  const resources = [{id: "original.png", bytes: png}, {id: "original.jpg", bytes: jpg}, {id: "original.gif", bytes: gif}];
  const {parts} = await output({...book(resources.map(r => ({t: "Para", c: [{t: "Image", c: [attr, [], [r.id, ""]]}]}))), resources});
  expect(xml(parts.get("EPUB/package.opf")!).tags.filter(t => t.name === "item" && t.attrs.id?.startsWith("resource-")).map(t => t.attrs["media-type"])).toEqual(["image/png", "image/jpeg", "image/gif"]);
  closure(parts);
  await expect(output({...book(), resources: [{id: "mismatched.jpg", bytes: png}]})).rejects.toMatchObject({code: "E_RESOURCE"});
});
it("packages explicit Unicode cover/image once with declared media type and cover spine", async () => {
  const name = "images/封面 % é.png";
  const doc: Document = {...book([{t: "Para", c: [{t: "Image", c: [attr, [{t: "Str", c: "Original"}], [name, ""]]}]}]), metadata: {title: {t: "MetaString", c: "原创"}, lang: {t: "MetaString", c: "fr"}, identifier: {t: "MetaString", c: "urn:example:original"}, modified: {t: "MetaString", c: "2026-09-16T00:00:00Z"}, "cover-image": {t: "MetaString", c: name}}, resources: [{id: name, bytes: png}]};
  const {parts} = await output(doc);
  const opf = xml(parts.get("EPUB/package.opf")!);
  expect(opf.text).toContain("urn:example:original");
  expect(opf.tags.find(t => t.attrs.properties === "cover-image")?.attrs["media-type"]).toBe("image/png");
  expect(opf.tags.filter(t => t.name === "itemref")[0]?.attrs.idref).toBe("cover");
  expect(parts.get("EPUB/resources/" + name)).toEqual(png);
  closure(parts);
});
it("keeps literal percent, spaces and URL syntax hazards in resource identities distinct", async () => {
  const names = ['image a.png', 'image%20a.png', '图像 "<#.png'];
  const doc: Document = {...book(names.map(name => ({t: "Para", c: [{t: "Image", c: [attr, [], [name, ""]]}]}))), resources: names.map(id => ({id, bytes: png}))};
  const {parts} = await output(doc);
  closure(parts);
  const images = xml(parts.get("EPUB/chapter-1.xhtml")!).tags.filter(t => t.name === "img");
  expect(images.map(t => decodeURIComponent(t.attrs.src!))).toEqual(names.map(n => "resources/" + n));
});
it.each([
  ["missing fragment", book([link("#absent")])],
  ["unknown local target", book([link("other.xhtml#absent")])],
  ["duplicate explicit IDs", book([heading("A", "x"), heading("B", "x")])],
  ["remote image", book([{t: "Para", c: [{t: "Image", c: [attr, [], ["https://example.org/image.png", ""]]}]}])],
  ["orphan media", {...book(), resources: [{id: "orphan.png", bytes: png}]}],
  ["active media", {...book(), resources: [{id: "script.js", bytes: new TextEncoder().encode("alert(1)")}]}],
  ["invalid modified", {...book(), metadata: {modified: {t: "MetaString", c: "yesterday"}}} as Document],
  ["raw scripts", book([{t: "RawBlock", c: ["html", "<script>alert(1)</script>"]}])]
] as const)("rejects %s", async (_name, doc) => {await expect(output(doc)).rejects.toThrow();});
it("keeps EPUB2 writing unsupported and obeys publication limits", async () => {
  await expect(output(book(), "epub2")).rejects.toMatchObject({code: "E_FORMAT"});
  await expect(writeDocument(book([heading("A")]), {to: "epub", yes: true}, {limits: {parts: 2}})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(writeDocument(book(), {to: "epub", yes: true}, {limits: {outputBytes: 100}})).rejects.toMatchObject({code: "E_LIMIT"});
});
it("rejects fractional modified timestamps outside the recorded EPUB profile", async () => {
  await expect(output({...book(), metadata: {modified: {t: "MetaString", c: "2026-09-16T00:00:00.001Z"}}})).rejects.toMatchObject({code: "E_OPTION"});
});
it("derives the publication identifier from content and media without ambient time/randomness", async () => {
  const clock = vi.spyOn(Date, "now").mockImplementation(() => {throw new Error("ambient clock");});
  const random = vi.spyOn(Math, "random").mockImplementation(() => {throw new Error("ambient randomness");});
  try {
    const first = await output(book([heading("Original")]));
    const same = await output(book([heading("Original")]));
    const changed = await output(book([heading("Different")]));
    const id = (r: typeof first) => xml(r.parts.get("EPUB/package.opf")!).text.slice(0, 75);
    expect(id(first)).toHaveLength(75);
    expect(id(first)).toBe(id(same)); expect(id(first)).not.toBe(id(changed));
  } finally {clock.mockRestore();random.mockRestore();}
});
it("publishes binary EPUB via the adapter into memfs without ambient resource reads", async () => {
  const vol = Volume.fromJSON({"/book.md": "# Original\n\nOriginal body."});
  const result = await createPandocCommand().execute({args: ["--yes", "-f", "commonmark", "-t", "epub3", "book.md", "-o", "book.epub"], cwd: "/", stdin: [], readFile: async path => new Uint8Array(vol.readFileSync("/" + path) as Buffer), writeFile: async (path, bytes) => {vol.writeFileSync("/" + path, bytes);}, stdout: {write: async () => {throw new Error("unexpected stdout");}}, stderr: {write: async () => {throw new Error("unexpected diagnostic");}}, signal: new AbortController().signal});
  expect(result).toEqual({exitCode: 0});
  closure(unzip(new Uint8Array(vol.readFileSync("/book.epub") as Buffer)));
});
it("uses the thin safe-bash adapter for binary EPUB3 stdout", async () => {
  const chunks: Uint8Array[] = [];
  expect(await createPandocCommand().execute({args: ["--yes", "-f", "commonmark", "-t", "epub3"], stdin: [new TextEncoder().encode("# Original")], stdout: {write: async b => {chunks.push(new Uint8Array(b));}}, stderr: {write: async () => {}}, signal: new AbortController().signal})).toEqual({exitCode: 0});
  expect(chunks.length).toBeGreaterThan(0);
  closure(unzip(Buffer.concat(chunks)));
  expect((await convert([{bytes: new TextEncoder().encode("# Original")}], {from: "commonmark", to: "epub3", yes: true}, {})).kind).toBe("binary");
});
