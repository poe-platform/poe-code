import { test } from "node:test";
import assert from "node:assert/strict";
import { openPdf } from "./index.js";

const bytes = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0));
function fixture(objects: string[], trailer = "/Root 1 0 R /Info 5 0 R") {
  let source = "%PDF-1.7\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(source.length);
    source += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = source.length;
  source += `xref\n0 ${offsets.length}\n0 65535 f\n`;
  for (const offset of offsets.slice(1)) source += `${offset} 0 n\n`;
  return bytes(source + `trailer\n<< /Size ${offsets.length} ${trailer} >>\nstartxref\n${start}\n%%EOF\n`);
}
const base = [
  "<< /Type /Catalog /Pages 2 0 R /Metadata 6 0 R /Outlines 7 0 R /Names << /EmbeddedFiles 9 0 R >> /AcroForm << /Fields [11 0 R] >> >>",
  "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 600 800] /CropBox [10 20 590 780] /Rotate -90 /Resources << /Unknown <ff> >> >>",
  "<< /Type /Page /Parent 2 0 R /Annots [8 0 R] >>",
  "<< /Type /Page /Parent 2 0 R /Rotate 450 /CropBox [0 0 700 900] /Resources << >> >>",
  "<< /Title <feff0041> /Custom <ff00> >>",
  "<< /Type /Metadata /Subtype /XML /Length 4 >>\nstream\n<x/>\nendstream",
  "<< /Type /Outlines /First 12 0 R /Last 12 0 R /Count 1 >>",
  "<< /Type /Annot /Subtype /Link /Rect [1 2 3 4] /A << /S /URI /URI (https://invalid/) >> >>",
  "<< /Names [(file) 10 0 R] >>",
  "<< /Type /Filespec /F (file) /EF << /F 13 0 R >> >>",
  "<< /FT /Tx /T <ff> /Kids [14 0 R] >>",
  "<< /Title (chapter) /Parent 7 0 R /Dest [3 0 R /Fit] >>",
  "<< /Type /EmbeddedFile /Length 3 >>\nstream\nabc\nendstream",
  "<< /Parent 11 0 R /T (child) >>"
];
test("page order, inherited geometry, raw resources and inert metadata inventories", () => {
  const result = openPdf(fixture(base)).inspectPages();
  assert.equal(result.pages.length, 2);
  assert.deepEqual(result.pages.map(p => p.reference.objectNumber), [3, 4]);
  assert.deepEqual(result.pages[0]!.mediaBox, [0, 0, 600, 800]);
  assert.deepEqual(result.pages[1]!.cropBox, [0, 0, 600, 800]);
  assert.equal(result.pages[0]!.rotate, 270);
  assert.equal(result.pages[1]!.rotate, 90);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(result.pages[0]!.trimBox, result.pages[0]!.cropBox);
  assert.equal(result.pages[0]!.resources!.kind, "dictionary");
  assert.equal(result.pages[1]!.resources!.entries!.length, 0);
  assert.deepEqual(result.xmp!.bytes, bytes("<x/>"));
  assert.deepEqual(result.info!.entries![1]!.value.bytes, bytes("\xff\0"));
  assert.equal(result.outlines.length, 1);
  assert.equal(result.links.length, 1);
  assert.equal(result.attachments.length, 1);
  assert.equal(result.forms.length, 2);
  assert.equal(result.forms[1]!.fieldType, "Tx");
});
test("BleedBox, TrimBox and ArtBox are page-local, with CropBox defaults", () => {
  const objects = [...base];
  objects[1] = base[1]!.replace("/Rotate", "/TrimBox [1 1 2 2] /Rotate");
  objects[2] = base[2]!.replace("/Annots", "/TrimBox [30 40 500 700] /BleedBox [20 30 550 750] /ArtBox [40 50 400 600] /Annots");
  const pages = openPdf(fixture(objects)).inspectPages().pages;
  assert.deepEqual(pages[0]!.trimBox, [30, 40, 500, 700]);
  assert.deepEqual(pages[0]!.bleedBox, [20, 30, 550, 750]);
  assert.deepEqual(pages[0]!.artBox, [40, 50, 400, 600]);
  assert.deepEqual(pages[1]!.trimBox, pages[1]!.cropBox);
});
test("page reads consume cumulative work, retention and depth quotas", () => {
  for (const limits of [{ work: 30_000 }, { retainedBytes: 50_000 }]) {
    const doc = openPdf(fixture(base), { limits });
    assert.throws(() => { for (let i = 0; i < 100; i++) doc.inspectPages(); }, /limit/);
  }
  assert.throws(() => openPdf(fixture(base)).inspectPages({ maxNodes: -1 }), /invalid graph/);
});
test("page graph rejects cycles, duplicate children, parent/count errors and invalid geometry", () => {
  for (const replacement of [
    base[1]!.replace("3 0 R 4 0 R", "2 0 R"),
    base[1]!.replace("3 0 R 4 0 R", "3 0 R 3 0 R"),
    base[1]!.replace("/Count 2", "/Count 3"),
    base[1]!.replace("600 800", "-1 800")
  ]) {
    const objects = [...base]; objects[1] = replacement;
    assert.throws(() => openPdf(fixture(objects)).inspectPages(), /cycle|duplicate|parent|count|box/i);
  }
  const objects = [...base]; objects[2] = base[2]!.replace("2 0 R", "1 0 R");
  assert.throws(() => openPdf(fixture(objects)).inspectPages(), /parent/);
});
test("inventory cycles, graph limits, cancellation and security context are fatal", () => {
  const objects = [...base]; objects[11] = base[11]!.replace("/Dest", "/Next 12 0 R /Dest");
  assert.throws(() => openPdf(fixture(objects)).inspectPages(), /cycle|duplicate/);
  assert.throws(() => openPdf(fixture(base)).inspectPages({ maxNodes: 2 }), /limit/);
  const controller = new AbortController();
  const doc = openPdf(fixture(base), { signal: controller.signal });
  const reason = new Error("cancel"); controller.abort(reason);
  assert.throws(() => doc.inspectPages(), e => e === reason);
  assert.throws(() => openPdf(fixture(base, "/Root 1 0 R /Encrypt 99 0 R")).inspectPages(), /encrypt/i);
  assert.throws(() => openPdf(fixture(base, "/Root 5 0 R")).inspectPages(), /catalog/);
});
test("catalog Pages must be an internal tree and outline root counts are validated", () => {
  assert.throws(() => openPdf(fixture(base.map((s, i) => i === 0 ? s.replace("/Pages 2 0 R", "/Pages 3 0 R") : s))).inspectPages(), /page tree/);
  const objects = [...base]; objects[6] = base[6]!.replace("/Count 1", "/Count 9");
  assert.throws(() => openPdf(fixture(objects)).inspectPages(), /outline count/);
});
test("nested page inheritance defaults, resource override and byte ownership", () => {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 20 30] /Rotate 90 >>",
    "<< /Type /Pages /Parent 2 0 R /Kids [4 0 R] /Count 1 /Resources << >> >>",
    "<< /Type /Page /Parent 3 0 R >>"
  ];
  const input = fixture(objects, "/Root 1 0 R");
  const doc = openPdf(input);
  input.fill(0);
  const first = doc.inspectPages();
  assert.deepEqual(first.pages[0]!.cropBox, [0, 0, 20, 30]);
  assert.equal(first.pages[0]!.rotate, 90);
  first.pages[0]!.inherited.mediaBox.items![0]!.value = 123;
  assert.deepEqual(doc.inspectPages().pages[0]!.mediaBox, [0, 0, 20, 30]);
});
test("name-tree and form cycles and invalid field parents fail", () => {
  for (const [index, replacement] of [
    [8, "<< /Kids [9 0 R] >>"],
    [10, "<< /FT /Tx /Kids [11 0 R] >>"],
    [13, "<< /Parent 1 0 R /T (bad) >>"]
  ] as const) {
    const objects = [...base]; objects[index] = replacement;
    assert.throws(() => openPdf(fixture(objects)).inspectPages(), /cycle|duplicate|parent/);
  }
});
test("sampled chunk boundaries preserve geometry and encoded metadata", () => {
  const input = fixture(base);
  for (let split = 0; split <= input.length; split += 31) {
    const tree = openPdf([input.slice(0, split), input.slice(split)]).inspectPages();
    assert.deepEqual(tree.xmp!.bytes, bytes("<x/>"));
    assert.deepEqual(tree.pages.map(p => p.rotate), [270, 90]);
  }
});
test("outline visibility counts include open descendants and preserve closed branches", () => {
  const objects = [...base];
  objects[11] = "<< /Title (closed) /Parent 7 0 R /First 15 0 R /Last 15 0 R /Count -1 >>";
  objects.push("<< /Title (hidden) /Parent 12 0 R >>");
  assert.equal(openPdf(fixture(objects)).inspectPages().outlines.length, 2);
  objects[11] = objects[11]!.replace("/Count -1", "/Count 1");
  assert.throws(() => openPdf(fixture(objects)).inspectPages(), /outline count/);
  objects[6] = base[6]!.replace("/Count 1", "/Count 2");
  assert.equal(openPdf(fixture(objects)).inspectPages().outlines.length, 2);
});
test("noninteger count tokens fail and cancellation during traversal propagates unchanged", () => {
  const objects = [...base]; objects[1] = base[1]!.replace("/Count 2", "/Count 2.0");
  assert.throws(() => openPdf(fixture(objects)).inspectPages(), /integer/);
  let checks = 0;
  let stopAt = Infinity;
  const reason = new Error("mid traversal cancellation");
  const signal = { get aborted() { return ++checks > stopAt; }, reason } as AbortSignal;
  const doc = openPdf(fixture(base), { signal });
  stopAt = checks + 100;
  assert.throws(() => doc.inspectPages(), e => e === reason);
});
test("filtered XMP, nested attachment names and repeated file specifications stay inert", () => {
  const objects = [...base];
  objects[0] = base[0]!.replace("/Pages", "/AF [10 0 R] /Pages");
  objects[5] = "<< /Type /Metadata /Subtype /XML /Filter /ASCIIHexDecode /Length 9 >>\nstream\n3c782f3e>\nendstream";
  objects[8] = "<< /Kids [15 0 R] >>";
  objects.push("<< /Names [(file) 10 0 R] >>");
  objects[10] = base[10]!.replace("/FT", "/V <aa> /FT");
  const tree = openPdf(fixture(objects)).inspectPages();
  assert.deepEqual(tree.xmp!.raw, bytes("3c782f3e>"));
  assert.deepEqual(tree.xmp!.bytes, bytes("<x/>"));
  assert.equal(tree.attachments.length, 1);
  assert.deepEqual(tree.forms[1]!.value!.bytes, Uint8Array.of(170));
  assert.equal(tree.forms[1]!.raw.entries!.some(e => Buffer.from(e.key.bytes!).toString() === "V"), false);
});
test("graph depth is bounded independently from shallow object syntax", () => {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>"];
  for (let number = 2; number < 8; number++) {
    objects.push(`<< /Type /Pages ${number > 2 ? `/Parent ${number - 1} 0 R` : ""} /Kids [${number + 1} 0 R] /Count 1 /MediaBox [0 0 1 1] >>`);
  }
  objects.push("<< /Type /Page /Parent 7 0 R >>");
  const doc = openPdf(fixture(objects, "/Root 1 0 R"), { limits: { nesting: 3 } });
  assert.throws(() => doc.inspectPages(), /graph limit/);
});
test("null dictionary entries act as absent while raw objects retain them", () => {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /Names null /AcroForm null /Outlines null /Metadata null /AF null >>",
    "<< /Type /Pages /Parent null /Kids [3 0 R] /Count 1 /MediaBox [0 0 20 30] /Rotate 90 /Resources << >> >>",
    "<< /Type /Page /Parent 2 0 R /Kids null /Annots null /AF null /Rotate null /Resources null /CropBox null >>"
  ];
  const result = openPdf(fixture(objects, "/Root 1 0 R /Info null")).inspectPages();
  assert.equal(result.pageCount, 1);
  assert.equal(result.pages[0]!.rotate, 90);
  assert.deepEqual(result.pages[0]!.cropBox, [0, 0, 20, 30]);
  assert.equal(result.pages[0]!.resources!.kind, "dictionary");
  assert.equal(result.info, undefined);
  assert.deepEqual(result.forms, []);
  assert.deepEqual(result.attachments, []);
  assert.equal(result.pages[0]!.raw.entries!.filter(e => e.value.kind === "null").length, 6);
});
test("indirect null optional entries and inherited attributes act as absent", () => {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /Names 4 0 R /AcroForm 4 0 R /Metadata 4 0 R /Outlines 4 0 R /AF 4 0 R >>",
    "<< /Type /Pages /Parent 4 0 R /Kids [3 0 R] /Count 1 /MediaBox [0 0 20 30] /Rotate 90 >>",
    "<< /Type /Page /Parent 2 0 R /Kids 4 0 R /Annots 4 0 R /Rotate 4 0 R /CropBox 4 0 R >>",
    "null"
  ];
  const tree = openPdf(fixture(objects, "/Root 1 0 R /Info 4 0 R")).inspectPages();
  assert.equal(tree.pageCount, 1);
  assert.equal(tree.pages[0]!.rotate, 90);
  assert.deepEqual(tree.pages[0]!.cropBox, [0, 0, 20, 30]);
  assert.equal(tree.info, undefined);
  assert.equal(tree.xmp, undefined);
});
test("inventory preserves opaque action and destination references without resolving them", () => {
  const objects = [...base];
  objects[7] = "<< /Subtype /Link /Rect [1 2 3 4] /A 99 0 R /Dest 98 0 R >>";
  objects[11] = "<< /Title (chapter) /Parent 7 0 R /A 99 0 R /Dest 98 0 R >>";
  const tree = openPdf(fixture(objects)).inspectPages();
  for (const item of [...tree.links, ...tree.outlines]) {
    assert.equal(item.action!.objectNumber, 99);
    assert.equal(item.destination!.objectNumber, 98);
  }
});

