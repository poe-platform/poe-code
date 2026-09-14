import { archiveSettings, type DocumentArchive } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { validateDocxInvocation } from "./command.js";
import { ControlClonePlanner } from "./control-clone.js";
import type { ControlTemplateData } from "./control-template-types.js";
import { inspectDocumentControls, inspectControlSnapshot, prepareControlValue, prepareControlPlaceholder, type ControlScalarInput, type ControlSnapshot } from "./controls.js";
import { xmlValue } from "./create-content.js";
import { parseFields, assertOutsideFields } from "./field-parser.js";
import { pathContains } from "./location-index.js";
import { encodeLocation, SelectionError, type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import type { DocxBindingRecord, DocxOperationArguments } from "./operation-types.js";
import { DocumentArchiveEditor } from "./package-write.js";
import type { XmlElement } from "./package-xml.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { assertOutsideRevisionRanges, containsRevision } from "./revision-markup.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";

const w15 = "http://schemas.microsoft.com/office/word/2012/wordml";
function elements(node: XmlElement): XmlElement[] { return [node, ...node.children.flatMap(elements)]; }
function child(node: XmlElement, name: string, namespace = node.namespace): XmlElement | undefined { const result = node.children.filter(child => child.namespace === namespace && child.localName === name); if (result.length > 1) throw new UnsupportedEditError("Repeated template declarations are unsupported."); return result[0]; }
function attr(node: XmlElement | undefined, name: string): string | undefined { return node?.attributes.find(attribute => attribute.namespace === node.namespace && attribute.localName === name)?.value; }
function open(node: XmlElement): string { return `<${node.name}${node.attributes.map(attribute => ` ${attribute.name}="${xmlValue(attribute.value)}"`).join("")}>`; }
function fields(item: XmlElement): XmlElement[] { return elements(item).filter(node => node !== item && node.namespace === item.namespace && node.localName === "sdt" && attr(child(child(node, "sdtPr")!, "tag"), "val") !== undefined); }
function shape(item: XmlElement): string {
  const tagged = new Set(fields(item));
  const read = (node: XmlElement): unknown => {
    if (node.namespace === item.namespace && node.localName === "id" || node.namespace === item.namespace && node.localName === "showingPlcHdr") return null;
    const names = node.attributes.filter(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/" && !(["id", "embed"].includes(attribute.localName) && ["bookmarkStart", "bookmarkEnd", "commentRangeStart", "commentRangeEnd", "commentReference", "docPr", "blip"].includes(node.localName) || node.localName === "bookmarkStart" && attribute.localName === "name" || node.localName === "hyperlink" && ["anchor", "id"].includes(attribute.localName) || ["date", "dropDownList", "comboBox"].includes(node.localName) && ["fullDate", "lastValue"].includes(attribute.localName) || node.namespace !== item.namespace && node.localName === "checked" && attribute.localName === "val")).map(attribute => [attribute.namespace, attribute.localName, attribute.value]);
    if (tagged.has(node)) {
      const content = child(node, "sdtContent")!, runs = elements(content).filter(node => node.namespace === item.namespace && node.localName === "r");
      return [node.namespace, node.localName, names, read(child(node, "sdtPr")!), content.children[0]?.localName === "p" ? "paragraph" : "inline", runs[0] ? child(runs[0], "rPr") && read(child(runs[0], "rPr")!) : null];
    }
    return [node.namespace, node.localName, names, node.children.map(read).filter(node => node !== null), node.children.length ? "" : node.text];
  };
  return JSON.stringify(read(item));
}
function scalar(item: ControlSnapshot, value: string | number | boolean): ControlScalarInput {
  if (["plain-text", "rich-text"].includes(item.kind) && typeof value === "string") return { text: value };
  if (item.kind === "checkbox" && typeof value === "boolean") return { checked: value };
  if (["dropdown", "combo-box"].includes(item.kind) && typeof value === "string") return { choice: value };
  if (item.kind === "date" && typeof value === "string") return { date: value };
  throw new DocxUsageError("The record value has a conflicting declared scalar type.");
}
export async function editDocumentControlRepeats(input: Uint8Array, options: DocxOperationArguments<"controls.repeat"> & { readonly input?: PublicationInput }, context: PublicationContext): Promise<ControlTemplateData> {
  const settings = archiveSettings(context); const { input: identity, ...args } = options;
  const invocation = validateDocxInvocation({ operation: "controls.repeat", inputs: [identity?.path ?? "document"], options: args }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"controls.repeat">; const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const { data, output, inPlace, force, dryRun, json, all, allowEmpty, ...selection } = opts; delete selection.limit;
  if (!Array.isArray(data)) throw new DocxUsageError("Repeating controls require a typed record array."); budget.check("matches", Math.max(1, data.length));
  const document = await openDocumentLocations(input, { ...settings, budget }); const archive = document.snapshot(); const editor = new DocumentArchiveEditor(archive, {}, undefined, budget);
  const inventory = await inspectDocumentControls(input, selection, { ...settings, budget }); const regions = inventory.items.filter(item => item.kind === "repeating-section");
  if (regions.length !== 1) throw new SelectionError(regions.length ? "ambiguous-selection" : "missing-selection", regions.map(item => item.location.token));
  const location = regions[0]!.location; document.select([location], { ...(all === undefined ? {} : { all }), ...(allowEmpty === undefined ? {} : { allowEmpty }) }, "mutation");
  if (document.references(location.token).length > 1) throw new UnsupportedEditError("Shared repeat owners are ambiguous.");
  const xml = editor.xml(location.value.part.slice(1)); let region = xml.root; const ancestors = [region]; for (const index of location.value.path) { region = region.children[index]!; ancestors.push(region); }
  const parent = ancestors.at(-2)!, properties = child(region, "sdtPr")!, content = child(region, "sdtContent")!;
  if (!properties || !content || child(properties, "dataBinding") || attr(child(properties, "lock"), "val") && attr(child(properties, "lock"), "val") !== "unlocked" || containsRevision(region)) throw new UnsupportedEditError("The repeating region is bound, locked or reviewed.");
  const row = parent.namespace === region.namespace && parent.localName === "tbl";
  if (!row && !(parent.namespace === region.namespace && ["body", "hdr", "ftr", "footnote", "endnote", "comment", "txbxContent", "tc"].includes(parent.localName))) throw new UnsupportedEditError("A repeating region requires a direct admitted row or block owner.");
  if (ancestors.slice(0, -1).some(owner => owner.namespace === region.namespace && ["sdt", "ins", "del", "moveFrom", "moveTo", "fldSimple", "hyperlink", "customXml"].includes(owner.localName))) throw new UnsupportedEditError("Repeating boundaries cannot cross controlled owners.");
  const story = document.list("story", { scope: "all-stories" }).filter(owner => owner.value.story === location.value.story && pathContains(owner.value.path, location.value.path)).sort((a, b) => b.value.path.length - a.value.path.length)[0]; if (!story) throw new UnsupportedEditError("A repeat requires an admitted story.");
  assertOutsideFields(parseFields(ancestors[story.value.path.length]!, story.value.path, budget, xml.compatibility.content), location.value.path); assertOutsideRevisionRanges(xml.root, region, budget, xml.compatibility.branches);
  if (!content.children.length || content.content.some(node => node.kind !== "element" && (node.kind !== "text" || node.text.trim()))) throw new UnsupportedEditError("A region requires reusable native items.");
  const items = content.children;
  for (const item of items) {
    const properties = child(item, "sdtPr"), body = child(item, "sdtContent");
    if (item.namespace !== region.namespace || item.localName !== "sdt" || !properties || !body || !child(properties, "repeatingSectionItem", w15) || child(properties, "dataBinding") || attr(child(properties, "lock"), "val") && attr(child(properties, "lock"), "val") !== "unlocked") throw new UnsupportedEditError("Every item requires an unlocked, unbound native declaration.");
    if (row ? body.children.length !== 1 || body.children[0]!.namespace !== region.namespace || body.children[0]!.localName !== "tr" : !body.children.length || body.children.some(node => node.namespace !== region.namespace || !["p", "tbl"].includes(node.localName))) throw new UnsupportedEditError("The native item has an unsupported row/block shape.");
    if (elements(body).some(node => ["vMerge", "hMerge", "gridSpan", "sectPr"].includes(node.localName) || node.namespace === w15 && ["repeatingSection", "repeatingSectionItem"].includes(node.localName))) throw new UnsupportedEditError("Merged, section-changing or nested repeated templates are unsupported.");
    if (row) { const cells = body.children[0]!.children.filter(node => node.namespace === region.namespace && node.localName === "tc"); const grid = child(parent, "tblGrid")?.children.filter(node => node.namespace === region.namespace && node.localName === "gridCol") ?? []; if (!grid.length || cells.length !== grid.length || cells.some(cell => !child(cell, "p") && !cell.children.some(node => node.namespace === region.namespace && node.localName === "p"))) throw new UnsupportedEditError("A repeated row requires a complete unmerged grid."); budget.table(Math.max(1, data.length), cells.length); }
    for (const node of elements(item).filter(node => node.namespace === region.namespace && node.localName === "sdt")) {
      const properties = child(node, "sdtPr"); if (!properties || child(properties, "dataBinding") || attr(child(properties, "lock"), "val") && attr(child(properties, "lock"), "val") !== "unlocked") throw new UnsupportedEditError("All repeated controls must be unlocked and unbound.");
    }
    if (shape(item) !== shape(items[0]!)) throw new UnsupportedEditError("Prior items have conflicting declaration schemas or layouts.");
  }
  const prototype = items[0]!, keys = new Set(fields(prototype).map(node => attr(child(child(node, "sdtPr")!, "tag"), "val")!));
  for (const record of data as readonly DocxBindingRecord[]) { const bindings = record.values.map(value => value.binding); if (bindings.length !== keys.size || new Set(bindings).size !== bindings.length || bindings.some(key => !keys.has(key))) throw new DocxUsageError("Every record must exactly match the declared scalar keys."); }
  if (!row) for (const table of elements(prototype).filter(node => node.namespace === region.namespace && node.localName === "tbl")) {
    const rows = table.children.filter(node => node.namespace === region.namespace && node.localName === "tr");
    const columns = child(table, "tblGrid")?.children.filter(node => node.namespace === region.namespace && node.localName === "gridCol").length ?? 0;
    budget.table(rows.length * Math.max(1, data.length), columns);
  }
  assertDocumentEditable(archive, { ...settings, budget }, archive); const planner = new ControlClonePlanner(archive, { ...settings, budget }); const rendered: string[] = [];
  for (const item of items) {
    planner.preflight(xml, item, location.value.part);
    await planner.admitMedia(xml, item, location.value.part);

    for (const node of fields(item)) {
      const snapshot = inspectControlSnapshot(node, location as Location<"control">, archive, { ...settings, budget }, xml);
      for (const record of data.length ? data : [null]) {
        const value = record?.values.find((entry: DocxBindingRecord["values"][number]) => entry.binding === snapshot.tag)?.value;
        if (record) prepareControlValue(xml, node, snapshot, scalar(snapshot, value!), { ...settings, budget });
        else prepareControlPlaceholder(xml, node, snapshot, { ...settings, budget });
      }
    }
  }
  for (const record of data.length ? data : [null]) {
    budget.check("work", 0); const clone = planner.clone(xml, prototype, location.value.part); const fragment = new DocumentXmlEditor(new TextEncoder().encode(`<root>${clone.xml}</root>`), {}, undefined, budget); const item = fragment.root.children[0]!;
    const stages: (() => void)[] = [];
    for (const node of fields(item)) {
      const snapshot = inspectControlSnapshot(node, location as Location<"control">, archive, { ...settings, budget }, fragment); if (!keys.has(snapshot.tag!)) throw new UnsupportedEditError("A clone introduced an undeclared key.");
      const value = record?.values.find((entry: DocxBindingRecord["values"][number]) => entry.binding === snapshot.tag)?.value; stages.push(record ? prepareControlValue(fragment, node, snapshot, scalar(snapshot, value!), { ...settings, budget }) : prepareControlPlaceholder(fragment, node, snapshot, { ...settings, budget }));
    }
    for (const stage of stages) stage(); const bytes = fragment.serialize(); const owned = new DocumentXmlEditor(bytes, {}, undefined, budget); rendered.push(owned.sourceXml(owned.root.children[0]!));
  }
  const replacement = open(content) + rendered.join("") + `</${content.name}>`; const value = { ...location.value, generation: 1 }; const after = { ...location, value, token: encodeLocation(value) }; const changes = [{ kind: "replace" as const, before: location, after }];
  const prospective = { changed: true, changes, output: dryRun ? null : { path: inPlace ? identity?.path ?? null : output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) }, dryRun: dryRun ?? false };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: "controls.repeat", ok: true, data: prospective, affected: 1, locations: [after], warnings: [], errors: [] }) + "\n").length);
  xml.replaceElement(content, replacement); const staged: DocumentArchive = planner.finish(editor);
  const published = await publishDocumentArchive(staged, { ...(identity ? { input: identity } : {}), ...(output === undefined ? {} : { output }), ...(inPlace === undefined ? {} : { inPlace }), ...(force === undefined ? {} : { force }), ...(dryRun === undefined ? {} : { dryRun }), ...(json === undefined ? {} : { json }) }, { ...context, budget }, archive);
  return { ...prospective, output: published.published.length ? { path: published.published[0]!.path, bytes: published.published[0]!.bytes, sha256: published.archiveSha256! } : null };
}
