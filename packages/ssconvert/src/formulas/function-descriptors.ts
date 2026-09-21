import { statisticsFunctionDescriptors } from "./statistics-function-descriptors.js";
import { dateFinanceFunctionDescriptors } from "./date-finance-function-descriptors.js";
import { numericFunctionDescriptors } from "./numeric-function-descriptors.js";
/** Released Gnumeric 1.12.61 descriptors; source binding in function-coverage.json. */
export const functionDescriptors: Readonly<Record<string, { readonly signature: string | null; readonly flags: string; readonly group: string }>> = {
  ...numericFunctionDescriptors,
  ...statisticsFunctionDescriptors,
  ...dateFinanceFunctionDescriptors,
  "DAVERAGE": {
    "signature": "rSr",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-database"
  },
  "DCOUNT": {
    "signature": "rSr",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-database"
  },
  "DCOUNTA": {
    "signature": "rSr",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-database"
  },
  "DGET": {
    "signature": "rSr",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-database"
  },
  "DMAX": {
    "signature": "rSr",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-database"
  },
  "DMIN": {
    "signature": "rSr",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-database"
  },
  "DPRODUCT": {
    "signature": "rSr",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-database"
  },
  "DSTDEV": {
    "signature": "rSr",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-database"
  },
  "DSTDEVP": {
    "signature": "rSr",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-database"
  },
  "DSUM": {
    "signature": "rSr",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-database"
  },
  "DVAR": {
    "signature": "rSr",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-database"
  },
  "DVARP": {
    "signature": "rSr",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-database"
  },
  "GETPIVOTDATA": {
    "signature": "rs",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-database"
  },
  "CELL": {
    "signature": "sr",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "ERROR.TYPE": {
    "signature": "E",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "INFO": {
    "signature": "s",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "ISBLANK": {
    "signature": "E",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "ISERR": {
    "signature": "E",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "ISERROR": {
    "signature": "E",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "ISEVEN": {
    "signature": "f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "ISLOGICAL": {
    "signature": "E",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "ISNA": {
    "signature": "E",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "ISNONTEXT": {
    "signature": "E",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "ISNUMBER": {
    "signature": "E",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "ISODD": {
    "signature": "S",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "ISREF": {
    "signature": null,
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "ISTEXT": {
    "signature": "E",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "N": {
    "signature": "S",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "NA": {
    "signature": "",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "TYPE": {
    "signature": "?",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "COUNTBLANK": {
    "signature": "r",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "ERROR": {
    "signature": "s",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "EXPRESSION": {
    "signature": "r",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "GET.FORMULA": {
    "signature": "r",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "GET.LINK": {
    "signature": "r",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "ISFORMULA": {
    "signature": "r",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "GETENV": {
    "signature": "s",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-info"
  },
  "AND": {
    "signature": null,
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-logical"
  },
  "OR": {
    "signature": null,
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-logical"
  },
  "NOT": {
    "signature": "b",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-logical"
  },
  "IFERROR": {
    "signature": "EE",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_SECOND",
    "group": "fn-logical"
  },
  "IFNA": {
    "signature": "EE",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_SECOND",
    "group": "fn-logical"
  },
  "IFS": {
    "signature": null,
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-logical"
  },
  "SWITCH": {
    "signature": null,
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-logical"
  },
  "TRUE": {
    "signature": "",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-logical"
  },
  "FALSE": {
    "signature": "",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-logical"
  },
  "XOR": {
    "signature": null,
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-logical"
  },
  "ADDRESS": {
    "signature": "ff|fbs",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "AREAS": {
    "signature": null,
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "CHOOSE": {
    "signature": null,
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "COLUMN": {
    "signature": "|A",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "COLUMNNUMBER": {
    "signature": "s",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "COLUMNS": {
    "signature": "A",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "HLOOKUP": {
    "signature": "EAf|bb",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "HYPERLINK": {
    "signature": "S|S",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "INDIRECT": {
    "signature": "s|b",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "INDEX": {
    "signature": "A|fff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "LOOKUP": {
    "signature": "EA|r",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "MATCH": {
    "signature": "EA|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "OFFSET": {
    "signature": "rff|ff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "ROW": {
    "signature": "|A",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "ROWS": {
    "signature": "A",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "SHEETS": {
    "signature": "|A",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "SHEET": {
    "signature": "|?",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "SORT": {
    "signature": "r|f",
    "flags": "GNM_FUNC_RETURNS_NON_SCALAR",
    "group": "fn-lookup"
  },
  "TRANSPOSE": {
    "signature": "A",
    "flags": "GNM_FUNC_RETURNS_NON_SCALAR",
    "group": "fn-lookup"
  },
  "UNIQUE": {
    "signature": "A|bb",
    "flags": "GNM_FUNC_RETURNS_NON_SCALAR",
    "group": "fn-lookup"
  },
  "VLOOKUP": {
    "signature": "EAf|bb",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "XLOOKUP": {
    "signature": "EAA|?ff",
    "flags": "GNM_FUNC_RETURNS_NON_SCALAR",
    "group": "fn-lookup"
  },
  "XMATCH": {
    "signature": "EA|ff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-lookup"
  },
  "ARRAY": {
    "signature": null,
    "flags": "GNM_FUNC_RETURNS_NON_SCALAR",
    "group": "fn-lookup"
  },
  "FLIP": {
    "signature": "A|b",
    "flags": "GNM_FUNC_RETURNS_NON_SCALAR",
    "group": "fn-lookup"
  },
  "ASC": {
    "signature": "s",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "CHAR": {
    "signature": "f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "UNICHAR": {
    "signature": "f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "CLEAN": {
    "signature": "S",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "CODE": {
    "signature": "S",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "UNICODE": {
    "signature": "S",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "CONCAT": {
    "signature": null,
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "CONCATENATE": {
    "signature": null,
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "DOLLAR": {
    "signature": "f|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "ENCODEURL": {
    "signature": "S",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "EXACT": {
    "signature": "SS",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "FIND": {
    "signature": "SS|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "FINDB": {
    "signature": "SS|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "FIXED": {
    "signature": "f|fb",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "JIS": {
    "signature": "s",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "LEFT": {
    "signature": "S|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "LEFTB": {
    "signature": "S|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "LEN": {
    "signature": "S",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "LENB": {
    "signature": "S",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "LOWER": {
    "signature": "S",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "MID": {
    "signature": "Sff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "MIDB": {
    "signature": "Sff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "NUMBERVALUE": {
    "signature": "SS",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "PROPER": {
    "signature": "S",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "REPLACE": {
    "signature": "SffS",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "REPLACEB": {
    "signature": "SffS",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "REPT": {
    "signature": "Sf",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "RIGHT": {
    "signature": "S|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "RIGHTB": {
    "signature": "S|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "SEARCH": {
    "signature": "SS|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "SEARCHB": {
    "signature": "SS|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "SUBSTITUTE": {
    "signature": "SSS|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "T": {
    "signature": "S",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "TEXT": {
    "signature": "Ss",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "TEXTAFTER": {
    "signature": "SA|ffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "TEXTBEFORE": {
    "signature": "SA|ffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "TEXTJOIN": {
    "signature": null,
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "TEXTSPLIT": {
    "signature": "SA|A?f?",
    "flags": "GNM_FUNC_RETURNS_NON_SCALAR",
    "group": "fn-string"
  },
  "TRIM": {
    "signature": "S",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "UPPER": {
    "signature": "S",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  },
  "VALUE": {
    "signature": "S",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-string"
  }
};
