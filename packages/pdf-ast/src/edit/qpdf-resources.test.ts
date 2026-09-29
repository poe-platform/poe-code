/* qpdf fixture-based regression adaptations.
 * Copyright (c) 2005-2021 Jay Berkenbilt, 2022-2026 Jay Berkenbilt and Manfred Holger.
 * Licensed under Apache-2.0; see ../../licenses/PDFJS-APACHE-2.0.txt.
 * Adapted from qpdf/qtest/merge-and-split.test at
 * 4eba95899886e851cc41d76886483b347612f2a8 using the local document API.
 */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PdfDocument, dictGet } from "../index.js";
import { pruneUnusedXObjects } from "./resources.js";

it("preserves qpdf shared-image page selection while removing unused resource names", () => {
  const source = PdfDocument.load(readFileSync(new URL("../fixtures/qpdf-shared-images.pdf", import.meta.url)));
  const doc = PdfDocument.create();
  doc.copyPagesFrom(source, [0, 2]);
  doc.copyPagesFrom(source, [0, 1]);
  pruneUnusedXObjects(doc.cos, doc.getPages());
  const saved = PdfDocument.load(doc.save());
  expect(saved.getPages().map(page => {
    const images = saved.cos.resolveDict(dictGet(page.getResourcesDict(), "XObject"));
    return images?.entries.map(entry => entry.key.decoded);
  })).toEqual([["Im1"], ["Im3"], ["Im1"], ["Im2"]]);
});

it("removes the first qpdf shared image only after its last placement is redacted", () => {
  const doc = PdfDocument.load(readFileSync(new URL("../fixtures/qpdf-shared-images.pdf", import.meta.url)));
  doc.getPage(0).redact([0, 0, 1000, 1000]);
  const saved = PdfDocument.load(doc.save());
  expect(saved.pageCount).toBe(10);
  expect(saved.getPages().map(page => {
    const images = saved.cos.resolveDict(dictGet(page.getResourcesDict(), "XObject"));
    return images?.entries.length ?? 0;
  })).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  expect([...saved.cos.objects.values()].filter(({ value }) => {
    const subtype = value.kind === "stream" ? dictGet(value.dict, "Subtype") : undefined;
    return subtype?.kind === "name" && subtype.decoded === "Image";
  })).toHaveLength(9);
});

it("retains all six image placements in qpdf's Forms without Resources fixture", () => {
  const doc = PdfDocument.load(readFileSync(new URL("../fixtures/qpdf-form-xobjects-no-resources.pdf", import.meta.url)));
  doc.getPage(0).redact([-10, -10, -5, -5]);
  const saved = PdfDocument.load(doc.save());
  expect(saved.getPage(0).evaluateDisplayList().images).toHaveLength(6);
  expect(saved.extractText()).toContain("FX2");
});
