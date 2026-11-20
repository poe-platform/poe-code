import {expect, it, vi} from "vitest";
import {Volume} from "memfs";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert as semanticHtmlConvert} from "@poe-code/document-converter-rust";
import {encode} from "jpeg-js";
import {PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream} from "pdf-lib";
import {readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {convert, readDocument, writeDocument} from "./engine.js";
import {convert as publicConvert, convertToOutput as publicConvertToOutput} from "./index.js";
import {htmlImageSources} from "./html.js";
import {ExecutionContext} from "./execution.js";
import {ResourceSession} from "./resources.js";
import type {Document, ResourceFileSystem} from "./types.js";

const encoder = new TextEncoder();
const input = (text: string, base?: string) => ({bytes: encoder.encode(text), ...(base === undefined ? {} : {base})});
const picture = new Uint8Array(encode({width: 2, height: 1, data: new Uint8Array(8).fill(255)}, 80).data);
const second = new Uint8Array(encode({width: 2, height: 1, data: Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255])}, 80).data);
const data = "data:image/jpeg;base64," + Buffer.from(picture).toString("base64");
const context = {yield: async () => {}};

function files(entries: Record<string, Uint8Array>) {
  const volume = new Volume();
  for (const [path, bytes] of Object.entries(entries)) {
    volume.mkdirSync(path.slice(0, path.lastIndexOf("/")) || "/", {recursive: true});
    volume.writeFileSync(path, bytes);
  }
  const readFile = vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer));
  const fs: ResourceFileSystem = {
    async lstat(path) {const stat = volume.lstatSync(path); return {type: stat.isDirectory() ? "directory" : "file"};},
    readFile,
    async mkdir(path) {volume.mkdirSync(path, {recursive: true});},
    async writeFile(path, bytes) {volume.writeFileSync(path, bytes);},
  };
  return {fs, readFile, volume};
}

async function expectImages(bytes: Uint8Array, to: "docx" | "pdf", count: number) {
  if (to === "docx") {
    const parts = readZipArchiveEntries(bytes);
    const xml = new TextDecoder().decode(parts.get("word/document.xml"));
    expect([...xml.matchAll(/<w:drawing\b[^>]*>/g)]).toHaveLength(count);
    expect([...parts.keys()].some(key => key.startsWith("word/media/"))).toBe(true);
  } else {
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("%PDF-");
    expect(text).toContain("/Subtype /Image");
    const pdf = await PDFDocument.load(bytes);
    const painting = pdf.getPages().flatMap(page => {
      const contents = page.node.Contents();
      if (!(contents instanceof PDFArray)) throw Error("Expected PDF streams");
      return contents.asArray().map(ref => {
        const stream = pdf.context.lookup(ref);
        if (!(stream instanceof PDFRawStream)) throw Error("Expected raw PDF stream");
        return new TextDecoder().decode(decodePDFRawStream(stream).decode());
      });
    }).join("\n");
    expect([...painting.matchAll(/\/Im\d+ Do/g)]).toHaveLength(count);
  }
}

it("discovers exact image source spans, entities and first duplicate attributes", async () => {
  const source = '<!-- <img src="hidden"> --><script>"<img src=hidden>"</script><IMG SRC=first&amp;x src="ignored"><img src=\'second\'>tail';
  const ctx = new ExecutionContext("convert", context);
  try {
    const targets = await htmlImageSources(source, ctx);
    expect(targets.map(target => target.source)).toEqual(["first&x", "second"]);
    expect(targets.map(target => source.slice(target.start, target.end))).toEqual(["SRC=first&amp;x", "src='second'"]);
  } finally {await ctx.close();}
});

const noteImageHtml = '<p>Body<a role="doc-noteref" href="#note">1</a></p><section role="doc-endnotes"><hr><ol><li id="note"><p>Note image <img src="pixel.jpg"><a role="doc-backlink" href="#ref"><img src="missing.jpg"></a></p></li></ol></section>';

