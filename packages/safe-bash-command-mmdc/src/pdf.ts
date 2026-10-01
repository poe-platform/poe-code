import { PdfDocument } from "@poe-code/pdf-ast";
import { prepareSceneSteps } from "./command.js";
import { rasterizeSceneSteps } from "./raster.js";
import { encodeRgbaToPngSteps } from "./png.js";
import { drainWork } from "./work.js";
import type { MermaidPngRenderOptions, MermaidSvgResult, MermaidAccounting } from "./contracts.js";

export interface MermaidPdfResult {
  readonly pdf: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly family: MermaidSvgResult["family"];
  readonly accounting: MermaidAccounting;
}

export function* renderMermaidPdfSteps(source: string, options?: MermaidPngRenderOptions): Generator<void, MermaidPdfResult, void> {
  const { scene, budget, renderOptions } = yield* prepareSceneSteps(source, options);
  const raster = yield* rasterizeSceneSteps(scene, { scale: renderOptions?.scale ?? 1, budget });
  const png = yield* encodeRgbaToPngSteps(raster.rgba, raster.width, raster.height, budget, "intermediate");
  budget.check();
  const document = PdfDocument.create();
  const width = scene.width * 0.75, height = scene.height * 0.75;
  const page = document.addPage([width, height]);
  page.drawImage(document.embedPng(png), { x: 0, y: 0, width, height });
  const pdf = document.save();
  budget.chargeMemoryBytes(pdf.byteLength);
  budget.chargeOutputBytes(pdf.byteLength);
  return { pdf, width, height, family: scene.family, accounting: budget.snapshot() };
}

export function renderMermaidPdf(source: string, options?: MermaidPngRenderOptions): MermaidPdfResult {
  return drainWork(renderMermaidPdfSteps(source, options));
}
