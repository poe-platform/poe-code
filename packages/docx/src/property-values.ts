import { InvalidValueError } from "./archive.js";
import type { AdmittedDocumentArchive } from "./admission.js";
import { documentDialects, type DocumentDialect } from "./dialect.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { validateDocxValue } from "./operation-schema.js";
import type { DocumentBudget } from "./budget.js";

export type PropertyGroup = "core" | "extended" | "custom";
export type PropertyType = "string" | "boolean" | "integer" | "number" | "date";
export interface PropertyValue { readonly name: string; readonly type: PropertyType; readonly value: string | boolean | number | null; readonly writable: boolean; readonly cached: boolean }
export interface StoredProperty { readonly node: XmlElement; readonly valueNode: XmlElement | null; readonly name: string | null; readonly storedType: { namespace: string; localName: string } | null; readonly id: string | null; readonly value: PropertyValue | null }
export interface PropertyPart { readonly name: string; readonly group: PropertyGroup; readonly root: XmlElement; readonly properties: readonly StoredProperty[]; readonly owned: boolean; readonly ambiguous: boolean; readonly safeCustom: boolean }
export const corePropertyNamespace = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
export const customPropertyFormatId = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}";
const dc = "http://purl.org/dc/elements/1.1/", terms = "http://purl.org/dc/terms/";
export const corePropertyKeys: Readonly<Record<string, { namespace: string; localName: string; type: PropertyType }>> = Object.freeze(Object.fromEntries([
  ["title", dc, "title", "string"], ["subject", dc, "subject", "string"], ["author", dc, "creator", "string"], ["keywords", corePropertyNamespace, "keywords", "string"], ["comments", dc, "description", "string"], ["lastModifiedBy", corePropertyNamespace, "lastModifiedBy", "string"], ["category", corePropertyNamespace, "category", "string"], ["contentStatus", corePropertyNamespace, "contentStatus", "string"], ["identifier", dc, "identifier", "string"], ["language", dc, "language", "string"], ["version", corePropertyNamespace, "version", "string"], ["revision", corePropertyNamespace, "revision", "integer"], ["created", terms, "created", "date"], ["modified", terms, "modified", "date"], ["lastPrinted", corePropertyNamespace, "lastPrinted", "date"]
].map(([key, namespace, localName, type]) => [key!, { namespace: namespace!, localName: localName!, type: type as PropertyType }])));
export const extendedPropertyKeys: Readonly<Record<string, { localName: string; type: PropertyType; cached: boolean }>> = Object.freeze(Object.fromEntries([
  ["company", "Company", "string", false], ["manager", "Manager", "string", false], ["template", "Template", "string", false], ["pages", "Pages", "integer", true], ["words", "Words", "integer", true], ["characters", "Characters", "integer", true], ["charactersWithSpaces", "CharactersWithSpaces", "integer", true], ["lines", "Lines", "integer", true], ["paragraphs", "Paragraphs", "integer", true], ["totalTime", "TotalTime", "integer", true], ["application", "Application", "string", true], ["appVersion", "AppVersion", "string", true]
].map(([key, localName, type, cached]) => [key as string, { localName: localName as string, type: type as PropertyType, cached: cached as boolean }])));
export function propertyAttribute(node: XmlElement, name: string): string | null { return node.attributes.find(a => a.namespace === "" && a.localName === name)?.value ?? null; }
export function normalizePropertyDate(value: unknown): string {
  if (!validateDocxValue("UTC instant", value)) throw new InvalidValueError("Expected a valid explicit UTC property instant.");
  return (value as string).slice(0, 19) + "Z";
}
export function propertyDeclaration(group: PropertyGroup, key: string, dialect: DocumentDialect): { namespace: string; localName: string; type: PropertyType; cached: boolean } | null {
  if (group === "core") { const entry = Object.hasOwn(corePropertyKeys, key) ? corePropertyKeys[key] : undefined; return entry ? { ...entry, cached: false } : null; }
  if (group === "extended") { const entry = Object.hasOwn(extendedPropertyKeys, key) ? extendedPropertyKeys[key] : undefined; return entry ? { ...entry, namespace: documentDialects[dialect].ep } : null; }
  return null;
}
export function propertyGroupDefinition(group: PropertyGroup, dialect: DocumentDialect) {
  const vocab = documentDialects[dialect];
  return group === "core" ? { namespace: corePropertyNamespace, root: "coreProperties", contentType: "application/vnd.openxmlformats-package.core-properties+xml", relationship: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", base: "/docProps/core" } : group === "extended" ? { namespace: vocab.ep, root: "Properties", contentType: "application/vnd.openxmlformats-officedocument.extended-properties+xml", relationship: `${vocab.r}/extended-properties`, base: "/docProps/app" } : { namespace: vocab.cus, root: "Properties", contentType: "application/vnd.openxmlformats-officedocument.custom-properties+xml", relationship: `${vocab.r}/custom-properties`, base: "/docProps/custom" };
}
const integerRanges: Readonly<Record<string, readonly [bigint, bigint]>> = { i1: [-128n, 127n], i2: [-32768n, 32767n], i4: [-2147483648n, 2147483647n], int: [-2147483648n, 2147483647n], i8: [-9223372036854775808n, 9223372036854775807n], ui1: [0n, 255n], ui2: [0n, 65535n], ui4: [0n, 4294967295n], uint: [0n, 4294967295n], ui8: [0n, 18446744073709551615n] };
export function customPropertyType(localName: string): PropertyType | null {
  return ["lpstr", "lpwstr", "bstr"].includes(localName) ? "string" : integerRanges[localName] ? "integer" : ["r4", "r8", "decimal"].includes(localName) ? "number" : localName === "bool" ? "boolean" : ["date", "filetime"].includes(localName) ? "date" : null;
}
export function propertyNumberFits(value: number, variant: string): boolean {
  const range = integerRanges[variant];
  if (range) return Number.isSafeInteger(value) && BigInt(value) >= range[0] && BigInt(value) <= range[1];
  return Number.isFinite(value) && (variant !== "r4" || Number.isFinite(Math.fround(value)));
}
export function serializePropertyScalar(value: string | boolean | number, variant: string): string {
  const text = String(value);
  if (variant !== "decimal" || typeof value !== "number" || !text.toLowerCase().includes("e")) return text;
  const [mantissa, exponent] = text.toLowerCase().split("e"), negative = mantissa![0] === "-", unsigned = negative ? mantissa!.slice(1) : mantissa!;
  const [whole, fraction = ""] = unsigned.split("."), digits = whole! + fraction, point = whole!.length + Number(exponent);
  const decimal = point <= 0 ? "0." + "0".repeat(-point) + digits : point >= digits.length ? digits + "0".repeat(point - digits.length) : digits.slice(0, point) + "." + digits.slice(point);
  return (negative ? "-" : "") + decimal;
}
function lexicalValue(raw: string, type: PropertyType, variant: string, group: PropertyGroup): PropertyValue["value"] {
  if (type === "string") return validateDocxValue("string", raw) && (group !== "core" || [...raw].length <= 255) ? raw : null;
  if (type === "boolean") return raw === "true" || raw === "1" ? true : raw === "false" || raw === "0" ? false : null;
  if (type === "date") { try { return normalizePropertyDate(raw); } catch { return null; } }
  const unsigned = raw[0] === "-" || raw[0] === "+" ? raw.slice(1) : raw;
  if (!unsigned || [...unsigned].some(c => !(type === "integer" ? "0123456789" : variant === "decimal" ? "0123456789." : "0123456789.eE+-").includes(c))) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || type === "integer" && !Number.isSafeInteger(value) || group === "core" && value <= 0 || group === "extended" && value < 0 || group === "custom" && !propertyNumberFits(value, variant)) return null;
  return value;
}
export function readPropertyNodes(root: XmlElement, group: PropertyGroup, dialect: DocumentDialect): StoredProperty[] {
  const vocab = documentDialects[dialect];
  return root.children.map(node => {
    let name: string | null = null, type: PropertyType | null = null, cached = false;
    const custom = group === "custom" && node.namespace === vocab.cus && node.localName === "property";
    const valueNode = group === "custom" ? custom && node.children.length === 1 && node.children[0]!.namespace === vocab.vt ? node.children[0]! : null : node;
    if (custom) { name = propertyAttribute(node, "name"); type = valueNode ? customPropertyType(valueNode.localName) : null; }
    else if (group !== "custom") {
      for (const key of Object.keys(group === "core" ? corePropertyKeys : extendedPropertyKeys)) { const entry = propertyDeclaration(group, key, dialect)!; if (entry.namespace === node.namespace && entry.localName === node.localName) { name = key; type = entry.type; cached = entry.cached; break; } }
      const keys = group === "core" ? corePropertyKeys : extendedPropertyKeys;
      const knownSpelling = Object.hasOwn(keys, node.localName) || Object.values(keys).some(entry => entry.localName === node.localName);
      const nativeNamespace = group === "core" ? [corePropertyNamespace, dc, terms].includes(node.namespace) : node.namespace === vocab.ep;
      if (name === null && nativeNamespace && !knownSpelling) name = node.localName;
    }
    const raw = valueNode?.content.filter(n => n.kind === "text" || n.kind === "cdata").map(n => n.text).join("") ?? "";
    const value = type && name && valueNode ? valueNode.children.length || valueNode.content.some(n => n.kind !== "text" && n.kind !== "cdata") ? null : lexicalValue(raw, type, valueNode.localName, group) : null;
    return { node, valueNode, name, storedType: valueNode ? { namespace: valueNode.namespace, localName: valueNode.localName } : null, id: custom ? propertyAttribute(node, "pid") : null, value: type && name ? { name, type, value, writable: !cached && value !== null, cached } : null };
  });
}
function validCustomId(value: string | null): boolean { return !!value && [...value].every(c => "0123456789".includes(c)) && Number.isSafeInteger(Number(value)) && Number(value) >= 2; }
export function readPropertyParts(archive: AdmittedDocumentArchive, budget: DocumentBudget, roots?: ReadonlyMap<string, XmlElement>): PropertyPart[] {
  const parts: PropertyPart[] = [], edges = archive.package.relationships("/");
  for (const group of ["core", "extended", "custom"] as const) {
    const definition = propertyGroupDefinition(group, archive.dialect), declarations = edges.filter(edge => edge.reltype === definition.relationship);
    for (const part of archive.package.parts) {
      if (part.content_type.toLowerCase() !== definition.contentType) continue;
      const root = roots?.get(part.partname) ?? parseDocumentXml(part.bytes, {}, budget).root;
      if (root.namespace !== definition.namespace || root.localName !== definition.root) continue;
      const owned = declarations.some(edge => !edge.is_external && edge.target_part.partname === part.partname), properties = readPropertyNodes(root, group, archive.dialect);
      budget.charge("work", properties.length); budget.charge("retainedBytes", properties.length * 128);
      const ids = new Set<number>(), names = new Set<string>(); let safeCustom = true;
      if (group === "custom") for (const property of properties) {
        const id = Number(property.id);
        if (property.node.namespace !== definition.namespace || property.node.localName !== "property" || !validCustomId(property.id) || !property.name || propertyAttribute(property.node, "fmtid")?.toUpperCase() !== customPropertyFormatId || ids.has(id) || names.has(property.name)) safeCustom = false;
        ids.add(id); if (property.name) names.add(property.name);
      }
      parts.push({ name: part.partname, group, root, properties, owned, ambiguous: declarations.length > 1, safeCustom });
    }
  }
  return parts.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
