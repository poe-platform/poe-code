import { archiveSettings, InputTypeError, type ArchiveContext } from "./archive.js";
import { readDocumentArchive } from "./admission.js";
import { validateDocxInvocation } from "./command.js";
import { documentPartRole } from "./document-part-roles.js";
import type { InspectionPart, InspectionReference } from "./inspection.js";
import { encodeLocation, type Location } from "./location-token.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import type { DocumentBudget } from "./budget.js";

export interface CustomXmlResourceDetails { readonly kind: "custom-xml"; readonly parts: readonly InspectionPart[]; readonly root: { readonly namespace: string; readonly localName: string } | null; readonly storeItemId: string | null; readonly propertiesParts: readonly string[]; readonly namespaces: readonly { readonly prefix: string; readonly uri: string }[]; readonly schemaReferences: readonly string[] }
export interface GlossaryResourceDetails { readonly kind: "glossary"; readonly parts: readonly InspectionPart[]; readonly buildingBlocks: readonly { readonly path: readonly number[]; readonly name: string | null; readonly guid: string | null; readonly category: string | null; readonly gallery: string | null; readonly types: readonly string[]; readonly behaviors: readonly string[] }[] }
export interface PackageResourceRecord { readonly kind: "custom-xml" | "glossary"; readonly location: Location<"part">; readonly name: string; readonly properties: readonly []; readonly references: readonly InspectionReference[]; readonly support: "preserve"; readonly details: CustomXmlResourceDetails | GlossaryResourceDetails }
export interface PackageResourceListData { readonly items: readonly PackageResourceRecord[] }
const office = ["http://schemas.openxmlformats.org/officeDocument/2006/relationships/", "http://purl.oclc.org/ooxml/officeDocument/relationships/"];
const datastore = "http://schemas.openxmlformats.org/officeDocument/2006/customXml";
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function attribute(node: XmlElement | undefined, name: string): string | null { return node?.attributes.find(attribute => attribute.namespace === node.namespace && attribute.localName === name)?.value ?? null; }
function child(node: XmlElement | undefined, name: string): XmlElement | undefined { const matches = node?.children.filter(child => child.namespace === node.namespace && child.localName === name) ?? []; return matches.length === 1 ? matches[0] : undefined; }
async function hash(bytes: Uint8Array, budget: DocumentBudget): Promise<string> { budget.charge("work", bytes.length); budget.charge("retainedBytes", bytes.length + 96); const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))); return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join(""); }

/** Measures internally constructed inventory JSON without allocating the serialized payload. */
export function measurePackageResourceSerialization(value: unknown, budget: DocumentBudget): number {
  let bytes = 0;
  const add = (amount: number) => { bytes += amount; budget.check("serializedOutput", bytes); };
  const string = (value: string) => { budget.charge("work", value.length + 1); add(2); for (let index = 0; index < value.length; index++) { const code = value.charCodeAt(index); if (code === 34 || code === 92) add(2); else if (code < 32) add([8,9,10,12,13].includes(code) ? 2 : 6); else if (code < 128) add(1); else if (code < 2048) add(2); else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { add(4); index++; } else add(code >= 0xd800 && code <= 0xdfff ? 6 : 3); } };
  const visit = (value: unknown): void => { budget.charge("work", 1); if (typeof value === "string") string(value); else if (value === null) add(4); else if (typeof value === "boolean") add(value ? 4 : 5); else if (typeof value === "number") add(String(value).length); else if (Array.isArray(value)) { add(2); for (let index = 0; index < value.length; index++) { if (index) add(1); visit(value[index]); } } else if (value && typeof value === "object") { add(2); let count = 0; for (const key in value) if (Object.hasOwn(value, key) && (value as Record<string, unknown>)[key] !== undefined) { if (count++) add(1); string(key); add(1); visit((value as Record<string, unknown>)[key]); } } };
  visit(value); return bytes;
}

