import { archiveSettings, type ArchiveContext, type DocumentArchive } from "./archive.js";
import type { DocumentBudget } from "./budget.js";
import { xmlValue } from "./create-content.js";
import { DocumentPackage, type PackageRelationship } from "./package.js";
import { DocumentArchiveEditor } from "./package-write.js";
import type { XmlElement } from "./package-xml.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import { admitControlPng } from "./control-picture.js";
import { containsRevision } from "./revision-markup.js";

const word = ["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"];
const relationships = ["http://schemas.openxmlformats.org/officeDocument/2006/relationships", "http://purl.oclc.org/ooxml/officeDocument/relationships"];
const drawingMain = ["http://schemas.openxmlformats.org/drawingml/2006/main", "http://purl.oclc.org/ooxml/drawingml/main"];
const pictures = ["http://schemas.openxmlformats.org/drawingml/2006/picture", "http://purl.oclc.org/ooxml/drawingml/picture"];
const drawings = ["http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing"];
function nodes(root: XmlElement, budget: DocumentBudget): XmlElement[] {
  budget.charge("work", 1); const result: XmlElement[] = [];
  const visit = (node: XmlElement): void => { budget.charge("work", node.children.length + node.attributes.length + 1); budget.charge("retainedBytes", 8); result.push(node); for (const child of node.children) visit(child); };
  visit(root); return result;
}
function parents(root: XmlElement, budget: DocumentBudget): Map<XmlElement, XmlElement> { budget.charge("work", 1); const result = new Map<XmlElement, XmlElement>(); for (const node of nodes(root, budget)) for (const child of node.children) { budget.charge("work", 1); budget.charge("retainedBytes", 16); result.set(child, node); } return result; }
function attribute(node: XmlElement, name: string, namespace = node.namespace): string | undefined { return node.attributes.find(attribute => attribute.namespace === namespace && attribute.localName === name)?.value; }
function number(value: string | undefined, signed = false): number {
  if (value === undefined || !value || [...value].some((char, index) => !"0123456789".includes(char) && !(signed && index === 0 && char === "-"))) throw new UnsupportedEditError("A template identity is malformed.");
  const result = Number(value); if (!Number.isSafeInteger(result) || result < (signed ? -2147483648 : 0) || result > 4294967295) throw new UnsupportedEditError("A template identity is out of range."); return result;
}
function opening(node: XmlElement, changes: ReadonlyMap<string, string> = new Map()): string {
  return `<${node.name}${[...node.namespaces].filter(([prefix]) => prefix !== "xml").map(([prefix, uri]) => ` ${prefix ? "xmlns:" + prefix : "xmlns"}="${xmlValue(uri)}"`).join("")}${node.attributes.filter(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/").map(attribute => ` ${attribute.name}="${xmlValue(changes.get(attribute.name) ?? attribute.value)}"`).join("")}>`;
}
export interface ControlClone { readonly xml: string; }
/** Plans owned identities and occurrence-local relationships without publishing source mutations. */
export class ControlClonePlanner {
  readonly #context: ReturnType<typeof archiveSettings>;
  readonly #package: DocumentPackage;
  readonly #identities = new Map<string, Set<number>>();
  readonly #names = new Set<string>();
  readonly #relationships = new Map<string, { id: string; edge: PackageRelationship }[]>();
  readonly #admittedMedia = new Set<string>();
  readonly #comments: { part: string; xml: string }[] = [];
  readonly #source = new Map<string, DocumentXmlEditor>();
  constructor(archive: DocumentArchive, context: ArchiveContext) {
    this.#context = archiveSettings(context); this.#package = new DocumentPackage(archive, this.#context.limits, this.#context.budget);
    const storyParts = new Map(Object.entries({ "document.main": "document", "template.main": "document", header: "hdr", footer: "ftr", footnotes: "footnotes", endnotes: "endnotes", comments: "comments" }).map(([kind, root]) => [`application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`, root]));
    for (const part of this.#package.parts) {
      const root = storyParts.get(part.content_type.toLowerCase()); if (root === undefined) continue;
      const xml = new DocumentXmlEditor(part.bytes, {}, undefined, this.#context.budget);
      if (!word.includes(xml.root.namespace) || xml.root.localName !== root) throw new UnsupportedEditError("A declared story part requires its matching WordprocessingML root.");
      this.#source.set(part.partname, xml);
      const owners = parents(xml.root, this.#context.budget);
      for (const node of nodes(xml.root, this.#context.budget)) {
        if (node.localName === "id" && word.includes(node.namespace) && owners.get(node)?.localName === "sdtPr" && owners.get(node)?.namespace === node.namespace && owners.get(owners.get(node)!)?.localName === "sdt" && owners.get(owners.get(node)!)?.namespace === node.namespace && attribute(node, "val") !== undefined) this.#taken("control").add(number(attribute(node, "val"), true));
        if (word.includes(node.namespace) && node.localName === "bookmarkStart") { this.#taken("bookmark").add(number(attribute(node, "id"))); this.#names.add(attribute(node, "name") ?? ""); }
        if (word.includes(node.namespace) && node.localName === "comment" && owners.get(node)?.localName === "comments" && owners.get(node)?.namespace === node.namespace) this.#taken("comment").add(number(attribute(node, "id")));
        if (drawings.includes(node.namespace) && node.localName === "docPr" || pictures.includes(node.namespace) && node.localName === "cNvPr") this.#taken("drawing").add(number(attribute(node, "id", "")));
      }
    }
  }
  #taken(kind: string): Set<number> { let values = this.#identities.get(kind); if (!values) { values = new Set(); this.#identities.set(kind, values); } return values; }
  #allocate(kind: string): string { const values = this.#taken(kind); let value = 1; while (values.has(value)) { this.#context.budget.charge("work", 1); value++; } if (value > 2147483647) throw new UnsupportedEditError("Template identities are exhausted."); values.add(value); return String(value); }
  admit(xml: DocumentXmlEditor, item: XmlElement): XmlElement[] {
    const all = nodes(item, this.#context.budget), budget = this.#context.budget;
    const supported = new Set("comment sdt sdtPr sdtEndPr sdtContent id tag alias lock text richText picture date dateFormat lid calendar storeMappedDataAs dropDownList comboBox listItem showingPlcHdr placeholder docPart temporary color appearance p pPr r rPr t tab br cr tbl tblPr tblGrid gridCol tr trPr tc tcPr tblStyle tblW tblInd tblBorders top left bottom right insideH insideV tblLayout tblCellMar tcW vAlign cantSplit tblHeader jc spacing ind keepNext keepLines pageBreakBefore widowControl numPr ilvl numId pStyle rStyle b bCs i iCs u strike dstrike caps smallCaps sz szCs rFonts lang highlight shd vertAlign noProof position kern w fitText rtl cs vanish webHidden textDirection drawing hyperlink bookmarkStart bookmarkEnd commentRangeStart commentRangeEnd commentReference".split(" "));
    const attributeNames: Readonly<Record<string, readonly string[]>> = {
      comment: ["id", "author", "date", "initials"],
      p: ["rsidR", "rsidRDefault", "rsidP", "rsidDel"], r: ["rsidR", "rsidRPr", "rsidDel"], tr: ["rsidR", "rsidTr", "rsidDel"], tbl: ["rsidR"], sdt: [], sdtPr: [], sdtEndPr: [], sdtContent: [], pPr: [], rPr: [], tblPr: [], tblGrid: [], trPr: [], tc: [], tcPr: [], t: [], drawing: [],
      bookmarkStart: ["id", "name", "colFirst", "colLast", "displacedByCustomXml"], bookmarkEnd: ["id", "displacedByCustomXml"], commentRangeStart: ["id", "displacedByCustomXml"], commentRangeEnd: ["id", "displacedByCustomXml"], commentReference: ["id"], hyperlink: ["anchor", "history", "docLocation", "tgtFrame", "tooltip"],
      date: ["fullDate"], dropDownList: ["lastValue"], comboBox: ["lastValue"], listItem: ["value", "displayText"], text: ["multiLine"], richText: [], picture: [], placeholder: [], temporary: [], showingPlcHdr: [], gridCol: ["w"],
      rFonts: ["ascii", "hAnsi", "eastAsia", "cs", "hint", "asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"], lang: ["val", "eastAsia", "bidi"], spacing: ["before", "after", "beforeLines", "afterLines", "beforeAutospacing", "afterAutospacing", "line", "lineRule"], ind: ["left", "right", "start", "end", "firstLine", "hanging", "leftChars", "rightChars", "firstLineChars", "hangingChars"], shd: ["val", "color", "fill", "themeColor", "themeFill", "themeTint", "themeShade", "themeFillTint", "themeFillShade"], color: ["val", "themeColor", "themeTint", "themeShade"], u: ["val", "color", "themeColor", "themeTint", "themeShade"], br: ["type", "clear"], tab: [],
    };
    const sized = new Set("tblW tblInd tcW".split(" "));
    const borders = new Set("top left bottom right insideH insideV".split(" "));
    for (const node of all) for (const attr of node.attributes.filter(attribute => word.includes(attribute.namespace))) {
      const admitted = attributeNames[node.localName] ?? (sized.has(node.localName) ? ["w", "type"] : borders.has(node.localName) ? ["val", "sz", "space", "color", "themeColor", "themeTint", "themeShade", "shadow", "frame"] : ["val"]);
      if (!admitted.includes(attr.localName)) throw new UnsupportedEditError("The template has an unverified attribute.");
    }
    budget.charge("work", all.length * 8);
    if (containsRevision(item)) throw new UnsupportedEditError("Reviewed templates cannot be cloned.");
    for (const node of all) {
      if (word.includes(node.namespace) && !supported.has(node.localName) || !xml.compatibility.canEdit(node) || node.attributes.some(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/" && !xml.compatibility.canEdit(attribute)) || ["fldChar", "fldSimple", "permStart", "permEnd", "footnoteReference", "endnoteReference", "sectPr", "object", "pict"].includes(node.localName) || node.content.some(content => content.kind !== "element" && (content.kind !== "text" || content.text.trim() && !["t", "instrText"].includes(node.localName)))) throw new UnsupportedEditError("The template contains unsupported boundaries or opaque data.");
    }
    return all;
  }
  preflight(xml: DocumentXmlEditor, item: XmlElement, owner: string): void {
    const all = this.admit(xml, item), owned = new Set(all), stack: string[] = [];
    for (const node of all.filter(node => node.namespace === item.namespace)) {
      if (node.localName === "bookmarkStart") {
        const id = attribute(node, "id"), name = attribute(node, "name"); number(id);
        if (!name || all.filter(candidate => candidate.namespace === item.namespace && candidate.localName === "bookmarkStart" && attribute(candidate, "id") === id).length !== 1) throw new UnsupportedEditError("Bookmark declarations must be unique.");
        if ([...this.#source].some(([part, source]) => nodes(part === owner ? xml.root : source.root, this.#context.budget).some(candidate => !owned.has(candidate) && word.includes(candidate.namespace) && candidate.localName === "hyperlink" && attribute(candidate, "anchor") === name))) throw new UnsupportedEditError("Bookmark references cannot cross the template boundary.");
        stack.push(id!);
      } else if (node.localName === "bookmarkEnd" && stack.pop() !== attribute(node, "id")) throw new UnsupportedEditError("Bookmark ranges cannot cross template boundaries.");
      if (["commentRangeStart", "commentRangeEnd", "commentReference"].includes(node.localName)) {
        const id = number(attribute(node, "id"));
        const markers = all.filter(candidate => candidate.namespace === item.namespace && ["commentRangeStart", "commentRangeEnd", "commentReference"].includes(candidate.localName) && number(attribute(candidate, "id")) === id);
        if (["commentRangeStart", "commentRangeEnd", "commentReference"].some(name => markers.filter(marker => marker.localName === name).length !== 1) || all.indexOf(markers.find(marker => marker.localName === "commentRangeStart")!) >= all.indexOf(markers.find(marker => marker.localName === "commentRangeEnd")!) || [...this.#source].some(([part, source]) => nodes(part === owner ? xml.root : source.root, this.#context.budget).some(candidate => !owned.has(candidate) && candidate.namespace === item.namespace && ["commentRangeStart", "commentRangeEnd", "commentReference"].includes(candidate.localName) && number(attribute(candidate, "id")) === id))) throw new UnsupportedEditError("Comments must have ordered complete owned ranges.");
      }
    }
    if (stack.length) throw new UnsupportedEditError("Bookmarks cross the template boundary.");
    const markers = all.filter(node => node.namespace === item.namespace && ["commentRangeStart", "commentRangeEnd", "commentReference"].includes(node.localName));
    if (markers.length) {
      if (this.#package.parts.some(part => ["commentsExtended", "commentsIds", "commentsExtensible", "people"].some(name => part.content_type.includes(name)))) throw new UnsupportedEditError("Modern comments cannot be cloned.");
      const edges = this.#package.relationships(owner).filter(edge => edge.reltype.endsWith("/comments"));
      if (edges.length !== 1 || edges[0]!.is_external) throw new UnsupportedEditError("A classic comment part is required.");
      const comments = this.#source.get(edges[0]!.target_part.partname)!;
      for (const id of new Set(markers.map(node => number(attribute(node, "id"))))) {
        const bodies = comments.root.children.filter(node => node.namespace === item.namespace && node.localName === "comment" && number(attribute(node, "id")) === id);
        if (bodies.length !== 1 || nodes(bodies[0]!, this.#context.budget).some(node => !comments.compatibility.canEdit(node) || node.attributes.some(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/" && !comments.compatibility.canEdit(attribute)) || !["comment", "p", "pPr", "r", "rPr", "t", "tab", "br", "cr", "b", "i", "rFonts"].includes(node.localName))) throw new UnsupportedEditError("A comment requires one supported stored body.");
        this.admit(comments, bodies[0]!);
      }
    }
    for (const node of all) for (const attr of node.attributes.filter(attribute => relationships.includes(attribute.namespace))) {
      if (!(["embed", "link"].includes(attr.localName) && node.localName === "blip" || attr.localName === "id" && node.localName === "hyperlink")) throw new UnsupportedEditError("The template relationship occurrence is unsupported.");
      const edge = this.#package.relationships(owner).find(edge => edge.rId === attr.value);
      if (!edge || !(edge.reltype.endsWith("/image") || edge.reltype.endsWith("/hyperlink")) || edge.is_external && !edge.reltype.endsWith("/hyperlink")) throw new UnsupportedEditError("The template relationship is unsupported.");
    }
  }
  async admitMedia(xml: DocumentXmlEditor, item: XmlElement, owner: string): Promise<void> {
    const all = nodes(item, this.#context.budget), owners = parents(item, this.#context.budget);
    for (const drawing of all.filter(node => word.includes(node.namespace) && node.localName === "drawing")) {
      const one = (node: XmlElement, name: string, namespaces: readonly string[]) => { const found = node.children.filter(child => namespaces.includes(child.namespace) && child.localName === name); if (found.length !== 1) throw new UnsupportedEditError("The cloned picture grammar is unsupported."); return found[0]!; };
      const inline = one(drawing, "inline", drawings), extent = one(inline, "extent", drawings); one(inline, "docPr", drawings);
      for (const field of ["cx", "cy"]) if (number(attribute(extent, field, "")) < 1) throw new UnsupportedEditError("Picture extents must be positive.");
      const graphic = one(inline, "graphic", drawingMain), data = one(graphic, "graphicData", drawingMain), picture = one(data, "pic", pictures);
      if (attribute(data, "uri", "") !== picture.namespace) throw new UnsupportedEditError("The picture dialect is inconsistent.");
      const properties = one(picture, "nvPicPr", pictures); one(properties, "cNvPr", pictures); one(properties, "cNvPicPr", pictures);
      const fill = one(picture, "blipFill", pictures), blip = one(fill, "blip", drawingMain), stretch = one(fill, "stretch", drawingMain); one(stretch, "fillRect", drawingMain);
      const shape = one(picture, "spPr", pictures), transform = one(shape, "xfrm", drawingMain); one(transform, "off", drawingMain); one(transform, "ext", drawingMain);
      const geometry = one(shape, "prstGeom", drawingMain); if (attribute(geometry, "prst", "") !== "rect") throw new UnsupportedEditError("Only rectangular pictures are admitted."); one(geometry, "avLst", drawingMain);
      const embed = blip.attributes.filter(attr => relationships.includes(attr.namespace) && attr.localName === "embed");
      if (embed.length !== 1 || blip.attributes.some(attr => relationships.includes(attr.namespace) && attr.localName === "link")) throw new UnsupportedEditError("Only internal picture embeds are admitted.");
      const edge = this.#package.relationships(owner).find(edge => edge.rId === embed[0]!.value);
      if (!edge || edge.is_external || !edge.reltype.endsWith("/image") || edge.target_part.content_type !== "image/png") throw new UnsupportedEditError("Only admitted internal PNG pictures are cloned.");
      if (!this.#admittedMedia.has(edge.target_part.partname)) { this.#context.budget.charge("embeddedMediaBytes", edge.target_part.bytes.length); await admitControlPng(edge.target_part.bytes, this.#context); this.#admittedMedia.add(edge.target_part.partname); }
      for (const node of nodes(drawing, this.#context.budget)) if (!(word.includes(node.namespace) && node.localName === "drawing" || drawings.includes(node.namespace) && ["inline", "extent", "docPr"].includes(node.localName) || pictures.includes(node.namespace) && ["pic", "nvPicPr", "cNvPr", "cNvPicPr", "blipFill", "spPr"].includes(node.localName) || drawingMain.includes(node.namespace) && ["graphic", "graphicData", "blip", "stretch", "fillRect", "xfrm", "off", "ext", "prstGeom", "avLst"].includes(node.localName))) throw new UnsupportedEditError("The picture contains unverified drawing markup.");
      const profile: Readonly<Record<string, { children: readonly string[]; attributes: readonly string[] }>> = {
        drawing: { children: ["inline"], attributes: [] }, inline: { children: ["extent", "docPr", "graphic"], attributes: ["distT", "distB", "distL", "distR"] }, extent: { children: [], attributes: ["cx", "cy"] }, docPr: { children: [], attributes: ["id", "name", "descr", "hidden"] }, graphic: { children: ["graphicData"], attributes: [] }, graphicData: { children: ["pic"], attributes: ["uri"] }, pic: { children: ["nvPicPr", "blipFill", "spPr"], attributes: [] }, nvPicPr: { children: ["cNvPr", "cNvPicPr"], attributes: [] }, cNvPr: { children: [], attributes: ["id", "name", "descr", "hidden"] }, cNvPicPr: { children: [], attributes: [] }, blipFill: { children: ["blip", "stretch"], attributes: [] }, blip: { children: [], attributes: [] }, stretch: { children: ["fillRect"], attributes: [] }, fillRect: { children: [], attributes: [] }, spPr: { children: ["xfrm", "prstGeom"], attributes: [] }, xfrm: { children: ["off", "ext"], attributes: [] }, off: { children: [], attributes: ["x", "y"] }, ext: { children: [], attributes: ["cx", "cy"] }, prstGeom: { children: ["avLst"], attributes: ["prst"] }, avLst: { children: [], attributes: [] },
      };
      for (const node of nodes(drawing, this.#context.budget)) {
        const declaration = profile[node.localName];
        if (!declaration || node.children.some(child => !declaration.children.includes(child.localName)) || node.children.length !== declaration.children.length || new Set(node.children.map(child => child.localName)).size !== node.children.length || node.attributes.some(attr => attr.namespace !== "http://www.w3.org/2000/xmlns/" && !(attr.namespace === "" && declaration.attributes.includes(attr.localName) || node === blip && relationships.includes(attr.namespace) && attr.localName === "embed"))) throw new UnsupportedEditError("The picture has unverified structural or attribute semantics.");
      }
      if (owners.get(drawing)?.localName !== "r") throw new UnsupportedEditError("Pictures require an ordinary run owner.");
    }
  }
  clone(xml: DocumentXmlEditor, item: XmlElement, owner: string): ControlClone {
    const budget = this.#context.budget; const owners = parents(item, this.#context.budget); this.preflight(xml, item, owner); const all = this.admit(xml, item); const owned = new Set(all); const attributeChanges = new Map<XmlElement, Map<string, string>>();
    budget.charge("insertedNodes", all.length); budget.charge("retainedBytes", all.length * 256);
    const change = (node: XmlElement, field: string, value: string, namespace = node.namespace) => {
      const attr = node.attributes.find(attribute => attribute.namespace === namespace && attribute.localName === field); if (!attr) throw new UnsupportedEditError("The template identity attribute is missing.");
      const changes = attributeChanges.get(node) ?? new Map(); changes.set(attr.name, value); attributeChanges.set(node, changes);
    };
    const starts = all.filter(node => node.localName === "bookmarkStart" && node.namespace === item.namespace); const ends = all.filter(node => node.localName === "bookmarkEnd" && node.namespace === item.namespace);
    for (const start of starts) {
      const id = number(attribute(start, "id")), name = attribute(start, "name"); const paired = ends.filter(end => number(attribute(end, "id")) === id);
      if (!name || starts.filter(node => number(attribute(node, "id")) === id).length !== 1 || paired.length !== 1 || all.indexOf(paired[0]!) < all.indexOf(start)) throw new UnsupportedEditError("Bookmarks must have complete owned pairs.");
      if ([...this.#source].some(([part, source]) => nodes(part === owner ? xml.root : source.root, this.#context.budget).some(node => !owned.has(node) && word.includes(node.namespace) && node.localName === "hyperlink" && attribute(node, "anchor") === name))) throw new UnsupportedEditError("Bookmark references cannot cross the template boundary.");
      const fresh = this.#allocate("bookmark"); let suffix = 1, newName: string; do { newName = name.slice(0, 30) + "_" + suffix++; } while (this.#names.has(newName)); this.#names.add(newName);
      change(start, "id", fresh); change(paired[0]!, "id", fresh); change(start, "name", newName);
      for (const link of all.filter(node => node.namespace === item.namespace && node.localName === "hyperlink" && attribute(node, "anchor") === name)) change(link, "anchor", newName);
    }
    if (ends.length !== starts.length || ends.some(end => !starts.some(start => attribute(start, "id") === attribute(end, "id")))) throw new UnsupportedEditError("Bookmarks cross the template boundary.");
    const commentMarkers = all.filter(node => node.namespace === item.namespace && ["commentRangeStart", "commentRangeEnd", "commentReference"].includes(node.localName));
    if (commentMarkers.length) {
      if (this.#package.parts.some(part => ["commentsExtended", "commentsIds", "commentsExtensible", "people"].some(name => part.content_type.includes(name)))) throw new UnsupportedEditError("Modern comments cannot be cloned.");
      const edges = this.#package.relationships(owner).filter(edge => edge.reltype.endsWith("/comments")); if (edges.length !== 1 || edges[0]!.is_external) throw new UnsupportedEditError("A classic comment part is required.");
      const part = edges[0]!.target_part.partname, comments = this.#source.get(part)!;
      for (const id of new Set(commentMarkers.map(node => number(attribute(node, "id"))))) {
        const markers = commentMarkers.filter(node => number(attribute(node, "id")) === id);
        if (["commentRangeStart", "commentRangeEnd", "commentReference"].some(name => markers.filter(node => node.localName === name).length !== 1) || [...this.#source].some(([name, source]) => nodes(name === owner ? xml.root : source.root, this.#context.budget).some(node => !owned.has(node) && node.namespace === item.namespace && ["commentRangeStart", "commentRangeEnd", "commentReference"].includes(node.localName) && number(attribute(node, "id")) === id))) throw new UnsupportedEditError("Comments must be entirely owned by one item.");
        const body = comments.root.children.filter(node => node.namespace === item.namespace && node.localName === "comment" && number(attribute(node, "id")) === id); if (body.length !== 1) throw new UnsupportedEditError("A comment requires one stored body.");
        if (nodes(body[0]!, this.#context.budget).some(node => !comments.compatibility.canEdit(node) || node.attributes.some(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/" && !comments.compatibility.canEdit(attribute)) || !["comment", "p", "pPr", "r", "rPr", "t", "tab", "br", "cr", "b", "i", "rFonts"].includes(node.localName))) throw new UnsupportedEditError("The comment body has unsupported cloning semantics.");
        const fresh = this.#allocate("comment"); const attr = body[0]!.attributes.find(attribute => attribute.namespace === item.namespace && attribute.localName === "id")!;
        this.#comments.push({ part, xml: opening(body[0]!, new Map([[attr.name, fresh]])) + comments.sourceXml(body[0]!, new Map(), true) + `</${body[0]!.name}>` }); for (const marker of markers) change(marker, "id", fresh);
      }
    }
    for (const node of all) {
      if (node.namespace === item.namespace && node.localName === "id" && owners.get(node)?.localName === "sdtPr" && owners.get(node)?.namespace === node.namespace && attribute(node, "val") !== undefined) change(node, "val", this.#allocate("control"));
      if (drawings.includes(node.namespace) && node.localName === "docPr" || pictures.includes(node.namespace) && node.localName === "cNvPr") change(node, "id", this.#allocate("drawing"), "");
      for (const attr of node.attributes.filter(attribute => relationships.includes(attribute.namespace))) {
        if (!(["embed", "link"].includes(attr.localName) && node.localName === "blip" || attr.localName === "id" && node.localName === "hyperlink")) throw new UnsupportedEditError("The template relationship occurrence is unsupported.");
        const edge = this.#package.relationships(owner).find(edge => edge.rId === attr.value); if (!edge || !(edge.reltype.endsWith("/image") || edge.reltype.endsWith("/hyperlink")) || edge.is_external && !edge.reltype.endsWith("/hyperlink")) throw new UnsupportedEditError("The template relationship is unsupported.");
        const additions = this.#relationships.get(owner) ?? []; const taken = new Set([...this.#package.relationships(owner).map(edge => edge.rId), ...additions.map(item => item.id)]); let ordinal = 1; while (taken.has(`rId${ordinal}`)) ordinal++;
        const id = `rId${ordinal}`; additions.push({ id, edge }); this.#relationships.set(owner, additions); change(node, attr.localName, id, attr.namespace);
      }
    }
    const render = (node: XmlElement): string => {
      const nested = new Map<XmlElement, string>(); for (const child of node.children) if (all.some(owner => attributeChanges.has(owner) && nodes(child, this.#context.budget).includes(owner))) nested.set(child, render(child));
      return attributeChanges.has(node) || node === item ? opening(node, attributeChanges.get(node)) + xml.sourceXml(node, nested, true) + `</${node.name}>` : xml.sourceXml(node, nested);
    };
    const result = render(item); budget.charge("retainedBytes", result.length * 8); budget.charge("work", result.length); return { xml: result };
  }
  finish(editor: DocumentArchiveEditor): DocumentArchive {
    for (const [owner, additions] of this.#relationships) {
      const slash = owner.lastIndexOf("/"), name = owner.slice(1, slash + 1) + "_rels/" + owner.slice(slash + 1) + ".rels"; const xml = editor.xml(name); const prefix = xml.root.name.includes(":") ? xml.root.name.slice(0, xml.root.name.indexOf(":") + 1) : "";
      xml.insertChildren(xml.root, additions.map(item => `<${prefix}Relationship Id="${item.id}" Type="${xmlValue(item.edge.reltype)}" Target="${xmlValue(item.edge.target_ref)}"${item.edge.is_external ? ' TargetMode="External"' : ""}/>`).join(""));
    }
    const comments = new Map<string, string[]>(); for (const item of this.#comments) { const items = comments.get(item.part) ?? []; items.push(item.xml); comments.set(item.part, items); }
    for (const [part, items] of comments) { const xml = editor.xml(part.slice(1)); xml.insertChildren(xml.root, items.join("")); }
    return editor.snapshot();
  }
}