test("indirect null field values inherit without losing the raw reference", () => {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] >> >>",
    "<< /Type /Pages /Kids [] /Count 0 >>",
    "null",
    "<< /FT /Tx /V <ff00> /Kids [5 0 R] >>",
    "<< /Parent 4 0 R /V 3 0 R >>"
  ];
  const tree = openPdf(fixture(objects, "/Root 1 0 R")).inspectPages();
  assert.equal(tree.pageCount, 0);
  assert.deepEqual(tree.forms[1]!.value!.bytes, Uint8Array.of(255, 0));
  const entry = tree.forms[1]!.raw.entries!.find(e => Buffer.from(e.key.bytes!).toString() === "V")!;
  assert.equal(entry.value.objectNumber, 3);
});

test("attachment inventory never decodes unsupported payloads or follows external files", () => {
  const objects = [...base];
  objects[9] = "<< /Type /Filespec /UF <feff0041> /F (https://invalid/file) /EF << /F 13 0 R >> /Unknown <ff00> >>";
  objects[12] = "<< /Type /EmbeddedFile /Filter /UnknownCodec /Length 3 >>\nstream\nabc\nendstream";
  const doc = openPdf(fixture(objects));
  const tree = doc.inspectPages();
  assert.equal(tree.attachments.length, 1);
  assert.equal(tree.attachments[0]!.embeddedFiles!.entries![0]!.value.objectNumber, 13);
  assert.deepEqual(doc.getObject(13).stream, bytes("abc"));
  assert.throws(() => doc.decodeStream(13), e => (e as { code?: string }).code === "UNSUPPORTED");
});

