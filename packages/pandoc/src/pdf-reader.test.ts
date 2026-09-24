import { describe, expect, it } from "vitest";
import { PdfDocument } from "@poe-code/pdf-ast";
import { convert, pdfReader, readDocument } from "./index.js";

describe("pdfReader (@poe-code/pdf-ast integration)", () => {
  it("reads PDF headings, paragraphs, lists, code blocks, tables, and metadata into Pandoc AST and converts to Markdown", async () => {
    const doc = PdfDocument.create();
    doc.setMetadata({
      title: "Unified PDF Architecture",
      author: "Ada Lovelace; Alan Turing",
      subject: "Compiler AST",
      keywords: "pdf, ast, pandoc",
    });

    const page = doc.addPage({ width: 612, height: 792 });
    page.drawText("Unified PDF Architecture", {
      x: 72,
      y: 720,
      size: 20,
      font: "Helvetica-Bold",
    });
    page.drawText("This document tests semantic PDF-to-Pandoc conversion.", {
      x: 72,
      y: 685,
      size: 11,
      font: "Helvetica",
    });
    page.drawText("• Deterministic COS lexer", {
      x: 72,
      y: 655,
      size: 11,
      font: "Helvetica",
    });
    page.drawText("• Content stream parser", {
      x: 72,
      y: 638,
      size: 11,
      font: "Helvetica",
    });
    page.drawImage(
      { width: 4, height: 4, data: new Uint8Array(4 * 4 * 4).fill(210) },
      { x: 72, y: 520, width: 40, height: 40 }
    );
    page.drawText("const ast = doc.toSemanticAst();", {
      x: 72,
      y: 605,
      size: 10,
      font: "Courier",
    });

    const pdfBytes = doc.save();

    const parsedDoc = await readDocument(
      { bytes: pdfBytes },
      { from: "pdf" },
      { reader: pdfReader }
    );

    expect(parsedDoc.metadata.title).toEqual({
      t: "MetaString",
      c: "Unified PDF Architecture",
    });
    expect(parsedDoc.blocks.some((b) => b.t === "Header")).toBe(true);
    expect(parsedDoc.blocks.some((b) => b.t === "Para")).toBe(true);
    expect(parsedDoc.resources.length).toBe(1);
    expect(parsedDoc.resources[0]?.id).toBe("pdf-image-1.png");

    const mdResult = await convert(
      [{ bytes: pdfBytes }],
      { from: "pdf", to: "commonmark" },
      { reader: pdfReader }
    );
    expect(mdResult.kind).toBe("text");
    if (mdResult.kind === "text") {
      expect(mdResult.text).toContain("# Unified PDF Architecture");
      expect(mdResult.text).toContain("This document tests semantic PDF-to-Pandoc conversion.");
    }
  });
});
