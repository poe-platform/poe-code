import { encodingAliases } from "./tables.js";

// Measured built-ins and canonical converter atoms absent from alias declarations.
const capturedNames: Readonly<Record<string, string>> = Object.freeze({
  "ansi_x3.4-1968": "ascii",
  ibm437: "cp437", ibm850: "cp850", ibm852: "cp852", ibm855: "cp855",
  ibm857: "cp857", ibm858: "cp858", ibm860: "cp860", ibm861: "cp861",
  ibm862: "cp862", ibm863: "cp863", ibm864: "cp864", ibm865: "cp865",
  ibm866: "cp866", ibm869: "cp869", "mac-uk": "mac-cyrillic",
  ucs2: "ucs-2", ucs4: "ucs-4",
  cp1250: "windows-1250", cp1251: "windows-1251", cp1252: "windows-1252",
  cp1253: "windows-1253", cp1254: "windows-1254", cp1255: "windows-1255",
  cp1256: "windows-1256", cp1257: "windows-1257", cp1258: "windows-1258"
});

/** Exact measured aliases only; no punctuation heuristics or WHATWG aliases. */
export function encodingName(charset: string): string {
  const name = charset.toLowerCase();
  return Object.hasOwn(capturedNames, name) ? capturedNames[name]! :
    Object.hasOwn(encodingAliases, name) ? encodingAliases[name]! : name;
}
