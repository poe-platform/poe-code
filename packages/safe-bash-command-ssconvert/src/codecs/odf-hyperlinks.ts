import { parseExpression } from "../formulas/parser.js";
import { excelGrammar, gnumericGrammar } from "../formulas/conventions.js";
import { quoteNativeSheet, serializeExpression } from "../formulas/serialization.js";
import { foldSheetName } from "../workbook/case-fold.js";

// Calc hyperlink fragments use unbracketed addresses, not OpenFormula syntax.
const linkGrammar = { ...excelGrammar, id: "odf-hyperlink", sheetSeparator: "." };

export function translateOdfHyperlink(source: string, direction: "import" | "export" | "normalize", charge: (n?: number) => void,
  sheetNames: readonly string[] = []): string {
  charge(source.length);
  if (direction === "normalize" && !source.startsWith("#")) return source;
  function findSheet(name: string) {
    const folded = foldSheetName(name);
    return sheetNames.find(candidate => { charge(candidate.length); return foldSheetName(candidate) === folded; });
  }
  let target = direction !== "export" && source.startsWith("#") ? source.slice(1) : source;
  if (direction !== "export") {
    try { target = decodeURIComponent(target); } catch { if (direction === "normalize") return source; }
    // Calc's MakeRangeFromName accepts its UI spelling for sheet-local names.
    const separator = target.indexOf(" (");
    if (separator > 0 && target.endsWith(")")) {
      const name = target.slice(0, separator), sheet = findSheet(target.slice(separator + 2, -1));
      if (sheet !== undefined) {
        const qualified = quoteNativeSheet(sheet) + "!" + name;
        const parsed = parseExpression("=" + qualified, { position: { sheet, row: 0, column: 0 }, onWork: charge });
        if (parsed.ok && parsed.document.root.kind === "name" && parsed.document.root.name === name && parsed.document.root.sheet === sheet)
          return direction === "import" ? qualified : source;
      }
    }
  }
  const parsed = parseExpression("=" + target, { grammar: direction !== "export" ? linkGrammar : gnumericGrammar,
    position: { sheet: "", row: 0, column: 0 }, onWork: charge });
  if (parsed.ok) {
    const node = parsed.document.root;
    if (node.kind === "name" && node.workbook === undefined ||
      node.kind === "reference" && !node.label && node.first.workbook === undefined && node.last?.workbook === undefined) {
      const sheet = direction !== "import" && node.kind === "name" && node.sheet !== undefined ? findSheet(node.sheet) : undefined;
      // Calc's hyperlink name lookup does not accept the formula spelling
      // Sheet.Name. Keep the name live using its explicitly local UI mark.
      if (sheet !== undefined && node.kind === "name") return "#" + encodeURI(node.name + " (" + sheet + ")");
      if (direction !== "normalize") target = serializeExpression(parsed.document, direction === "import" ?
        { ...gnumericGrammar, quoteSheetName: quoteNativeSheet } : linkGrammar, false, true).slice(1);
    }
  }
  return direction === "import" ? target : direction === "normalize" ? source : "#" + encodeURI(target);
}