it("prepares raw note resources without reading or rewriting removed backlink images", async () => {
  const host = files({"/pixel.jpg": picture});
  const ctx = new ExecutionContext("convert", {...context, resourceFiles: host.fs});
  try {
    const document: Document = {blocks: [{t: "RawBlock", c: ["html", noteImageHtml]}], metadata: {}, resources: []};
    const prepared = await new ResourceSession(ctx).prepare(document, false, true, true);
    expect(prepared.resources).toEqual([{id: "pixel.jpg", bytes: picture}]);
    expect(prepared.blocks).toEqual(document.blocks);
    expect(host.readFile.mock.calls.map(([path]) => path)).toEqual(["/pixel.jpg"]);
  } finally {await ctx.close();}
});

for (const to of ["docx", "pdf"] as const) for (const via of ["resolver", "vfs"] as const) {
  it(`ignores only note backlink images while embedding real raw HTML note images in ${to} via ${via}`, async () => {
    const host = files({"/pixel.jpg": picture});
    const resolve = vi.fn(async (source: string) => {if (source !== "pixel.jpg") throw Error(`Missing image: ${source}`); return picture;});
    const document: Document = {blocks: [{t: "RawBlock", c: ["html", noteImageHtml]}], metadata: {}, resources: []};
    const result = await writeDocument(document, {to}, {...context, ...(via === "resolver" ? {resources: {resolve}} : {resourceFiles: host.fs})});
    if (result.kind !== "binary") throw Error("Expected binary document");
    if (to === "docx") {
      const parts = readZipArchiveEntries(result.bytes);
      const notes = new TextDecoder().decode(parts.get("word/footnotes.xml"));
      expect(notes).toContain("Note image");
      expect([...notes.matchAll(/<w:drawing\b[^>]*>/g)]).toHaveLength(1);
      expect([...parts.keys()].filter(key => key.startsWith("word/media/"))).toHaveLength(1);
    } else await expectImages(result.bytes, to, 1);
    expect(via === "resolver" ? resolve.mock.calls.map(([source]) => source) : host.readFile.mock.calls.map(([path]) => path)).toEqual([via === "resolver" ? "pixel.jpg" : "/pixel.jpg"]);
  });

  it(`still resolves missing ordinary body backlink images in ${to} via ${via}`, async () => {
    const host = files({"/pixel.jpg": picture});
    const resolve = vi.fn(async (source: string) => {if (source !== "pixel.jpg") throw Error(`Missing image: ${source}`); return picture;});
    const publish = vi.fn(async () => {});
    const html = '<p><a role="doc-backlink" href="#ref"><img src="body-missing.jpg"></a></p>' + noteImageHtml;
    const document: Document = {blocks: [{t: "RawBlock", c: ["html", html]}], metadata: {}, resources: []};
    await expect(writeDocument(document, {to}, {...context, ...(via === "resolver" ? {resources: {resolve}} : {resourceFiles: host.fs}), output: {publish}})).rejects.toMatchObject({code: via === "resolver" ? "E_IO" : "E_RESOURCE"});
    if (via === "resolver") expect(resolve.mock.calls.map(([source]) => source)).toContain("body-missing.jpg");
    expect(publish).not.toHaveBeenCalled();
  });
}

it("keeps backlink images outside standard note definitions and in split raw fragments", async () => {
  const source = '<section role="doc-endnotes"><p role="doc-backlink"><img src="stray.jpg"></p><ol><li><a role="doc-backlink"><img src="no-id.jpg"></a></li><li id="" data-heading="empty"><a role="doc-backlink"><img src="empty-id.jpg"></a></li><li data-heading="note"><a role="doc-backlink"><img src="ignored.jpg"></a><img src="note.jpg"></li></ol></section><a role="doc-backlink"><img src="body.jpg">';
  const ctx = new ExecutionContext("convert", context);
  try {
    expect((await htmlImageSources(source, ctx)).map(target => target.source)).toEqual(["stray.jpg", "no-id.jpg", "empty-id.jpg", "note.jpg", "body.jpg"]);
    expect((await htmlImageSources('<img src="fragment.jpg"></a></li></ol></section>', ctx)).map(target => target.source)).toEqual(["fragment.jpg"]);
  } finally {await ctx.close();}
});

