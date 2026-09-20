import type { DocumentBudget } from "./budget.js";
import { documentDialects } from "./dialect.js";
import { documentPartRole } from "./document-part-roles.js";
import { parseMediaType } from "./media-type.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import type { PackagePart } from "./package.js";
import { styleAttribute, styleIds } from "./style-properties.js";

/** Reserve stored definitions and references, including inactive branches, without resolving them. */
export function styleAllocationIds(parts: Iterable<PackagePart>, budget: DocumentBudget, parsed?: ReadonlyMap<Uint8Array, XmlElement>): Set<string> {
  const ids = new Set<string>();
  for (const part of parts) {
    budget.charge("work", 1);
    const type = parseMediaType(part.content_type);
    if (!type.startsWith("application/vnd.openxmlformats-officedocument.wordprocessingml.") || !type.endsWith("+xml")) continue;
    const root = parsed?.get(part.bytes) ?? parseDocumentXml(part.bytes, {}, budget).root;
    if (!Object.values(documentDialects).some(dialect => dialect.w === root.namespace)) continue;
    const styles = type === "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml" && root.localName === "styles";
    const numbering = type === "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml" && root.localName === "numbering";
    const role = documentPartRole(type, root);
    if (!styles && !numbering && role !== "story" && role !== "glossary" && role !== "settings") continue;
    if (styles) for (const id of styleIds(root, budget)) ids.add(id);
    const stack = [root];
    while (stack.length) {
      const node = stack.pop()!;
      budget.charge("work", 1 + node.children.length);
      if (node.namespace === root.namespace && ["pStyle", "rStyle", "tblStyle", "basedOn", "next", "link", "styleLink", "numStyleLink", "defaultTableStyle"].includes(node.localName)) {
        const id = styleAttribute(node, "val");
        if (id !== undefined) ids.add(id);
      }
      stack.push(...node.children);
    }
  }
  return ids;
}
