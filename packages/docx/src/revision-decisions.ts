import { archiveSettings } from "./archive.js";
import { validateDocxInvocation } from "./command.js";
import { xmlValue } from "./create-content.js";
import { assertOutsideFields, parseFields } from "./field-parser.js";
import { pathContains } from "./location-index.js";
import { closedRecord, encodeLocation, type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { DocumentArchiveEditor } from "./package-write.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { assertOutsideRevisionRanges, containsRevision, revisionInfo, type RevisionInfo } from "./revision-markup.js";
import { inspectDocumentRevisions } from "./revisions.js";
import { UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";

export type RevisionDecisionRequest = { [K in "revisions.accept" | "revisions.reject"]: {
  readonly operation: K; readonly options: DocxOperationArguments<K>; readonly input?: PublicationInput;
} }["revisions.accept" | "revisions.reject"];
export interface RevisionDecisionData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "replace" | "remove"; readonly before: Location; readonly after: Location | null; readonly revision: RevisionInfo }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}
function opening(node: XmlElement, name = node.name, inherited?: ReadonlyMap<string, string>): string {
  const lifted = inherited === undefined ? "" : [...inherited].filter(([field]) => !node.attributes.some(attribute => attribute.namespace === "http://www.w3.org/XML/1998/namespace" && attribute.localName === field)).map(([field, value]) => ` xml:${field}="${xmlValue(value)}"`).join("");
  return `<${name}${[...node.namespaces].filter(([prefix]) => prefix !== "xml").map(([prefix, uri]) => ` ${prefix ? "xmlns:" + prefix : "xmlns"}="${xmlValue(uri)}"`).join("")}${node.attributes.filter(a => a.namespace !== "http://www.w3.org/2000/xmlns/").map(a => ` ${a.name}="${xmlValue(a.value)}"`).join("")}${lifted}>`;
}
/** A revision decision is a bounded mutation of admitted owners, never an implicit review policy. */
export async function editDocumentRevisionDecisions(input: Uint8Array, request: RevisionDecisionRequest, context: PublicationContext): Promise<RevisionDecisionData> {
  closedRecord(request, ["operation", "options", "input"]);
  if (!["revisions.accept", "revisions.reject"].includes(request.operation)) throw new UnsupportedEditError("Expected an explicit revision decision.");
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: request.operation, inputs: [request.input?.path ?? "document"], options: request.options }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"revisions.accept">;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const { output, inPlace, force, dryRun, json, all, allowEmpty, ...selection } = opts;
  delete selection.limit;
  if (selection.select !== undefined && document.resolve(selection.select).value.range !== null) throw new UnsupportedEditError("Revision decisions require whole owner selections.");
  const inventory = await inspectDocumentRevisions(input, selection, { ...settings, budget });
  const selected = document.select(inventory.items.map(item => item.location), { ...(all === undefined ? {} : { all }), ...(allowEmpty === undefined ? {} : { allowEmpty }) }, "mutation");
  const archive = document.snapshot(); assertDocumentEditable(archive, { ...settings, budget });
  const editor = new DocumentArchiveEditor(archive, {}, undefined, budget);
  const candidates: { xml: DocumentXmlEditor; node: XmlElement; target: XmlElement; replacement: string; change: RevisionDecisionData["changes"][number] }[] = [];
  for (const location of selected) {
    budget.charge("work", selected.length + location.value.path.length);
    if (selected.some(other => other.token !== location.token && other.value.story === location.value.story &&
      (pathContains(other.value.path, location.value.path) || pathContains(location.value.path, other.value.path)))) throw new UnsupportedEditError("Nested revision decisions are not supported.");
    if (document.references(location.token).length > 1) throw new UnsupportedEditError("Shared revision owners require an unambiguous binding.");
    const xml = editor.xml(location.value.part.slice(1));
    let node = xml.root; const ancestors = [node];
    for (const index of location.value.path) { node = node.children[index]!; ancestors.push(node); }
    const parent = ancestors.at(-2)!; const w = node.namespace; const info = revisionInfo(node);
    const inherited = new Map<string, string>();
    for (const ancestor of ancestors) for (const attribute of ancestor.attributes) if (attribute.namespace === "http://www.w3.org/XML/1998/namespace") {
      if (["lang", "space"].includes(attribute.localName)) inherited.set(attribute.localName, attribute.value);
      else if (ancestor === node) throw new UnsupportedEditError("This revision carries unsupported inherited XML semantics.");
    }
    if (!info || info.support !== "supported" || !["insert", "delete", "format"].includes(info.type) ||
      ancestors.slice(0, -1).some(ancestor => revisionInfo(ancestor) || ["sdt", "fldSimple", "hyperlink", "customXml"].includes(ancestor.localName)))
      throw new UnsupportedEditError("This revision owner has no verified decision semantics.");
    const structuralReview = (current: XmlElement): boolean => {
      budget.charge("work", 1);
      if (current === node) return false;
      const review = revisionInfo(current);
      return review !== undefined && (review.type !== "format" || review.support === "opaque") || current.children.some(structuralReview);
    };
    if (ancestors.some(ancestor => ancestor.children.some(properties => properties.namespace === w &&
      ["pPr", "trPr", "tcPr", "tblPr", "sectPr"].includes(properties.localName) && structuralReview(properties)))) throw new UnsupportedEditError("Structural property revisions overlap this decision.");
    const descendants = (current: XmlElement): void => {
      budget.charge("work", 1);
      if (current !== node && revisionInfo(current)) throw new UnsupportedEditError("Nested revision owners cannot be decided implicitly.");
      if (!xml.compatibility.canEdit(current) || current.attributes.some(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/" && !xml.compatibility.canEdit(attribute))) throw new UnsupportedEditError("Opaque revision content cannot be changed.");
      for (const content of current.content) if (content.kind !== "element" && (content.kind !== "text" || [...content.text].some(char => char !== " " && char !== "\t" && char !== "\r" && char !== "\n") && !["t", "delText"].includes(current.localName))) throw new UnsupportedEditError("Revision content contains unsupported lexical boundaries.");
      for (const child of current.children) descendants(child);
    };
    descendants(node);
    assertOutsideRevisionRanges(xml.root, node, budget, xml.compatibility.branches);
    const story = document.list("story", { scope: "all-stories" }).filter(owner => owner.value.story === location.value.story && pathContains(owner.value.path, location.value.path)).sort((a, b) => b.value.path.length - a.value.path.length)[0];
    if (!story) throw new UnsupportedEditError("Revision decisions require an admitted story owner.");
    assertOutsideFields(parseFields(ancestors[story.value.path.length]!, story.value.path, budget, xml.compatibility.content), location.value.path);
    let target = node, replacement = "", removed = false;
    if (info.type === "format") {
      const propertyName = node.localName === "rPrChange" ? "rPr" : "pPr";
      if (parent.localName !== propertyName || parent.namespace !== w || ancestors.at(-3)?.localName !== (propertyName === "rPr" ? "r" : "p")) throw new UnsupportedEditError("Formatting history requires a direct run or paragraph owner.");
      const current = opening(parent) + xml.sourceXml(parent, new Map([[node, ""]]), true) + `</${parent.name}>`;
      const admitted = parseDocumentXml(new TextEncoder().encode(`<d:${node.localName} xmlns:d="${xmlValue(w)}">${current}</d:${node.localName}>`), {}, budget).root;
      if (revisionInfo(admitted)?.support !== "supported") throw new UnsupportedEditError("Compound current properties have no verified rollback semantics.");
      target = parent;
      replacement = request.operation === "revisions.accept" ? current : opening(node.children[0]!, node.children[0]!.name, inherited) + xml.sourceXml(node.children[0]!, new Map(), true) + `</${node.children[0]!.name}>`;
    } else {
      if (parent.localName !== "p" || parent.namespace !== w || !node.children.length || node.children.some(run => run.namespace !== w || run.localName !== "r" ||
        run.children.some(child => child.namespace !== w || !["rPr", "t", "delText", "tab", "br", "cr"].includes(child.localName) || info.type === "insert" && child.localName === "delText" || child.localName === "br" && child.attributes.some(a => a.localName === "type" && a.value !== "textWrapping")))) throw new UnsupportedEditError("Only ordinary inline text revisions support decisions.");
      if (ancestors.some(ancestor => ancestor.children.some(child => child.namespace === w && ["pPr", "trPr", "tcPr", "tblPr", "sectPr"].includes(child.localName) && containsRevision(child)))) throw new UnsupportedEditError("Structural or overlapping property revisions require independent support.");
      removed = request.operation === "revisions.accept" ? info.type === "delete" : info.type === "insert";
      if (!removed) {
        for (const run of node.children) {
          const patches = new Map<XmlElement, string>();
          if (info.type === "delete") for (const child of run.children) if (child.localName === "delText") {
            const name = child.name.includes(":") ? child.name.slice(0, child.name.indexOf(":") + 1) + "t" : "t";
            patches.set(child, opening(child, name) + xmlValue(child.text) + `</${name}>`);
          }
          replacement += opening(run, run.name, inherited) + xml.sourceXml(run, patches, true) + `</${run.name}>`;
        }
      }
    }
    const owner = document.list("paragraph", { scope: "all-stories" }).find(paragraph => paragraph.value.story === location.value.story && pathContains(paragraph.value.path, location.value.path));
    const after = owner ? (() => { const value = { ...owner.value, generation: 1 }; return { ...owner, value, token: encodeLocation(value) }; })() : null;
    candidates.push({ xml, node, target, replacement, change: { kind: removed ? "remove" : "replace", before: location, after, revision: info } });
  }
  const changes = candidates.map(candidate => candidate.change);
  const prospective = { changed: candidates.length > 0, changes, output: dryRun ? null : { path: inPlace ? request.input?.path ?? null : output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) }, dryRun: dryRun ?? false };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: request.operation, ok: true, data: prospective, affected: changes.length, locations: changes.flatMap(change => change.after ? [change.after] : []), warnings: [], errors: [] }) + "\n").length);
  for (const candidate of candidates) candidate.xml.replaceElement(candidate.target, candidate.replacement);
  const result = await publishDocumentArchive(editor.snapshot(), { ...(request.input ? { input: request.input } : {}), ...(output === undefined ? {} : { output }), ...(inPlace === undefined ? {} : { inPlace }), ...(force === undefined ? {} : { force }), ...(dryRun === undefined ? {} : { dryRun }), ...(json === undefined ? {} : { json }) }, { ...context, budget });
  return { ...prospective, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
