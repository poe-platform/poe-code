import {expect, it} from "vitest";
import {PDFContext} from "pdf-lib";
import {defaultPdfLimits, renderPdf, serializePdf, suppliedDefaultFont} from "./index.js";
it("defaults every PDF budget to Infinity and renders", async () => {
  expect(Object.values(defaultPdfLimits).every(value => value === Infinity)).toBe(true);
  const bytes = await renderPdf({fonts: [suppliedDefaultFont()], blocks: []});
  expect(new TextDecoder().decode(bytes)).toContain("%PDF-1.7");
});
it("serializes with unbounded budgets", async () => {
  const context = PDFContext.create();
  context.trailerInfo.Root = context.register(context.obj({Type: "Catalog"}));
  expect(await serializePdf(context, {outputBytes: Infinity, objects: Infinity})).toBeInstanceOf(Uint8Array);
});
