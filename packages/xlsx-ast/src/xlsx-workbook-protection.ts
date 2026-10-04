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
  return { content, handled };
}
