import type { Workbook } from "@poe-code/spreadsheet-ast";
import { escapeXlsx, metadataNode, type ElementWriter, type MetadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { xlsxNamespaces } from "./xlsx-schema.js";

/** Only self-contained themes can be copied without their unretained relationships. */
export function writeXlsxTheme(book: Workbook, xml: ElementWriter, charge: (amount?: number) => void) {
  for (const record of book.unsupportedRecords ?? []) {
    charge();
    if (record.kind !== "theme") continue;
    const root = metadataNode(record.data, charge);
    if (!root || root.name !== "theme" || !xlsxNamespaces.XL_NS_DRAW!.includes(root.namespace)) continue;
    const pending = [root];
    let supported = true;
    while (pending.length) {
      charge();
      const node = pending.pop()!;
      if (node.namespace !== root.namespace) { supported = false; break; }
      for (const name of Object.keys(node.attributes)) {
        charge(name.length);
        if (name === "xmlns" || name.includes(":") && name !== "xml:space" && name !== "xml:lang") supported = false;
      }
      if (!supported) break;
      for (const child of node.children) pending.push(child);
    }
    if (!supported) continue;
    const stack: { node: MetadataNode; expanded: boolean }[] = [{ node: root, expanded: false }];
    const rendered = new Map<MetadataNode, string>();
    while (stack.length) {
      charge();
      const item = stack.pop()!;
      if (!item.expanded) {
        stack.push({ ...item, expanded: true });
        for (let index = item.node.children.length - 1; index >= 0; index--)
          stack.push({ node: item.node.children[index]!, expanded: false });
        continue;
      }
      const content = escapeXlsx(item.node.text) + item.node.children.map(child => rendered.get(child)!).join("");
      rendered.set(item.node, xml(item.node.name, item.node === root ? { xmlns: root.namespace, ...item.node.attributes } : item.node.attributes, content));
      for (const child of item.node.children) rendered.delete(child);
    }
    return { record, content: rendered.get(root)! };
  }
  return undefined;
}
