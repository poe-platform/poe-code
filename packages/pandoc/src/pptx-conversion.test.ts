import { expect, it, beforeAll, afterAll, vi } from "vitest";
import { convert, readDocument, writeDocument } from "./engine.js";
import type { Document } from "./types.js";
import type { Block } from "./ast-types.js";
import jpeg from "jpeg-js";
import { pptxReader, pptxWriter } from "./pptx.js";
import { crc32, inflateRawSync, deflateSync } from "node:zlib";
import path from "node:path";
import { SaxesParser } from "saxes";
import { Volume } from "memfs";
import { Presentation, Inches, readNotes, createPresentation, addLayout, mutateAnimations, readLayouts, CategoryChartData, addOleObject } from "pptx";

// Independent classic ZIP inspector: no engine packaging or XML APIs.
function inspectZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const parts: {name: string; payload: Uint8Array}[] = [];
  let offset = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const local = view.getUint32(offset + 42, true);
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const nameSize = view.getUint16(offset + 28, true);
    const name = new TextDecoder("utf-8", {fatal: true}).decode(bytes.subarray(offset + 46, offset + 46 + nameSize));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const compressed = bytes.subarray(start, start + view.getUint32(offset + 20, true));
    const method = view.getUint16(offset + 10, true);
    expect([0, 8]).toContain(method);
    const payload = method === 8 ? new Uint8Array(inflateRawSync(compressed)) : new Uint8Array(compressed);
    expect(payload.length).toBe(view.getUint32(offset + 24, true));
    expect(crc32(payload)).toBe(view.getUint32(offset + 16, true));
    parts.push({name, payload});
    offset += 46 + nameSize + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  expect(new Set(parts.map(p => p.name)).size).toBe(count);
  return parts;
}

const ec = {
  limits: { maxBytes: 1e6, maxReads: 10000, chunkBytes: 4096 },
  archiveLimits: { maxArchiveBytes: 1e6, maxEntryBytes: 1e6, maxTotalBytes: 1e6,
    maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 4096,
    maxTextBytes: 1e6, chunkSize: 4096 },
  xmlLimits: { maxBytes: 1e6, maxNodes: 10000, maxDepth: 128 },
  relationshipLimits: { maxBytes: 1e6, maxParts: 100, maxRelationships: 1000 }
};
const a = ["", [], []] as const;
const para = (text: string): Block => ({t: "Para", c: [{t: "Str", c: text}]});
const heading: Block = {t: "Header", c: [1, a, [{t: "Str", c: "Orchard"}]]};
async function write(blocks: Block[], extra: Partial<Document> = {}) {
  const result = await writeDocument({blocks, resources: [], metadata: {}, ...extra}, {to: "pptx"}, context);
  if (result.kind !== "binary") throw new Error("Expected bytes");
  return result.bytes;
}

const encode = (text: string) => new TextEncoder().encode(text);
it("rejects table formatting and section semantics that cannot be preserved", async () => {
  const cell = (text: string) => [a, "AlignDefault", 1, 1, [para(text)]] as const;
  const row = [a, [cell("Sample")]] as const;
  const table: Extract<Block, {t: "Table"}> = {t: "Table", c: [a, [null, []], [["AlignDefault", {t: "ColWidthDefault"}]], [a, []], [[a, 0, [], [row]]], [a, []]]};
  const variants: Extract<Block, {t: "Table"}>[] = [
    {t: "Table", c: [a, [null, []], [["AlignCenter", {t: "ColWidthDefault"}]], table.c[3], table.c[4], table.c[5]]},
    {t: "Table", c: [a, [null, []], [["AlignDefault", {t: "ColWidth", c: 0.5}]], table.c[3], table.c[4], table.c[5]]},
    {t: "Table", c: [a, [null, []], table.c[2], [a, [row, row]], table.c[4], table.c[5]]},
    {t: "Table", c: [a, [null, []], table.c[2], table.c[3], table.c[4], [a, [row]]]}
  ];
  for (const variant of variants) {
    await expect(write([heading, variant])).rejects.toMatchObject({code: "E_CAPABILITY"});
  }
});
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, ms?: number) =>
    ms === 0 ? setImmediate(cb) : timer(cb, ms)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const context = { reader: pptxReader, writer: pptxWriter, yield: async () => {} };
