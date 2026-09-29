import { dictGet, type PdfCosNode } from "../ast.js";
import type { ParsedCosDocument } from "../cos/parser.js";
import { CalGrayCS, CalRGBCS, LabCS } from "../vendor/pdfjs-fonts.mjs";

export type CalibratedColorSpace = CalGrayCS | CalRGBCS | LabCS;

export function createCalibratedColorSpace(doc: ParsedCosDocument, family: "CalGray" | "CalRGB" | "Lab", parameters: PdfCosNode | undefined): CalibratedColorSpace {
  const dict = doc.resolveDict(parameters);
  const array = (key: string) => {
    const value = dict ? doc.resolveArray(dictGet(dict, key)) : undefined;
    return value?.items.map(item => {
      const number = doc.resolve(item);
      return number?.kind === "number" ? number.value : 0;
    });
  };
  // Retain the existing D65 fallback for malformed dictionaries without a
  // WhitePoint; valid PDF parameters are passed unchanged to PDF.js.
  const whitePoint = array("WhitePoint") ?? [0.95047, 1, 1.08883];
  const blackPoint = array("BlackPoint");
  if (family === "CalGray") {
    const gamma = dict ? doc.resolve(dictGet(dict, "Gamma")) : undefined;
    return new CalGrayCS(whitePoint, blackPoint, gamma?.kind === "number" ? gamma.value : undefined);
  }
  if (family === "CalRGB") return new CalRGBCS(whitePoint, blackPoint, array("Gamma"), array("Matrix"));
  return new LabCS(whitePoint, blackPoint, array("Range"));
}
