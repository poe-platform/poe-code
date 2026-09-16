import type { AdmittedDocumentArchive } from "./admission.js";
import type { DocumentBudget } from "./budget.js";
import { MarkupCompatibility } from "./compatibility.js";
import { documentDialects } from "./dialect.js";
import type { DocumentPackage } from "./package.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { displayXml } from "./xml-display.js";
import { UnsupportedEditError } from "./xml-write.js";

export class UnsupportedEmbeddedFontMutationError extends UnsupportedEditError {
  constructor() { super("Embedded font mutation is unsupported; preserve font definitions, obfuscation metadata and relationships."); }
}

export interface ThemeResource {
  readonly part: string; readonly name: string | null;
  readonly colors: readonly { slot: string; kind: string; value: string | null; lastColor: string | null }[];
  readonly fonts: readonly { family: "major" | "minor"; slot: string; script: string | null; typeface: string | null }[];
}
export interface FontTableResource {
  readonly part: string;
  readonly fonts: readonly { name: string | null; alternateName: string | null; charset: string | null; family: string | null; pitch: string | null;
    embedded: readonly { kind: string; id: string | null; fontKey: string | null; subsetted: string | null; target: string | null; status: "resolved" | "invalid-font-reference" }[] }[];
}
export interface ThemeReference {
  readonly part: string; readonly path: readonly number[]; readonly attribute: string; readonly value: string;
  readonly resource: string | null;
  readonly status: "resolved" | "missing-theme" | "invalid-theme-reference" | "missing-theme-slot";
}
export interface FontResourceData {
  readonly themes: readonly ThemeResource[];
  readonly fontTables: readonly FontTableResource[];
  readonly references: readonly ThemeReference[];
  readonly languages: readonly { part: string; values: Readonly<Record<string, string>> }[];
  readonly colorMappings: readonly { part: string; values: Readonly<Record<string, string>> }[];
  readonly diagnostics: readonly { code: string; part: string; message: string }[];
  readonly availability: null; readonly licensing: null; readonly embeddedFontMutation: "unsupported";
}

const embeddedNames = new Set(["embedRegular", "embedBold", "embedItalic", "embedBoldItalic"]);
const attr = (node: XmlElement | undefined, name: string, namespace = ""): string | null => node?.attributes.find(a => a.localName === name && a.namespace === namespace)?.value ?? null;
const child = (node: XmlElement | undefined, name: string) => node?.children.find(c => c.namespace === node.namespace && c.localName === name);
const values = (node: XmlElement) => Object.fromEntries(node.attributes.filter(a => a.namespace === node.namespace).map(a => [a.localName, a.value]));

