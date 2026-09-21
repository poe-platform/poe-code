import type { DocumentBudget } from "./budget.js";
import type { XmlElement } from "./package-xml.js";
import { paragraphTextRun, replaceParagraphContent } from "./paragraph-content.js";
import { runElementOpen } from "./run-properties.js";
import { paragraphTextHistory } from "./revision-markup.js";
import type { TextContentAssignment } from "./text-raster-content.js";
import { activeXmlChildren } from "./xml-active-children.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";

/** Replace native cell blocks; preserve properties, inert owners and annotation ranges. */
export function replaceCellContent(xml: DocumentXmlEditor, cell: XmlElement, text: string, budget: DocumentBudget, raster: TextContentAssignment, properties?: string): string {
  const children = activeXmlChildren(xml, budget), active = children(cell);
  const containers = active.filter(node => node.namespace === cell.namespace && node.localName === "tcPr");
  if (containers.length > 1) throw new UnsupportedEditError("Whole cell text requires one owning property container.");
  // Complex field ranges may begin outside the selected cell. Inactive branches
  // are not field instructions in the active story.
  const storyNames = new Set(["body", "hdr", "ftr", "footnote", "endnote", "comment", "txbxContent"]);
  let story = xml.root, inSimpleField = false;
  const pendingOwners = [{ node: xml.root, owner: xml.root, simple: false }];
  while (pendingOwners.length) {
    const frame = pendingOwners.pop()!, node = frame.node;
    let { owner, simple } = frame;
    budget.charge("work", 1);
    if (node.namespace === cell.namespace && storyNames.has(node.localName)) owner = node;
    simple ||= node.namespace === cell.namespace && node.localName === "fldSimple";
    if (node === cell) { story = owner; inSimpleField = simple; break; }
    const active = children(node);
    for (let index = active.length - 1; index >= 0; index--) pendingOwners.push({ node: active[index]!, owner, simple });
  }
  let depth = 0;
  const preceding = [story];
  while (preceding.length) {
    const node = preceding.pop()!;
    budget.charge("work", 1);
    if (node === cell) break;
    if (node !== story && node.namespace === cell.namespace && storyNames.has(node.localName)) continue;
    if (node.namespace === cell.namespace && node.localName === "fldChar") {
      const kind = node.attributes.find(attribute => attribute.namespace === cell.namespace && attribute.localName === "fldCharType")?.value;
      if (kind === "begin") depth++;
      if (kind === "end") depth--;
    }
    const active = children(node);
    for (let index = active.length - 1; index >= 0; index--) preceding.push(active[index]!);
  }
  if (depth > 0 || inSimpleField) throw new UnsupportedEditError("Cell text replacement cannot edit content inside a field range.");
  const contents: (XmlElement | string)[] = [], blocks: XmlElement[] = [];
  const markers = new Set(["bookmarkStart", "bookmarkEnd", "commentRangeStart", "commentRangeEnd", "proofErr", "permStart", "permEnd"]);
  const propertyNames = (node: XmlElement): string[] => node.localName === "tbl" ? ["tblPr", "tblGrid"] : node.localName === "tr" ? ["trPr"] : ["tcPr"];
  const assertNative = (root: XmlElement): void => {
    const pending = [{ node: root, scopes: 1, blocks: true }];
    while (pending.length) {
      const { node, scopes, blocks } = pending.pop()!;
      // Each collected table previously rechecked its entire physical subtree.
      // Keep those conservative work reservations without repeated traversal.
      budget.charge("work", scopes);
      if (!xml.compatibility.canEdit(node) || node.attributes.some(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/" && !xml.compatibility.canEdit(attribute)))
        throw new UnsupportedEditError("Whole cell text cannot discard opaque table ownership.");
      const nativeBlocks = blocks && node.namespace === cell.namespace && ["tbl", "tr", "tc"].includes(node.localName);
      const properties = propertyNames(node);
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index]!, block = nativeBlocks && !(child.namespace === cell.namespace && properties.includes(child.localName));
        pending.push({ node: child, scopes: scopes + (block && child.namespace === cell.namespace && child.localName === "tbl" ? 1 : 0), blocks: block });
      }
    }
  };
  const pending: ({ node: XmlElement; validated: boolean; property?: boolean } | { text: string })[] = [];
  const collect = (root: XmlElement): void => {
    pending.push({ node: root, validated: false });
    while (pending.length) {
      const item = pending.pop()!;
      if ("text" in item) { contents.push(item.text); continue; }
      const { node } = item;
      if (item.property) {
        const properties = [node];
        while (properties.length) {
          const property = properties.pop()!;
          budget.charge("work", 1);
          if (property.localName.endsWith("Change") || ["ins", "del", "cellIns", "cellDel", "cellMerge"].includes(property.localName))
            throw new UnsupportedEditError("Whole cell text cannot discard review history.");
          for (let index = property.children.length - 1; index >= 0; index--) properties.push(property.children[index]!);
        }
        continue;
      }
      budget.charge("work", 1);
      if (node.namespace !== cell.namespace) throw new UnsupportedEditError("Whole cell text cannot discard opaque blocks.");
      if (node.localName === "p") { contents.push(node); continue; }
      if (markers.has(node.localName)) { contents.push(runElementOpen(node) + xml.sourceXml(node, new Map(), true) + `</${node.name}>`); continue; }
      if (!["tbl", "tr", "tc"].includes(node.localName)) throw new UnsupportedEditError("Whole cell text requires native paragraph or table blocks.");
      // A removed table cannot carry inactive content or extension semantics to a
      // different owner. The final XML retention guard also checks physical scope.
      if (node.localName === "tbl" && !item.validated) assertNative(node);
      const validated = item.validated || node.localName === "tbl", properties = propertyNames(node);
      for (let index = node.content.length - 1; index >= 0; index--) {
        const child = node.content[index]!;
        if (child.kind === "comment") { pending.push({ text: "<!--" + child.text + "-->" }); continue; }
        if (child.kind === "processing-instruction") { pending.push({ text: "<?" + child.target + (child.text ? " " + child.text : "") + "?>" }); continue; }
        if (child.kind !== "element") { if (child.text.trim()) throw new UnsupportedEditError("Whole cell text cannot discard table scalars."); continue; }
        pending.push({ node: child, validated, property: child.namespace === cell.namespace && properties.includes(child.localName) });
      }
    }
  };
  for (const child of active) if (!containers.includes(child)) { blocks.push(child); collect(child); }
  const history = paragraphTextHistory(xml.root, contents.filter((item): item is XmlElement => typeof item !== "string"), children, budget);
  const patches = new Map<XmlElement, string>();
  let paragraph = "";
  let prefix = "", assigned = false;
  for (const item of contents) {
    if (typeof item === "string") {
      if (!paragraph) prefix += item;
      else { const end = paragraph.lastIndexOf("</"); paragraph = paragraph.slice(0, end) + item + paragraph.slice(end); }
      continue;
    }
    const retained = replaceParagraphContent(xml, item, "", assigned ? "" : text, budget, raster, history);
    assigned = true;
    if (!paragraph) { paragraph = retained; const start = paragraph.indexOf(">") + 1; paragraph = paragraph.slice(0, start) + prefix + paragraph.slice(start); }
    else {
      const fragment = new DocumentXmlEditor(new TextEncoder().encode(retained), {}, undefined, budget);
      const scope = new Map(fragment.root.children.map(child => [child,
        runElementOpen(child) + fragment.sourceXml(child, new Map(), true) + `</${child.name}>`]));
      const end = paragraph.lastIndexOf("</");
      paragraph = paragraph.slice(0, end) + fragment.sourceXml(fragment.root, scope, true) + paragraph.slice(end);
    }
  }
  if (!paragraph) paragraph = `<cc:p xmlns:cc="${cell.namespace}">${prefix}${paragraphTextRun(cell.namespace, text)}</cc:p>`;
  else {
    const fragment = new DocumentXmlEditor(new TextEncoder().encode(paragraph), {}, undefined, budget);
    if (!activeXmlChildren(fragment, budget)(fragment.root).some(node => node.namespace === cell.namespace && node.localName === "r")) {
      const end = paragraph.lastIndexOf("</");
      paragraph = paragraph.slice(0, end) + paragraphTextRun(cell.namespace, "") + paragraph.slice(end);
    }
  }
  const fragment = new DocumentXmlEditor(new TextEncoder().encode(paragraph), {}, undefined, budget);
  const projected = activeXmlChildren(fragment, budget), runs = projected(fragment.root).filter(node => node.namespace === cell.namespace && node.localName === "r");
  if (runs.some(run => projected(run).some(node => node.namespace === cell.namespace && node.localName === "commentReference"))) {
    if (runs.some(run => run.attributes.some(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/") || run.children.some(node => node.namespace !== cell.namespace)))
      throw new UnsupportedEditError("Cell text cannot relocate an opaque reference owner.");
    const content = runs.flatMap(run => run.children.filter(node => node.localName !== "rPr")).map(node => runElementOpen(node) + fragment.sourceXml(node, new Map(), true) + `</${node.name}>`).join("");
    const merged = `<cc:r xmlns:cc="${cell.namespace}">${content}</cc:r>`;
    paragraph = runElementOpen(fragment.root) + fragment.sourceXml(fragment.root, new Map(runs.map((run, index) => [run, index ? "" : merged])), true) + `</${fragment.root.name}>`;
  }
  blocks.forEach((block, index) => patches.set(block, index ? "" : paragraph));
  if (containers[0] && properties !== undefined) patches.set(containers[0], properties);
  return runElementOpen(cell) + (containers.length ? "" : properties ?? "") + xml.sourceXml(cell, patches, true) + (blocks.length ? "" : paragraph) + `</${cell.name}>`;
}
