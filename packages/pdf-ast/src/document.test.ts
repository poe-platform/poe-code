import { describe, expect, it } from "vitest";
import {
  PdfDocument,
  rgb,
  cosDict,
  cosName,
  cosNumber,
  cosArray,
  cosStream,
  decodePng,
  encodePng,
} from "./index.js";

describe("Layer 2 & Layer 3 Unified PdfDocument SDK, Extraction, Editing, Redaction & Rasterizer", () => {
  it("creates, edits, extracts text/tables/semantic-AST, merges pages, fills AcroForms, redacts, and renders to PNG", () => {
    const doc = PdfDocument.create();
    doc.setTitle("Quarterly Architecture & Financial Report");
    doc.setAuthor("Poe Platform");
    doc.setKeywords(["pdf-ast", "engine", "foundations"]);

    const page1 = doc.addPage([612, 792]);
    page1.drawRect({
      x: 50,
      y: 720,
      width: 512,
      height: 36,
      fill: rgb(0.12, 0.24, 0.48),
    });
    page1.drawText("QUARTERLY FINANCIAL REPORT", {
      x: 64,
      y: 732,
      size: 18,
      font: "Helvetica-Bold",
      color: rgb(1, 1, 1),
    });
    page1.drawText("Confidential Token: SECRET-9981-KEY", {
      x: 64,
      y: 680,
      size: 12,
      font: "Helvetica",
      color: rgb(0.1, 0.1, 0.1),
    });

    // Draw a 2-column table
    page1.drawText("Metric", { x: 64, y: 620, size: 12, font: "Helvetica-Bold" });
    page1.drawText("Value", { x: 240, y: 620, size: 12, font: "Helvetica-Bold" });
    page1.drawText("Revenue", { x: 64, y: 596, size: 12, font: "Helvetica" });
    page1.drawText("$4.2M", { x: 240, y: 596, size: 12, font: "Helvetica" });
    page1.drawText("Margin", { x: 64, y: 572, size: 12, font: "Helvetica" });
    page1.drawText("68%", { x: 240, y: 572, size: 12, font: "Helvetica" });

    page1.addLinkAnnotation({
      rect: [64, 520, 220, 540],
      uri: "https://poe.com/docs",
      contents: "Poe Documentation",
    });

    // Embed an RGB image and draw it
    const rgbSamples = new Uint8Array(4 * 4 * 3);
    for (let i = 0; i < 16; i++) {
      rgbSamples[i * 3] = 40;
      rgbSamples[i * 3 + 1] = 160;
      rgbSamples[i * 3 + 2] = 240;
    }
    const imgHandle = doc.embedRgbImage(4, 4, rgbSamples);
    page1.drawImage(imgHandle, { x: 440, y: 580, width: 48, height: 48 });

    // AcroForm fields
    doc.setFormField("approval.reviewer", "Alice Vance");
    doc.setFormField("approval.signed", true);

    const savedBytes = doc.save({ normalizeContent: true });
    const reloaded = PdfDocument.load(savedBytes);

    expect(reloaded.getMetadata().title).toBe("Quarterly Architecture & Financial Report");
    expect(reloaded.getFormFields()).toEqual([
      { name: "approval.reviewer", type: "text", value: "Alice Vance" },
      { name: "approval.signed", type: "checkbox", value: true },
    ]);

    const extractedText = reloaded.extractText({ mode: "logical" });
    expect(extractedText).toContain("QUARTERLY FINANCIAL REPORT");
    expect(extractedText).toContain("Confidential Token: SECRET-9981-KEY");

    const tables = reloaded.extractTables();
    expect(tables.length).toBeGreaterThanOrEqual(1);
    expect(tables[0]!.headers).toEqual(["Metric", "Value"]);
    expect(tables[0]!.rows).toEqual([
      ["Revenue", "$4.2M"],
      ["Margin", "68%"],
    ]);

    const semantic = reloaded.toSemanticAst();
    expect(semantic.some(n => n.kind === "heading" && n.text.includes("QUARTERLY FINANCIAL REPORT"))).toBe(true);
    expect(semantic.some(n => n.kind === "table")).toBe(true);
    expect(semantic.some(n => n.kind === "link" && n.uri === "https://poe.com/docs")).toBe(true);

    // Redact the confidential token on page 0
    const rPage = reloaded.getPage(0);
    rPage.redact([[60, 670, 380, 700]], {
      fillColor: rgb(0, 0, 0),
      replacementText: "[REDACTED]",
    });
    const redactedBytes = reloaded.save({ normalizeContent: true });
    const afterRedact = PdfDocument.load(redactedBytes);
    const postRedactText = afterRedact.extractText({ mode: "logical" });
    expect(postRedactText).not.toContain("SECRET-9981-KEY");
    expect(postRedactText).toContain("[REDACTED]");
    expect(new TextDecoder("latin1").decode(redactedBytes)).not.toContain("SECRET-9981-KEY");

    // Copy page into a new merged document
    const mergedDoc = PdfDocument.create();
    mergedDoc.copyPagesFrom(afterRedact, [0]);
    expect(mergedDoc.getPageCount()).toBe(1);
    expect(mergedDoc.extractText()).toContain("QUARTERLY FINANCIAL REPORT");

    // Render to PNG and re-embed the PNG
    const pngBytes = rPage.renderToPng({ scale: 1.0 });
    expect(pngBytes[0]).toBe(137);
    expect(pngBytes[1]).toBe(80);
    expect(pngBytes[2]).toBe(78);
    expect(pngBytes[3]).toBe(71);
    const reEmbeddedPng = mergedDoc.embedPng(pngBytes);
    expect(reEmbeddedPng.width).toBe(612);
    expect(reEmbeddedPng.height).toBe(792);
  });

  it("evaluates Form XObjects (/Subtype /Form), inline images (BI/ID/EI), v/y Bézier curves, and unclosed filled subpaths", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 200, height: 200 });

    expect(doc.version).toBe("1.7");
    expect(page.dict.kind).toBe("dict");

    const formStreamText = [
      "q",
      "0 0.5 1 rg",
      "10 10 m",
      "20 30 40 30 v",
      "50 20 30 10 y",
      "f",
      "BT /F1 12 Tf 15 45 Td (Form XObject Label) Tj ET",
      "BI /W 2 /H 2 /CS /RGB /BPC 8 ID",
      "\xff\x00\x00\x00\xff\x00\x00\x00\xff\xff\xff\x00",
      "EI",
      "Q",
    ].join("\n");

    const formFontDict = cosDict({
      F1: cosDict({
        Type: cosName("Font"),
        Subtype: cosName("Type1"),
        BaseFont: cosName("Helvetica"),
      }),
    });
    const formXObj = cosStream(
      cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Form"),
        BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(100), cosNumber(100)]),
        Matrix: cosArray([cosNumber(1), cosNumber(0), cosNumber(0), cosNumber(1), cosNumber(20), cosNumber(30)]),
        Resources: cosDict({ Font: formFontDict }),
      }),
      new TextEncoder().encode(formStreamText)
    );
    const formRef = doc.cos.allocateObject(formXObj);

    const resDict = page.getResourcesDict();
    resDict.entries.push({
      key: cosName("XObject"),
      value: cosDict({ Fm1: formRef }),
    });
    page.setRawContentStream(new TextEncoder().encode("q /Fm1 Do Q"));

    const dl = page.evaluateDisplayList();
    expect(dl.glyphs.map(g => g.unicode).join("")).toContain("Form XObject Label");
    expect(dl.paths.length).toBe(1);
    const cubic0 = dl.paths[0]!.segments[1]!;
    expect(cubic0.kind).toBe("cubic");
    if (cubic0.kind === "cubic") {
      expect(cubic0.x1).toBeCloseTo(30, 3);
      expect(cubic0.y1).toBeCloseTo(40, 3);
      expect(cubic0.x2).toBeCloseTo(40, 3);
      expect(cubic0.y2).toBeCloseTo(60, 3);
      expect(cubic0.x).toBeCloseTo(60, 3);
      expect(cubic0.y).toBeCloseTo(60, 3);
    }
    const cubic1 = dl.paths[0]!.segments[2]!;
    expect(cubic1.kind).toBe("cubic");
    if (cubic1.kind === "cubic") {
      expect(cubic1.x1).toBeCloseTo(70, 3);
      expect(cubic1.y1).toBeCloseTo(50, 3);
      expect(cubic1.x2).toBeCloseTo(50, 3);
      expect(cubic1.y2).toBeCloseTo(40, 3);
      expect(cubic1.x).toBeCloseTo(50, 3);
      expect(cubic1.y).toBeCloseTo(40, 3);
    }
    expect(dl.images.length).toBe(1);
    expect(dl.images[0]!.width).toBe(2);
    expect(dl.images[0]!.height).toBe(2);

    const pngBytes = page.renderToPng({ scale: 1 });
    const bitmap = decodePng(pngBytes);
    const px = 45;
    const py = 200 - 48;
    const idx = (py * bitmap.width + px) * 4;
    expect(bitmap.data[idx]).toBeLessThan(50);
    expect(bitmap.data[idx + 2]).toBeGreaterThan(200);
  });

  it("handles upstream PDF edge cases: copyPages inherited attributes & widgets (pdf-lib #1579/#1686/#1332, pypdf #4078), split-widget & custom checkbox states (pdf-lib #1585, qpdf #1056), CTM-transformed redaction (pypdf #4062), and isolated page drawing (pdf-lib #1075/#1541)", () => {
    // 1. Source document with /Resources, /Rotate, and /CropBox ONLY on parent /Pages node
    const srcDoc = PdfDocument.create();
    const srcP1 = srcDoc.addPage([612, 792]);
    const srcP2 = srcDoc.addPage([612, 792]);
    srcP1.drawText("Inherited Resource Page 1", { x: 50, y: 700, size: 12 });
    srcP2.drawText("Unselected Page 2", { x: 50, y: 700, size: 12 });

    const p1ResIdx = srcP1.dict.entries.findIndex(e => e.key.decoded === "Resources");
    const inheritedRes = srcP1.dict.entries[p1ResIdx]!.value;
    srcP1.dict.entries.splice(p1ResIdx, 1);

    const parentRef = srcP1.dict.entries.find(e => e.key.decoded === "Parent")!.value;
    const pagesNode = srcDoc.cos.resolveDict(parentRef)!;
    pagesNode.entries.push(
      { key: cosName("Resources"), value: inheritedRes },
      { key: cosName("Rotate"), value: cosNumber(90) },
      { key: cosName("CropBox"), value: cosArray([cosNumber(10), cosNumber(10), cosNumber(600), cosNumber(780)]) }
    );

    const parentFieldRef = srcDoc.cos.allocateObject(
      cosDict({
        FT: cosName("Tx"),
        T: cosName("invoice_id"),
      })
    );
    const widgetRef = srcDoc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        Parent: parentFieldRef,
        P: srcP1.ref,
        Rect: cosArray([cosNumber(50), cosNumber(650), cosNumber(200), cosNumber(670)]),
      })
    );
    srcP1.dict.entries.push({ key: cosName("Annots"), value: cosArray([widgetRef]) });

    const dstDoc = PdfDocument.create();
    const [copiedP1] = dstDoc.copyPagesFrom(srcDoc, [0]);
    expect(copiedP1!.getRotation()).toBe(90);
    expect(copiedP1!.getCropBox()).toEqual([10, 10, 600, 780]);
    expect(dstDoc.extractText()).toContain("Inherited Resource Page 1");
    expect(dstDoc.extractText()).not.toContain("Unselected Page 2");

    const copiedAnnots = dstDoc.cos.resolveArray(
      copiedP1!.dict.entries.find(e => e.key.decoded === "Annots")?.value
    )!;
    const copiedWidget = dstDoc.cos.resolveDict(copiedAnnots.items[0])!;
    expect(copiedWidget.entries.some(e => e.key.decoded === "Parent")).toBe(true);
    const copiedWidgetP = copiedWidget.entries.find(e => e.key.decoded === "P")?.value;
    expect(copiedWidgetP).toEqual(copiedP1!.ref);

    // 2. AcroForm terminal field with anonymous Widget /Kids + custom checkbox /AP /N (/Agree)
    const formDoc = PdfDocument.create();
    const formPage = formDoc.addPage([612, 792]);
    const anonWidgetRef = formDoc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        P: formPage.ref,
        Rect: cosArray([cosNumber(50), cosNumber(500), cosNumber(200), cosNumber(520)]),
      })
    );
    const emailFieldRef = formDoc.cos.allocateObject(
      cosDict({
        FT: cosName("Tx"),
        T: cosName("customer.email"),
        V: cosName("alice@example.com"),
        Kids: cosArray([anonWidgetRef]),
      })
    );
    const cbWidgetRef = formDoc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        AS: cosName("Off"),
        AP: cosDict({
          N: cosDict({
            Agree: cosDict({}),
            Off: cosDict({}),
          }),
        }),
      })
    );
    const cbFieldRef = formDoc.cos.allocateObject(
      cosDict({
        FT: cosName("Btn"),
        T: cosName("terms"),
        V: cosName("Off"),
        Kids: cosArray([cbWidgetRef]),
      })
    );
    const catalog = formDoc.cos.resolveDict(formDoc.cos.rootRef)!;
    catalog.entries.push({
      key: cosName("AcroForm"),
      value: cosDict({ Fields: cosArray([emailFieldRef, cbFieldRef]) }),
    });

    const fieldsBefore = formDoc.getFormFields();
    expect(fieldsBefore).toEqual([
      { name: "customer.email", type: "text", value: "alice@example.com" },
      { name: "terms", type: "checkbox", value: false },
    ]);

    formDoc.setFormField("terms", true);
    const cbFieldDict = formDoc.cos.resolveDict(cbFieldRef)!;
    const cbWidgetDict = formDoc.cos.resolveDict(cbWidgetRef)!;
    expect(cbFieldDict.entries.find(e => e.key.decoded === "V")?.value).toEqual(cosName("Agree"));
    expect(cbWidgetDict.entries.find(e => e.key.decoded === "AS")?.value).toEqual(cosName("Agree"));

    // 3. CTM-transformed content redaction (pypdf #4062)
    const redactDoc = PdfDocument.create();
    const redactPage = redactDoc.addPage([612, 792]);
    redactPage.ensureStandardFontResource("Helvetica");
    redactPage.setRawContentStream(
      new TextEncoder().encode(
        "q 1 0 0 1 120 300 cm BT /F1 12 Tf 0 0 Td (TOP-SECRET-CTM) Tj ET Q\nBT /F1 12 Tf 50 500 Td (PUBLIC-LINE) Tj ET"
      )
    );
    redactPage.redact([[115, 295, 260, 320]]);
    const postCtmRedact = redactDoc.extractText();
    expect(postCtmRedact).not.toContain("TOP-SECRET-CTM");
    expect(postCtmRedact).toContain("PUBLIC-LINE");

    // 4. Graphics state isolation when appending drawing operations onto a page with unbalanced CTM
    const dirtyDoc = PdfDocument.create();
    const dirtyPage = dirtyDoc.addPage([612, 792]);
    dirtyPage.ensureStandardFontResource("Helvetica");
    dirtyPage.setRawContentStream(
      new TextEncoder().encode("1 0 0 -1 0 792 cm BT /F1 12 Tf 50 92 Td (Flipped Legacy Text) Tj ET")
    );
    dirtyPage.drawText("Clean Stamp", { x: 60, y: 700, size: 12 });
    const dirtyDl = dirtyPage.evaluateDisplayList();
    const stampGlyphs = dirtyDl.glyphs.filter(g => "Clean Stamp".includes(g.unicode));
    expect(stampGlyphs.some(g => Math.abs(g.baselineY - 700) < 2)).toBe(true);
  });

  it("handles scientific notation in rotated drawText & COS numbers (qpdf #1079), false inline image EI markers (pypdf #3922), trailing PNG predictor padding (pdf-lib #1496), and page scaling (pdf-lib #991)", async () => {
    const { applyPredictor } = await import("./cos/filters.js");

    // 1. Rotated drawText by Math.PI / 2 must not emit 6.123233995736766e-17 into content stream,
    // and external content streams with -3e-05 (qpdf #1079) must be parsed as numbers
    const doc = PdfDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText("Rotated 90 Degrees", {
      x: 200,
      y: 300,
      size: 14,
      rotateRadians: Math.PI / 2,
    });
    const rawStreamText = new TextDecoder("latin1").decode(page.getRawContentStream());
    expect(rawStreamText).not.toMatch(/e[+-]?\d+/i);

    const reloaded = PdfDocument.load(doc.save());
    expect(reloaded.extractText()).toContain("Rotated 90 Degrees");

    // External content stream containing scientific notation -3e-05 in cm
    const sciPage = reloaded.getPage(0);
    sciPage.setRawContentStream(
      new TextEncoder().encode("1 0 0 1 -3e-05 420 cm BT /F1 12 Tf 50 0 Td (SciNotationText) Tj ET")
    );
    const sciDl = sciPage.evaluateDisplayList();
    expect(sciDl.glyphs.map(g => g.unicode).join("")).toContain("SciNotationText");
    expect(sciDl.glyphs[0]!.baselineY).toBeCloseTo(420, 2);

    // 2. False inline image EI marker inside binary pixel data (pypdf #3922) + CRLF after ID
    // 4x1 RGB image (12 bytes) whose first 4 bytes are [0x20, 0x45, 0x49, 0x20] (" EI ")
    const inlineStream = new Uint8Array([
      ...new TextEncoder().encode("BI /W 4 /H 1 /CS /RGB /BPC 8 ID\r\n"),
      0x20, 0x45, 0x49, 0x20, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80,
      ...new TextEncoder().encode("\nEI\nBT /F1 12 Tf 10 500 Td (AfterInlineImage) Tj ET"),
    ]);
    sciPage.setRawContentStream(inlineStream);
    const inlineDl = sciPage.evaluateDisplayList();
    expect(inlineDl.images.length).toBe(1);
    expect(inlineDl.images[0]!.decodedRgba!.length).toBe(16);
    expect(Array.from(inlineDl.images[0]!.decodedRgba!.slice(0, 4))).toEqual([0x20, 0x45, 0x49, 255]);
    expect(inlineDl.glyphs.map(g => g.unicode).join("")).toContain("AfterInlineImage");

    // 3. PNG predictor (Predictor 12, Columns 4, Colors 1) with trailing zero/newline padding byte
    const paddedPngRows = new Uint8Array([
      2, 10, 20, 30, 40,
      2, 1, 2, 3, 4,
      0, // extra trailing padding byte emitted by buggy PDF writer
    ]);
    const decodedPred = applyPredictor(paddedPngRows, { Predictor: 12, Columns: 4, Colors: 1, BitsPerComponent: 8 });
    expect(Array.from(decodedPred)).toEqual([10, 20, 30, 40, 11, 22, 33, 44]);

    // 4. PdfPage.scale(x, y) scales page size, content stream (cm), and annotation Rects (pdf-lib #991)
    const scaleDoc = PdfDocument.create();
    const scalePage = scaleDoc.addPage([200, 400]);
    scalePage.drawText("Scaled Label", { x: 20, y: 100, size: 10 });
    scalePage.addLinkAnnotation({ rect: [10, 20, 50, 40], uri: "https://example.com" });
    scalePage.scale(2, 1.5);
    expect(scalePage.getSize()).toEqual({ width: 400, height: 600 });
    const scaledDl = scalePage.evaluateDisplayList();
    expect(scaledDl.glyphs[0]!.bbox[0]).toBeCloseTo(40, 1);
    expect(scaledDl.glyphs[0]!.baselineY).toBeCloseTo(150, 1);
    const annotsArr = scaleDoc.cos.resolveArray(
      scalePage.dict.entries.find(e => e.key.decoded === "Annots")?.value
    )!;
    const annotDict = scaleDoc.cos.resolveDict(annotsArr.items[0])!;
    const rectArr = scaleDoc.cos.resolveArray(annotDict.entries.find(e => e.key.decoded === "Rect")?.value)!;
    expect(rectArr.items.map(i => (i.kind === "number" ? i.value : 0))).toEqual([20, 30, 100, 60]);
  });

  it("handles indirect /Length streams containing endstream (pdf.js/qpdf), /F1 1 Tf with 12 0 0 12 Tm glyph widths (pypdf #4116), AcroForm /DR fonts (pypdf #3983), and CMap surrogate pairs", async () => {
    const { parseToUnicodeCMap } = await import("./fonts/cmap.js");

    // 1. Stream with indirect /Length 5 0 R whose content contains the literal word "endstream"
    const streamBody = "BT /F1 12 Tf 50 700 Td (Literal endstream token inside text) Tj ET";
    const rawPdf = [
      "%PDF-1.7",
      "1 0 obj << /Type /Catalog /Pages 2 0 R /AcroForm << /DR << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >> >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >> endobj",
      `4 0 obj << /Length 5 0 R >>\nstream\n${streamBody}\nendstream\nendobj`,
      `5 0 obj ${streamBody.length} endobj`,
      "trailer << /Root 1 0 R >>",
      "%%EOF",
    ].join("\n");

    const parsedDoc = PdfDocument.load(new TextEncoder().encode(rawPdf));
    // Also tests AcroForm /DR /Font fallback (pypdf #3983) because page 3 has empty /Resources << >>!
    expect(parsedDoc.extractText()).toContain("Literal endstream token inside text");

    // 2. /F1 1 Tf with 12 0 0 12 72 700 Tm and 5 Tc (charSpace = 0.5 in 1pt font -> 6pt in 12x Tm)
    const tmPage = parsedDoc.getPage(0);
    tmPage.setRawContentStream(
      new TextEncoder().encode("BT /F1 1 Tf 0.5 Tc 12 0 0 12 72 600 Tm (AB) Tj ET")
    );
    const tmDl = tmPage.evaluateDisplayList();
    const glyphA = tmDl.glyphs.find(g => g.unicode === "A")!;
    const glyphB = tmDl.glyphs.find(g => g.unicode === "B")!;
    // Advance of A (667/1000 * 1 + 0.5 Tc) * 12 = 1.167 * 12 = 14.004pt
    expect(glyphB.bbox[0] - glyphA.bbox[0]).toBeCloseTo(14.004, 2);
    expect(glyphA.advanceWidth).toBeCloseTo(14.004, 2);

    // 3. CMap beginbfrange with UTF-16BE surrogate pairs (U+1D400 Mathematical Bold Capital A -> U+1D402)
    const cmapText = [
      "begincmap",
      "1 begincodespacerange",
      "<0000> <FFFF>",
      "endcodespacerange",
      "1 beginbfrange",
      "<0001> <0003> <D835DC00>",
      "endbfrange",
      "endcmap",
    ].join("\n");
    const cmap = parseToUnicodeCMap(new TextEncoder().encode(cmapText));
    const decoded = cmap.decodeBytes(new Uint8Array([0x00, 0x01, 0x00, 0x02, 0x00, 0x03]));
    expect(decoded.map(d => d.unicode)).toEqual([
      String.fromCodePoint(0x1d400),
      String.fromCodePoint(0x1d401),
      String.fromCodePoint(0x1d402),
    ]);
  });

  it("extracts ruled-grid tables separated by vertical vector lines and ordered numbered lists in semantic AST", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 300, height: 300 });
    // Draw an ordered numbered list at the top
    page.drawText("1. First requirement", { x: 20, y: 260, size: 11 });
    page.drawText("2. Second requirement", { x: 20, y: 242, size: 11 });

    // Draw a 2-column ruled table where columns are separated by a vertical border rule at x = 62
    // (only a ~8pt horizontal gap between "ID" and "Name", which requires vertical rule detection)
    page.drawRect({ x: 20, y: 100, width: 140, height: 60, borderColor: { r: 0, g: 0, b: 0 }, borderWidth: 1 });
    page.drawLine({ x1: 62, y1: 100, x2: 62, y2: 160, color: { r: 0, g: 0, b: 0 }, width: 1 });
    page.drawText("Key", { x: 35, y: 140, size: 10 });
    page.drawText("Value", { x: 66, y: 140, size: 10 });
    page.drawText("A01", { x: 35, y: 118, size: 10 });
    page.drawText("Alpha", { x: 66, y: 118, size: 10 });

    const tables = page.extractTables();
    expect(tables).toHaveLength(1);
    expect(tables[0]!.headers).toEqual(["Key", "Value"]);
    expect(tables[0]!.rows).toEqual([["A01", "Alpha"]]);

    const ast = doc.toSemanticAst();
    const orderedList = ast.find((n): n is Extract<typeof n, { kind: "list" }> => n.kind === "list");
    expect(orderedList).toBeDefined();
    expect(orderedList!.ordered).toBe(true);
    expect(orderedList!.items).toEqual(["First requirement", "Second requirement"]);
  });

  it("purges placed XObject images intersecting redaction rectangles while preserving surviving images and glyph fonts", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 200, height: 200 });
    const pngBytes = encodePng({
      width: 2,
      height: 2,
      data: Uint8Array.from([
        255, 0, 0, 255, 0, 255, 0, 255,
        0, 0, 255, 255, 255, 255, 0, 255,
      ]),
    });
    const img = doc.embedPng(pngBytes);
    // Image 1 at (10, 10) size 30x30 (inside redaction box [5, 5, 50, 50])
    page.drawImage(img, { x: 10, y: 10, width: 30, height: 30 });
    // Image 2 at (120, 120) size 30x30 (outside redaction box)
    page.drawImage(img, { x: 120, y: 120, width: 30, height: 30 });

    expect(page.evaluateDisplayList().images).toHaveLength(2);
    page.redact([[5, 5, 50, 50]]);
    const afterDl = page.evaluateDisplayList();
    expect(afterDl.images).toHaveLength(1);
    expect(afterDl.images[0]!.matrix[4]).toBeCloseTo(120, 1);
  });
});