it("admits raw images through the same VFS path and changes only their source attribute", async () => {
  const {fs, readFile} = files({"/notes/a&b.jpg": picture});
  const ctx = new ExecutionContext("convert", {...context, resourceFiles: fs});
  const media = new ResourceSession(ctx);
  const raw = {t: "RawBlock" as const, c: ["html", '<table><tr><td><img id=x SRC=\'a&amp;b.jpg\' alt="same"></td></tr></table>'] as const};
  media.origins.set(raw.c, {base: "/notes"});
  try {
    const prepared = await media.prepare({blocks: [raw], metadata: {}, resources: []}, false, true, true);
    const replacement = prepared.blocks[0] as typeof raw;
    expect(replacement.c[1]).toBe('<table><tr><td><img id=x src="a%26b.jpg" alt="same"></td></tr></table>');
    expect(raw.c[1]).toContain("SRC='a&amp;b.jpg'");
    expect(prepared.resources).toEqual([{id: "a%26b.jpg", bytes: picture}]);
    expect(readFile).toHaveBeenCalledOnce();
  } finally {await ctx.close();}
});

it("prepares only visible metadata images and preserves their input origins", async () => {
  const {fs, readFile} = files({"/notes/title.jpg": picture});
  const ctx = new ExecutionContext("convert", {...context, resourceFiles: fs});
  const media = new ResourceSession(ctx);
  const raw = {t: "RawInline" as const, c: ["html", '<img src="title.jpg">'] as const};
  media.origins.set(raw.c, {base: "/notes"});
  const unused = {t: "MetaInlines" as const, c: [{t: "Image" as const, c: [["", [], []], [], ["https://unused.test/image", ""]] as const}]};
  try {
    const prepared = await media.prepare({blocks: [], metadata: {title: {t: "MetaInlines", c: [raw]}, custom: unused, author: {t: "MetaMap", c: {name: unused}}}, resources: []}, false, true, true);
    expect(prepared.resources).toEqual([{id: "title.jpg", bytes: picture}]);
    expect(prepared.metadata.custom).toBe(unused);
    expect(readFile.mock.calls.map(([path]) => path)).toEqual(["/notes/title.jpg"]);
  } finally {await ctx.close();}
});

it.each(["docx", "pdf"] as const)("embeds raw and typed images once per source in %s", async to => {
  const resolve = vi.fn(async () => picture);
  const source = '![typed](https://example.test/a?x=1&y=2) <img src="https://example.test/a?x=1&amp;y=2" alt="raw"> <img src="https://example.test/a?x=1&amp;y=2">';
  const result = await convert([input(source)], {from: "gfm", to}, {...context, resources: {resolve}});
  if (result.kind !== "binary") throw Error("Expected binary document");
  await expectImages(result.bytes, to, 3);
  expect(resolve).toHaveBeenCalledOnce();
  expect(resolve).toHaveBeenCalledWith("https://example.test/a?x=1&y=2", undefined, undefined);
});

it.each(["docx", "pdf"] as const)("embeds data URLs in raw inline and block HTML in %s", async to => {
  const source = `before <img src="${data}"> after\n\n<table><tr><td><img src="${data}"></td></tr></table>`;
  const result = await convert([input(source)], {from: "commonmark", to}, context);
  if (result.kind !== "binary") throw Error("Expected binary document");
  await expectImages(result.bytes, to, 2);
});

it.each([false, true])("preserves separate raw-image input origins with fileScope=%s", async fileScope => {
  const {fs, readFile} = files({"/one/pixel.jpg": picture, "/two/pixel.jpg": second});
  const source = '![typed](pixel.jpg) before <img src="pixel.jpg"> after\n\n<div><img src="pixel.jpg"></div>';
  const result = await convert([input(source, "/one"), input(source, "/two")], {from: "commonmark", to: "docx", fileScope}, {...context, resourceFiles: fs});
  if (result.kind !== "binary") throw Error("Expected binary document");
  await expectImages(result.bytes, "docx", 6);
  expect(readFile.mock.calls.map(([path]) => path)).toEqual(["/one/pixel.jpg", "/two/pixel.jpg"]);
  const media = [...readZipArchiveEntries(result.bytes)].filter(([key]) => key.startsWith("word/media/")).map(([, bytes]) => bytes);
  expect(media).toContainEqual(picture);
  expect(media).toContainEqual(second);
});

