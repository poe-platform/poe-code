import { trimXmlWhitespace } from "./stored-lexical.js";
import { InvalidDocumentError } from "./document-error.js";
import { Length, Pt, Twips } from "./formatting-values.js";

/** Decode stored Word measures without treating JavaScript numeric syntax as XML. */
export function storedMeasure(raw: string, unit: "twip" | "unsigned-twip" | "half-point" = "twip", message = "Invalid stored document measure."): Length {
  const text = trimXmlWhitespace(raw), multiplier = ({ in: 914400, cm: 360000, mm: 36000, pt: 12700, pc: 152400, pi: 152400 } as Readonly<Record<string, number>>)[text.slice(-2)];
  const physical = multiplier !== undefined, scalar = physical ? text.slice(0, -2) : text;
  let start = scalar[0] === "-" || !physical && scalar[0] === "+" ? 1 : 0;
  if (start === scalar.length || physical && unit !== "twip" && scalar[0] === "-") throw new InvalidDocumentError(message);
  let digits = 0, decimal = false;
  for (; start < scalar.length; start++) {
    const character = scalar[start]!;
    if (character >= "0" && character <= "9") { digits++; continue; }
    if (physical && character === "." && !decimal && digits > 0 && start < scalar.length - 1) { decimal = true; continue; }
    throw new InvalidDocumentError(message);
  }
  const value = Number(scalar);
  if (!digits || !Number.isFinite(value) || !physical && !Number.isSafeInteger(value) || unit !== "twip" && value < 0) throw new InvalidDocumentError(message);
  try { return physical ? Length(value * multiplier) : unit === "half-point" ? Pt(value / 2) : Twips(value); }
  catch (error) { if (error instanceof RangeError || error instanceof TypeError) throw new InvalidDocumentError(message); throw error; }
}
