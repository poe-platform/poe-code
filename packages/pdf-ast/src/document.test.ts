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
});
