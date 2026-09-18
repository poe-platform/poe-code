import { archiveSettings, type ArchiveContext } from "./archive.js";
import { validateDocxInvocation } from "./command.js";
import { documentDialects, dialectForNamespace } from "./dialect.js";
import { openDocumentLocations } from "./locations.js";
import type { Location } from "./location-token.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { docxOperationSchemas } from "./operation-schema.js";
import { DocumentPackage } from "./package.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { readStyleProperties, styleAttribute, styleChild, styleFontFlags } from "./style-properties.js";
import { activeXmlChildren } from "./xml-active-children.js";

export interface TextResourceInspectionData {
  readonly item: {
    readonly kind: "paragraphs" | "runs";
    readonly location: Location;
    readonly text: string;
    readonly properties: readonly {
      name: string; type: "string" | "boolean" | "integer" | "number";
      value: string | boolean | number | null; writable: boolean; cached: false;
    }[];
    readonly references: readonly { owner: string; id: string; type: string; target: string; external: boolean }[];
    readonly support: "read";
  };
}

export interface TextResourceListData {
  readonly items: readonly TextResourceInspectionData["item"][];
}

async function openTextResources(input: Uint8Array, operation: "paragraphs.get" | "runs.get" | "paragraphs.list" | "runs.list", options: DocxOperationArguments<"paragraphs.get">, context: ArchiveContext) {
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation, inputs: ["document"], options }, settings.budget);
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget }, "inventory");
  const locations = resolveDocxSelection(document, invocation);
  const graph = new DocumentPackage(document.snapshot(), settings.limits, budget);
  const parts = new Map<string, { root: XmlElement; children: ReturnType<typeof activeXmlChildren> }>();
  const read = (location: Location) => {
    let part = parts.get(location.value.part);
    if (!part) {
      const root = parseDocumentXml(graph.getPart(location.value.part).bytes, {}, budget).root;
      part = { root, children: activeXmlChildren(root, budget) };
      parts.set(location.value.part, part);
    }
    let node = part.root;
    for (const position of location.value.path) { budget.charge("work", 1); node = node.children[position]!; }
    return { document, location, graph, ...part, node, budget };
  };
  return { locations, read, budget };
}

type TextResourceSource = ReturnType<Awaited<ReturnType<typeof openTextResources>>["read"]>;

function textResourceData(source: TextResourceSource, kind: "paragraphs" | "runs", values: Readonly<Record<string, unknown>>): TextResourceInspectionData {
  const { document, location, graph, root, node, budget, children } = source;
  const properties: TextResourceInspectionData["item"]["properties"][number][] = [];
  const writable = docxOperationSchemas[kind === "paragraphs" ? "paragraphs.set" : "runs.set"].sdkFields;
  const booleanNames = new Set([...Object.keys(styleFontFlags), "hidden", "superscript", "subscript", "keepWithNext", "keepTogether", "widowControl", "pageBreakBefore"]);
  const numberNames = new Set(["size", "spaceBefore", "spaceAfter", "leftIndent", "rightIndent", "firstLineIndent", "lineSpacing"]);
  const add = (name: string, value: unknown): void => {
    budget.charge("work", 1);
    if (value === undefined) value = null;
    if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") {
      budget.charge("retainedBytes", 96 + name.length * 2 + (typeof value === "string" ? value.length * 2 : 8));
      const type = booleanNames.has(name) ? "boolean" : name === "outlineLevel" || name === "numbering.level" || name === "tabStops.count" ? "integer"
        : numberNames.has(name) || name.endsWith(".position") ? "number" : "string";
      properties.push({ name, type, value: value as string | boolean | number | null, writable: Object.hasOwn(writable, name), cached: false });
    } else if (Array.isArray(value)) value.forEach((item, index) => add(`${name}.${index}`, item));
    else if (value !== undefined) for (const [key, item] of Object.entries(value)) add(`${name}.${key}`, item);
  };
  for (const [key, value] of Object.entries(values)) {
    if (key === "tabStops") {
      add("tabStops.count", Array.isArray(value) ? value.length : null);
      if (Array.isArray(value)) value.forEach((item, index) => add(`tabStops.${index}`, item));
    } else if (key === "numbering") {
      const numbering = value as { id: string | null; level: number | null } | null;
      add("numbering.id", numbering?.id ?? null); add("numbering.level", numbering?.level ?? null);
    } else add(key, value);
  }
  const r = documentDialects[dialectForNamespace(root.namespace)!].r;
  const references: TextResourceInspectionData["item"]["references"][number][] = [];
  const edges = new Map(graph.relationships(location.value.part).map(edge => [edge.rId, edge]));
  const seen = new Set<string>(), pending: XmlElement[] = [node];
  while (pending.length) {
    const current = pending.pop()!;
    budget.charge("work", 1 + current.attributes.length);
    for (const attribute of current.attributes) {
      if (attribute.namespace !== r || seen.has(attribute.value)) continue;
      const edge = edges.get(attribute.value);
      if (!edge) continue;
      seen.add(attribute.value);
      budget.charge("retainedBytes", 128 + (edge.rId.length + edge.reltype.length + edge.target_ref.length) * 2);
      references.push({ owner: location.value.part, id: edge.rId, type: edge.reltype, target: edge.target_ref, external: edge.is_external });
    }
    const nested = children(current); budget.charge("retainedBytes", nested.length * 8);
    pending.push(...[...nested].reverse());
  }
  const data: TextResourceInspectionData = { item: { kind, location, text: document.text({ select: location.token }).text, properties, references, support: "read" } };
  const size = new TextEncoder().encode(JSON.stringify(data)).length;
  budget.check("serializedOutput", size); budget.charge("retainedBytes", size);
  return data;
}

