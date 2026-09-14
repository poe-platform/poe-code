import { DocumentBudget } from "./budget.js";
import { type LocationIndex, type LocationEntry, pathContains } from "./location-index.js";
import type { Location } from "./location-token.js";
import type { XmlElement } from "./package-xml.js";

export type TextView = "final" | "original" | "all";
export interface TextFormatting {
  readonly bold: boolean | null;
  readonly italic: boolean | null;
  readonly rtl: boolean | null;
  readonly hidden: boolean | null;
  readonly style: string | null;
  readonly language: Readonly<Record<string, string>>;
  readonly fonts: Readonly<Record<string, string>>;
  readonly paragraph: { readonly style: string | null; readonly bidi: boolean | null };
}
export interface TextSegment {
  readonly text: string;
  readonly location: Location;
  readonly revision: "insert" | "delete" | "unchanged";
  readonly kind: "text" | "tab" | "line-break" | "page-break" | "column-break" | "paragraph" | "cell" | "row" | "story";
  readonly formatting: TextFormatting;
}
export interface TextData {
  readonly text: string;
  readonly view: TextView;
  readonly segments: readonly TextSegment[];
  readonly hiddenText: "include";
}
interface State { entry: LocationEntry; revision: TextSegment["revision"]; formatting: TextFormatting; }
interface Piece { segments: TextSegment[]; state: State; boundary?: TextSegment["revision"]; }

