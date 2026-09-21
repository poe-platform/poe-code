import { excelStatisticsImports, odfStatisticsImports } from "./statistics-export-names.js";
import type { FormulaGrammar } from "./ast.js";
import { odfFunctionNames, excelNumericFunctionNames } from "./function-export-names.js";

/** Fixed C-locale conventions from Gnumeric 1.12.61, not host locale guesses. */
export const gnumericGrammar: FormulaGrammar = Object.freeze({
  id: "gnumeric", address: "a1", arguments: ",", arrayColumn: ",", arrayRow: ";",
  intersection: " ", union: ",", sheetSeparator: "!", bracketReferences: false,
  stringEscape: "backslash", leftAssociativePower: false, prefixes: Object.freeze(["="]), functionPrefixes: Object.freeze([]),
  nativeNames: true, singleQuotedStrings: true, quotedErrors: true
});
export const excelGrammar: FormulaGrammar = Object.freeze({ ...gnumericGrammar,
  id: "excel", stringEscape: "double", singleQuotedStrings: false, quotedErrors: false, functionPrefixes: Object.freeze(["_XLFN.", "_XLFNODF.", "_XLFNGNUMERIC."]),
  functionPrefixAliases: Object.freeze({ "_XLFN.": Object.freeze({ ...excelStatisticsImports, "ERF.PRECISE": "ERF", "ERFC.PRECISE": "ERFC", "GAMMALN.PRECISE": "GAMMALN" }) }),
  functionExportAliases: excelNumericFunctionNames, excelNumericHandlers: true
});
export const odfGrammar: FormulaGrammar = Object.freeze({ ...gnumericGrammar,
  id: "odf", arguments: ";", arrayColumn: ";", arrayRow: "|", intersection: "!", union: "~",
  sheetSeparator: ".", bracketReferences: true, stringEscape: "double", leftAssociativePower: true,
  nativeNames: false, singleQuotedStrings: false, quotedErrors: false,
  absoluteSheetReferences: true, sheetSpans: false,
  functionPrefixAliases: Object.freeze({ "COM.MICROSOFT.": odfStatisticsImports }),
  functionAliases: Object.freeze({ ...odfStatisticsImports, TIME: "ODF.TIME", PDURATION: "G_DURATION", INDIRECT_XL: "INDIRECT", ADDRESS_XL: "ADDRESS", ERRORTYPE: "ERROR.TYPE", FORMULA: "GET.FORMULA", USDOLLAR: "DOLLAR", SUMPRODUCT: "ODF.SUMPRODUCT" }),
  odfRoundingArguments: true,
  functionExportAliases: odfFunctionNames,
  booleanFunctions: true,
  prefixes: Object.freeze(["of:=", "oooc:=", "="]), functionPrefixes: Object.freeze(["ORG.GNUMERIC.", "COM.MICROSOFT."])
});
export const sylkGrammar: FormulaGrammar = Object.freeze({ ...gnumericGrammar, id: "sylk", address: "r1c1" });
/** Native SYLK output quotes strings without escaping; its reader does not invert that operation. */
export const sylkWriterGrammar: FormulaGrammar = Object.freeze({ ...sylkGrammar, id: "sylk-writer", stringEscape: "raw" });
/** Old OpenOffice textual expressions; binary Lotus/BIFF tokens need their own decoder. */
export const legacyOpenOfficeGrammar: FormulaGrammar = Object.freeze({ ...odfGrammar, id: "legacy-openoffice", sheetSeparator: "!",
  functionArgumentInsertions: Object.freeze({ ADDRESS: Object.freeze({ arity: 4, index: 3, value: Object.freeze({ kind: "number" as const, value: 1 }) }) })
});
export const legacyApplixGrammar: FormulaGrammar = Object.freeze({ ...gnumericGrammar, id: "legacy-applix",
  sheetSeparator: ":", rangeSeparator: "..", intersection: "", sheetSpans: false, qualifiedRangeEndpoints: true,
  absoluteSheetReferences: true, unquotedSheets: true, hashLogicals: true, wholeAxisReferences: false, qualifiedNames: false,
  functionAliases: Object.freeze({ IPAYMT: "IPMT", PAYMT: "PMT", PPAYMT: "PPMT" })
});
