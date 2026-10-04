import type { UnsupportedRecord, Workbook } from "@poe-code/spreadsheet-ast";
import { metadataNode, type ElementWriter } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { xlsxNamespaces } from "./xlsx-schema.js";

const fields = new Set(["workbookPassword", "workbookPasswordCharacterSet", "revisionsPassword", "revisionsPasswordCharacterSet",
  "lockStructure", "lockWindows", "lockRevision", "revisionsAlgorithmName", "revisionsHashValue", "revisionsSaltValue",
  "revisionsSpinCount", "workbookAlgorithmName", "workbookHashValue", "workbookSaltValue", "workbookSpinCount"]);

/** Preserve the document's protection settings without interpreting password algorithms. */
export function writeXlsxWorkbookProtection(book: Workbook, xml: ElementWriter, charge: (amount?: number) => void) {
  const handled = new Set<UnsupportedRecord>();
  let content = "";
  for (const record of book.unsupportedRecords ?? []) {
    charge();
    if (content || record.kind !== "workbookProtection") continue;
    const node = metadataNode(record.data, charge);
    if (!node || node.name !== "workbookProtection" || !xlsxNamespaces.XL_NS_SS!.includes(node.namespace)) continue;
    const attributes: Record<string, string> = {};
    let complete = !node.children.length && !node.text.trim();
    for (const [name, value] of Object.entries(node.attributes)) {
      charge();
      if (fields.has(name)) attributes[name] = value;
      else complete = false;
    }
    content = xml("workbookProtection", attributes);
    if (complete) handled.add(record);
  }
  if (!content) {
    const attributes: Record<string, string> = {};
    const biffFields: Readonly<Record<string, readonly [number, string]>> = {
      PROTECT: [0x12, "lockStructure"], WINDOWPROTECT: [0x19, "lockWindows"], PASSWORD: [0x13, "workbookPassword"]
    };
    for (const record of book.unsupportedRecords ?? []) {
      charge();
      if (record.source !== "biff" || !Object.hasOwn(biffFields, record.kind)) continue;
      const [opcode, name] = biffFields[record.kind]!;
      const data = record.data as { opcode?: unknown; bytes?: unknown } | undefined;
      if (Array.isArray(data) || data?.opcode !== opcode || typeof data.bytes !== "string") continue;
      const bytes = data.bytes;
      if (opcode === 0x12 ? bytes.length > 4 || bytes.length % 2 !== 0 : bytes.length !== 4) continue;
      charge(bytes.length);
      if (![...bytes].every(character => "0123456789abcdefABCDEF".includes(character))) continue;
      const value = bytes.length < 4 ? 1 : Number.parseInt(bytes.slice(2) + bytes.slice(0, 2), 16);
      if (opcode === 0x13) {
        if (value) attributes[name] = value.toString(16).toUpperCase().padStart(4, "0");
        else delete attributes[name];
      } else attributes[name] = value === 1 ? "1" : "0";
      handled.add(record);
    }
    if (handled.size) content = xml("workbookProtection", attributes);
  }
  return { content, handled };
}
