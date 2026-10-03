import { SsconvertError, type CapabilityContext } from "../../contracts.js";
import { printWork } from "./pagination.js";

export interface PrintHeaderFooterInfo {
  readonly page: number;
  readonly pages: number;
  readonly sheetName: string;
  readonly filename: string;
  readonly path: string;
  readonly title: string;
  readonly timestamp?: {
    readonly serial: number;
    readonly dateSystem: "1900" | "1904";
    format(serial: number, pattern: string, dateSystem: "1900" | "1904"): string;
  };
  cell?(reference: string, repeating: boolean): string;
}
export function renderPrintHeaderFooter(format: string, info: PrintHeaderFooterInfo, context: CapabilityContext): string {
  const tick = printWork(context); tick();
  if (typeof format !== "string" || !Number.isSafeInteger(info.page) || !Number.isSafeInteger(info.pages) ||
      info.page < 0 || info.pages < 0 || (context.limits.outputBytes !== Infinity && !Number.isSafeInteger(context.limits.outputBytes)) || context.limits.outputBytes < 0)
    throw new SsconvertError("invalid-request", "Invalid ssconvert print header metadata");
  let bytes = 0;
  const parts: string[] = [];
  function append(text: string) {
    tick();
    if (typeof text !== "string") throw new SsconvertError("invalid-request", "Invalid ssconvert print header text");
    // Count without first allocating an unbounded encoded copy of host text.
    for (const character of text) {
      tick();
      if (character === "\0") break;
      const code = character.codePointAt(0)!;
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      if (bytes > context.limits.outputBytes)
        throw new SsconvertError("resource-limit", "ssconvert print header output limit exceeded");
    }
    const end = text.indexOf("\0");
    parts.push(end < 0 ? text : text.slice(0, end));
  }
  for (let index = 0; index < format.length;) {
    tick();
    if (format[index] === "\0") break;
    if (format[index] !== "&" || format[index + 1] !== "[") {
      const code = format.codePointAt(index)!;
      const count = code > 0xffff ? 2 : 1;
      append(format.slice(index, index + count)); index += count;
      continue;
    }
    const start = index + 2;
    index = start;
    while (index < format.length && format[index] !== "]" && format[index] !== "\0") { tick(); index++; }
    if (index === format.length || format[index] === "\0") break;
    const operation = format.slice(start, index++);
    const colon = operation.indexOf(":");
    // These are the full Unicode casefold expansions that can occur in the
    // English native opcode names. Lowercasing alone misses long s and fi.
    const name = (colon < 0 ? operation : operation.slice(0, colon)).toLowerCase()
      .replaceAll("ſ", "s").replaceAll("ﬁ", "fi");
    const args = colon < 0 ? undefined : operation.slice(colon + 1);
    switch (name) {
      case "tab": append(info.sheetName); break;
      case "page": append(String(info.page)); break;
      case "pages": append(String(info.pages)); break;
      case "file": append(info.filename); break;
      case "path": append(info.path); break;
      case "title": append(info.title); break;
      case "date": case "time": {
        const timestamp = info.timestamp;
        if (!timestamp || !Number.isFinite(timestamp.serial) || !["1900", "1904"].includes(timestamp.dateSystem))
          throw new SsconvertError("invalid-request", "Missing or invalid ssconvert print timestamp metadata");
        append(timestamp.format(timestamp.serial, args ?? (name === "date" ? "dd-mmm-yyyy" : "hh:mm"), timestamp.dateSystem));
        break;
      }
      case "cell": {
        if (!info.cell) throw new SsconvertError("invalid-request", "Missing ssconvert print cell metadata");
        const repeating = args?.startsWith("rep|") ?? false;
        append(info.cell(repeating ? args!.slice(4) : args ?? "", repeating));
        break;
      }
    }
  }
  tick();
  return parts.join("");
}
