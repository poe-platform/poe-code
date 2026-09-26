import type { XmlElement } from "@poe-code/safe-fs/xml";
import { SsconvertError } from "../contracts.js";
import type { FormulaSemantics } from "../workbook.js";

// Gnumeric text parsing coerces quoted numbers, booleans and errors in arrays.
// This ignorable extension preserves imported string types during readback.
const namespace = "urn:poe-code:ssconvert:formulas:1";

export function readFormulaSemantics(node: XmlElement | undefined): FormulaSemantics {
  const value = node?.attributes.find(attribute => attribute.namespace === namespace && attribute.localName === "array-string-literals")?.value;
  if (value !== undefined && value !== "0" && value !== "1")
    throw new SsconvertError("io", "Invalid ssconvert formula array string semantics");
  return value === "1" ? { arrayStringLiterals: true } : {};
}

export function formulaSemanticsAttributes(enabled: boolean | undefined, markupCompatibility = false): Record<string, string> {
  return enabled ? { "xmlns:ssc": namespace, "ssc:array-string-literals": "1",
    ...(markupCompatibility ? { "xmlns:mc": "http://schemas.openxmlformats.org/markup-compatibility/2006", "mc:Ignorable": "ssc" } : {}) } : {};
}
