import { archiveSettings, CancellationError, ResourceLimitError } from "./archive.js";
import { validateDocxInvocation } from "./command.js";
import type { DocumentBudget } from "./budget.js";
import { inspectControlSnapshot, inspectDocumentControls, prepareControlValue, type ControlSnapshot } from "./controls.js";
import type { ControlTemplateData } from "./control-template-types.js";
import { assertOutsideFields, parseFields } from "./field-parser.js";
import { pathContains } from "./location-index.js";
import { closedRecord, encodeLocation, SelectionError, type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { DocumentPackage } from "./package.js";
import { DocumentArchiveEditor } from "./package-write.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { assertOutsideRevisionRanges, containsRevision } from "./revision-markup.js";
import { UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";

const relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const datastore = "http://schemas.openxmlformats.org/officeDocument/2006/customXml";
const schema = "http://www.w3.org/2001/XMLSchema";
const instance = "http://www.w3.org/2001/XMLSchema-instance";
function reject(): never { throw new UnsupportedEditError("Binding requires a singleton admitted store, selector and complete unlocked recipient set."); }
function chain(root: XmlElement, path: readonly number[]): XmlElement[] { const result = [root]; for (const index of path) result.push(result.at(-1)!.children[index]!); return result; }
function expanded(name: string, namespaces: ReadonlyMap<string, string>, budget: DocumentBudget): readonly [string, string] {
  const pieces = name.split(":"); if (pieces.length > 2 || pieces.some(piece => !piece)) reject();
  // The XML parser validates QName spelling without an XPath engine.
  try { parseDocumentXml(new TextEncoder().encode(`<${name}${pieces.length === 2 ? ` xmlns:${pieces[0]}="urn:validation"` : ""}/>`), {}, budget); } catch (error) { if (error instanceof ResourceLimitError || error instanceof CancellationError) throw error; reject(); }
  if (pieces.length === 1) return ["", name];
  const namespace = namespaces.get(pieces[0]!); if (!namespace) reject(); return [namespace, pieces[1]!];
}
interface Target { readonly part: string; readonly xml: DocumentXmlEditor; readonly leaf: XmlElement; readonly key: string; readonly scalar: string; }
export async function editDocumentControlBindings(input: Uint8Array, options: DocxOperationArguments<"controls.bind"> & { input?: PublicationInput }, context: PublicationContext): Promise<ControlTemplateData> {
  const settings = archiveSettings(context); const { input: identity, ...args } = options; closedRecord(options, [...Object.keys(args), "input"]);
  const opts = validateDocxInvocation({ operation: "controls.bind", inputs: [identity?.path ?? "document"], options: args }, settings.budget).options as DocxOperationArguments<"controls.bind">;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const bounded = { ...settings, budget }; const document = await openDocumentLocations(input, bounded); const archive = document.snapshot();
  const editor = new DocumentArchiveEditor(archive, {}, undefined, budget); const pkg = new DocumentPackage(archive, settings.limits, budget);
  const owners = pkg.parts.filter(part => part.content_type !== "application/vnd.openxmlformats-package.relationships+xml" && part.partname !== "/[Content_Types].xml");
  const { binding, valueJson, output, inPlace, force, dryRun, json, all, allowEmpty, limit: ignoredLimit, ...selectors } = opts;
  const selected = (await inspectDocumentControls(input, selectors, bounded)).items;
  const chosen = document.select(selected.map(item => item.location), { ...(all === undefined ? {} : { all }), ...(allowEmpty === undefined ? {} : { allowEmpty }) }, "mutation");
  const admitted = new Set(chosen.map(location => location.token));
  const allItems = (await inspectDocumentControls(input, { scope: "all-stories" }, bounded)).items;
  const targets = new Map<string, Target>();
  const resolve = (item: ControlSnapshot): Target => {
    const descriptor = item.binding; if (!descriptor?.storeItemId || !descriptor.xpath) reject();
    let mappings: XmlElement; try { mappings = parseDocumentXml(new TextEncoder().encode(`<mapping ${descriptor.prefixMappings ?? ""}/>`), {}, budget).root; } catch (error) { if (error instanceof ResourceLimitError || error instanceof CancellationError) throw error; reject(); }
    if (mappings.attributes.some(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/")) reject();
    if (!descriptor.xpath.startsWith("/")) reject();
    const steps = descriptor.xpath.slice(1).split("/").map(name => expanded(name, mappings.namespaces, budget));
    const stores = owners.filter(part => pkg.relationships(part.partname).some(edge => {
      if (edge.reltype !== relationships + "customXmlProps") return false;
      if (edge.is_external) return false;
      const root = editor.xml(edge.target_part.partname.slice(1)).root;
      return root.namespace === datastore && root.localName === "datastoreItem" && root.attributes.some(attribute => attribute.namespace === datastore && attribute.localName === "itemID" && attribute.value.toLowerCase() === descriptor.storeItemId!.toLowerCase());
    }));
    if (stores.length !== 1) reject(); const part = stores[0]!;
    const edges = owners.flatMap(owner => pkg.relationships(owner.partname)).filter(edge => edge.reltype === relationships + "customXml" && !edge.is_external && edge.target_part.partname === part.partname);
    if (!edges.length || pkg.relationships(part.partname).filter(edge => edge.reltype === relationships + "customXmlProps").length !== 1) reject();
    const xml = editor.xml(part.partname.slice(1)); let leaf = xml.root;
    for (let index = 0; index < steps.length; index++) { const [namespace, localName] = steps[index]!; const nodes = (index ? leaf.children : [leaf]).filter(node => node.namespace === namespace && node.localName === localName); if (nodes.length !== 1) reject(); leaf = nodes[0]!; }
    if (leaf.content.some(node => node.kind !== "text" && node.kind !== "cdata")) reject();
    const type = leaf.attributes.find(attribute => attribute.namespace === instance && attribute.localName === "type");
    let scalar = item.kind === "checkbox" ? "boolean" : "string";
    if (type) { const [namespace, localName] = expanded(type.value, leaf.namespaces, budget); if (namespace !== schema || !["string", "boolean", "integer", "double"].includes(localName)) reject(); scalar = localName; }
    if (scalar === "boolean" ? item.kind !== "checkbox" : scalar === "integer" || scalar === "double" ? !["plain-text", "rich-text"].includes(item.kind) : !["plain-text", "rich-text", "dropdown", "combo-box", "date"].includes(item.kind)) scalar = "unsupported";
    return { part: part.partname, xml, leaf, key: JSON.stringify([part.partname, steps]), scalar };
  };
  const declarations = selected.filter(item => admitted.has(item.location.token) && item.tag === binding);
  if (!declarations.length) throw new SelectionError("missing-selection");
  for (const item of allItems.filter(item => item.tag === binding)) { const target = resolve(item); targets.set(target.key + target.scalar, target); }
  if (targets.size !== 1) throw new SelectionError("ambiguous-selection"); const target = [...targets.values()][0]!;
  const recipients: ControlSnapshot[] = [];
  for (const item of allItems) if (item.binding) {
    let candidate: Target;
    try { candidate = resolve(item); } catch (error) {
      if (!(error instanceof UnsupportedEditError)) throw error;
      if (item.binding.storeItemId?.toLowerCase() === declarations[0]!.binding!.storeItemId?.toLowerCase()) reject();
      continue;
    }
    if (candidate.key === target.key) { if (candidate.scalar !== target.scalar || !admitted.has(item.location.token)) reject(); recipients.push(item); }
  }
  if (target.scalar === "string" ? typeof valueJson !== "string" : target.scalar === "boolean" ? typeof valueJson !== "boolean" : typeof valueJson !== "number" || !Number.isFinite(valueJson) || target.scalar === "integer" && !Number.isSafeInteger(valueJson)) reject();
  const lexical = String(valueJson); const stages: (() => void)[] = [];
  assertDocumentEditable(archive, bounded, archive);
  for (const item of recipients) {
    const location = item.location, xml = editor.xml(location.value.part.slice(1)); const ancestors = chain(xml.root, location.value.path), node = ancestors.at(-1)!;
    if (item.support !== "supported" || item.lock !== "unlocked" || document.references(location.token).length > 1 || containsRevision(node) || ancestors.slice(0, -1).some(owner => owner.namespace === node.namespace && ["ins", "del", "moveFrom", "moveTo"].includes(owner.localName))) reject();
    for (const owner of ancestors.slice(0, -1)) if (owner.namespace === node.namespace && owner.localName === "sdt") { const snapshot = inspectControlSnapshot(owner, location, archive, bounded, xml); if (snapshot.support !== "supported" || snapshot.lock !== "unlocked" || snapshot.binding) reject(); }
    const story = document.list("story", { scope: "all-stories" }).filter(owner => owner.value.story === location.value.story && pathContains(owner.value.path, location.value.path)).sort((a, b) => b.value.path.length - a.value.path.length)[0]; if (!story) reject();
    assertOutsideFields(parseFields(ancestors[story.value.path.length]!, story.value.path, budget, xml.compatibility.content), location.value.path); assertOutsideRevisionRanges(xml.root, node, budget, xml.compatibility.branches);
    const values = item.kind === "checkbox" ? { checked: valueJson as boolean } : item.kind === "date" ? { date: lexical } : ["dropdown", "combo-box"].includes(item.kind) ? { choice: lexical } : { text: lexical };
    stages.push(prepareControlValue(xml, node, item, values, bounded));
  }
  const changes = recipients.map(item => { const before: Location = item.location, value = { ...before.value, generation: 1 }; return { kind: "replace" as const, before, after: { ...before, value, token: encodeLocation(value) } }; });
  const prospective = { changed: true, changes, output: dryRun ? null : { path: inPlace ? identity?.path ?? null : output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) }, dryRun: dryRun ?? false };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: "controls.bind", ok: true, data: prospective, affected: changes.length, locations: changes.map(change => change.after), warnings: [], errors: [] }) + "\n").length);
  // Rewrite scalar tokens without touching namespace declarations or opaque siblings.
  target.xml.replaceScalarText(target.leaf, lexical);
  for (const stage of stages) stage();
  const published = await publishDocumentArchive(editor.snapshot(), { ...(identity ? { input: identity } : {}), ...(output === undefined ? {} : { output }), ...(inPlace === undefined ? {} : { inPlace }), ...(force === undefined ? {} : { force }), ...(dryRun === undefined ? {} : { dryRun }), ...(json === undefined ? {} : { json }) }, { ...context, budget }, archive);
  return { ...prospective, output: published.published.length ? { path: published.published[0]!.path, bytes: published.published[0]!.bytes, sha256: published.archiveSha256! } : null };
}
