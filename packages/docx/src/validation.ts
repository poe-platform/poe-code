import { macroTypes } from "./admission.js";
import { InputTypeError, InvalidValueError, ResourceLimitError, type DocumentArchive } from "./archive.js";
import { DocumentBudget } from "./budget.js";
import { DocumentPackage } from "./package.js";
import { InvalidPackageError, InvalidXmlError, parseDocumentXml, UnsupportedProfileError, type XmlElement } from "./package-xml.js";
import { documentDialects, validatePackageDialect } from "./dialect.js";
import { MarkupCompatibility, documentCompatibilityProfile, type CompatibilityElement } from "./compatibility.js";

export interface ValidationOptions {
  readonly profile?: "core-v1";
  readonly maxParts?: number;
  readonly maxBytes?: number;
  readonly maxNodes?: number;
  readonly maxDiagnostics?: number;
}
export interface ValidationDiagnostic {
  readonly code: string;
  readonly part: string;
  readonly location: string;
  readonly message: string;
}
export interface ValidationData {
  readonly valid: boolean;
  readonly profile: "core-v1";
  readonly checks: readonly { id: string; status: "passed" | "failed" | "unvalidated" }[];
  readonly diagnostics: readonly ValidationDiagnostic[];
  readonly warnings: readonly string[];
}
export class SemanticValidationError extends InvalidPackageError {
  constructor(readonly diagnostics: readonly ValidationDiagnostic[]) {
    super("Staged document validation failed.");
  }
}
export const documentValidationProfile = Object.freeze({
  profile: "core-v1",
  understoodNamespaces: Object.freeze([...documentCompatibilityProfile.understoodNamespaces.filter(Boolean), "http://schemas.openxmlformats.org/markup-compatibility/2006"]),
  schema: "Selected roots and attributes; no full XSD conformance.",
  checks: Object.freeze(["container", "part-names", "content-types", "relationships", "xml", "mce", "structure", "references", "protection", "signatures", "extension-coverage"])
});

type Node = { element: CompatibilityElement; part: string; location: string; story: string };
const wordType = "application/vnd.openxmlformats-officedocument.wordprocessingml.";
function integer(value: string | undefined, min = 0, max = 2147483647): string | undefined {
  if (value === undefined || !value.length) return undefined;
  const digits = value[0] === "-" || value[0] === "+" ? value.slice(1) : value;
  if (!digits.length || [...digits].some(c => c < "0" || c > "9")) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? String(n) : undefined;
}