describe("Advanced PDF Gaps: Blend Modes, SOF2 Progressive JPEG, Mesh Shadings, TrueType Outlines, Linearization, JBIG2/JPX", () => {
  it("evaluates and renders PDF /BM transparency blend modes (Multiply, Screen, Difference)", () => {
    const rawPdf = `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100]
   /Resources <<
     /ExtGState <<
       /GSMult << /Type /ExtGState /BM /Multiply >>
       /GSDiff << /Type /ExtGState /BM /Difference >>
     >>
   >>
   /Contents 4 0 R
>>
endobj
4 0 obj
<< /Length 125 >>
stream
1 0.5 0.5 rg
0 0 100 100 re f
/GSMult gs
0.5 1 0.5 rg
0 0 50 100 re f
/GSDiff gs
1 1 1 rg
50 0 50 100 re f
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000310 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
485
%%EOF`;
    const doc = PdfDocument.load(new TextEncoder().encode(rawPdf));
    const dl = doc.getPage(0).evaluateDisplayList();
    expect(dl.paths.some(p => p.blendMode === "Multiply")).toBe(true);
    expect(dl.paths.some(p => p.blendMode === "Difference")).toBe(true);
    const bmp = doc.getPage(0).renderToBitmap({ dpi: 72 });
    const leftIdx = (50 * bmp.width + 25) * 4;
    expect(bmp.data[leftIdx]).toBeGreaterThan(115);
    expect(bmp.data[leftIdx]).toBeLessThan(140);
    expect(bmp.data[leftIdx + 1]).toBeGreaterThan(115);
    expect(bmp.data[leftIdx + 1]).toBeLessThan(140);
    expect(bmp.data[leftIdx + 2]).toBeGreaterThan(55);
    expect(bmp.data[leftIdx + 2]).toBeLessThan(75);
    const rightIdx = (50 * bmp.width + 75) * 4;
    expect(bmp.data[rightIdx]).toBeLessThan(15);
    expect(bmp.data[rightIdx + 1]).toBeGreaterThan(115);
    expect(bmp.data[rightIdx + 2]).toBeGreaterThan(115);
  });

  it("decodes SOF2 progressive multi-scan JPEGs (DC first + DC refinement + AC spectral selection)", async () => {
    const { decodeJpegToRgba } = await import("./index.js");
    const dhtDcAndAc = [
      0xff, 0xc4, 0x00, 0x15,
      0x00,
      0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0x00,
      0xff, 0xc4, 0x00, 0x15,
      0x10,
      0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0x00,
    ];
    const sof2Bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xdb, 0x00, 0x43, 0x00, ...new Array(64).fill(8),
      0xff, 0xc2, 0x00, 0x0b, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00,
      ...dhtDcAndAc,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x00, 0x10, 0x80,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x01, 0x3f, 0x00, 0x00,
      0xff, 0xd9,
    ]);
    const res = decodeJpegToRgba(sof2Bytes, 8, 8);
    expect(res.width).toBe(8);
    expect(res.height).toBe(8);
    expect(res.data[0]).toBeGreaterThanOrEqual(128);
    expect(res.data[0]).toBeLessThanOrEqual(131);
  });

  it("renders ShadingType 4 (Free-Form Gouraud Triangle Mesh)", () => {
    const meshBytes = new Uint8Array([
      0, 0, 0, 255, 0, 0,
      0, 255, 0, 0, 255, 0,
      0, 0, 255, 0, 0, 255,
    ]);
    let hexStream = "";
    for (const b of meshBytes) hexStream += b.toString(16).padStart(2, "0");
    const rawPdf = `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100]
   /Resources << /Shading << /Sh4 5 0 R >> >>
   /Contents 4 0 R
>>
endobj
4 0 obj
<< /Length 8 >>
stream
/Sh4 sh
endstream
endobj
5 0 obj
<< /ShadingType 4 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 8
   /Decode [0 100 0 100 0 1 0 1 0 1] /Filter /ASCIIHexDecode /Length ${hexStream.length} >>
stream
${hexStream}>
endstream
endobj
xref
0 6
0000000000 65535 f 
trailer
<< /Size 6 /Root 1 0 R >>
%%EOF`;
    const doc = PdfDocument.load(new TextEncoder().encode(rawPdf));
    const dl = doc.getPage(0).evaluateDisplayList();
    expect(dl.images.length).toBe(1);
    expect(dl.images[0]!.decodedRgba).toBeDefined();
    const bmp = doc.getPage(0).renderToBitmap({ dpi: 72 });
    const blIdx = (85 * bmp.width + 10) * 4;
    expect(bmp.data[blIdx]!).toBeGreaterThan(150);
  });

  it("extracts and renders embedded TrueType (/FontFile2) glyph outlines into Bezier paths", async () => {
    const { parseTrueTypeFont } = await import("./index.js");
    const buf = new ArrayBuffer(512);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    dv.setUint32(0, 0x00010000);
    dv.setUint16(4, 7);
    const writeTag = (off: number, tag: string, tOff: number, tLen: number) => {
      for (let i = 0; i < 4; i++) u8[off + i] = tag.charCodeAt(i);
      dv.setUint32(off + 8, tOff);
      dv.setUint32(off + 12, tLen);
    };
    writeTag(12, "head", 140, 54);
    writeTag(28, "maxp", 196, 6);
    writeTag(44, "hhea", 204, 36);
    writeTag(60, "hmtx", 240, 8);
    writeTag(76, "loca", 248, 6);
    writeTag(92, "glyf", 256, 32);
    writeTag(108, "cmap", 300, 44);
    dv.setUint16(140 + 18, 1000);
    dv.setInt16(140 + 50, 0);
    dv.setUint16(196 + 4, 2);
    dv.setInt16(204 + 4, 800);
    dv.setInt16(204 + 6, -200);
    dv.setUint16(204 + 34, 2);
    dv.setUint16(240, 500);
    dv.setUint16(244, 700);
    dv.setUint16(248, 0);
    dv.setUint16(250, 0);
    dv.setUint16(252, 12);
    dv.setInt16(256, 1);
    dv.setInt16(258, 100);
    dv.setInt16(260, 0);
    dv.setInt16(262, 600);
    dv.setInt16(264, 700);
    dv.setUint16(266, 2);
    dv.setUint16(268, 0);
    u8[270] = 0x01 | 0x02 | 0x20;
    u8[271] = 0x01 | 0x02 | 0x04 | 0x10;
    u8[272] = 0x01 | 0x02 | 0x04;
    u8[273] = 100;
    u8[274] = 250;
    u8[275] = 250;
    u8[276] = 250;
    u8[277] = 250;
    dv.setUint16(300, 0);
    dv.setUint16(302, 1);
    dv.setUint16(304, 3);
    dv.setUint16(306, 1);
    dv.setUint32(308, 12);
    const f4 = 312;
    dv.setUint16(f4, 4);
    dv.setUint16(f4 + 2, 32);
    dv.setUint16(f4 + 6, 4);
    dv.setUint16(f4 + 14, 0x0041);
    dv.setUint16(f4 + 16, 0xffff);
    dv.setUint16(f4 + 18, 0);
    dv.setUint16(f4 + 20, 0x0041);
    dv.setUint16(f4 + 22, 0xffff);
    dv.setInt16(f4 + 24, -64);
    dv.setInt16(f4 + 26, 1);
    dv.setUint16(f4 + 28, 0);
    dv.setUint16(f4 + 30, 0);

    const parsedTt = parseTrueTypeFont(u8);
    expect(parsedTt).toBeDefined();
    const outline = parsedTt!.getGlyphOutline(0x41);
    expect(outline.length).toBeGreaterThanOrEqual(4);
    expect(outline[0]!.kind).toBe("move");
  });

  it("serializes byte-accurate linearized PDFs and decodes JBIG2/JPX streams", async () => {
    const { decodeJbig2ToRgba, decodeJpxToRgba, dictGet } = await import("./index.js");
    const doc = PdfDocument.create();
    const p = doc.addPage({ width: 200, height: 100 });
    p.drawText("Linearized PDF Test", { x: 20, y: 50, size: 14 });
    const linBytes = doc.save({ linearize: true });
    const linText = new TextDecoder("latin1").decode(linBytes);
    expect(linText.indexOf("/Linearized 1")).toBeGreaterThan(0);
    expect(linText.indexOf("/Linearized 1")).toBeLessThan(120);
    const reloaded = PdfDocument.load(linBytes);
    let foundLinL = 0;
    for (const o of reloaded.cos.objects.values()) {
      if (o.value.kind === "dict") {
        const lNode = dictGet(o.value, "L");
        if (lNode?.kind === "number") foundLinL = lNode.value;
      }
    }
    expect(foundLinL).toBe(linBytes.length);

    const jbig2Rgba = decodeJbig2ToRgba(new Uint8Array([0xaa, 0x55]), 8, 2);
    expect(jbig2Rgba.length).toBe(8 * 2 * 4);
    const jpxRgba = decodeJpxToRgba(new Uint8Array([0xff, 0x4f, 0xff, 0x93, 200, 100, 50]), 4, 4);
    expect(jpxRgba.length).toBe(4 * 4 * 4);
    expect(jpxRgba[0]).toBe(200);
    expect(jpxRgba[1]).toBe(100);
    expect(jpxRgba[2]).toBe(50);
  });
});