/** Inventory stored resources only. Resolved means a package slot exists, never an installed or licensed face. */
export function readFontResources(archive: AdmittedDocumentArchive, roots: ReadonlyMap<string, XmlElement>, budget: DocumentBudget): FontResourceData {
  const { w, a, r } = documentDialects[archive.dialect];
  const graph = archive.package;
  const themes: ThemeResource[] = [], fontTables: FontTableResource[] = [];
  const languages: { part: string; values: Record<string, string> }[] = [], colorMappings: typeof languages = [];
  const references: ThemeReference[] = [];
  const diagnostics: { code: string; part: string; message: string }[] = [];
  const pending: { part: string; path: number[]; attribute: string; value: string }[] = [];
  for (const [part, root] of roots) {
    const view = new MarkupCompatibility(root, undefined, budget);
    if (root.namespace === a && root.localName === "theme") {
      const elements = child(root, "themeElements"), scheme = child(elements, "fontScheme");
      const colors = (child(elements, "clrScheme")?.children ?? []).filter(n => n.namespace === a && view.canEdit(n)).flatMap(n => n.children.filter(c => c.namespace === a && view.canEdit(c)).map(c => ({ slot: n.localName, kind: c.localName, value: attr(c, "val"), lastColor: attr(c, "lastClr") })));
      const fonts: ThemeResource["fonts"][number][] = [];
      for (const family of ["major", "minor"] as const) for (const node of child(scheme, family + "Font")?.children ?? []) {
        budget.charge("work", 1);
        if (node.namespace === a && ["latin", "ea", "cs", "font"].includes(node.localName) && view.canEdit(node)) fonts.push({ family, slot: node.localName, script: attr(node, "script"), typeface: attr(node, "typeface") });
      }
      themes.push({ part, name: attr(root, "name"), colors, fonts });
    }
    if (root.namespace === w && root.localName === "fonts") {
      const edges = graph.relationships(part);
      budget.charge("work", edges.length);
      const bindings = new Map(edges.map(edge => [edge.rId, edge]));
      fontTables.push({ part, fonts: root.children.filter(n => n.namespace === w && n.localName === "font" && view.canEdit(n)).map(node => ({
        name: attr(node, "name", w), alternateName: attr(child(node, "altName"), "val", w), charset: attr(child(node, "charset"), "val", w), family: attr(child(node, "family"), "val", w), pitch: attr(child(node, "pitch"), "val", w),
        embedded: node.children.filter(n => n.namespace === w && embeddedNames.has(n.localName) && view.canEdit(n)).map(n => {
          const id = attr(n, "id", r), edge = id === null ? undefined : bindings.get(id);
          const valid = edge && !edge.is_external && edge.fragment === null && edge.reltype === `${r}/font` && ["application/vnd.openxmlformats-officedocument.obfuscatedfont", "application/x-fontdata"].includes(edge.target_part.content_type.toLowerCase());
          if (!valid) diagnostics.push({ code: "invalid-font-reference", part, message: "Embedded font reference does not identify an internal font resource." });
          return { kind: n.localName, id, fontKey: attr(n, "fontKey", w), subsetted: attr(n, "subsetted", w), target: valid ? edge.target_part.partname : null, status: valid ? "resolved" as const : "invalid-font-reference" as const };
        })
      })) });
    }
    const stack = [{ node: root, path: [] as number[] }];
    while (stack.length) {
      budget.charge("work", 1);
      const { node, path } = stack.pop()!;
      for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i]!, path: [...path, i] });
      if (node.namespace !== w || !view.canEdit(node)) continue;
      if (node.localName === "themeFontLang") languages.push({ part, values: values(node) });
      if (node.localName === "clrSchemeMapping") colorMappings.push({ part, values: values(node) });
      for (const attribute of node.attributes) {
        if (attribute.namespace !== w) continue;
        if (node.localName === "rFonts" && ["asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"].includes(attribute.localName) || attribute.localName === "themeColor" || attribute.localName === "themeFill") pending.push({ part, path, attribute: attribute.localName, value: attribute.value });
      }
    }
  }
  const themeByPart = new Map(themes.map(t => [t.part, t]));
  const fontSlots: Record<string, string> = { Ascii: "latin", HAnsi: "latin", EastAsia: "ea", Bidi: "cs" };
  const colorSlots: Record<string, string> = { dark1: "dk1", light1: "lt1", dark2: "dk2", light2: "lt2", accent1: "accent1", accent2: "accent2", accent3: "accent3", accent4: "accent4", accent5: "accent5", accent6: "accent6", hyperlink: "hlink", followedHyperlink: "folHlink" };
  const defaultMapping: Record<string, string> = { background1: "light1", text1: "dark1", background2: "light2", text2: "dark2" };
  const mappingNames: Record<string, string> = { background1: "bg1", text1: "t1", background2: "bg2", text2: "t2", hyperlink: "hyperlink", followedHyperlink: "followedHyperlink" };
  const main = "/" + archive.mainPart;
  const settingsEdges = graph.relationships(main).filter(e => e.reltype === `${r}/settings` && !e.is_external);
  const settingsParts = new Set(settingsEdges.map(e => e.target_part.partname));
  const mappings = colorMappings.filter(m => settingsParts.has(m.part));
  for (const ref of pending) {
    budget.charge("work", 1);
    const ownedEdges = graph.relationships(ref.part), mainEdges = graph.relationships(main);
    budget.charge("work", ownedEdges.length + mainEdges.length);
    const local = ownedEdges.filter(e => e.reltype === `${r}/theme`);
    const edges = local.length ? local : mainEdges.filter(e => e.reltype === `${r}/theme`);
    const edge = edges.length === 1 && !edges[0]!.is_external && edges[0]!.fragment === null ? edges[0] : undefined;
    const theme = edge && edge.target_part.content_type.toLowerCase() === "application/vnd.openxmlformats-officedocument.theme+xml" ? themeByPart.get(edge.target_part.partname) : undefined;
    budget.charge("work", (theme?.colors.length ?? 0) + (theme?.fonts.length ?? 0));
    let slot: string | undefined, exists = false;
    if (ref.attribute === "themeColor" || ref.attribute === "themeFill") {
      const mappingKey = Object.hasOwn(mappingNames, ref.value) ? mappingNames[ref.value]! : ref.value;
      const mapped = mappings.length === 1 && Object.hasOwn(mappings[0]!.values, mappingKey) ? mappings[0]!.values[mappingKey] : undefined;
      const key = mapped ?? (Object.hasOwn(defaultMapping, ref.value) ? defaultMapping[ref.value]! : ref.value);
      slot = (Object.hasOwn(colorSlots, ref.value) || Object.hasOwn(defaultMapping, ref.value)) && Object.hasOwn(colorSlots, key) ? colorSlots[key] : undefined;
      exists = theme?.colors.filter(c => c.slot === slot).length === 1;
    } else {
      const family = ref.value.startsWith("major") ? "major" : ref.value.startsWith("minor") ? "minor" : undefined;
      const key = ref.value.slice(5);
      slot = family && Object.hasOwn(fontSlots, key) ? fontSlots[key] : undefined;
      exists = theme?.fonts.filter(f => f.family === family && f.slot === slot).length === 1;
    }
    const status = !slot ? "invalid-theme-reference" : !theme ? "missing-theme" : !exists ? "missing-theme-slot" : "resolved";
    references.push({ ...ref, resource: theme?.part ?? null, status });
    if (status !== "resolved") diagnostics.push({ code: status, part: ref.part, message: "Stored theme reference cannot resolve to one supported package slot; no font or color is inferred." });
  }
  return { themes, fontTables, references, languages, colorMappings, diagnostics, availability: null, licensing: null, embeddedFontMutation: "unsupported" };
}

/** Keep embedded font definitions and relationship bindings inert during explicit XML edits. */
export function embeddedFontState(graph: DocumentPackage, budget: DocumentBudget): string {
  const state: unknown[] = [];
  for (const part of graph.parts) {
    budget.charge("work", 1);
    if (part.content_type.toLowerCase().endsWith(".fonttable+xml")) {
      const root = parseDocumentXml(part.bytes, {}, budget).root;
      for (const font of root.children) if (font.namespace === root.namespace && font.localName === "font" && font.children.some(n => n.namespace === root.namespace && embeddedNames.has(n.localName))) state.push([part.partname, displayXml(font, budget, false)]);
    }
    if (part.content_type.toLowerCase().endsWith("relationships+xml")) continue;
    for (const edge of graph.relationships(part.partname)) if (edge.reltype.endsWith("/font") || edge.reltype.endsWith("/fontTable")) state.push([part.partname, edge.rId, edge.reltype, edge.target_ref, edge.is_external]);
  }
  return JSON.stringify(state);
}