test("required XMP interpretation fails explicitly while its raw stream remains inspectable", () => {
  const objects = [...base];
  objects[5] = "<< /Type /Metadata /Subtype /XML /Filter /UnknownCodec /Length 4 >>\nstream\n<x/>\nendstream";
  const doc = openPdf(fixture(objects));
  assert.throws(() => doc.inspectPages(), e => (e as { code?: string }).code === "UNSUPPORTED");
  assert.deepEqual(doc.getObject(6).stream, bytes("<x/>"));
});
test("document page layout exposes inherited geometry, glyphs and ordered metadata", () => {
  const content = "BT /F 10 Tf 1 0 0 1 20 70 Tm (A) Tj ET";
  const doc = openPdf(fixture([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 200 100] /Rotate 90 /Resources << /Font << /F 7 0 R >> >> >>",
    "<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R >>",
    "<< /Title (Original) >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Subtype /Type1 /Encoding /WinAnsiEncoding /FirstChar 65 /Widths [500] >>"
  ]));
  const page = doc.extractPageLayout(0, { mode: "layout" });
  assert.equal(page.text, "A");
  assert.deepEqual(page.runs[0]!.origin, [70, 20]);
  assert.equal(page.glyphs[0]!.source.contentStream!.objectNumber, 6);
  const inspect = doc.inspectPages.bind(doc);
  let inventories = 0;
  doc.inspectPages = () => { inventories++; return inspect(); };
  const result = doc.extractLayout({ mode: "content" });
  assert.equal(inventories, 1, "whole-document extraction inventories pages once");
  assert.deepEqual(result.pages.map(p => p.text), ["A", ""]);
  assert.deepEqual(result.inventory.pages.map(p => p.reference.objectNumber), [3, 4]);
  assert.deepEqual(result.inventory.info!.entries![0]!.value.bytes, bytes("Original"));
});
test("image-only page layout skips image payload and shares document cancellation and quotas", () => {
  const content = "/Im Do";
  const input = fixture([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 200 100] /Resources << /XObject << /Im 7 0 R >> >> >>",
    "<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>",
    "null", "<< /Title (Image) >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /Filter /DCTDecode /Length 3 >>\nstream\nabc\nendstream"
  ]);
  const doc = openPdf(input);
  assert.equal(doc.extractPageLayout(0).text, "");
  assert.deepEqual(doc.extractPageLayout(0).glyphs, []);
  const controller = new AbortController();
  const cancelled = openPdf(input, { signal: controller.signal });
  const reason = {}; controller.abort(reason);
  assert.throws(() => cancelled.extractLayout(), e => e === reason);
  const bounded = openPdf(input, { limits: { retainedBytes: 100_000 } });
  let exhausted = false;
  for (let i = 0; i < 100; i++) {
    try { bounded.extractPageLayout(0); }
    catch (e) { assert.ok(e instanceof Error && "code" in e && e.code === "LIMIT"); exhausted = true; break; }
  }
  assert.equal(exhausted, true, "repeated extraction never resets document allocation budgets");
});
