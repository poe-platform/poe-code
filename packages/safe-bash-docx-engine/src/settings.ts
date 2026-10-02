import { compareInventoryNames } from "./pack-inventory.js";
import { parseMediaType } from "./media-type.js";
import { archiveSettings, InputTypeError, type ArchiveContext } from "./archive.js";
import { readDocumentArchive } from "./admission.js";
import { validateDocxInvocation } from "./command.js";
import { MarkupCompatibility } from "./compatibility.js";
import { documentPartRole } from "./document-part-roles.js";
import type { PropertyValue } from "./property-values.js";
import type { InspectionReference, InspectionProtection } from "./inspection.js";
import { encodeGeneratedLocation as encodeLocation, type Location } from "./location-token.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { incomingResourceReferences, measurePackageResourceSerialization } from "./ancillary-resources.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import type { DocumentBudget } from "./budget.js";
import { activeSettingsProtection } from "./protection.js";
import { activeXmlChildren } from "./xml-active-children.js";
import { storedBooleanValue } from "./stored-lexical.js";

export interface SettingEntry {
  readonly path: readonly number[]; readonly namespace: string; readonly localName: string;
  readonly attributes: readonly { namespace: string; localName: string; value: string }[];
  readonly status: "stored" | "opaque";
}
export interface SettingsDetails {
  readonly kind: "settings";
  readonly entries: readonly SettingEntry[];
  readonly updateFields: boolean | null;
  readonly fontEmbedding: Readonly<Record<"embedTrueTypeFonts" | "embedSystemFonts" | "saveSubsetFonts", boolean | null>>;
  readonly protection: readonly Omit<InspectionProtection, "part">[];
}
export interface SettingsRecord {
  readonly kind: "settings"; readonly name: string; readonly location: Location<"part">;
  readonly properties: readonly []; readonly references: readonly []; readonly support: "read" | "preserve";
  readonly details: SettingsDetails;
}
export interface SettingsListData { readonly items: readonly SettingsRecord[] }
export interface SettingsResourceRecord {
  readonly kind: "settings";
  readonly name: string;
  readonly location: Location<"part">;
  readonly properties: readonly PropertyValue[];
  readonly references: readonly InspectionReference[];
  readonly support: "read" | "preserve";
}
export interface SettingsResourceListData { readonly items: readonly SettingsResourceRecord[] }


const value = (node: XmlElement, name: string) => node.attributes.find(attribute => attribute.namespace === node.namespace && attribute.localName === name)?.value;
function booleanValue(node: XmlElement | undefined): boolean | null {
  if (!node) return null;
  const stored = value(node, "val");
  return stored === undefined ? true : storedBooleanValue(stored);
}

