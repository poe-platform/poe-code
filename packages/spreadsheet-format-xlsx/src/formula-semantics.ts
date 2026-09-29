import type { XmlElement } from "@poe-code/safe-fs/xml";
import { SsconvertError, type CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { FormulaSemantics } from "@poe-code/spreadsheet-ast";
import type { ParsePosition } from "@poe-code/spreadsheet-engine/formulas/ast";
import { parseExpression } from "@poe-code/spreadsheet-engine/formulas/parser";
import { serializeExpression } from "@poe-code/spreadsheet-engine/formulas/serialization";
import { gnumericGrammar } from "@poe-code/spreadsheet-engine/formulas/conventions";
import { visitFormula } from "@poe-code/spreadsheet-engine/formulas/rewriting";

// Gnumeric text parsing coerces quoted numbers, booleans and errors in arrays.
// This ignorable extension preserves imported string types during readback.
const namespace = "urn:poe-code:ssconvert:formulas:1";

export function nativeOpenFormula(source: string, position: ParsePosition, context: CapabilityContext, arrayStringLiterals = false): string {
  if (!source.startsWith("of:=") && !source.includes("@") && !source.includes("!!")) return source;
  const parsed = parseExpression(source, { maximumDepth: context.limits.formulaDepth, position, arrayStringLiterals, signal: context.signal,
    maximumLength: context.limits.workbookTextBytes ?? context.limits.outputBytes, maximumNodes: context.limits.workbookNodes ?? Infinity });
  if (!parsed.ok) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: invalid OpenFormula expression");
  visitFormula(parsed.document.root, node => {
    context.signal.throwIfAborted();
    if (node.kind === "binary" && node.op === "label-intersection")
      throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: automatic label intersection in Gnumeric output");
    if (node.kind === "reference" && node.label)
      throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: live label reference in Gnumeric output");
  });
  if (!source.startsWith("of:=")) return source;
  return serializeExpression(parsed.document, gnumericGrammar, false, true, { relativeSheets: "fixed" });
}

export function readFormulaSemantics(node: XmlElement | undefined): FormulaSemantics {
  const value = node?.attributes.find(attribute => attribute.namespace === namespace && attribute.localName === "array-string-literals")?.value;
  if (value !== undefined && value !== "0" && value !== "1")
    throw new SsconvertError("io", "Invalid ssconvert formula array string semantics");
  return value === "1" ? { arrayStringLiterals: true } : {};
}

/** Native Excel/Gnumeric syntax cannot retain relative named-sheet references.
 * The standard expression is a fixed-target fallback; this extension carries
 * the original OpenFormula expression and an optional named-expression anchor. */
export function readOpenFormula(node: XmlElement | undefined): { source: string; position?: ParsePosition } | undefined {
  const source = node?.attributes.find(attribute => attribute.namespace === namespace && attribute.localName === "openformula")?.value;
  if (source === undefined) return undefined;
  if (!source.startsWith("of:=")) throw new SsconvertError("io", "Invalid ssconvert OpenFormula expression");
  const anchor = node?.attributes.find(attribute => attribute.namespace === namespace && attribute.localName === "openformula-origin")?.value;
  if (anchor === undefined) return { source };
  let values: unknown;
  try { values = JSON.parse(anchor); } catch { throw new SsconvertError("io", "Invalid ssconvert OpenFormula origin"); }
  if (!Array.isArray(values) || values.length !== 3 || typeof values[0] !== "string" || !values[0] ||
    !values.slice(1).every(value => Number.isSafeInteger(value) && value >= 0))
    throw new SsconvertError("io", "Invalid ssconvert OpenFormula origin");
  return { source, position: { sheet: values[0], row: values[1] as number, column: values[2] as number } };
}

export function formulaSemanticsAttributes(enabled: boolean | undefined, markupCompatibility = false, source?: string, position?: ParsePosition): Record<string, string> {
  const openFormula = source?.startsWith("of:=") ? source : undefined;
  return enabled || openFormula ? { "xmlns:ssc": namespace, ...(enabled ? { "ssc:array-string-literals": "1" } : {}),
    ...(openFormula ? { "ssc:openformula": openFormula, ...(position ? { "ssc:openformula-origin": JSON.stringify([position.sheet, position.row, position.column]) } : {}) } : {}),
    ...(markupCompatibility ? { "xmlns:mc": "http://schemas.openxmlformats.org/markup-compatibility/2006", "mc:Ignorable": "ssc" } : {}) } : {};
}
