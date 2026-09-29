import type { ImportedValue, Workbook } from "@poe-code/spreadsheet-ast";
import { createOdfXml, odfAttributes, odfChildren, odfNamespaces, odfObject, type OdfAttributes } from "@poe-code/spreadsheet-engine/codecs/odf-write-support";

type Section = "contentAutomatic" | "stylesAutomatic" | "masters" | "fonts" | "styles";

/** Preserve imported definitions and reuse equivalent generated definitions.
 * Names belong to their package part, container, element type and style family. */
export function createOdfStyleDefinitions(book: Workbook, xml: ReturnType<typeof createOdfXml>) {
  const sections = new Map<Section, Map<string, ImportedValue>>();
  const shapes = new Map<Section, Map<string, string>>();
  const names = new Set<string>();
  let anonymous = 0;
  for (const record of book.unsupportedRecords ?? []) {
    xml.charge();
    if (record.source !== "Gnumeric_OpenCalc:openoffice") continue;
    const data = odfObject(record.data);
    const section: Section | undefined = record.kind === "automatic-styles"
      ? data?.packagePart === "styles.xml" ? "stylesAutomatic" : "contentAutomatic"
      : record.kind === "master-styles" ? "masters" : record.kind === "font-face-decls" ? "fonts"
        : record.kind === "styles" ? "styles" : undefined;
    if (!section) continue;
    let entries = sections.get(section);
    if (!entries) { entries = new Map(); sections.set(section, entries); }
    for (const child of odfChildren(data?.xml)) {
      xml.charge();
      const node = odfObject(child), attributes = odfAttributes(child, odfNamespaces.style);
      const key = attributes.name ? JSON.stringify([node?.namespace, node?.name, attributes.family ?? "", attributes.name])
        : "anonymous:" + anonymous++;
      // Repeated exports historically appended duplicate definitions. Retain
      // the last definition of an identity, matching the importer style map.
      entries.set(key, child);
      if (attributes.name) names.add(attributes.name);
    }
  }
  for (const [section, entries] of sections) {
    const byShape = new Map<string, string>(); shapes.set(section, byShape);
    for (const child of entries.values()) {
      xml.charge(); const node = odfObject(child), name = odfAttributes(child, odfNamespaces.style).name;
      if (!node || !name || !Array.isArray(node.attributes)) continue;
      const attributes = node.attributes.filter(value => {
        xml.charge(); const attribute = odfObject(value);
        return attribute?.namespace !== odfNamespaces.style || attribute?.name !== "name";
      });
      byShape.set(xml.retained({ ...node, attributes }), name);
    }
  }
  function register(section: Section, tag: string, preferredName: string, attributes: OdfAttributes, content = "") {
    const shape = xml.element(tag, attributes, content);
    let byShape = shapes.get(section);
    const existing = byShape?.get(shape);
    if (existing !== undefined) return existing;
    let name = preferredName, suffix = 1;
    while (names.has(name)) { xml.charge(); name = preferredName + "_" + suffix++; }
    names.add(name);
    let entries = sections.get(section);
    if (!entries) { entries = new Map(); sections.set(section, entries); }
    entries.set("generated:" + name, xml.element(tag, { "style:name": name, ...attributes }, content));
    if (!byShape) { byShape = new Map(); shapes.set(section, byShape); }
    byShape.set(shape, name);
    return name;
  }
  function render(section: Section) {
    let result = "";
    for (const value of sections.get(section)?.values() ?? []) {
      xml.charge(); result += typeof value === "string" ? value : xml.retained(value);
    }
    return result;
  }
  return { register, render };
}
