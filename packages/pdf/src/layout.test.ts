import {expect, it} from "vitest";
import {PDFDocument, PDFRawStream, decodePDFRawStream} from "pdf-lib";
import {renderPdf, suppliedDefaultFont, type Placement} from "./index.js";

const font = suppliedDefaultFont();
const page = {width: 160, height: 120, margin: 10};
const p = (text: string) => ({kind: "paragraph" as const, runs: [{text}], spaceAfter: 0});
async function inspect(blocks: Parameters<typeof renderPdf>[0]["blocks"], geometry = page) {
  const boxes: Placement[] = [];
  const bytes = await renderPdf({fonts: [font], blocks, page: geometry}, {onPlacement: box => boxes.push(box)});
  return {boxes, pdf: await PDFDocument.load(bytes)};
}
it("reports independently measurable glyph advances and wraps at word boundaries", async () => {
  const {boxes} = await inspect([p("hello world again")], {width: 112, height: 120, margin: 10});
  const text = boxes.filter(b => b.kind === "text");
  // Read the supplied sfnt's raw metric records independently of pdf-lib/fontkit.
  const sfnt = new DataView(font.bytes.buffer, font.bytes.byteOffset, font.bytes.byteLength);
  const tables = new Map<number, number>();
  for (let i = 0; i < sfnt.getUint16(4); i++) tables.set(sfnt.getUint32(12 + i * 16), sfnt.getUint32(20 + i * 16));
  const units = sfnt.getUint16(tables.get(0x68656164)! + 18);
  const advance = sfnt.getUint16(tables.get(0x686d7478)! + 4); // packaged mono glyph 1
  expect(text[0]!.width).toBeCloseTo(advance / units * 12 * 12, 5);
  expect(text.map(b => b.text)).toEqual(["hello world ", "again"]);
});
it("uses independently read ascent/descent metrics for line boxes", async () => {
  const {boxes} = await inspect([p("gÉ\npq")]);
  const view = new DataView(font.bytes.buffer, font.bytes.byteOffset, font.bytes.byteLength);
  let units = 0; let ascent = 0; let descent = 0;
  for (let i = 0; i < view.getUint16(4); i++) {
    const r = 12 + i * 16; const start = view.getUint32(r + 8);
    if (view.getUint32(r) === 0x68656164) units = view.getUint16(start + 18);
    if (view.getUint32(r) === 0x68686561) {ascent = view.getInt16(start + 4); descent = view.getInt16(start + 6);}
  }
  expect(boxes[0]!.height).toBeCloseTo((ascent - descent) / units * 12);
  expect(boxes[1]!.y - boxes[0]!.y).toBeCloseTo(boxes[0]!.height);
});
it("has deterministic empty/one/multiple page geometry with all boxes inside margins", async () => {
  expect((await inspect([])).pdf.getPageCount()).toBe(1);
  expect((await inspect([p("one")])).pdf.getPageCount()).toBe(1);
  const {boxes, pdf} = await inspect([p("https://example.com/" + "x".repeat(300)), p("code".repeat(100))]);
  expect(pdf.getPageCount()).toBeGreaterThan(1);
  for (const b of boxes) { expect(b.x).toBeGreaterThanOrEqual(10); expect(b.x + b.width).toBeLessThanOrEqual(150.00001); expect(b.y + b.height).toBeLessThanOrEqual(110.00001); }
  expect(boxes.filter(b => b.kind === "text").map(b => b.text).join("")).toBe("https://example.com/" + "x".repeat(300) + "code".repeat(100));
});
it("keeps two orphan/widow lines and a heading with its following paragraph", async () => {
  const {boxes} = await inspect([p("a\nb\nc\nd\ne"), {...p("heading"), keepWithNext: true}, p("one\ntwo\nthree")]);
  const heading = boxes.find(b => b.text === "heading")!;
  expect(heading.page).toBe(boxes.find(b => b.text === "one")!.page);
  const split = await inspect([p("a\nb\nc\nd\ne"), p("one\ntwo\nthree\nfour")]);
  expect(split.boxes.find(b => b.text === "one")!.page).toBe(2);
});
it("repeats table headers and splits oversized rows without dropping cell lines", async () => {
  const {boxes, pdf} = await inspect([{kind: "table", widths: [0.5, 0.5], headerRows: 1, rowSplit: "lines", rows: [[p("HEAD"), p("H2")], [p(Array.from({length: 18}, (_, i) => `r${i}`).join("\n")), p("other")]]}]);
  expect(pdf.getPageCount()).toBeGreaterThan(2);
  expect(boxes.filter(b => b.text === "HEAD")).toHaveLength(pdf.getPageCount());
  for (let i = 0; i < 18; i++) expect(boxes.filter(b => b.text === `r${i}`)).toHaveLength(1);
});
it("contains large images with their intrinsic aspect ratio", async () => {
  const bytes = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,2,0,0,0,144,119,83,222,0,0,0,12,73,68,65,84,120,156,99,80,104,56,0,0,2,36,1,97,221,20,154,144,0,0,0,0,73,69,78,68,174,66,96,130]);
  const {boxes} = await inspect([{kind: "image", bytes, media: "png", width: 400, height: 300, fit: "contain"}]);
  expect(boxes[0]).toMatchObject({kind: "image", width: 100, height: 100});
});
it("keeps headings with images and declared table headers", async () => {
  const bytes = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,2,0,0,0,144,119,83,222,0,0,0,12,73,68,65,84,120,156,99,80,104,56,0,0,2,36,1,97,221,20,154,144,0,0,0,0,73,69,78,68,174,66,96,130]);
  const heading = {...p("heading"), keepWithNext: true};
  const image = await inspect([p("a\nb\nc\nd\ne"), heading, {kind: "image", bytes, media: "png", width: 70, height: 70}]);
  expect(image.boxes.find(b => b.text === "heading")!.page).toBe(image.boxes.find(b => b.kind === "image")!.page);
  const table = await inspect([p("a\nb\nc\nd\ne"), heading, {kind: "table", widths: [1], headerRows: 1, rows: [[p("header")], [p("body")]]}]);
  expect(table.boxes.find(b => b.text === "heading")!.page).toBe(table.boxes.find(b => b.text === "body")!.page);
});
it("admits JPEG decoded dimensions before embedding", async () => {
  const bytes = Uint8Array.from([255,216,255,192,0,17,8,255,255,255,255,3,1,17,0,2,17,0,3,17,0,255,217]);
  expect(await inspect([{kind: "image", bytes, media: "jpeg", width: 40, height: 40}]).then(() => "accepted", e => e.code)).toBe("E_LIMIT");
});
it("rejects zero advance and hostile sfnt directories before library parsing", async () => {
  const corrupt = new Uint8Array(font.bytes); const view = new DataView(corrupt.buffer);
  view.setUint32(20, 0xfffffff0);
  expect(await renderPdf({fonts: [{id: "bad", bytes: corrupt}], blocks: [p("x")]}).then(() => "accepted", e => e.code)).toBe("E_CAPABILITY");
  const zero = new Uint8Array(font.bytes); const z = new DataView(zero.buffer);
  for (let i = 0; i < z.getUint16(4); i++) { const r = 12 + i * 16; if (z.getUint32(r) === 0x686d7478) zero.fill(0, z.getUint32(r + 8), z.getUint32(r + 8) + z.getUint32(r + 12)); }
  expect(await renderPdf({fonts: [{id: "zero", bytes: zero}], blocks: [p("abc")]}).then(() => "accepted", e => e.code)).toBe("E_CAPABILITY");
});
it("rejects font metric counts exceeding admitted glyph records", async () => {
  const bad = new Uint8Array(font.bytes); const view = new DataView(bad.buffer);
  for (let i = 0; i < view.getUint16(4); i++) {const r = 12 + i * 16; if (view.getUint32(r) === 0x68686561) view.setUint16(view.getUint32(r + 8) + 34, 65535);}
  expect(await renderPdf({fonts: [{id: "bad", bytes: bad}], blocks: [p("x")]}).then(() => "accepted", e => e.code)).toBe("E_CAPABILITY");
});
it("rejects unbreakable overflow and cooperatively cancels long layout", async () => {
  await expect(inspect([{...p("long".repeat(50)), longWord: "error"}])).rejects.toMatchObject({code: "E_CAPABILITY"});
  const controller = new AbortController(); let calls = 0;
  await expect(renderPdf({fonts: [font], blocks: [p("x".repeat(5000))]}, {signal: controller.signal, yield: async () => {if (++calls === 3) controller.abort();}})).rejects.toMatchObject({code: "E_CANCELLED"});
});
it("yields to event-loop cancellation without an injected scheduler", async () => {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 0);
  try {
    expect(await renderPdf({fonts: [font], blocks: [p("x".repeat(1000))]}, {signal: controller.signal}).then(() => "accepted", e => e.code)).toBe("E_CANCELLED");
  } finally {clearTimeout(timer);}
});
it("bounds hostile cmap character expansion before fontkit enumerates coverage", async () => {
  const bad = new Uint8Array(font.bytes); const view = new DataView(bad.buffer);
  for (let i = 0; i < view.getUint16(4); i++) {
    const r = 12 + i * 16; if (view.getUint32(r) !== 0x636d6170) continue;
    const cmap = view.getUint32(r + 8);
    const sub = cmap + view.getUint32(cmap + 8);
    view.setUint16(sub, 12); view.setUint32(sub + 4, 28); view.setUint32(sub + 12, 1);
    view.setUint32(sub + 16, 0); view.setUint32(sub + 20, 0xffffffff); view.setUint32(sub + 24, 1);
    break;
  }
  expect(await renderPdf({fonts: [{id: "bad", bytes: bad}], blocks: [p("x")]}).then(() => "accepted", e => e.code)).toBe("E_CAPABILITY");
});
it("uses supplied fallback for cmap entries mapping to .notdef and reports absence", async () => {
  const missing = new Uint8Array(font.bytes); const view = new DataView(missing.buffer);
  for (let i = 0; i < view.getUint16(4); i++) {
    const r = 12 + i * 16; if (view.getUint32(r) !== 0x636d6170) continue;
    const cmap = view.getUint32(r + 8); const visited = new Set<number>();
    for (let j = 0; j < view.getUint16(cmap + 2); j++) {
      const sub = cmap + view.getUint32(cmap + 8 + j * 8); if (visited.has(sub)) continue; visited.add(sub);
      if (view.getUint16(sub) === 12) {
        for (let g = 0; g < view.getUint32(sub + 12); g++) {
          const record = sub + 16 + g * 12; const first = view.getUint32(record); const last = view.getUint32(record + 4);
          if (first <= 120 && last >= 120) view.setUint32(record + 8, (first - 120) >>> 0);
        }
      }
    }
  }
  expect(await renderPdf({fonts: [{id: "missing", bytes: missing}], blocks: [p("x")]}).then(() => "accepted", e => e.code)).toBe("E_CAPABILITY");
  const boxes: Placement[] = [];
  await renderPdf({fonts: [{id: "missing", bytes: missing}, font], blocks: [p("x")]}, {onPlacement: b => boxes.push(b)});
  expect(boxes[0]!.width).toBeCloseTo(7.2);
});
it("writes the same text operators for the advertised Unicode profile", async () => {
  const {pdf, boxes} = await inspect([p("Latin Ελληνικά Кириллица")]);
  expect(boxes.map(b => b.text).join("")).toBe("Latin Ελληνικά Кириллица");
  const operators = pdf.context.enumerateIndirectObjects().flatMap(([, o]) => o instanceof PDFRawStream ? [new TextDecoder().decode(decodePDFRawStream(o).decode())] : []).join("");
  expect(operators).toContain("Tj");
});
