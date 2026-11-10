import type { ByteSpan, PdfCosNull, PdfCosBoolean, PdfCosNumber, PdfCosNode, PdfCosArray, PdfCosRef } from "../ast.js";

export function cosNull(span?: ByteSpan): PdfCosNull {
  return { kind: "null", span };
}

export function cosBool(value: boolean, span?: ByteSpan): PdfCosBoolean {
  return { kind: "boolean", value, span };
}

export function formatPdfNumber(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-10) {
    return "0";
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  let fixed = value.toFixed(6);
  while (fixed.endsWith("0")) fixed = fixed.slice(0, -1);
  if (fixed.endsWith(".")) fixed = fixed.slice(0, -1);
  return fixed === "-0" || fixed === "" ? "0" : fixed;
}

export function cosNumber(value: number, raw?: string, span?: ByteSpan): PdfCosNumber {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid non-finite PDF number: ${String(value)}`);
  }
  const isInteger = Number.isInteger(value);
  const hasExponent = raw !== undefined && (raw.includes("e") || raw.includes("E"));
  const formatted =
    raw !== undefined && !hasExponent
      ? raw
      : formatPdfNumber(value);
  return { kind: "number", value, raw: formatted, isInteger, span };
}

export function cosArray(items: PdfCosNode[], span?: ByteSpan): PdfCosArray {
  return { kind: "array", items: [...items], span };
}

export function cosRef(objectNumber: number, generationNumber = 0, span?: ByteSpan): PdfCosRef {
  return { kind: "ref", objectNumber, generationNumber, span };
}