/** Reads one stored paragraph without creating styles or changing its story. */
export async function inspectDocumentParagraph(input: Uint8Array, options: DocxOperationArguments<"paragraphs.get">, context: ArchiveContext): Promise<TextResourceInspectionData> {
  const opened = await openTextResources(input, "paragraphs.get", options, context);
  const source = opened.read(opened.locations[0]!);
  return textResourceData(source, "paragraphs", paragraphValues(source));
}

function paragraphValues(source: TextResourceSource): Readonly<Record<string, unknown>> {
  const paragraph = styleChild(source.node, "pPr", source.children);
  const runDefaults = styleChild(paragraph, "rPr", source.children);
  return { ...readStyleProperties(runDefaults, paragraph, source.children), style: styleAttribute(styleChild(paragraph, "pStyle", source.children), "val") };
}

/** Reads one stored run, including explicit false formatting and inert references. */
export async function inspectDocumentRun(input: Uint8Array, options: DocxOperationArguments<"runs.get">, context: ArchiveContext): Promise<TextResourceInspectionData> {
  const opened = await openTextResources(input, "runs.get", options, context);
  const source = opened.read(opened.locations[0]!);
  return textResourceData(source, "runs", runValues(source));
}

function runValues(source: TextResourceSource): Readonly<Record<string, unknown>> {
  const run = styleChild(source.node, "rPr", source.children);
  const { fontHidden, ...properties } = readStyleProperties(run, undefined, source.children);
  const fonts = styleChild(run, "rFonts", source.children), language = styleChild(run, "lang", source.children), color = styleChild(run, "color", source.children);
  const slots = Object.fromEntries(([ ["ascii", "ascii"], ["highAnsi", "hAnsi"], ["eastAsia", "eastAsia"], ["complexScript", "cs"],
    ["asciiTheme", "asciiTheme"], ["highAnsiTheme", "hAnsiTheme"], ["eastAsiaTheme", "eastAsiaTheme"], ["complexScriptTheme", "cstheme"] ] as const)
    .map(([name, attribute]) => [name, styleAttribute(fonts, attribute) ?? null]));
  return { ...properties, ...slots, hidden: fontHidden,
    superscript: properties.baseline === null ? null : properties.baseline === "superscript", subscript: properties.baseline === null ? null : properties.baseline === "subscript",
    eastAsiaLanguage: styleAttribute(language, "eastAsia") ?? null, bidiLanguage: styleAttribute(language, "bidi") ?? null,
    themeTint: styleAttribute(color, "themeTint") ?? null, themeShade: styleAttribute(color, "themeShade") ?? null,
    style: styleAttribute(styleChild(run, "rStyle", source.children), "val") };
}

/** Lists stored paragraphs in selected logical story order without creating definitions. */
export async function inspectDocumentParagraphs(input: Uint8Array, options: DocxOperationArguments<"paragraphs.list">, context: ArchiveContext): Promise<TextResourceListData> {
  const source = await openTextResources(input, "paragraphs.list", options, context);
  const data = { items: source.locations.map(location => { const item = source.read(location); return textResourceData(item, "paragraphs", paragraphValues(item)).item; }) };
  const size = new TextEncoder().encode(JSON.stringify(data)).length;
  source.budget.check("serializedOutput", size); source.budget.charge("retainedBytes", size);
  return data;
}

/** Lists stored runs in selected logical story order, retaining inert owner-local references. */
export async function inspectDocumentRuns(input: Uint8Array, options: DocxOperationArguments<"runs.list">, context: ArchiveContext): Promise<TextResourceListData> {
  const source = await openTextResources(input, "runs.list", options, context);
  const data = { items: source.locations.map(location => { const item = source.read(location); return textResourceData(item, "runs", runValues(item)).item; }) };
  const size = new TextEncoder().encode(JSON.stringify(data)).length;
  source.budget.check("serializedOutput", size); source.budget.charge("retainedBytes", size);
  return data;
}
