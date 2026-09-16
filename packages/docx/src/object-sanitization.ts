import { archiveSettings, type DocumentArchive } from "./archive.js";
import { readDocumentArchive } from "./admission.js";
import { inspectDocumentObjects } from "./objects.js";
import { DocumentArchiveEditor } from "./package-write.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import { documentDialects } from "./dialect.js";
import { documentCompatibilityProfile } from "./compatibility.js";
import { DocumentPackage } from "./package.js";
import { assertOutsideFields, parseFields } from "./field-parser.js";
import { assertOutsideRevisionRanges } from "./revision-markup.js";
import { publishDocumentArchive, type PublicationContext } from "./publication.js";

/** Prepares a bounded inert-carrier and unused leaf graph removal without caller I/O. */
export async function prepareObjectSanitization(staged: Uint8Array, context: PublicationContext): Promise<{ readonly archive: DocumentArchive; readonly records: readonly string[]; readonly gaps: readonly string[] }> {
  const settings = archiveSettings(context), budget = settings.budget;
  const records: string[] = [], gaps: string[] = [];
  const inventory = await inspectDocumentObjects(staged, {}, { ...settings, budget });
  const archive = await readDocumentArchive(staged, { ...settings, budget }), editor = new DocumentArchiveEditor(archive, {}, { ...documentCompatibilityProfile, understoodElements: [...documentCompatibilityProfile.understoodElements ?? [], { namespace: "urn:schemas-microsoft-com:office:office", localName: "OLEObject", attributes: [...Object.values(documentDialects).map(d => ({ namespace: d.r, localName: "id" })), ...["Type", "ProgID", "ShapeID", "DrawAspect", "ObjectID", "UpdateMode"].map(localName => ({ namespace: "", localName }))] }] }, budget);
  const targets = new Set<string>();
  for (const item of inventory.items) {
    if (!item.location.value.path.length || !["internal", "external"].includes(item.details.status)) throw new UnsupportedEditError("Unbound or opaque embedded objects cannot be sanitized safely.");
    const xml = editor.xml(item.location.value.part.slice(1));
    let node = xml.root; const ancestors = [node];
    for (const index of item.location.value.path) { node = node.children[index]!; ancestors.push(node); }
    const carrier = ancestors.at(-2)!;
    if (node.namespace !== "urn:schemas-microsoft-com:office:office" || node.localName !== "OLEObject" || node.children.length || node.content.some(content => content.kind !== "text" || content.text.trim()) || carrier.localName !== "object" || !Object.values(documentDialects).some(d => carrier.namespace === d.w) || carrier.children.length !== 1 || ancestors.at(-3)?.localName !== "r" || ancestors.some(n => ["sdt", "ins", "del", "hyperlink", "fldSimple"].includes(n.localName))) throw new UnsupportedEditError("Only direct inert object carriers without previews or compound owners are supported.");
    let storyIndex = -1;
    ancestors.forEach((ancestor, index) => { if (ancestor.namespace === carrier.namespace && ["body", "hdr", "ftr", "footnote", "endnote", "comment", "txbxContent"].includes(ancestor.localName)) storyIndex = index; });
    if (storyIndex < 0) throw new UnsupportedEditError("Object removal requires an admitted story.");
    assertOutsideFields(parseFields(ancestors[storyIndex]!, item.location.value.path.slice(0, storyIndex), budget, xml.compatibility.content), item.location.value.path.slice(0, -1));
    assertOutsideRevisionRanges(xml.root, carrier, budget, xml.compatibility.branches);
    const permissions = new Set<string>();
    const scan = (current: typeof node): void => {
      budget.charge("work", 1);
      if (current === carrier && permissions.size) throw new UnsupportedEditError("Object removal cannot cross a permission boundary.");
      if (current.namespace === carrier.namespace) {
        const id = current.attributes.find(attribute => attribute.namespace === carrier.namespace && attribute.localName === "id")?.value ?? "";
        if (current.localName === "permStart") permissions.add(id);
        if (current.localName === "permEnd") permissions.delete(id);
      }
      current.children.forEach(scan);
    };
    scan(xml.root);
    xml.assertShapeEditAllowed(carrier); xml.replaceElement(carrier, "");
    records.push(item.location.token);
    if (item.details.resource) targets.add(item.details.resource.part);
  }
  let result = editor.snapshot();
  // Remove only unused object bindings; targets survive other incoming references.
  const retired = new Set<string>();
  for (const item of inventory.items) for (const reference of item.references.filter(edge => edge.owner === item.location.value.part && ["oleObject", "package"].some(role => edge.type.endsWith("/" + role)))) {
    const split = reference.owner.lastIndexOf("/"), name = reference.owner.slice(1, split + 1) + "_rels/" + reference.owner.slice(split + 1) + ".rels";
    const owner = editor.xml(reference.owner.slice(1));
    const used = (node: typeof owner.root): boolean => { budget.charge("work", 1); return node.attributes.some(a => Object.values(documentDialects).some(d => a.namespace === d.r) && a.value === reference.id) || node.children.some(used); };
    const current = new DocumentXmlEditor(owner.serialize(), {}, undefined, budget);
    if (!used(current.root)) {
      const rels = editor.xml(name), edge = rels.root.children.find(node => node.attributes.some(a => a.localName === "Id" && a.value === reference.id));
      if (edge) rels.replaceElement(edge, "");
    }
  }
  result = editor.snapshot();
  const packageView = new DocumentPackage(result, settings.limits, budget);
  for (const target of targets) if (!["/", ...packageView.parts.filter(part => !part.content_type.endsWith("relationships+xml")).map(part => part.partname)].some(owner => packageView.relationships(owner).some(edge => !edge.is_external && edge.target_part.partname === target))) {
    if (packageView.relationships(target).length) { gaps.push("Unreferenced embedded targets with outgoing graphs are retained."); continue; }
    retired.add(target.slice(1));
    const split = target.lastIndexOf("/");
    retired.add(target.slice(1, split + 1) + "_rels/" + target.slice(split + 1) + ".rels");
  }
  if (retired.size) {
    const member = result.members.find(member => member.name === "[Content_Types].xml")!, types = new DocumentXmlEditor(member.bytes, {}, undefined, budget);
    for (const node of types.root.children) if (node.localName === "Override" && node.attributes.some(a => a.localName === "PartName" && retired.has(a.value.slice(1)))) types.replaceElement(node, "");
    result = { ...result, members: result.members.filter(member => !retired.has(member.name)).map(current => current === member ? { ...current, bytes: types.serialize() } : current) };
  }
  await publishDocumentArchive(result, { dryRun: true }, { ...settings, budget, encoding: context.encoding }, archive);
  gaps.push("Preview-bearing, compound, unbound and opaque objects reject; shared targets and unrelated payloads are retained.");
  return { archive: result, records, gaps };
}