/** Validates owned, decoded package members; container integrity belongs to readArchive. */
export function validateDocumentArchive(archive: DocumentArchive, options: ValidationOptions = {}, budget = new DocumentBudget()): ValidationData {
  if (!options || typeof options !== "object" || Array.isArray(options) ||
    Object.keys(options).some(k => !["profile", "maxParts", "maxBytes", "maxNodes", "maxDiagnostics"].includes(k)) ||
    (options.profile !== undefined && options.profile !== "core-v1")) throw new InvalidValueError("Unknown validation profile or option.");
  const limits = { maxParts: Math.min(4096, budget.limits.zipEntries), maxBytes: Math.min(32 * 1024 * 1024, budget.limits.expandedPackage), maxNodes: Math.min(200000, budget.limits.xmlNodes), maxDiagnostics: 1000 };
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const value = options[key] ?? limits[key];
    const ceiling = key === "maxParts" ? budget.limits.zipEntries : key === "maxBytes" ? budget.limits.expandedPackage : key === "maxNodes" ? budget.limits.xmlNodes : 1000;
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) throw new InvalidValueError("Validation limits must be positive safe integers within host ceilings.");
    limits[key] = value;
  }
  if (!archive || !Array.isArray(archive.members)) throw new InputTypeError("Expected decoded archive members.");
  if (archive.members.length > limits.maxParts) throw new ResourceLimitError("Validation part limit exceeded.");
  let total = 0;
  for (const member of archive.members) {
    if (!member || !(member.bytes instanceof Uint8Array) || typeof member.name !== "string") throw new InputTypeError("Expected typed archive members.");
    total += member.bytes.length;
    if (total > limits.maxBytes) throw new ResourceLimitError("Validation byte limit exceeded.");
  }
  budget.charge("work", total * 8);
  const diagnostics: ValidationDiagnostic[] = [];
  const failed = new Set<string>();
  let styleFallback = false;
  const add = (code: string, part: string, location: string, message: string, check = "references") => {
    if (diagnostics.length >= limits.maxDiagnostics) throw new ResourceLimitError("Validation diagnostic limit exceeded.");
    budget.charge("diagnosticBytes", new TextEncoder().encode(code + part + location + message).length);
    failed.add(check);
    diagnostics.push({ code, part, location, message });
  };
  const result = (): ValidationData => ({
    valid: diagnostics.length === 0, profile: "core-v1", diagnostics,
    checks: documentValidationProfile.checks.map(id => ({ id, status: failed.has(id) ? "failed" :
      ["container", "protection", "signatures", "extension-coverage"].includes(id) ? "unvalidated" : diagnostics.length ? "unvalidated" : "passed" })),
    warnings: ["Partial schema and semantic validation only; no full conformance certification.",
      "Container integrity requires byte admission; protection, signatures and extension semantics are unvalidated.",
      ...(styleFallback ? ["Unresolved style references use document defaults or inherited formatting."] : [])]
  });
  for (const name of ["[Content_Types].xml", "_rels/.rels"]) {
    if (!archive.members.some(m => !m.directory && m.name.toLowerCase() === name.toLowerCase()))
      add("required-part", "/" + name, "/", "Required package metadata is missing.", "structure");
  }
  if (diagnostics.length) return result();
  const roots = new Map<string, XmlElement>();
  let remaining = limits.maxNodes;
  const parse = (part: string, bytes: Uint8Array) => {
    const root = parseDocumentXml(bytes, { maxBytes: Math.min(limits.maxBytes, budget.limits.xmlPartBytes), maxNodes: Math.max(1, remaining) }, budget).root;
    const stack = [root];
    while (stack.length) {
      if (--remaining < 0) throw new ResourceLimitError("Validation node limit exceeded.");
      const node = stack.pop()!;
      for (const child of node.children) stack.push(child);
    }
    roots.set(part, root);
  };
  // Parse OPC metadata first so malformed XML has a precise part diagnostic.
  for (const member of archive.members) {
    if (member.name.toLowerCase() === "[content_types].xml" || member.name.toLowerCase().endsWith(".rels")) {
      try { parse("/" + member.name, member.bytes); }
      catch (e) {
        if (!(e instanceof InvalidXmlError)) throw e;
        add("invalid-xml", "/" + member.name, "/", e.message, "xml");
      }
    }
  }
  if (diagnostics.length) return result();
  let graph: DocumentPackage;
  try {
    graph = new DocumentPackage(archive, { maxMembers: limits.maxParts, maxArchiveBytes: limits.maxBytes,
      maxEntryBytes: limits.maxBytes, maxTotalBytes: limits.maxBytes, maxPathBytes: 4096, maxDepth: 256,
      maxExtraBytes: 0, maxCommentBytes: 0, maxRetainedBytes: budget.limits.retainedBytes, chunkSize: 4096 }, budget);
  } catch (e) {
    if (!(e instanceof InvalidPackageError || e instanceof InvalidXmlError)) throw e;
    add(e instanceof InvalidPackageError ? e.diagnosticCode : "invalid-xml", e instanceof InvalidPackageError ? e.part ?? "/" : "/", e instanceof InvalidPackageError ? e.location : "/", e.message, "relationships");
    return result();
  }
  if ([...graph.defaults, ...graph.overrides].some(declaration => macroTypes.has(declaration.content_type.toLowerCase())))
    throw new UnsupportedProfileError("Macro-enabled document containers are unsupported.");
  for (const part of graph.parts) {
    if (!roots.has(part.partname) && (part.content_type.toLowerCase().endsWith("+xml") || part.content_type.toLowerCase() === "application/xml" || part.content_type.toLowerCase() === "text/xml")) {
      try { parse(part.partname, part.bytes); }
      catch (e) {
        if (!(e instanceof InvalidXmlError)) throw e;
        add("invalid-xml", part.partname, "/", e.message, "xml");
      }
    }
  }
  if (diagnostics.length) return result();
  const mains = graph.relationships("/").filter(e => Object.values(documentDialects).some(d => e.reltype === d.r + "/officeDocument"));
  if (mains.length !== 1 || mains[0]!.is_external || mains[0]!.fragment !== null) {
    add("main-part", "/_rels/.rels", "/", "Exactly one internal main relationship without a fragment is required.", "structure");
    return result();
  }
  const main = mains[0]!.target_part;
  if (![wordType + "document.main+xml", wordType + "template.main+xml"].includes(main.content_type.toLowerCase()))
    throw new UnsupportedProfileError("Only non-macro Word documents and templates are supported.");
  const root = roots.get(main.partname);
  if (!root) {
    add("part-root", main.partname, "/", "Missing document XML root.", "structure");
    return result();
  }
  let dialect;
  try { dialect = validatePackageDialect(graph, mains[0]!, root, budget); }
  catch (e) {
    if (!(e instanceof InvalidPackageError)) throw e;
    add(e.diagnosticCode, e.part ?? main.partname, e.location, e.message, "structure");
    return result();
  }
  const { w, r, wp } = documentDialects[dialect];
  const attr = (node: Node, name: string, namespace: string = w) => {
    budget.charge("work", node.element.attributes.length);
    return node.element.attributes.find(a => a.namespace === namespace && a.localName === name)?.value;
  };
  const children = (node: Node, name: string): Node[] => {
    budget.charge("work", node.element.content.length);
    return node.element.content.flatMap((child, i) => "source" in child && child.source.namespace === w && child.source.localName === name ?
      [{ ...node, element: child, location: `${node.location}/${name}[${i + 1}]` }] : []);
  };
  const issue = (node: Node, code: string, message: string) => add(code, node.part, node.location, message);
  const semanticParts = new Set([main.partname]);
  for (const edge of graph.relationships(main.partname)) {
    if (!edge.is_external && ["styles", "numbering", "header", "footer", "footnotes", "endnotes", "comments"].some(name => edge.reltype === `${r}/${name}`))
      semanticParts.add(edge.target_part.partname);
  }
  const nodes: Node[] = [];
  for (const part of graph.parts) {
    const partRoot = roots.get(part.partname);
    if (!partRoot || !semanticParts.has(part.partname) || !part.content_type.toLowerCase().startsWith(wordType)) continue;
    const view = new MarkupCompatibility(partRoot, documentCompatibilityProfile, budget);
    const visit = (content: typeof view.content, location: string, story: string) => {
      for (let i = 0; i < content.length; i++) {
        const element = content[i]!;
        if (!("source" in element) || element.disposition !== "understood") continue;
        const path = `${location}/${element.source.localName}[${i + 1}]`;
        const local = element.source.localName;
        const scope = element.source.namespace === w && ["footnote", "endnote", "comment", "txbxContent"].includes(local) ? path : story;
        nodes.push({ element, part: part.partname, location: path, story: part.partname + scope });
        visit(element.content, path, scope);
      }
    };
    visit(view.content, "", "/");
  }
  const definitions = new Map<string, Map<string, Node>>();
  const definitionNames: Record<string, string> = { style: "styleId", num: "numId", abstractNum: "abstractNumId", footnote: "id", endnote: "id", comment: "id" };
  for (const node of nodes) {
    if (node.element.source.namespace !== w) continue;
    const name = node.element.source.localName;
    if (!Object.hasOwn(definitionNames, name)) continue;
    const raw = attr(node, definitionNames[name]!);
    const id = name === "style" ? raw : integer(raw, name === "footnote" || name === "endnote" ? -1 : 0);
    const key = `${node.part}:${name}`;
    const entries = definitions.get(key) ?? new Map<string, Node>();
    if (id === undefined || id === "" || entries.has(id)) issue(node, name + "-id", "Missing, invalid or duplicate definition ID.");
    else entries.set(id, node);
    definitions.set(key, entries);
  }
  const relatedParts = new Map(graph.relationships(main.partname).filter(e => !e.is_external).map(e => [e.reltype, e.target_part.partname]));
  const related = (name: string): string | undefined => relatedParts.get(`${r}/${name}`);
  const relationships = new Map(graph.parts.filter(p => !p.content_type.toLowerCase().includes("relationships+xml")).map(p => [p.partname, new Map(graph.relationships(p.partname).map(e => [e.rId, e]))]));
  const lookup = (name: string, id: string | undefined, part = related(name === "style" ? "styles" : name === "num" || name === "abstractNum" ? "numbering" : name === "comment" ? "comments" : name + "s")) =>
    id === undefined || !part ? undefined : definitions.get(`${part}:${name}`)?.get(id);
  const completedStyles = new Set<Node>();
  for (const [key, entries] of definitions) {
    if (!key.endsWith(":style")) continue;
    const defaults = new Set<string>();
    for (const style of entries.values()) {
      const type = attr(style, "type") ?? "";
      if (["1", "true", "on"].includes(attr(style, "default") ?? "0")) {
        if (defaults.has(type)) issue(style, "style-default", "A style type has multiple defaults.");
        defaults.add(type);
      }
      for (const [tag, code] of [["basedOn", "style-base-type"], ["next", "style-next-type"], ["link", "style-link-type"]]) {
        const reference = children(style, tag!)[0];
        const target = reference && entries.get(attr(reference, "val") ?? "");
        if (!target) continue;
        const targetType = attr(target, "type");
        const compatible = tag === "link" ? type === "paragraph" && targetType === "character" || type === "character" && targetType === "paragraph"
          : tag === "next" ? type === "paragraph" && targetType === "paragraph" : type === targetType;
        if (!compatible) issue(reference!, code!, "Style relationship has incompatible types.");
      }
    }
    const completedLinks = new Set<Node>();
    for (const start of entries.values()) {
      const path = new Map<Node, number>();
      let current: Node | undefined = start;
      while (current && !completedLinks.has(current)) {
        budget.charge("work", 1);
        const previous = path.get(current);
        if (previous !== undefined) {
          if (path.size - previous !== 2) issue(current, "style-link-cycle", "Linked styles contain a cycle beyond a reciprocal pair.");
          break;
        }
        path.set(current, path.size);
        const link: Node | undefined = children(current, "link")[0];
        current = link ? entries.get(attr(link, "val") ?? "") : undefined;
      }
      for (const node of path.keys()) completedLinks.add(node);
    }
    for (const start of entries.values()) {
      const chain = new Set<Node>();
      let current: Node | undefined = start;
      while (current && !completedStyles.has(current)) {
        if (chain.has(current)) { issue(current, "style-cycle", "Style inheritance contains a cycle."); break; }
        chain.add(current);
        const base: Node | undefined = children(current, "basedOn")[0];
        current = base ? entries.get(attr(base, "val") ?? "") : undefined;
      }
      for (const node of chain) completedStyles.add(node);
    }
  }
  const numberingNext = new Map<Node, Node>();
  for (const node of nodes) {
    if (node.element.source.namespace !== w) continue;
    const name = node.element.source.localName;
    let target: Node | undefined;
    if (name === "num") {
      const id = children(node, "abstractNumId")[0];
      target = id && lookup("abstractNum", integer(attr(id, "val")), node.part);
    } else if (name === "abstractNum") {
      const link = children(node, "numStyleLink")[0];
      target = link && lookup("style", attr(link, "val"));
    } else if (name === "style") {
      const pPr = children(node, "pPr")[0];
      const numPr = pPr && children(pPr, "numPr")[0];
      const id = numPr && children(numPr, "numId")[0];
      target = id && lookup("num", integer(attr(id, "val")));
    }
    if (target) numberingNext.set(node, target);
  }
  const resolvedNumbering = new Map<Node, Node | undefined>();
  for (const start of numberingNext.keys()) {
    const chain = new Set<Node>();
    let current: Node | undefined = start;
    while (current && !resolvedNumbering.has(current)) {
      if (chain.has(current)) { issue(current, "numbering-cycle", "Numbering style dependencies contain a cycle."); current = undefined; break; }
      chain.add(current);
      const next: Node | undefined = numberingNext.get(current);
      if (!next) break;
      current = next;
    }
    const terminal = current && (resolvedNumbering.has(current) ? resolvedNumbering.get(current) : current);
    for (const node of chain) resolvedNumbering.set(node, terminal);
  }
  const unique = new Map<string, Set<string>>();
  const claim = (key: string, id: string | undefined) => {
    const set = unique.get(key) ?? new Set<string>();
    if (id === undefined || set.has(id)) return false;
    set.add(id); unique.set(key, set); return true;
  };
  const bookmarks = new Map<string, Node>();
  const fields = new Map<string, { node: Node; separated: boolean }[]>();
  const commentRanges = new Map<string, Node>();
  const revisionRanges = new Map<string, Node>();
  for (const node of nodes) {
    const name = node.element.source.localName;
    const namespace = node.element.source.namespace;
    for (const a of node.element.attributes) {
      if (a.namespace !== r || !["id", "embed", "link"].includes(a.localName)) continue;
      const edge = relationships.get(node.part)?.get(a.value);
      if (!edge) issue(node, "relationship-reference", "Relationship ID is not defined by the owning part.");
      const expected = namespace === w ? ({ hyperlink: "hyperlink", headerReference: "header", footerReference: "footer" } as Record<string, string>)[name]
        : namespace === documentDialects[dialect].a && name === "blip" ? "image" : undefined;
      if (edge && expected && edge.reltype !== `${r}/${expected}`) issue(node, "relationship-type", "Relationship type disagrees with the referring element.");
      if (edge && expected === "image" && !edge.is_external && !edge.target_part.content_type.toLowerCase().startsWith("image/"))
        issue(node, "relationship-content-type", "Image relationship target has a non-image content type.");
    }
    if (namespace === wp && name === "docPr" && !claim("drawing", integer(attr(node, "id", ""), 0, 4294967295))) issue(node, "drawing-id", "Invalid or duplicate document drawing ID.");
    if (namespace !== w) continue;
    if (["pStyle", "rStyle", "tblStyle", "basedOn", "next", "link", "numStyleLink", "styleLink"].includes(name) && !lookup("style", attr(node, "val"))) {
      if (attr(node, "val") !== undefined && !["numStyleLink", "styleLink"].includes(name)) styleFallback = true;
      else issue(node, "style-reference", "Style reference has no definition.");
    }
    const expectedStyleType: Record<string, string> = { pStyle: "paragraph", rStyle: "character", tblStyle: "table" };
    if (Object.hasOwn(expectedStyleType, name)) {
      const style = lookup("style", attr(node, "val"));
      if (style && attr(style, "type") !== expectedStyleType[name]) issue(node, "style-type", "Style type disagrees with its usage.");
    }
    if (name === "num" && children(node, "abstractNumId").length !== 1) issue(node, "numbering-reference", "Numbering instances require exactly one abstract reference.");
    if (name === "abstractNum" || name === "num") {
      const levels = children(node, name === "num" ? "lvlOverride" : "lvl");
      const ids = new Set<string>();
      for (const level of levels) {
        const id = integer(attr(level, "ilvl"), 0, 8);
        if (id === undefined || ids.has(id)) issue(level, "numbering-level", "Invalid or duplicate numbering level.");
        else ids.add(id);
      }
    }
    if (name === "numPr") {
      const numId = children(node, "numId")[0];
      const level = children(node, "ilvl")[0];
      const id = numId && integer(attr(numId, "val"));
      const ilvl = level ? integer(attr(level, "val"), 0, 8) : "0";
      const num = lookup("num", id);
      const abstractId = num && children(num, "abstractNumId")[0];
      const direct = abstractId && lookup("abstractNum", integer(attr(abstractId, "val")), abstractId.part);
      const abstract = direct && (resolvedNumbering.has(direct) ? resolvedNumbering.get(direct) : direct);
      const override = num && children(num, "lvlOverride").find(l => integer(attr(l, "ilvl")) === ilvl && children(l, "lvl").length === 1);
      if (ilvl === undefined || (id !== undefined && id !== "0" && num && !override &&
        (!abstract || !children(abstract, "lvl").some(l => integer(attr(l, "ilvl")) === ilvl)))) issue(node, "numbering-level", "Numbering level has no matching definition.");
    }
    if (name === "numId" && integer(attr(node, "val")) !== "0" && !lookup("num", integer(attr(node, "val")))) issue(node, "numbering-reference", "Numbering reference has no instance.");
    if (name === "abstractNumId" && !lookup("abstractNum", integer(attr(node, "val")), node.part)) issue(node, "numbering-reference", "Abstract numbering reference has no definition.");
    if (["footnoteReference", "endnoteReference", "commentReference", "commentRangeStart", "commentRangeEnd"].includes(name)) {
      const type = name.startsWith("footnote") ? "footnote" : name.startsWith("endnote") ? "endnote" : "comment";
      if (!lookup(type, integer(attr(node, "id")))) issue(node, type === "comment" ? "comment-reference" : "note-reference", "Annotation reference has no definition.");
    }
    if (name === "bookmarkStart" || name === "bookmarkEnd") {
      const id = integer(attr(node, "id"));
      const key = node.story + ":" + id;
      if (name === "bookmarkStart") {
        if (!claim(node.story + ":bookmark", id) || !claim("bookmark-name", attr(node, "name"))) issue(node, "bookmark-range", "Invalid or duplicate bookmark start.");
        bookmarks.set(key, node);
      } else if (id === undefined || !bookmarks.delete(key)) issue(node, "bookmark-range", "Bookmark end has no preceding start in this story.");
    }
    if (name === "commentRangeStart" || name === "commentRangeEnd") {
      const key = node.story + ":" + integer(attr(node, "id"));
      if (name === "commentRangeStart") {
        if (commentRanges.has(key)) issue(node, "comment-range", "Duplicate open comment range.");
        commentRanges.set(key, node);
      } else if (!commentRanges.delete(key)) issue(node, "comment-range", "Comment end has no preceding start.");
    }
    if (["ins", "del", "moveFrom", "moveTo", "rPrChange", "pPrChange", "sectPrChange", "tblPrChange", "trPrChange", "tcPrChange", "tblGridChange", "numberingChange", "cellIns", "cellDel", "cellMerge", "tblPrExChange"].includes(name) && !claim("revision", integer(attr(node, "id"))))
      issue(node, "revision-id", "Invalid or duplicate tracked revision ID.");
    for (const kind of ["moveFrom", "moveTo", "customXmlIns", "customXmlDel", "customXmlMoveFrom", "customXmlMoveTo"]) {
      if (name !== kind + "RangeStart" && name !== kind + "RangeEnd") continue;
      const id = integer(attr(node, "id"));
      const key = node.story + ":" + kind + ":" + id;
      if (name.endsWith("Start")) {
        if (!claim(node.story + ":" + kind, id)) issue(node, "revision-id", "Invalid or duplicate tracked range ID.");
        revisionRanges.set(key, node);
      } else if (id === undefined || !revisionRanges.delete(key)) issue(node, "revision-id", "Tracked range end has no matching preceding start.");
    }
    if (name === "fldChar") {
      const stack = fields.get(node.story) ?? [];
      const kind = attr(node, "fldCharType");
      if (kind === "begin") stack.push({ node, separated: false });
      else if (kind === "end" && stack.length) stack.pop();
      else if (kind === "separate" && stack.length && !stack.at(-1)!.separated) stack.at(-1)!.separated = true;
      else issue(node, "field-balance", "Unmatched or repeated field delimiter.");
      fields.set(node.story, stack);
    }
    if (name === "tbl") {
      const grids = children(node, "tblGrid");
      const width = grids.length === 1 ? children(grids[0]!, "gridCol").length : 0;
      const rows = children(node, "tr");
      if (width && rows.length) budget.table(rows.length, width);
      if (!width) issue(node, "table-grid", "A table needs one nonempty grid.");
      let previous = new Map<number, number>();
      for (const row of rows) {
        const properties = children(row, "trPr")[0];
        const count = (parent: Node | undefined, key: string, fallback: number) => {
          const value = parent && children(parent, key)[0];
          return value ? Number(integer(attr(value, "val")) ?? NaN) : fallback;
        };
        let column = count(properties, "gridBefore", 0);
        const next = new Map<number, number>();
        for (const cell of children(row, "tc")) {
          const props = children(cell, "tcPr")[0];
          const span = count(props, "gridSpan", 1);
          const merge = props && children(props, "vMerge")[0];
          if (!Number.isSafeInteger(span) || span < 1) issue(cell, "table-grid", "Invalid cell span.");
          if (merge) {
            const value = attr(merge, "val") ?? "continue";
            if (value !== "restart" && (value !== "continue" || previous.get(column) !== span)) issue(cell, "table-grid", "Vertical continuation does not match the preceding row span.");
            next.set(column, span);
          }
          column += span;
        }
        if (column + count(properties, "gridAfter", 0) !== width) issue(row, "table-grid", "Row cells and omitted slots disagree with the table grid.");
        previous = next;
      }
    }
  }
  for (const node of revisionRanges.values()) issue(node, "revision-id", "Tracked range start has no matching end.");
  for (const node of bookmarks.values()) issue(node, "bookmark-range", "Bookmark start has no end in this story.");
  for (const node of commentRanges.values()) issue(node, "comment-range", "Comment range start has no end.");
  for (const stack of fields.values()) for (const { node } of stack) issue(node, "field-balance", "Field begin has no end in this story.");
  return result();
}
