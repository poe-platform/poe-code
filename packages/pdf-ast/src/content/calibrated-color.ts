import { dictGet, type PdfCosNode } from "../ast.js";
import type { ParsedCosDocument } from "../cos/parser.js";
import { type CalGrayCS, CalRGBCS, LabCS } from "../vendor/pdfjs-fonts.mjs";

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
  if (family === "CalGray") {
    const gamma = dict ? doc.resolve(dictGet(dict, "Gamma")) : undefined;
    const exponent = gamma?.kind === "number" ? gamma.value : 1;
    return {
      name: "CalGray",
      getRgb(src, offset) {
        // CalGray XYZ is A^Gamma times the source white point. Adapting
        // that neutral axis to the display white leaves equal linear RGB
        // components. Encode these as sRGB, as Poppler does, rather than L*.
        const linear = Math.min(1, Math.max(0, src[offset]!)) ** exponent;
        const gray = 255 * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055);
        return new Uint8ClampedArray([gray, gray, gray]);
      },
    };
  }
  // Retain the existing D65 fallback for malformed dictionaries without a
  // WhitePoint; valid PDF parameters are passed unchanged to PDF.js.
  const whitePoint = array("WhitePoint") ?? [0.95047, 1, 1.08883];
  const blackPoint = array("BlackPoint");
  if (family === "CalRGB") return new CalRGBCS(whitePoint, blackPoint, array("Gamma"), array("Matrix"));
  return new LabCS(whitePoint, blackPoint, array("Range"));
}