/** Inventories inert package resources and their internal graph closure; no resource is activated or fetched. */
export async function inspectDocumentPackageResources(input: Uint8Array, operation: "custom-xml.list" | "glossary.list", options: DocxOperationArguments<"custom-xml.list"> | DocxOperationArguments<"glossary.list">, context: ArchiveContext): Promise<PackageResourceListData> {
  const settings = archiveSettings(context), invocation = validateDocxInvocation({ operation, inputs: ["document"], options }, settings.budget);
  const budget = settings.budget.lower(Object.fromEntries((invocation.options.limit as readonly { name: string; value: number }[] | undefined ?? []).map(limit => [limit.name, limit.value])));
  if (!(input instanceof Uint8Array)) throw new InputTypeError("Expected archive bytes."); budget.check("compressedInput", input.length); budget.charge("retainedBytes", input.length); budget.charge("work", input.length); const owned = new Uint8Array(input);
  const archive = await readDocumentArchive(owned, { ...settings, budget }), graph = archive.package;
  budget.charge("work", 1); budget.charge("retainedBytes", archive.members.length * 96);
  const parts = new Map(graph.parts.filter(part => part.content_type.toLowerCase() !== "application/vnd.openxmlformats-package.relationships+xml").map(part => [part.partname, part]));
  const edges = ["/", ...parts.keys()].flatMap(owner => { const references = graph.relationships(owner); budget.charge("work", references.length); budget.charge("retainedBytes", references.length * 32); return references.map(edge => ({ owner, edge })); });
  const relation = (type: string, name: string) => office.some(namespace => type === namespace + name);
  const itemNames = new Set(edges.filter(({ edge }) => !edge.is_external && relation(edge.reltype, "customXml")).map(({ edge }) => edge.target_part.partname));
  const associated = new Set(edges.filter(({ owner, edge }) => itemNames.has(owner) && !edge.is_external && relation(edge.reltype, "customXmlProps")).map(({ edge }) => edge.target_part.partname));
  const candidates = operation === "custom-xml.list" ? [...itemNames, ...[...parts.values()].filter(part => part.content_type.toLowerCase() === "application/vnd.openxmlformats-officedocument.customxmlproperties+xml" && !associated.has(part.partname)).map(part => part.partname)] : [...parts.values()].filter(part => part.content_type.toLowerCase() === "application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml").map(part => part.partname);
  budget.check("matches", candidates.length); budget.charge("retainedBytes", candidates.length * 64);
  const roots = new Map<string, XmlElement>(), metadata = new Map<string, InspectionPart>();
  const root = (name: string): XmlElement | undefined => { const part = parts.get(name)!; if (!part.content_type.toLowerCase().endsWith("+xml") && !["application/xml", "text/xml"].includes(part.content_type.toLowerCase())) return undefined; let value = roots.get(name); if (!value) { value = parseDocumentXml(part.bytes, {}, budget).root; roots.set(name, value); } return value; };
  const sourceSha256 = await hash(owned, budget), records: PackageResourceRecord[] = [];
  for (const name of [...new Set(candidates)].sort(compare)) {
    budget.charge("work", 1); const pending = [name], closure = new Set<string>();
    while (pending.length) { budget.charge("work", 1); const owner = pending.pop()!; if (closure.has(owner)) continue; budget.charge("retainedBytes", 32); closure.add(owner); for (const edge of graph.relationships(owner)) { budget.charge("work", 1); if (!edge.is_external && !closure.has(edge.target_part.partname)) { budget.charge("retainedBytes", 8); pending.push(edge.target_part.partname); } } }
    const inventory: InspectionPart[] = [];
    for (const partName of [...closure].sort(compare)) { let item = metadata.get(partName); if (!item) { const part = parts.get(partName)!; item = { name: partName, contentType: part.content_type, bytes: part.bytes.length, sha256: await hash(part.bytes, budget) }; metadata.set(partName, item); } budget.charge("retainedBytes", 8); inventory.push(item); }
    const references = edges.filter(({ owner, edge }) => closure.has(owner) || !edge.is_external && edge.target_part.partname === name).map(({ owner, edge }) => ({ owner, id: edge.rId, type: edge.reltype, target: edge.target_ref, external: edge.is_external })).sort((a, b) => compare(a.owner, b.owner) || compare(a.id, b.id));
    budget.charge("retainedBytes", references.length * 64); const value = { version: 1 as const, sourceSha256, generation: 0, part: name, story: name, path: [], range: null }, token = encodeLocation(value); budget.charge("retainedBytes", token.length * 4);
    const location: Location<"part"> = { kind: "part", token, value, positions: {} }; let details: PackageResourceRecord["details"];
    const itemRoot = root(name);
    if (operation === "custom-xml.list") {
      const propertiesParts = itemNames.has(name) ? graph.relationships(name).filter(edge => !edge.is_external && relation(edge.reltype, "customXmlProps")).map(edge => edge.target_part.partname).sort(compare) : [name];
      const propertyRoots = propertiesParts.map(root).filter((node): node is XmlElement => node?.namespace === datastore && node.localName === "datastoreItem");
      const storeIds = propertyRoots.map(node => attribute(node, "itemID"));
      const schemaReferences = [...new Set(propertyRoots.flatMap(node => child(node, "schemaRefs")?.children.filter(child => child.namespace === datastore && child.localName === "schemaRef").map(node => attribute(node, "uri")).filter((uri): uri is string => uri !== null) ?? []))].sort(compare);
      details = { kind: "custom-xml", parts: inventory, root: itemNames.has(name) && itemRoot ? { namespace: itemRoot.namespace, localName: itemRoot.localName } : null, storeItemId: propertiesParts.length === 1 && propertyRoots.length === 1 ? storeIds[0] ?? null : null, propertiesParts, namespaces: itemRoot ? [...itemRoot.namespaces].map(([prefix, uri]) => ({ prefix, uri })).sort((a, b) => compare(a.prefix, b.prefix)) : [], schemaReferences };
    } else {
      const buildingBlocks: GlossaryResourceDetails["buildingBlocks"][number][] = [];
      if (itemRoot && documentPartRole(parts.get(name)!.content_type, itemRoot) === "glossary") { const container = child(itemRoot, "docParts"); if (container) for (let index = 0; index < container.children.length; index++) { budget.charge("work", 1); const block = container.children[index]!; if (block.namespace !== itemRoot.namespace || block.localName !== "docPart") continue; const properties = child(block, "docPartPr"), category = child(properties, "category"), values = (owner: XmlElement | undefined, field: string) => owner?.children.filter(node => node.namespace === itemRoot.namespace && node.localName === field).map(node => attribute(node, "val")).filter((value): value is string => value !== null) ?? []; buildingBlocks.push({ path: [itemRoot.children.indexOf(container), index], name: attribute(child(properties, "name"), "val"), guid: attribute(child(properties, "guid"), "val"), category: attribute(child(category, "name"), "val"), gallery: attribute(child(category, "gallery"), "val"), types: values(child(properties, "types"), "type"), behaviors: values(child(properties, "behaviors"), "behavior") }); } }
      details = { kind: "glossary", parts: inventory, buildingBlocks };
    }
    records.push({ kind: details.kind, name, location, properties: [], references, support: "preserve", details });
  }
  const data = { items: records }; measurePackageResourceSerialization({ version: 1, operation, ok: true, data, warnings: [], errors: [], affected: 0, locations: records.map(record => record.location) }, budget); return data;
}
