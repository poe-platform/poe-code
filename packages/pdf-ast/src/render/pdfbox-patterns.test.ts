/*
 * Adapted from Apache PDFBox TestQuality.java, Apache-2.0.
 * Copyright The Apache Software Foundation. See THIRD_PARTY_NOTICES.md.
 * Upstream c4d556abc9d5f0cbc486d459c84682321dd38ff4.
 */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PdfDocument } from "../document.js";
import { renderDisplayListToBitmap } from "./raster.js";

function pixel(file: string, page: number, x: number, y: number) {
  const doc = PdfDocument.load(readFileSync(new URL(`../fixtures/pdfbox-${file}.pdf`, import.meta.url)));
  const list = doc.getPage(page).evaluateDisplayList();
  const scale = 100 / 72;
  const [ox, oy] = list.origin ?? [0, 0];
  // Render the original sample's one-pixel viewport at the original DPI.
  // Full-page rendering is checked separately; unrelated pixels make these
  // upstream regression assertions needlessly expensive in the unit suite.
  const bitmap = renderDisplayListToBitmap({ ...list, width: 1 / scale, height: 1 / scale,
    origin: [ox + x / scale, oy + list.height - (y + 1) / scale] }, { scale });
  return Array.from(bitmap.data);
}

// Preserve PDFBox's original page, resolution, sample coordinates and assertions.
it("PDFBOX-6077: leaves gaps in a stencil's tiling pattern transparent", () => {
  expect(pixel("6077-example", 0, 280, 23)).toEqual([255, 255, 255, 255]);
});

it("PDFBOX-5842: positions the soft mask of a stencil pattern in page coordinates", () => {
  expect(pixel("5842-reduced", 0, 267, 1329)).not.toEqual([255, 255, 255, 255]);
});

it("PDFBOX-5403: keeps stencil-pattern text dark across tile boundaries", () => {
  expect(pixel("5403-bad-rendering", 2, 159, 115)[0]).toBeLessThan(100);
});

it("PDFBOX-5250: positions a text pattern using its transparency group's initial matrix", () => {
  const [red, green] = pixel("5250-pattern-reduced3", 0, 190, 331);
  expect(red).toBeGreaterThan(150);
  expect(green).toBeLessThan(150);
});
