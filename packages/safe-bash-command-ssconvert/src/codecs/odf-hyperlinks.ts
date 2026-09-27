import { parseExpression } from "../formulas/parser.js";
import { excelGrammar, gnumericGrammar } from "../formulas/conventions.js";
import { quoteNativeSheet, serializeExpression } from "../formulas/serialization.js";

// Calc hyperlink fragments use unbracketed addresses, not OpenFormula syntax.
const linkGrammar = { ...excelGrammar, id: "odf-hyperlink", sheetSeparator: "." };

export function translateOdfHyperlink(source: string, direction: "import" | "export", charge: (n?: number) => void): string {
  charge(source.length);
  let target = direction === "import" && source.startsWith("#") ? source.slice(1) : source;
  if (direction === "import") {
    try { target = decodeURIComponent(target); } catch { /* Preserve malformed passive targets. */ }
  }
  const parsed = parseExpression("=" + target, { grammar: direction === "import" ? linkGrammar : gnumericGrammar,
    position: { sheet: "", row: 0, column: 0 }, onWork: charge });
  if (parsed.ok) {
    const node = parsed.document.root;
    if (node.kind === "name" && node.workbook === undefined ||
      node.kind === "reference" && !node.label && node.first.workbook === undefined && node.last?.workbook === undefined) {
      target = serializeExpression(parsed.document, direction === "import" ?
        { ...gnumericGrammar, quoteSheetName: quoteNativeSheet } : linkGrammar, false, true).slice(1);
    }
  }
  return direction === "import" ? target : "#" + encodeURI(target);
}
