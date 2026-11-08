import { DocumentBudget } from "./budget.js";
import type { ExpandedXmlName } from "./compatibility.js";
import { UnsupportedEditError } from "./xml-write.js";

const w15 = "http://schemas.microsoft.com/office/word/2012/wordml";
/** Enumerates active direct rows and declared native repeat-item rows only. */
export function tableRows<T>(table: T, name: (node: T) => ExpandedXmlName, children: (node: T) => readonly T[], budget: DocumentBudget): T[] {
  const w = name(table).namespace; const result: T[] = [];
  const named = (node: T, localName: string, namespace = w) => children(node).filter(child => name(child).namespace === namespace && name(child).localName === localName);
  const one = (node: T, localName: string) => { const nodes = named(node, localName); if (nodes.length !== 1) throw new UnsupportedEditError("A native row wrapper requires one declared owner."); return nodes[0]!; };
  for (const node of children(table)) {
    budget.charge("work", 1); if (name(node).namespace !== w) continue;
    if (name(node).localName === "tr") result.push(node);
    else if (name(node).localName === "sdt") {
      const properties = named(node, "sdtPr"); if (properties.length !== 1 || named(properties[0]!, "repeatingSection", w15).length !== 1) continue;
      const content = one(node, "sdtContent"), items = children(content); if (!items.length) throw new UnsupportedEditError("A native repeated row requires a reusable item.");
      for (const item of items) {
        budget.charge("work", 1); if (name(item).namespace !== w || name(item).localName !== "sdt") throw new UnsupportedEditError("A native row region contains unsupported items.");
        const properties = one(item, "sdtPr"); if (named(properties, "repeatingSectionItem", w15).length !== 1) throw new UnsupportedEditError("A native row item declaration is missing.");
        const body = one(item, "sdtContent"), rows = children(body); if (rows.length !== 1 || name(rows[0]!).namespace !== w || name(rows[0]!).localName !== "tr") throw new UnsupportedEditError("A native row item requires exactly one row."); result.push(rows[0]!);
      }
    }
  }
  return result;
}
