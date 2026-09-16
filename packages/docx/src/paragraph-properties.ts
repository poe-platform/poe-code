import { DocxUsageError } from "./argument-json.js";
import { xmlValue } from "./create-content.js";
import { documentDialects } from "./dialect.js";
import type { DocxEnumNames, DocxLength, DocxOperationArguments } from "./operation-types.js";
import type { XmlElement } from "./package-xml.js";
import { runElementOpen } from "./run-properties.js";
import { UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";

/** Convert once to integer EMUs, then to the schema storage unit, half away from zero. */
export function paragraphUnits(value: DocxLength, divisor = 635): number {
  const emu = value.value * { emu: 1, in: 914400, cm: 360000, mm: 36000, pt: 12700, twip: 635 }[value.unit];
  const rounded = Math.sign(emu) * Math.round(Math.abs(emu));
  const result = Math.sign(rounded) * Math.round(Math.abs(rounded) / divisor);
  if (!Number.isSafeInteger(rounded) || !Number.isSafeInteger(result))
    throw new DocxUsageError("Paragraph length exceeds safe integer storage.");
  return result;
}

const order = "pStyle keepNext keepLines pageBreakBefore framePr widowControl numPr suppressLineNumbers pBdr shd tabs suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct autoSpaceDE autoSpaceDN bidi adjustRightInd snapToGrid spacing ind contextualSpacing mirrorIndents suppressOverlap jc textDirection textAlignment textboxTightWrap outlineLvl divId cnfStyle rPr sectPr pPrChange".split(" ");
export const alignments = { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFY: "both", DISTRIBUTE: "distribute", JUSTIFY_MED: "mediumKashida", JUSTIFY_HI: "highKashida", JUSTIFY_LOW: "lowKashida", THAI_JUSTIFY: "thaiDistribute" };
const tabAlignments = { LEFT: "left", CENTER: "center", RIGHT: "right", DECIMAL: "decimal", BAR: "bar", LIST: "list", CLEAR: "clear", END: "end", NUM: "num", START: "start" };
const leaders = { SPACES: "none", DOTS: "dot", DASHES: "hyphen", LINES: "underscore", HEAVY: "heavy", MIDDLE_DOT: "middleDot" };
export const paragraphLineMultiples: Readonly<Partial<Record<DocxEnumNames["WD_LINE_SPACING"], number>>> = { SINGLE: 1, ONE_POINT_FIVE: 1.5, DOUBLE: 2 };

/** Merge supplied direct properties while retaining untouched lexical content. */
export function paragraphProperties(xml: DocumentXmlEditor, paragraph: XmlElement, options: DocxOperationArguments<"paragraphs.set">, styleId?: string): string {
  const w = paragraph.namespace;
  const strict = w === documentDialects.strict.w;
  const directional = (value: string) => strict ? ({ left: "start", right: "end" }[value] ?? value) : value;
  const containers = paragraph.children.filter(c => c.namespace === w && c.localName === "pPr");
  if (containers.length > 1) throw new UnsupportedEditError("Duplicate paragraph property containers cannot be edited.");
  const props = containers[0];
  const patches = new Map<XmlElement, string>();
  const added = new Map<string, string>();
  const mergeOrdered = (parent: XmlElement | undefined, replacements: Map<XmlElement, string>, additions: Map<string, string>, names: readonly string[]): string => {
    const prefixes = new Map<XmlElement, string>();
    let tail = "";
    for (const name of names) {
      const markup = additions.get(name); if (markup === undefined) continue;
      const next = parent?.children.find(c => c.namespace === w && names.indexOf(c.localName) > names.indexOf(name));
      if (next) prefixes.set(next, (prefixes.get(next) ?? "") + markup); else tail += markup;
    }
    for (const [node, prefix] of prefixes) replacements.set(node, prefix + (replacements.get(node) ?? xml.sourceXml(node)));
    return (parent ? xml.sourceXml(parent, replacements, true) : "") + tail;
  };
  const find = (name: string, parent = props) => {
    const matches = parent?.children.filter(c => c.namespace === w && c.localName === name) ?? [];
    if (matches.length > 1) throw new UnsupportedEditError("Duplicate paragraph properties cannot be edited.");
    return matches[0];
  };
  const element = (name: string, attrs: Record<string, string | null>, node?: XmlElement, content?: string) => {
    const prefix = node?.name.includes(":") ? node.name.split(":")[0]! : "pf";
    const retained = node?.attributes.filter(a => a.namespace !== "http://www.w3.org/2000/xmlns/" && !(a.namespace === w && Object.hasOwn(attrs, a.localName))) ?? [];
    const attributes = [...retained.map(a => ` ${a.name}="${xmlValue(a.value)}"`), ...Object.entries(attrs).filter(([, v]) => v !== null).map(([k, v]) => ` ${prefix}:${k}="${xmlValue(v!)}"`)].join("");
    const namespaces = new Map(node?.namespaces); namespaces.set(prefix, w);
    const bindings = [...namespaces].filter(([p]) => p !== "xml").map(([p, uri]) => ` ${p ? "xmlns:" + p : "xmlns"}="${xmlValue(uri)}"`).join("");
    const inner = content ?? (node ? xml.sourceXml(node, new Map(), true) : "");
    return `<${prefix}:${name}${bindings}${attributes}>${inner}</${prefix}:${name}>`;
  };
  const set = (name: string, attrs: Record<string, string | null> | null, content?: string) => {
    const node = find(name);
    if (attrs === null) { if (node) patches.set(node, ""); return; }
    if (!node && !content && Object.values(attrs).every(value => value === null)) return;
    if (node && content === undefined && Object.entries(attrs).every(([key, value]) => {
      const old = node.attributes.find(a => a.namespace === w && a.localName === key)?.value;
      if (["keepNext", "keepLines", "widowControl", "pageBreakBefore"].includes(name) && key === "val")
        return value === "1" ? old === undefined || ["1", "true", "on"].includes(old) : value === "0" && ["0", "false", "off"].includes(old ?? "");
      return value === null ? old === undefined : old === value;
    })) return;
    const markup = element(name, attrs, node, content);
    if (node) patches.set(node, markup); else added.set(name, markup);
  };
  if (styleId !== undefined) set("pStyle", { val: styleId });
  if (options.alignment !== undefined) set("jc", options.alignment === null ? null : { val: directional(alignments[options.alignment.name]) });
  for (const [key, name] of [["keepWithNext", "keepNext"], ["keepTogether", "keepLines"], ["widowControl", "widowControl"], ["pageBreakBefore", "pageBreakBefore"]] as const) {
    const value = options[key]; if (value !== undefined) set(name, value === null ? null : { val: String(Number(value)) });
  }
  if (options.outlineLevel !== undefined) set("outlineLvl", options.outlineLevel === null ? null : { val: String(options.outlineLevel) });
  const indentation: Record<string, string | null> = {};
  for (const [key, name, alternate] of [["leftIndent", "left", "start"], ["rightIndent", "right", "end"]] as const) {
    const value = options[key];
    if (value !== undefined) Object.assign(indentation, { [strict ? alternate : name]: value === null ? null : String(paragraphUnits(value)), [name + "Chars"]: null, [strict ? name : alternate]: null, [alternate + "Chars"]: null });
  }
  if (options.firstLineIndent !== undefined) {
    const n = options.firstLineIndent === null ? null : paragraphUnits(options.firstLineIndent);
    Object.assign(indentation, { firstLine: n !== null && n >= 0 ? String(n) : null, hanging: n !== null && n < 0 ? String(-n) : null, firstLineChars: null, hangingChars: null });
  }
  if (Object.keys(indentation).length) set("ind", indentation);
  const spacing: Record<string, string | null> = {};
  for (const [key, name] of [["spaceBefore", "before"], ["spaceAfter", "after"]] as const) {
    const value = options[key];
    if (value !== undefined) Object.assign(spacing, { [name]: value === null ? null : String(paragraphUnits(value)), [name + "Lines"]: null, [name + "Autospacing"]: null });
  }
  if (options.lineSpacing !== undefined) {
    const value = options.lineSpacing;
    Object.assign(spacing, { line: value === null ? null : String(typeof value === "number" ? Math.round(value * 240) : paragraphUnits(value)), lineRule: value === null ? null : typeof value === "number" ? "auto" : "exact" });
  }
  if (options.lineSpacingRule !== undefined) {
    const rule = options.lineSpacingRule?.name;
    if (rule === undefined) spacing.lineRule = null;
    else {
      spacing.lineRule = rule === "EXACTLY" ? "exact" : rule === "AT_LEAST" ? "atLeast" : "auto";
      const fixed = paragraphLineMultiples[rule];
      if (fixed !== undefined) spacing.line = String(fixed * 240);
    }
  }
  if (Object.keys(spacing).length) set("spacing", spacing);
  if (strict && options.tabStops?.some(tab => tab.alignment?.name === "LIST")) throw new UnsupportedEditError("The deprecated list tab alignment is unavailable in Strict documents.");
  if (options.tabStops !== undefined) set("tabs", options.tabStops === null || options.tabStops.length === 0 ? null : {}, options.tabStops?.slice().sort((a, b) => paragraphUnits(a.position) - paragraphUnits(b.position)).map(tab => element("tab", { pos: String(paragraphUnits(tab.position)), val: directional(tabAlignments[tab.alignment?.name ?? "LEFT"]), leader: leaders[tab.leader?.name ?? "SPACES"] })).join(""));
  if (options.tabStopsClear === true) set("tabs", null);
  if (options.tabStopAdd !== undefined || options.tabStopDelete !== undefined) {
    const container = find("tabs");
    const stops = container?.children.filter(c => c.namespace === w && c.localName === "tab") ?? [];
    const changes = new Map<XmlElement, string>();
    let tail = "";
    if (options.tabStopDelete !== undefined) {
      const index = options.tabStopDelete < 0 ? stops.length + options.tabStopDelete : options.tabStopDelete;
      const stop = stops[index];
      if (!stop) throw new UnsupportedEditError("Tab stop index is out of range.");
      changes.set(stop, "");
    } else {
      const tab = options.tabStopAdd!;
      if (strict && tab.alignment?.name === "LIST") throw new UnsupportedEditError("The deprecated list tab alignment is unavailable in Strict documents.");
      const position = paragraphUnits(tab.position);
      const markup = element("tab", { pos: String(position), val: directional(tabAlignments[tab.alignment?.name ?? "LEFT"]), leader: leaders[tab.leader?.name ?? "SPACES"] });
      const positions = stops.map(stop => {
        const stored = stop.attributes.find(a => a.namespace === w && a.localName === "pos")?.value;
        if (stored === undefined || stored.trim() === "" || !Number.isSafeInteger(Number(stored))) throw new UnsupportedEditError("Malformed tab stop positions cannot be edited.");
        return Number(stored);
      });
      const next = stops.find((_, index) => positions[index]! > position);
      if (next) changes.set(next, markup + xml.sourceXml(next)); else tail = markup;
    }
    const content = (container ? xml.sourceXml(container, changes, true) : "") + tail;
    if (options.tabStopDelete !== undefined && stops.length === 1 && container?.content.every(c => c.kind === "element" && c.namespace === w && c.localName === "tab")) set("tabs", null);
    else set("tabs", {}, content);
  }
  if (options.shading !== undefined) set("shd", options.shading === null ? null : { fill: options.shading.fill.toUpperCase(), color: options.shading.color?.toUpperCase() ?? "auto", val: options.shading.pattern, themeFill: null, themeFillTint: null, themeFillShade: null, themeColor: null, themeTint: null, themeShade: null });
  if (options.borders !== undefined) {
    if (options.borders === null) set("pBdr", null);
    else if (Object.keys(options.borders).length) {
      const container = find("pBdr"), replacements = new Map<XmlElement, string>();
      const additions = new Map<string, string>();
      for (const name of ["top", "left", "bottom", "right", "between"] as const) {
        const border = options.borders[name]; if (!border) continue;
        const node = find(name, container);
        const markup = element(name, { val: border.style, sz: String(paragraphUnits(border.width, 12700 / 8)), color: border.color.toUpperCase(), space: border.space === undefined ? null : String(paragraphUnits(border.space, 12700)), themeColor: null, themeTint: null, themeShade: null }, node);
        if (node) replacements.set(node, markup); else additions.set(name, markup);
      }
      set("pBdr", {}, mergeOrdered(container, replacements, additions, ["top", "left", "bottom", "right", "between", "bar"]));
    }
  }
  if (!patches.size && !added.size) return props ? xml.sourceXml(props) : "";
  const content = mergeOrdered(props, patches, added, order);
  return props ? runElementOpen(props) + content + `</${props.name}>` : `<pf:pPr xmlns:pf="${w}">${content}</pf:pPr>`;
}
