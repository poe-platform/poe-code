import { parseExpression } from "../formulas/parser.js";
import { excelGrammar, gnumericGrammar } from "../formulas/conventions.js";
import { quoteNativeSheet, serializeExpression } from "../formulas/serialization.js";
import { foldSheetName } from "../workbook/case-fold.js";

// Calc hyperlink fragments use unbracketed addresses, not OpenFormula syntax.
const linkGrammar = { ...excelGrammar, id: "odf-hyperlink", sheetSeparator: ".", absoluteSheetReferences: true };

// Calc getUTF32/WithCharset decodes valid characters independently, leaving
// malformed UTF-8 octets escaped and literal percent characters untouched.
function decodeFragment(source: string, charge: (n?: number) => void): string {
  let result = "";
  for (let at = 0; at < source.length;) {
    charge();
    const high = "0123456789abcdef".indexOf(source[at + 1]?.toLowerCase() ?? " ");
    const low = "0123456789abcdef".indexOf(source[at + 2]?.toLowerCase() ?? " ");
    if (source[at] !== "%" || high < 0 || low < 0) { result += source[at++]!; continue; }
    const octet = high * 16 + low;
    const length = octet >= 0xC0 && octet <= 0xDF ? 6 : octet >= 0xE0 && octet <= 0xEF ? 9 :
      octet >= 0xF0 && octet <= 0xF4 ? 12 : 3;
    const encoded = source.slice(at, at + length);
    try {
      result += decodeURIComponent(encoded);
      at += length;
    } catch {
      result += source.slice(at, at + 3).toUpperCase();
      at += 3;
    }
  }
  return result;
}

function encodeFragment(source: string): string {
  return "#" + encodeURI(source).split("#").join("%23").split("?").join("%3F");
}

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
    target = decodeFragment(target, charge);
    // Calc's MakeRangeFromName accepts its UI spelling for sheet-local names.
    const separator = target.indexOf(" (");
    if (separator > 0 && target.endsWith(")")) {
      const name = target.slice(0, separator), sheet = findSheet(target.slice(separator + 2, -1));
      if (sheet !== undefined) {
        const qualified = quoteNativeSheet(sheet) + "!" + name;
        const parsed = parseExpression("=" + qualified, { position: { sheet, row: 0, column: 0 }, onWork: charge });
        if (parsed.ok && parsed.document.root.kind === "name" && parsed.document.root.name === name && parsed.document.root.sheet === sheet)
          return direction === "import" ? qualified : encodeFragment(target);
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
      if (sheet !== undefined && node.kind === "name") return encodeFragment(node.name + " (" + sheet + ")");
      if (direction !== "normalize") target = serializeExpression(parsed.document, direction === "import" ?
        { ...gnumericGrammar, quoteSheetName: quoteNativeSheet } : linkGrammar, false, true).slice(1);
    }
  }
  return direction === "import" ? target : direction === "normalize" ? source : encodeFragment(target);
}
