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
});