it("retains raw-image origins across the public read/write seam and resourcePath override", async () => {
  const {fs, readFile} = files({"/origin/pixel.jpg": picture, "/search/pixel.jpg": second});
  const document = await readDocument(input('before <img src="pixel.jpg">', "/origin"), {from: "commonmark"}, context);
  await writeDocument(document, {to: "docx"}, {...context, resourceFiles: fs});
  await writeDocument(document, {to: "docx", resourcePath: ["/search"]}, {...context, resourceFiles: fs});
  expect(readFile.mock.calls.map(([path]) => path)).toEqual(["/origin/pixel.jpg", "/search/pixel.jpg"]);
});

it.each(["docx", "pdf"] as const)("uses a supplied streaming resolver for raw images in %s", async to => {
  let closed = false;
  const resolveStream = vi.fn(async function* () {try {yield picture.subarray(0, 17); yield picture.subarray(17);} finally {closed = true;}});
  const result = await convert([input('before <img src="opaque:picture">')], {from: "gfm", to}, {...context, resources: {resolveStream}});
  if (result.kind !== "binary") throw Error("Expected binary document");
  await expectImages(result.bytes, to, 1);
  expect(resolveStream).toHaveBeenCalledOnce();
  expect(closed).toBe(true);
});

it.each(["images", "resources", "resourceBytes"] as const)("enforces raw-image %s limits before publication", async limit => {
  const publish = vi.fn(async () => {});
  await expect(convert([input(`before <img src="${data}">`)], {from: "gfm", to: "docx"}, {...context, limits: {[limit]: 0}, output: {publish}})).rejects.toMatchObject({code: "E_LIMIT"});
  expect(publish).not.toHaveBeenCalled();
});

it("leaves raw-image extraction unpublished when a later resource fails", async () => {
  const {fs, volume} = files({"/notes/pixel.jpg": picture});
  const publish = vi.fn(async () => {});
  await expect(convert([input('before <img src="pixel.jpg"><img src="missing.jpg">', "/notes")], {
    from: "commonmark", to: "docx", extractMedia: "/extracted"
  }, {...context, resourceFiles: fs, output: {publish}})).rejects.toMatchObject({code: "E_RESOURCE"});
  expect(volume.existsSync("/extracted")).toBe(false);
  expect(publish).not.toHaveBeenCalled();
});

it("requires explicit authority for remote and file raw-image URLs", async () => {
  for (const source of ["https://example.test/image.jpg", "file:///image.jpg"]) {
    const publish = vi.fn(async () => {});
    await expect(convert([input(`before <img src="${source}">`)], {from: "commonmark", to: "docx"}, {...context, output: {publish}})).rejects.toMatchObject({code: "E_RESOURCE", message: expect.stringContaining("Missing image resource")});
    expect(publish).not.toHaveBeenCalled();
  }
});

it("honors cancellation and resolver errors before publishing raw-image output", async () => {
  for (const cancel of [false, true]) {
    const publish = vi.fn(async () => {}), controller = new AbortController();
    const resolve = vi.fn(async (_source: string, _base: string | undefined, signal: AbortSignal | undefined) => {
      expect(signal).toBe(controller.signal);
      if (cancel) {controller.abort(); return picture;}
      throw Error("Resource unavailable");
    });
    await expect(convert([input('before <img src="https://example.test/pixel.jpg">')], {from: "gfm", to: "docx"}, {...context, signal: controller.signal, resources: {resolve}, output: {publish}})).rejects.toMatchObject({code: cancel ? "E_CANCELLED" : "E_IO"});
    expect(resolve).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  }
});