async function deck(text: string, metadata = {}) {
  const result = await convert([{ bytes: encode(text) }], { from: "commonmark", to: "pptx", metadata }, context);
  expect(result.kind).toBe("binary");
  if (result.kind !== "binary") throw new Error("Expected deck");
  const volume = new Volume();
  volume.writeFileSync("/original.pptx", result.bytes);
  return new Uint8Array(volume.readFileSync("/original.pptx") as Uint8Array);
}
function texts(bytes: Uint8Array) {
  const parts = new Map(inspectZip(bytes).map(p => [p.name, p]));
  const slides: string[] = [];
  const relationships = elements(parts.get("ppt/_rels/presentation.xml.rels")!.payload, "Relationship");
  const parser = new SaxesParser({xmlns: true});
  parser.on("opentag", tag => {
    if (tag.local !== "sldId") return;
    const id = Object.values(tag.attributes).find(a => a.local === "id" && a.uri.endsWith("/relationships"))!.value;
    const rel = relationships.find(r => r.Id === id)!;
    expect(rel.Type!.endsWith("/slide")).toBe(true);
    slides.push(path.posix.normalize(path.posix.join("ppt", rel.Target!)));
  });
  parser.write(new TextDecoder().decode(parts.get("ppt/presentation.xml")!.payload)).close();
  return slides.map(name => {
    const part = parts.get(name)!;
    const values: string[] = [];
    let inText = false;
    let shapeText = "";
    const parser = new SaxesParser({ xmlns: true });
    parser.on("opentag", tag => { inText = tag.local === "t"; });
    parser.on("text", text => { if (inText) shapeText += text; });
    parser.on("closetag", tag => { inText = false; if (tag.local === "sp") { values.push(shapeText); shapeText = ""; } });
    parser.write(new TextDecoder().decode(part.payload)).close();
    return values;
  });
}
function elements(bytes: Uint8Array, name: string) {
  const values: Record<string, string>[] = [];
  const parser = new SaxesParser({xmlns: true});
  parser.on("opentag", tag => {if (tag.local === name) values.push(Object.fromEntries(Object.values(tag.attributes).map(a => [a.local, a.value])));});
  parser.write(new TextDecoder().decode(bytes)).close();
  return values;
}
function textShapes(bytes: Uint8Array) {
  const values: {text: string; x?: string; y?: string}[] = [];
  let shape: typeof values[number] | undefined, inText = false;
  const parser = new SaxesParser({xmlns: true});
  parser.on("opentag", tag => {
    if (tag.local === "sp") shape = {text: ""};
    if (shape && tag.local === "off") {const attrs = Object.fromEntries(Object.values(tag.attributes).map(a => [a.local, a.value])); shape.x = attrs.x!; shape.y = attrs.y!;}
    if (tag.local === "t") inText = true;
  });
  parser.on("text", text => {if (inText && shape) shape.text += text;});
  parser.on("closetag", tag => {if (tag.local === "t") inText = false; if (tag.local === "sp" && shape) {values.push(shape); shape = undefined;}});
  parser.write(new TextDecoder().decode(bytes)).close();
  return values;
}
function originalPng() {
  const chunk = (name: string, payload: Uint8Array) => {
    const data = Buffer.concat([Buffer.from(name), payload]);
    const length = Buffer.alloc(4); length.writeUInt32BE(payload.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(data));
    return Buffer.concat([length, data, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(4); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(34, 255); pixels[0] = 0; pixels[17] = 0;
  return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", new Uint8Array())]));
}
it("keeps preamble, title-only and consecutive empty slides in order", async () => {
  expect(texts(await deck("Orchard preamble\n\n# Spring\n\n---\n\n---\n\n# Summer\n\nHarvest"))).toEqual([
    ["Orchard preamble"], ["Spring"], [], [], ["Summer", "Harvest"]
  ]);
});
it("treats deeper headings as content and rejects ambiguous automatic heading inference", async () => {
  expect(texts(await deck("# Spring\n\n## Buds\n\n# Summer"))).toEqual([["Spring", "Buds"], ["Summer"]]);
  await expect(deck("# One\n\n## Two", { "pptx-slide-level": { t: "MetaString", c: "auto" } })).rejects.toMatchObject({code: "E_OPTION"});
});
it("preserves original nested list structure in the conversion round trip", async () => {
  const doc = await readDocument({bytes: await deck("# Trees\n\n- Apple\n  - Red\n  - Green\n- Pear")}, {from: "pptx"}, context);
  expect(JSON.stringify(doc.blocks)).toContain('"t":"BulletList"');
  expect(JSON.stringify(doc.blocks)).toContain("Green");
  const div = doc.blocks[0]!;
  expect(div.t).toBe("Div");
  if (div.t === "Div") expect(div.c[1].find(b => b.t === "BulletList")?.c).toHaveLength(2);
});
it("writes hyperlink relationships and recovers linked text", async () => {
  const bytes = await deck("# Survey\n\n[Field map](https://example.org/orchard)");
  const parts = inspectZip(bytes);
  expect(parts.some(p => new TextDecoder().decode(p.payload).includes('Target="https://example.org/orchard"'))).toBe(true);
  const doc = await readDocument({bytes}, {from: "pptx"}, context);
  expect(JSON.stringify(doc.blocks)).toContain('"t":"Link"');
  expect(JSON.stringify(doc.blocks)).toContain("https://example.org/orchard");
});
it("separates structural extraction order from visual reading order", async () => {
  const model = await Presentation();
  const slide = model.slides.add_slide(model.slide_layouts.get(0));
  slide.shapes.add_textbox(new Inches(1), new Inches(4), new Inches(4), new Inches(1)).text = "First in structure";
  slide.shapes.add_textbox(new Inches(1), new Inches(1), new Inches(4), new Inches(1)).text = "Second in structure";
  const doc = await readDocument({bytes: await model.save()}, {from: "pptx"}, context);
  const json = JSON.stringify(doc.blocks);
  expect(json.indexOf("First in structure")).toBeLessThan(json.indexOf("Second in structure"));
  expect(json).toContain("structural");
});
it("writes and reads speaker notes separately from visible content", async () => {
  const bytes = await write([heading, para("Visible survey"), {t: "Div", c: [["", ["notes"], []], [para("Discuss frost risk")]]}]);
  expect(texts(bytes)[0]!.join(" ")).not.toContain("frost");
  expect((await readNotes(bytes, {}, ec))[0]!.text).toBe("Discuss frost risk");
  const doc = await readDocument({bytes}, {from: "pptx"}, context);
  expect(JSON.stringify(doc.blocks)).toContain('"notes"');
  expect(JSON.stringify(doc.blocks)).toContain("Discuss frost risk");
});
it.each(["jpg", "png"])("retains original %s bytes and contains the image without changing its aspect ratio", async extension => {
  const media = extension === "png" ? originalPng() : new Uint8Array(jpeg.encode({width: 4, height: 2, data: new Uint8Array(32).fill(255)}, 70).data);
  const image: Block = {t: "Para", c: [{t: "Image", c: [["", [], [["width", "2in"]]], [{t: "Str", c: "Original sky"}], ["sky.jpg", ""]]}]};
  const bytes = await write([heading, image], {resources: [{id: "sky.jpg", bytes: media}]});
  expect(inspectZip(bytes).find(p => p.name.startsWith("ppt/media/"))!.payload).toEqual(media);
  const parts = inspectZip(bytes);
  const rel = elements(parts.find(p => p.name === "ppt/slides/_rels/slide1.xml.rels")!.payload, "Relationship").find(r => r.Type!.endsWith("/image"))!;
  expect(parts.find(p => p.name === path.posix.normalize(path.posix.join("ppt/slides", rel.Target!)))!.payload).toEqual(media);
  expect(elements(parts.find(p => p.name === "ppt/slides/slide1.xml")!.payload, "ext")).toContainEqual({cx: "1828800", cy: "914400"});
  const model = await Presentation(bytes);
  const picture = model.slides.get(0).shapes.get(1);
  expect(picture.width!.emu / picture.height!.emu).toBe(2);
  expect(picture.width!.inches).toBe(2);
  const doc = await readDocument({bytes}, {from: "pptx"}, context);
  expect(doc.resources[0]!.bytes).toEqual(media);
  expect(JSON.stringify(doc.blocks)).toContain("Image");
});
it("resolves presentation relationship order independently for more than nine slides", async () => {
  const bytes = await deck(Array.from({length: 12}, (_, i) => `# Season ${i + 1}`).join("\n\n"));
  expect(texts(bytes)).toEqual(Array.from({length: 12}, (_, i) => [`Season ${i + 1}`]));
});
it("rejects an unsupported two-column reference layout instead of silently projecting it", async () => {
  const reference = (await addLayout(await createPresentation({}, ec), {scope: "layouts", master: "/ppt/slideMasters/slideMaster1.xml", name: "Orchard columns", type: "twoColTx"}, ec)).bytes;
  const metadata = {"pptx-reference": {t: "MetaString", c: "ref"}, "pptx-layout-title-body": {t: "MetaString", c: "Orchard columns"}} as const;
  await expect(writeDocument({blocks: [heading, para("Orchard report")], resources: [], metadata}, {to: "pptx"}, {...context, resources: {resolve: async () => reference}})).rejects.toMatchObject({code: "E_CAPABILITY"});
});
it("maps original reference placeholders to their declared title and body geometry", async () => {
  const reference = (await addLayout(await createPresentation({}, ec), {scope: "layouts", master: "/ppt/slideMasters/slideMaster1.xml", name: "Orchard content", type: "tx", placeholders: [
    {type: "title", index: 0, x: 900000, y: 200000, width: 8000000, height: 900000},
    {type: "body", index: 1, x: 1400000, y: 1900000, width: 7000000, height: 3600000}
  ]}, ec)).bytes;
  const metadata = {"pptx-reference": {t: "MetaString", c: "ref"}, "pptx-layout-title-body": {t: "MetaString", c: "Orchard content"}} as const;
  const result = await writeDocument({blocks: [heading, para("Body survey")], resources: [], metadata}, {to: "pptx"}, {...context, resources: {resolve: async () => reference}});
  if (result.kind !== "binary") throw new Error("Expected bytes");
  const slide = inspectZip(result.bytes).find(p => p.name === "ppt/slides/slide1.xml")!;
  expect(textShapes(slide.payload).find(s => s.text === "Orchard")).toMatchObject({x: "900000", y: "200000"});
  expect(textShapes(slide.payload).find(s => s.text === "Body survey")).toMatchObject({x: "1400000", y: "1900000"});
  expect(texts(result.bytes)[0]!.filter(Boolean)).toEqual(["Orchard", "Body survey"]);
});
it("keeps an original rectangular table with surrounding paragraphs on the same slide", async () => {
  const cell = (text: string) => [a, "AlignDefault", 1, 1, [para(text)]] as const;
  const table: Block = {t: "Table", c: [a, [null, []], [["AlignDefault", {t: "ColWidthDefault"}], ["AlignDefault", {t: "ColWidthDefault"}]],
    [a, [[a, [cell("Tree"), cell("Count")]]]], [[a, 0, [], [[a, [cell("Pear"), cell("7")]]]]], [a, []]]};
  const bytes = await write([heading, para("Before"), table, para("After")]);
  const doc = await readDocument({bytes}, {from: "pptx"}, context);
  expect(doc.blocks).toHaveLength(1);
  const json = JSON.stringify(doc.blocks);
  expect(json).toContain('"t":"Table"');
  expect(json.indexOf("Before")).toBeLessThan(json.indexOf('"t":"Table"'));
  expect(json.indexOf("After")).toBeGreaterThan(json.indexOf("Pear"));
});
it("uses explicit reference layout names, preserves deck ratio and rejects missing layouts", async () => {
  let reference = await createPresentation({width: 9144000, height: 6858000}, ec);
  reference = (await addLayout(reference, {scope: "layouts", master: "/ppt/slideMasters/slideMaster1.xml", name: "Orchard title", type: "titleOnly"}, ec)).bytes;
  const metadata = {"pptx-reference": {t: "MetaString", c: "reference.pptx"}, "pptx-layout-title-only": {t: "MetaString", c: "Orchard title"}} as const;
  const referenceContext = {...context, resources: {resolve: async () => reference}};
  const result = await writeDocument({blocks: [heading], resources: [], metadata}, {to: "pptx"}, referenceContext);
  if (result.kind !== "binary") throw new Error("Expected deck");
  const model = await Presentation(result.bytes);
  expect(model.slide_width!.emu / model.slide_height!.emu).toBeCloseTo(4 / 3);
  const layouts = await readLayouts(result.bytes, ec);
  expect(layouts.find(l => l.name === "Orchard title")!.affectedSlides).toEqual([1]);
  await expect(writeDocument({blocks: [heading], resources: [], metadata: {...metadata, "pptx-layout-title-only": {t: "MetaString", c: "Absent"}}}, {to: "pptx"}, referenceContext)).rejects.toMatchObject({code: "E_CAPABILITY"});
});
it("rejects conservative geometric overflow instead of claiming measured text fit", async () => {
  await expect(write([heading, ...Array.from({length: 12}, (_, i) => para(`Row ${i}`))])).rejects.toMatchObject({code: "E_CAPABILITY"});
  await expect(write([heading, para("x".repeat(801))])).rejects.toMatchObject({code: "E_CAPABILITY"});
});
it("rejects authored animations and diagnoses explicit lossy extraction", async () => {
  const bytes = await deck("# Orchard\n\nFrost");
  const animated = (await mutateAnimations(bytes, "add", {kind: "appear", trigger: "on-click", target: {slide: {coordinateSystem: "one-based", value: 1}, shape: "Pandoc paragraph 3"}}, ec)).bytes;
  await expect(readDocument({bytes: animated}, {from: "pptx"}, context)).rejects.toMatchObject({code: "E_CAPABILITY"});
  const result = await convert([{bytes: animated}], {from: "pptx", to: "plain", lossy: true}, {reader: pptxReader, yield: async () => {}});
  expect(result.diagnostics.some(d => d.code === "W_PRESENTATION_LOSS" && d.message.includes("Animations"))).toBe(true);
});
it("rebuilds reader slide Divs without discarding title-only and empty slides", async () => {
  const original = await deck("# Spring\n\n---\n\n# Summer\n\nHarvest");
  const doc = await readDocument({bytes: original}, {from: "pptx"}, context);
  expect(texts(await write([...doc.blocks]))).toEqual(texts(original));
});
it("retains mixed list nesting, numbering starts and continuation paragraphs", async () => {
  const bytes = await deck("# Inventory\n\n3. Apple\n   - Red\n   - Green\n4. Pear\n\n   Second paragraph");
  const doc = await readDocument({bytes}, {from: "pptx"}, context);
  const slide = doc.blocks[0]!;
  if (slide.t !== "Div") throw new Error("Expected slide");
  const list = slide.c[1].find(b => b.t === "OrderedList");
  if (!list || list.t !== "OrderedList") throw new Error("Expected numbered list");
  expect(list.c[0][0]).toBe(3);
  expect(list.c[1]).toHaveLength(2);
  expect(list.c[1][0]!.find(b => b.t === "BulletList")?.c).toHaveLength(2);
  expect(list.c[1][1]).toHaveLength(2);
});
it("rejects authored charts and embedded objects without native activation", async () => {
  const model = await Presentation();
  const slide = model.slides.add_slide(model.slide_layouts.get(0));
  const data = new CategoryChartData(); data.categories = ["Pear", "Apple"]; data.add_series("Trees", [7, 4]);
  slide.shapes.add_chart("COLUMN_CLUSTERED", new Inches(1), new Inches(1), new Inches(4), new Inches(2), data);
  await expect(readDocument({bytes: await model.save()}, {from: "pptx"}, context)).rejects.toMatchObject({code: "E_CAPABILITY"});
  const iconBytes = new Uint8Array(jpeg.encode({width: 1, height: 1, data: new Uint8Array(4).fill(255)}, 70).data);
  const objectDeck = await addOleObject(await deck("# Attachments"), {slide: 1, bytes: encode("Original inert attachment"), progId: "Package", iconBytes, iconContentType: "image/jpeg"}, ec);
  await expect(readDocument({bytes: objectDeck}, {from: "pptx"}, context)).rejects.toMatchObject({code: "E_CAPABILITY"});
});
it("reports unmeasured text layout and allows warning rejection", async () => {
  const doc = {blocks: [heading, para("Original content")], metadata: {}, resources: []};
  const result = await writeDocument(doc, {to: "pptx"}, context);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({code: "W_LAYOUT_UNMEASURED"}));
  await expect(writeDocument(doc, {to: "pptx", failIfWarnings: true}, context)).rejects.toMatchObject({code: "E_WARNINGS"});
});
it("rejects stretched image requests and non-plaintext speaker-note links", async () => {
  const media = new Uint8Array(jpeg.encode({width: 4, height: 2, data: new Uint8Array(32).fill(255)}, 70).data);
  const image: Block = {t: "Para", c: [{t: "Image", c: [["", [], [["width", "2in"], ["height", "2in"]]], [], ["sky.jpg", ""]]}]};
  await expect(write([heading, image], {resources: [{id: "sky.jpg", bytes: media}]})).rejects.toMatchObject({code: "E_CAPABILITY"});
  const notes: Block = {t: "Div", c: [["", ["notes"], []], [{t: "Para", c: [{t: "Link", c: [a, [{t: "Str", c: "Map"}], ["https://example.org", ""]]}]}]]};
  await expect(write([heading, notes])).rejects.toMatchObject({code: "E_CAPABILITY"});
});