/** Reads stored package settings without creating owners or activating resources. */
export function inspectDocumentSettings(input: Uint8Array, options: DocxOperationArguments<"settings.list">, context: ArchiveContext, projection: "resource"): Promise<SettingsResourceListData>;
export function inspectDocumentSettings(input: Uint8Array, options: DocxOperationArguments<"settings.list">, context: ArchiveContext, projection?: "snapshot"): Promise<SettingsListData>;
export async function inspectDocumentSettings(input: Uint8Array, options: DocxOperationArguments<"settings.list">, context: ArchiveContext, projection: "snapshot" | "resource" = "snapshot"): Promise<SettingsListData | SettingsResourceListData> {
  if (projection !== "snapshot" && projection !== "resource") throw new InputTypeError("Expected a declared settings projection.");
  const settings = archiveSettings(context), invocation = validateDocxInvocation({ operation: "settings.list", inputs: ["document"], options }, settings.budget);
  const budget = settings.budget.lower(Object.fromEntries((invocation.options.limit as readonly { name: string; value: number }[] | undefined ?? []).map(limit => [limit.name, limit.value])));
  if (!(input instanceof Uint8Array)) throw new InputTypeError("Expected archive bytes.");
  budget.check("compressedInput", input.length); budget.charge("retainedBytes", input.length);
  const owned = new Uint8Array(input);
  const archive = await readDocumentArchive(owned, { ...settings, budget });
  budget.charge("work", input.length); budget.charge("retainedBytes", input.length + 96);
  const digest = await crypto.subtle.digest("SHA-256", owned);
  const sourceSha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const records: SettingsRecord[] = [];
  for (const part of archive.package.parts) {
    budget.charge("work", 1);
    if (parseMediaType(part.content_type) !== "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml") continue;
    const root = parseDocumentXml(part.bytes, {}, budget).root, native = documentPartRole(part.content_type, root) === "settings";
    const view = new MarkupCompatibility(root, undefined, budget), entries: SettingEntry[] = [], protection: Omit<InspectionProtection, "part">[] = [];
    const activeProtection = native ? activeSettingsProtection(root, view, budget) : new Set<XmlElement>();
    const active = activeXmlChildren(root, budget), rootChildren = active(root);
    const stored = new Set<XmlElement>(), pending = rootChildren.filter(node => native && node.namespace === root.namespace && ["compat", "updateFields", "embedTrueTypeFonts", "embedSystemFonts", "saveSubsetFonts", "documentProtection", "writeProtection", "evenAndOddHeaders"].includes(node.localName));
    budget.charge("retainedBytes", pending.length * 8);
    while (pending.length) {
      const node = pending.pop()!, children = active(node);
      budget.charge("retainedBytes", 32 + children.length * 8); stored.add(node);
      for (const child of children) pending.push(child);
    }
    const singleton = (name: string) => { budget.charge("work", rootChildren.length); const matches = rootChildren.filter(node => native && node.namespace === root.namespace && node.localName === name); const node = matches.length === 1 ? matches[0] : undefined; return node && view.canEdit(node) && !node.children.length && !node.text.trim() && node.attributes.every(attribute => attribute.namespace === "http://www.w3.org/2000/xmlns/" || attribute.namespace === node.namespace && attribute.localName === "val" && view.canEdit(attribute)) ? node : undefined; };
    const census: { node: XmlElement; path: number[] }[] = [];
    budget.charge("retainedBytes", root.children.length * 40);
    for (let index = root.children.length - 1; index >= 0; index--)
      census.push({ node: root.children[index]!, path: [index] });
    while (census.length) {
      const { node, path } = census.pop()!;
      budget.charge("work", node.attributes.length + node.children.length + 1);
      const protectedNode = native && node.namespace === root.namespace && ["documentProtection", "writeProtection"].includes(node.localName);
      const attributes = node.attributes.filter(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/" && (!protectedNode || attribute.namespace === node.namespace && ["edit", "enforcement", "recommended", "formatting"].includes(attribute.localName))).map(attribute => ({ namespace: attribute.namespace, localName: attribute.localName, value: attribute.value })).sort((a, b) => a.namespace.localeCompare(b.namespace) || a.localName.localeCompare(b.localName));
      budget.charge("retainedBytes", 128 + attributes.reduce((total, attribute) => total + 64 + (attribute.namespace.length + attribute.localName.length + attribute.value.length) * 2, 0));
      entries.push({ path, namespace: node.namespace, localName: node.localName, attributes, status: stored.has(node) && node.namespace === root.namespace && view.canEdit(node) && node.attributes.every(attribute => attribute.namespace === "http://www.w3.org/2000/xmlns/" || view.canEdit(attribute)) ? "stored" : "opaque" });
      if (activeProtection.has(node)) {
        const enforcement = value(node, "enforcement");
        protection.push({ kind: node.localName, edit: value(node, "edit") ?? null, enforced: node.localName === "writeProtection" ? true : enforcement === undefined ? false : storedBooleanValue(enforcement) });
      }
      budget.charge("retainedBytes", node.children.length * (32 + (path.length + 1) * 8));
      for (let index = node.children.length - 1; index >= 0; index--)
        census.push({ node: node.children[index]!, path: [...path, index] });
    }
    budget.check("matches", records.length + 1);
    const locationValue = { version: 1 as const, sourceSha256, generation: 0, part: part.partname, story: part.partname, path: [], range: null };
    const location: Location<"part"> = { kind: "part", value: locationValue, token: encodeLocation(locationValue), positions: {} };
    budget.charge("retainedBytes", location.token.length * 4 + 256);
    records.push({ kind: "settings", name: part.partname, location, properties: [], references: [], support: native ? "read" : "preserve", details: { kind: "settings", entries, updateFields: booleanValue(singleton("updateFields")), fontEmbedding: { embedTrueTypeFonts: booleanValue(singleton("embedTrueTypeFonts")), embedSystemFonts: booleanValue(singleton("embedSystemFonts")), saveSubsetFonts: booleanValue(singleton("saveSubsetFonts")) }, protection } });
  }
  records.sort((left, right) => compareInventoryNames(left.name, right.name));
  const data = projection === "snapshot" ? { items: records } : { items: records.map(record => {
    const { details, ...item } = record;
    const properties: PropertyValue[] = [];
    const scalar = (name: string, type: PropertyValue["type"], value: PropertyValue["value"]) => {
      budget.charge("retainedBytes", 128 + name.length * 2 + (typeof value === "string" ? value.length * 2 : 8));
      properties.push({ name, type, value, writable: false, cached: false });
    };
    scalar("updateFields", "boolean", details.updateFields);
    for (const [name, value] of Object.entries(details.fontEmbedding)) scalar(name, "boolean", value);
    scalar("entryCount", "integer", details.entries.length);
    scalar("opaqueCount", "integer", details.entries.filter(entry => entry.status === "opaque").length);
    for (const entry of details.entries) {
      const prefix = `settings[${entry.path.join(".")}]`;
      scalar(prefix + ".namespace", "string", entry.namespace);
      scalar(prefix + ".localName", "string", entry.localName);
      scalar(prefix + ".status", "string", entry.status);
      for (const [index, attribute] of entry.attributes.entries()) for (const [field, value] of Object.entries(attribute)) scalar(`${prefix}.attributes[${index}].${field}`, "string", value);
    }
    for (const [index, protection] of details.protection.entries()) {
      scalar(`protection[${index}].kind`, "string", protection.kind);
      scalar(`protection[${index}].enforced`, "boolean", protection.enforced);
      scalar(`protection[${index}].edit`, "string", protection.edit);
    }
    return { ...item, properties, references: incomingResourceReferences(archive.package, record.name, budget) };
  }) };
  measurePackageResourceSerialization(data, budget);
  return data;
}

/** Raw settings edits admit field-update intent only; other settings remain inert. */
export function assertSettingsXmlReplacement(contentType: string, original: Uint8Array, replacement: Uint8Array, budget: DocumentBudget): void {
  if (parseMediaType(contentType) !== "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml") return;
  const before = new DocumentXmlEditor(original, {}, undefined, budget), after = new DocumentXmlEditor(replacement, {}, undefined, budget);
  if (documentPartRole(contentType, before.root) !== "settings" || documentPartRole(contentType, after.root) !== "settings") throw new UnsupportedEditError("Affected settings root is unsupported.");
  const remainder = (editor: DocumentXmlEditor) => {
    const fields = activeXmlChildren(editor, budget)(editor.root).filter(node => node.namespace === editor.root.namespace && node.localName === "updateFields");
    if (fields.length > 1 || fields.some(node => !editor.compatibility.canEdit(node) || node.children.length || node.text.trim() || booleanValue(node) === null || node.attributes.some(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/" && (attribute.namespace !== node.namespace || attribute.localName !== "val" || !editor.compatibility.canEdit(attribute))))) throw new UnsupportedEditError("Affected field-update settings are unsupported.");
    return editor.sourceXml(editor.root, new Map(fields.map(node => [node, ""])));
  };
  if (remainder(before) !== remainder(after)) throw new UnsupportedEditError("Raw settings edits may change only field-update intent; preserve compatibility, font embedding and unknown settings.");
}