it("does not admit raw images for other writers or change the public Markdown AST", async () => {
  const source = 'before <img src="pixel.jpg"> after';
  const {fs, readFile} = files({"/pixel.jpg": picture});
  const result = await convert([input(source)], {from: "commonmark", to: "json"}, {...context, resourceFiles: fs});
  expect(result.kind).toBe("text");
  if (result.kind !== "text") throw Error("Expected JSON");
  const document = JSON.parse(result.text) as {blocks: Document["blocks"]};
  expect(document.blocks[0]).toMatchObject({t: "Para", c: expect.arrayContaining([{t: "RawInline", c: ["html", '<img src="pixel.jpg">']}])});
  expect(readFile).not.toHaveBeenCalled();
});

const detailCases = [false, true].flatMap(open => [false, true].flatMap(splitSummary =>
  [false, true].flatMap(resetBold => [false, true].flatMap(retained =>
    (["docx", "pdf"] as const).map(to => ({open, splitSummary, resetBold, retained, to}))))));

it.each(detailCases)("exports details open=$open splitSummary=$splitSummary resetBold=$resetBold retained=$retained in $to", async ({open, splitSummary, resetBold, retained, to}) => {
  const start = `<details id="detail"${open ? " open" : ""}>`;
  const summaryStart = `<summary id="summary"${resetBold ? ' style="font-weight:normal"' : ""}>`;
  const normal = '<span dir="ltr" style="font-weight:normal">SummaryNormal</span>';
  const summary = splitSummary
    ? `${summaryStart}\n\nSummary **SummaryBold** ${normal}\n\n</summary>`
    : `${summaryStart}Summary <strong>SummaryBold</strong> ${normal}</summary>`;
  const markdown = `Before\n\n${start}\n${summary}\n\nBody *BodyItalic* and \`BodyCode\`.\n\n[SummaryLink](#summary) [DetailsLink](#detail)\n\n</details>\n\nAfter\n`;
  const html = `<p>Before</p>${start}${summaryStart}Summary <strong>SummaryBold</strong> ${normal}</summary><p>Body <em>BodyItalic</em> and <code>BodyCode</code>.</p><p><a href="#summary">SummaryLink</a> <a href="#detail">DetailsLink</a></p></details><p>After</p>`;
  let source = markdown, from = "gfm";
  if (retained) {
    // The retained reader feeds the public JSON seam: binary writers currently
    // buffer their input and are not themselves retained-output adapters.
    const fs = new MemoryFileSystem();
    const chunks: Uint8Array[] = [];
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole-document retained fallback"));
    try {
      await publicConvertToOutput([input(markdown)], {from: "gfm", to: "json"}, {
        ...context, workingFiles: {fs, directory: "/", cacheBytes: 16384},
        output: {async write(bytes) {chunks.push(bytes.slice());}, async close() {}, async abort() {}},
      });
      expect(acquire).not.toHaveBeenCalled();
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
    source = new TextDecoder().decode(Buffer.concat(chunks));
    from = "json";
  }
  const result = await publicConvert([input(source)], {from, to}, context);
  // Compare against the shared Rust semantic-HTML path. The legacy public
  // HTML reader has its own summary defaults before it produces Pandoc AST.
  const reference = await semanticHtmlConvert({mode: "html", format: to, html});
  if (result.kind !== "binary") throw Error("Expected binary export");
  expect(result.diagnostics).toEqual([]);
  const words = ["Before", "Summary", "SummaryBold", "SummaryNormal", "Body", "BodyItalic", "BodyCode", "SummaryLink", "DetailsLink", "After"];
  if (to === "docx") {
    const document = (bytes: Uint8Array) => new TextDecoder().decode(readZipArchiveEntries(bytes).get("word/document.xml"));
    const xml = document(result.bytes), expected = document(reference.bytes);
    const text = [...xml.matchAll(/<w:t\b[^>]*>(.*?)<\/w:t>/gs)].map(match => match[1]).join(" ");
    let previous = -1;
    for (const word of words) {const at = text.indexOf(word, previous + 1); expect(at, word).toBeGreaterThan(previous); previous = at;}
    const run = (body: string, value: string) => [...body.matchAll(/<w:r\b[^>]*>.*?<\/w:r>/gs)].find(match => match[0].includes(value))?.[0];
    expect(run(xml, "SummaryBold")).toContain("<w:b/>");
    expect(run(xml, "SummaryNormal")).toBeDefined();
    expect(run(xml, "SummaryNormal")).not.toContain("<w:b/>");
    const summaryRun = [...xml.matchAll(/<w:r\b[^>]*>.*?<\/w:r>/gs)].find(match => /<w:t\b[^>]*>Summary(?: |<)/.test(match[0]))?.[0];
    expect(summaryRun).toBeDefined();
    expect(summaryRun!.includes("<w:b/>")).toBe(!resetBold);
    expect(run(xml, "BodyItalic")).toContain("<w:i/>");
    expect(run(xml, "BodyCode")).toContain('w:rStyle w:val="VerbatimChar"');
    for (const id of ["detail", "summary"]) {
      expect(xml).toContain(`w:name="${id}"`);
      expect(xml).toContain(`w:anchor="${id}"`);
    }
    expect(xml).toBe(expected);
  } else {
    const pdf = await PDFDocument.load(result.bytes), expected = await PDFDocument.load(reference.bytes);
    const streams = (document: PDFDocument) => document.getPages().map(page => {
      const contents = page.node.Contents();
      if (!(contents instanceof PDFArray)) throw Error("Expected content streams");
      return contents.asArray().map(ref => {
        const stream = document.context.lookup(ref);
        if (!(stream instanceof PDFRawStream)) throw Error("Expected raw PDF stream");
        return new TextDecoder().decode(decodePDFRawStream(stream).decode());
      }).join("\n");
    });
    // Pandoc paragraphs and direct HTML keep different existing paragraph gaps
    // and link decoration defaults. Compare text/font runs, not those defaults.
    const styledText = (document: PDFDocument) => streams(document).flatMap((content, index) => {
      const fonts = document.getPages()[index]!.node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
      return [...content.matchAll(/BT \/(F\d+) ([\d.]+) Tf[\s\S]*?<([\dA-F]+)> Tj/g)].map(match => [
        fonts.lookup(PDFName.of(match[1]!), PDFDict).lookup(PDFName.of("BaseFont"), PDFName).toString(), match[2], match[3],
      ]);
    });
    expect(styledText(pdf)).toEqual(styledText(expected));
    expect(styledText(pdf).some(([font]) => font!.includes("Bold"))).toBe(true);
    expect(styledText(pdf).some(([font]) => font!.includes("Italic"))).toBe(true);
    expect(styledText(pdf).some(([font]) => font!.includes("Mono"))).toBe(true);
    const destinations = (document: PDFDocument) => document.getPages().flatMap(page => (page.node.Annots()?.asArray() ?? []).map(ref => {
      const annotation = document.context.lookup(ref, PDFDict);
      const destination = annotation.lookup(PDFName.of("Dest"), PDFArray);
      const target = document.getPages().findIndex(candidate => candidate.ref.toString() === destination.get(0).toString());
      const y = destination.lookup(3, PDFNumber).asNumber();
      expect(y).toBeGreaterThan(annotation.lookup(PDFName.of("Rect"), PDFArray).lookup(3, PDFNumber).asNumber());
      expect(y).toBeLessThanOrEqual(page.getHeight());
      return target;
    }));
    expect(destinations(pdf)).toEqual(destinations(expected));
    expect(destinations(pdf)).toEqual([0, 0]);
    const plain = await publicConvert([{bytes: result.bytes}], {from: "pdf", to: "plain"}, context);
    if (plain.kind !== "text") throw Error("Expected extracted PDF text");
    let previous = -1;
    for (const word of words) {const at = plain.text.indexOf(word, previous + 1); expect(at, word).toBeGreaterThan(previous); previous = at;}
  }
});
