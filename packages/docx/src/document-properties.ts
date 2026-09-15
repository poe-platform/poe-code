import { archiveSettings, InputTypeError, InvalidValueError, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { readDocumentArchive, type AdmittedDocumentArchive } from "./admission.js";
import { validateDocxInvocation } from "./command.js";
import { documentDialects } from "./dialect.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import { SelectionError, closedRecord } from "./location-token.js";
import { encodeLocation, type Location } from "./location-token.js";
import { xmlValue } from "./create-content.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { validateDocumentArchive, SemanticValidationError } from "./validation.js";
import { normalizeDocxPropertyOptions } from "./command-properties.js";
import { customPropertyFormatId, normalizePropertyDate, propertyDeclaration, propertyGroupDefinition, propertyNumberFits, serializePropertyScalar, readPropertyParts, type PropertyGroup, type PropertyPart, type PropertyValue, type StoredProperty, type PropertyType } from "./property-values.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import type { DocumentBudget } from "./budget.js";

export interface PropertyWarning { readonly code: string; readonly message: string }
export interface PropertyResourceRecord {
  readonly kind: "property"; readonly name?: string; readonly location: Location<"part">; readonly properties: readonly PropertyValue[];
  readonly references: readonly { owner: string; id: string; type: string; target: string; external: boolean }[];
  readonly support: "edit" | "read" | "preserve";
  readonly details: { readonly kind: "property"; readonly group: PropertyGroup; readonly storedType: { readonly namespace: string; readonly localName: string } | null; readonly id: string | null };
}
export interface PropertyInspectionData { readonly items: readonly PropertyResourceRecord[]; readonly warnings: readonly PropertyWarning[] }
export type PropertyInspectionOptions = Partial<DocxOperationArguments<"properties.get">>;
export type PropertyEditOptions = (({ readonly operation: "properties.set" } & DocxOperationArguments<"properties.set">) | ({ readonly operation: "properties.remove" } & DocxOperationArguments<"properties.remove">)) & { readonly input?: PublicationInput };
export interface PropertyMutationData { readonly changed: boolean; readonly changes: readonly { readonly kind: "add" | "set" | "remove"; readonly before: Location<"part"> | null; readonly after: Location<"part"> | null }[]; readonly dryRun: boolean; readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null }
function requestedName(name: string): { group?: PropertyGroup; key: string } {
  const colon = name.indexOf(":"); return colon < 0 ? { key: name } : { group: name.slice(0, colon) as PropertyGroup, key: name.slice(colon + 1) };
}
function select(parts: readonly PropertyPart[], name: string): { part: PropertyPart; property: StoredProperty } | null {
  const requested = requestedName(name), candidates = parts.flatMap(part => requested.group !== undefined && part.group !== requested.group ? [] : part.properties.filter(property => property.name === requested.key).map(property => ({ part, property })));
  if (candidates.length > 1 || candidates.some(c => c.part.ambiguous)) throw new SelectionError("ambiguous-selection");
  return candidates[0] ?? null;
}
function warningsFor(parts: readonly PropertyPart[]): PropertyWarning[] {
  const warnings: PropertyWarning[] = [];
  if (parts.some(p => !p.owned || p.ambiguous)) warnings.push({ code: "ambiguous-property-ownership", message: "Some metadata parts are orphaned or ambiguously declared and remain preserved." });
  if (parts.some(p => !p.safeCustom || p.properties.some(v => !v.value || v.value.value === null))) warnings.push({ code: "invalid-property", message: "Some stored metadata is invalid or unsupported and remains preserved." });
  return warnings;
}
async function ownedArchive(input: Uint8Array, context: ArchiveContext) {
  const settings = archiveSettings(context);
  if (!(input instanceof Uint8Array)) throw new InputTypeError("Expected archive bytes.");
  settings.budget.check("compressedInput", input.length); settings.budget.charge("retainedBytes", input.length);
  const bytes = new Uint8Array(input), archive = await readDocumentArchive(bytes, settings);
  return { bytes, archive, settings };
}
export async function inspectDocumentProperties(input: Uint8Array, options: PropertyInspectionOptions, context: ArchiveContext): Promise<PropertyInspectionData> {
  closedRecord(options, ["name", "json", "limit"]);
  const settings = archiveSettings(context), invocation = validateDocxInvocation({ operation: options.name === undefined ? "properties.list" : "properties.get", inputs: ["document"], options }, settings.budget);
  const budget = settings.budget.lower(Object.fromEntries((invocation.options.limit as PropertyInspectionOptions["limit"] ?? []).map(v => [v.name, v.value])));
  const { bytes, archive } = await ownedArchive(input, { ...settings, budget }), parts = readPropertyParts(archive, budget);
  const selection = options.name === undefined ? null : select(parts, options.name);
  if (options.name !== undefined && !selection) throw new SelectionError("missing-selection");
  budget.charge("work", bytes.length); const sourceSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
  const items: PropertyResourceRecord[] = [];
  for (const part of parts) {
    const references = archive.package.relationships("/").filter(edge => !edge.is_external && edge.target_part.partname === part.name).map(edge => ({ owner: "/", id: edge.rId, type: edge.reltype, target: edge.target_ref, external: false })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const property of part.properties) {
      if (selection && property !== selection.property) continue;
      budget.charge("matches", 1); budget.charge("retainedBytes", 256);
      const value = { version: 1 as const, sourceSha256, generation: 0, part: part.name, story: part.name, path: [], range: null }, token = encodeLocation(value), location: Location<"part"> = { kind: "part", token, value, positions: {} };
      budget.charge("retainedBytes", token.length * 4);
      const native = property.value ? { ...property.value, writable: property.value.writable && part.owned && !part.ambiguous && part.safeCustom } : null;
      items.push({ kind: "property", ...(property.name ? { name: `${part.group}:${property.name}` } : {}), location, properties: native ? [native] : [], references,
        support: !native || native.value === null || !part.owned || part.ambiguous || !part.safeCustom ? "preserve" : native.cached ? "read" : native.writable ? "edit" : "preserve",
        details: { kind: "property", group: part.group, storedType: property.storedType, id: property.id } });
    }
  }
  const data = { items, warnings: warningsFor(parts) }; if (options.json) measurePackageResourceSerialization(data, budget); return data;
}
function createPropertyPart(archive: AdmittedDocumentArchive, group: PropertyGroup, budget: DocumentBudget): { archive: DocumentArchive; name: string } {
  const definition = propertyGroupDefinition(group, archive.dialect), name = archive.package.allocatePartName(definition.base, ".xml");
  const types = archive.members.find(m => m.name === "[Content_Types].xml")!, typesEditor = new DocumentXmlEditor(types.bytes, {}, undefined, budget);
  typesEditor.insertChildren(typesEditor.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="${xmlValue(name)}" ContentType="${definition.contentType}"/>`);
  const relationships = archive.members.find(m => m.name === "_rels/.rels")!, relEditor = new DocumentXmlEditor(relationships.bytes, {}, undefined, budget), id = archive.package.allocateRelationshipId("/");
  relEditor.insertChildren(relEditor.root, `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="${id}" Type="${definition.relationship}" Target="${xmlValue(name.slice(1))}"/>`);
  const members = archive.members.map(m => m === types ? { ...m, bytes: typesEditor.serialize() } : m === relationships ? { ...m, bytes: relEditor.serialize() } : m);
  members.push({ name: name.slice(1), bytes: new TextEncoder().encode(`<p:${definition.root} xmlns:p="${definition.namespace}"/>`), directory: false, modified: new Date("1980-01-01T00:00:00Z") });
  return { archive: { ...archive, members }, name };
}
export async function editDocumentProperties(input: Uint8Array, options: PropertyEditOptions, context: PublicationContext): Promise<PropertyMutationData> {
  const identity = options.input; closedRecord(options, ["operation", "name", "value", "type", "input", "output", "inPlace", "force", "dryRun", "allowEmpty", "json", "limit"]);
  const { operation, ...args } = options;
  delete (args as { input?: PublicationInput }).input;
  if (operation !== "properties.set" && operation !== "properties.remove") throw new InvalidValueError("Expected a typed property mutation.");
  const settings = archiveSettings(context), invocation = validateDocxInvocation({ operation, inputs: ["document"], options: args }, settings.budget), opts = invocation.options as DocxOperationArguments<"properties.set"> & DocxOperationArguments<"properties.remove">;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(v => [v.name, v.value]))), owned = await ownedArchive(input, { ...settings, budget }), archive = owned.archive;
  assertDocumentEditable(archive, { ...settings, budget }); const report = validateDocumentArchive(archive, {}, budget); if (!report.valid) throw new SemanticValidationError(report.diagnostics);
  const parts = readPropertyParts(archive, budget), selected = select(parts, opts.name), requested = requestedName(opts.name);
  const group = selected?.part.group ?? requested.group ?? (propertyDeclaration("core", requested.key, archive.dialect) ? "core" : propertyDeclaration("extended", requested.key, archive.dialect) ? "extended" : "custom");
  const declarations = archive.package.relationships("/").filter(edge => edge.reltype === propertyGroupDefinition(group, archive.dialect).relationship);
  if (declarations.length > 1) throw new SelectionError("ambiguous-selection");
  if (declarations.some(edge => edge.is_external) || declarations.length && !parts.some(p => p.group === group && p.owned)) throw new UnsupportedEditError("Metadata ownership is not an admitted internal part.");
  if (selected && (!selected.part.owned || selected.part.ambiguous || !selected.part.safeCustom || !selected.property.value?.writable)) throw new UnsupportedEditError("The selected stored property cannot be safely mutated through its typed declaration.");
  const active = parts.find(p => p.group === group && p.owned);
  if (active && !active.safeCustom) throw new UnsupportedEditError("Stored custom property identities cannot be safely extended.");
  if (!selected && operation === "properties.remove" && !opts.allowEmpty) throw new SelectionError("missing-selection");
  let value: PropertyValue["value"] = null, type: PropertyType | undefined;
  if (operation === "properties.set") {
    type = selected?.property.value?.type ?? propertyDeclaration(group, requested.key, archive.dialect)?.type ?? opts.type;
    if (!type) throw new InvalidValueError("New custom properties require an explicit type.");
    const normalized = normalizeDocxPropertyOptions({ name: `${group}:${requested.key}`, value: opts.value, type }, false);
    if (opts.type !== undefined && opts.type !== type) throw new InvalidValueError("Property type conflicts with its stored declaration.");
    value = type === "date" ? normalizePropertyDate(normalized.value) : normalized.value as PropertyValue["value"];
    if (group === "custom" && selected?.property.valueNode && typeof value === "number" && !propertyNumberFits(value, selected.property.valueNode.localName)) throw new UnsupportedEditError("Assigned number exceeds the retained custom XML variant range.");
    if (group !== "custom" && !propertyDeclaration(group, requested.key, archive.dialect)) throw new UnsupportedEditError("This native property is not writable.");
  }
  const changed = selected ? operation === "properties.remove" || selected.property.value!.value !== value : operation === "properties.set";
  let staged: DocumentArchive = archive, partName = selected?.part.name ?? active?.name;
  if (changed) {
    if (!partName) { const created = createPropertyPart(archive, group, budget); staged = created.archive; partName = created.name; }
    const member = staged.members.find(m => "/" + m.name === partName)!, editor = new DocumentXmlEditor(member.bytes, {}, undefined, budget);
    if (selected) {
      const target = editor.root.children[selected.part.root.children.indexOf(selected.property.node)]!;
      if (operation === "properties.remove") editor.replaceElement(target, "");
      else { const valueNode = group === "custom" ? target.children[0]! : target; editor.replaceScalarText(valueNode, serializePropertyScalar(value!, valueNode.localName)); }
    } else {
      const declaration = propertyDeclaration(group, requested.key, archive.dialect);
      let markup: string;
      if (group === "custom") {
        const used = new Set(active?.properties.map(p => Number(p.id)) ?? []); let id = 2; while (used.has(id)) { budget.charge("work", 1); id++; }
        const variant = { string: "lpwstr", boolean: "bool", integer: "i8", number: "r8", date: "filetime" }[type!], vocab = documentDialects[archive.dialect];
        markup = `<p:property xmlns:p="${vocab.cus}" fmtid="${customPropertyFormatId}" pid="${id}" name="${xmlValue(requested.key)}"><v:${variant} xmlns:v="${vocab.vt}">${xmlValue(String(value))}</v:${variant}></p:property>`;
      } else {
        const entry = declaration!; markup = `<p:${entry.localName} xmlns:p="${entry.namespace}"${group === "core" && ["created", "modified"].includes(requested.key) ? ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:dcterms="http://purl.org/dc/terms/" xsi:type="dcterms:W3CDTF"' : ""}>${xmlValue(String(value))}</p:${entry.localName}>`;
      }
      editor.insertChildren(editor.root, markup);
    }
    staged = { ...staged, members: staged.members.map(m => m === member ? { ...m, bytes: editor.serialize() } : m) };
  }
  budget.charge("work", owned.bytes.length);
  const sourceSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", owned.bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
  const location = (generation: number): Location<"part"> => { const value = { version: 1 as const, sourceSha256, generation, part: partName!, story: partName!, path: [], range: null }; return { kind: "part", value, token: encodeLocation(value), positions: {} }; };
  const changes: PropertyMutationData["changes"] = changed ? [{ kind: operation === "properties.remove" ? "remove" : selected ? "set" : "add", before: selected ? location(0) : null, after: operation === "properties.remove" ? null : location(1) }] : [];
  const publication = { ...(identity ? { input: identity } : {}), ...(opts.output === undefined ? {} : { output: opts.output }), ...(opts.inPlace === undefined ? {} : { inPlace: opts.inPlace }), ...(opts.force === undefined ? {} : { force: opts.force }), ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }), ...(opts.json === undefined ? {} : { json: opts.json }) };
  measurePackageResourceSerialization({ version: 1, operation, ok: true, data: { changed, changes, dryRun: opts.dryRun ?? false, output: opts.dryRun ? null : { path: opts.output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } }, warnings: [], errors: [], affected: changes.length, locations: [] }, budget);
  const result = await publishDocumentArchive(staged, publication, { ...context, budget }, undefined, changed ? undefined : owned.bytes);
  return { changed, changes, dryRun: opts.dryRun ?? false, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