/** Logical order only. Formatting is direct XML context, never a rendered style cascade. */
export function readTextSegments(index: LocationIndex, selected: readonly Location[], view: TextView,
  location: (entry: LocationEntry) => Location, budget: DocumentBudget): TextData {
  const segments: TextSegment[] = [];
  let segmentCount = 0;
  const byNode = new Map<XmlElement, LocationEntry>();
  for (const entry of index.entries) if (entry.node && entry.kind !== "annotation") byNode.set(entry.node, entry);
  const defaults: TextFormatting = { bold: null, italic: null, rtl: null, hidden: null, style: null,
    language: {}, fonts: {}, paragraph: { style: null, bidi: null } };
  const named = (node: XmlElement | undefined, name: string) => node && index.named(node, name)[0];
  const value = (node: XmlElement | undefined, name: string) => {
    const property = named(node, name);
    return property ? index.attr(property, "val") ?? null : null;
  };
  const toggle = (node: XmlElement | undefined, name: string): boolean | null => {
    const property = named(node, name);
    return property ? !["0", "false", "off"].includes(index.attr(property, "val") ?? "true") : null;
  };
  const attributes = (node: XmlElement | undefined): Readonly<Record<string, string>> => Object.fromEntries(
    (node?.attributes ?? []).filter(a => a.namespace === node!.namespace).map(a => [a.localName, a.value]));
  const visible = (revision: TextSegment["revision"]) => !(view === "final" && revision === "delete" || view === "original" && revision === "insert");
  const marked = (node: XmlElement | undefined): TextSegment["revision"] | undefined => named(node, "del") ? "delete" : named(node, "ins") ? "insert" : undefined;
  const make = (text: string, state: State, kind: TextSegment["kind"]): TextSegment => {
    budget.check("matches", ++segmentCount);
    budget.charge("retainedBytes", 256 + text.length * 2);
    budget.charge("work", text.length + 1);
    return { text, kind, location: location(state.entry), revision: state.revision, formatting: state.formatting };
  };
  const join = (pieces: Piece[], separator: string, kind: TextSegment["kind"], state: State): TextSegment[] => {
    const result: TextSegment[] = [];
    pieces.forEach((piece, i) => {
      const previous = pieces[i - 1];
      if (previous && separator && visible(previous.boundary ?? "unchanged"))
        result.push(make(separator, previous.boundary ? { ...previous.state, revision: previous.boundary } : state, kind));
      budget.charge("work", piece.segments.length);
      for (const segment of piece.segments) result.push(segment);
    });
    return result;
  };
  let storyCount = 0;
  for (const story of index.entries.filter(e => e.kind === "story")) {
    budget.charge("work", selected.length + index.entries.length);
    const targets = selected.filter(target => target.value.story === story.story);
    if (!targets.length) continue;
    const fields: boolean[] = [];
    const w = story.node!.namespace;
    const included = (entry: LocationEntry) => {
      budget.charge("work", targets.length * (entry.path.length + 1));
      return targets.some(target => pathContains(target.value.path, entry.path));
    };
    const relevant = (entry: LocationEntry) => {
      budget.charge("work", targets.length * (entry.path.length + 1));
      return included(entry) || targets.some(target => pathContains(entry.path, target.value.path));
    };
    let revision: TextSegment["revision"] = "unchanged";
    let omitted = false;
    let ancestor = index.entries.find(entry => entry.kind === "part" && entry.part === story.part)!.node!;
    for (const child of story.path) {
      budget.charge("work", 1);
      ancestor = ancestor.children[child]!;
      if (ancestor.namespace !== w) continue;
      const rowRevision = ancestor.localName === "tr" ? marked(named(ancestor, "trPr")) : undefined;
      if (!rowRevision && !["ins", "moveTo", "del", "moveFrom"].includes(ancestor.localName)) continue;
      revision = rowRevision ?? (ancestor.localName === "ins" || ancestor.localName === "moveTo" ? "insert" : "delete");
      omitted ||= view === "final" && revision === "delete" || view === "original" && revision === "insert";
    }
    if (omitted) continue;
    const initial: State = { entry: story, revision, formatting: defaults };
    const visit = (node: XmlElement, inherited: State): Piece[] => {
      budget.charge("work", 1);
      const entry = byNode.get(node);
      let state = entry?.story === story.story ? { ...inherited, entry } : inherited;
      if (node.namespace !== w) return [];
      const name = node.localName;
      if (name === "txbxContent" && node !== story.node) return [];
      if (["pPr", "rPr", "tblPr", "tcPr", "trPr", "sectPr", "tblGrid", "drawing", "pict", "object", "instrText", "delInstrText", "lastRenderedPageBreak"].includes(name)) return [];
      if (["ins", "moveTo", "del", "moveFrom"].includes(name)) {
        const revision = name === "ins" || name === "moveTo" ? "insert" : "delete";
        if (!visible(revision)) return [];
        state = { ...state, revision };
      }
      if (name === "tr") {
        const revision = marked(named(node, "trPr"));
        if (revision && !visible(revision)) return [];
        if (revision) state = { ...state, revision };
      }
      if (name === "p") {
        const props = named(node, "pPr");
        state = { ...state, formatting: { ...defaults, paragraph: { style: value(props, "pStyle"), bidi: toggle(props, "bidi") } } };
      }
      if (name === "r") {
        const props = named(node, "rPr");
        state = { ...state, formatting: { ...state.formatting, bold: toggle(props, "b"), italic: toggle(props, "i"),
          hidden: toggle(props, "vanish"), rtl: toggle(props, "rtl"), style: value(props, "rStyle"),
          language: attributes(named(props, "lang")), fonts: attributes(named(props, "rFonts")) } };
      }
      if (name === "fldChar") {
        const type = index.attr(node, "fldCharType");
        if (type === "begin") fields.push(false);
        else if (type === "separate" && fields.length) fields[fields.length - 1] = true;
        else if (type === "end") fields.pop();
        return [];
      }
      const text = name === "t" || name === "delText" ? node.text : name === "tab" ? "\t" : name === "cr" ? "\n"
        : name === "br" ? index.attr(node, "type") === "page" ? "\f" : index.attr(node, "type") === "column" ? "\v" : "\n"
        : name === "noBreakHyphen" ? "\u2011" : name === "softHyphen" ? "\u00ad" : undefined;
      if (text !== undefined) {
        if (!included(state.entry) || fields.includes(false) || name === "delText" && view === "final") return [];
        const kind = name === "tab" ? "tab" : name === "br" || name === "cr" ? text === "\f" ? "page-break" : text === "\v" ? "column-break" : "line-break" : "text";
        return text ? [{ state, segments: [make(text, name === "delText" ? { ...state, revision: "delete" } : state, kind)] }] : [];
      }
      const children = (index.children.get(node) ?? []).flatMap(child => visit(child, state));
      if (name === "p" || name === "tc" || name === "tr" || name === "tbl" || node === story.node) {
        if (!relevant(state.entry) || !children.length && !included(state.entry)) return [];
        const separator = name === "p" ? "" : name === "tr" ? "\t" : "\n";
        const kind = name === "tr" ? "cell" : name === "tbl" ? "row" : "paragraph";
        const boundary = name === "p" ? marked(named(named(node, "pPr"), "rPr")) : undefined;
        return [{ state, segments: join(children, separator, kind, state), ...(boundary ? { boundary } : {}) }];
      }
      return children;
    };
    const pieces = visit(story.node!, initial);
    if (!pieces.length) continue;
    if (storyCount++) segments.push(make("\n\n", initial, "story"));
    for (const piece of pieces) for (const segment of piece.segments) segments.push(segment);
  }
  const range = selected.length === 1 ? selected[0]!.value.range : null;
  let result = segments;
  if (range) {
    let offset = 0;
    result = segments.flatMap(segment => {
      const scalars = [...segment.text];
      const text = scalars.slice(Math.max(0, range.start - offset), Math.max(0, range.end - offset)).join("");
      offset += scalars.length;
      return text ? [{ ...segment, text }] : [];
    });
  }
  budget.check("matches", result.length);
  const data: TextData = { text: result.map(segment => segment.text).join(""), view, segments: result, hiddenText: "include" };
  const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
  budget.check("serializedOutput", bytes);
  budget.charge("retainedBytes", bytes);
  return data;
}
