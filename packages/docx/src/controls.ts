import { archiveSettings, InvalidValueError, type ArchiveContext } from "./archive.js";
import { validateDocxInvocation } from "./command.js";
import type { CompatibilityContent } from "./compatibility.js";
import { xmlValue } from "./create-content.js";
import { parseFields, assertOutsideFields } from "./field-parser.js";
import { assertOutsideRevisionRanges, containsRevision } from "./revision-markup.js";
import { pathContains } from "./location-index.js";
import { closedRecord, encodeLocation, SelectionError, type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import type { DocxOperationArguments, DocxBinaryInput } from "./operation-types.js";
import { DocumentArchiveEditor } from "./package-write.js";
import type { XmlElement } from "./package-xml.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";
import { replaceControlPicture, finishControlPictures, readControlPicture, acquireControlPng, type ControlBinaryResolver, type ControlPicture } from "./control-picture.js";

const w14 = "http://schemas.microsoft.com/office/word/2010/wordml";
export interface ControlContext extends PublicationContext { readonly binaryResolver?: ControlBinaryResolver; }
export interface ControlSnapshot {
  readonly location: Location<"control">;
  readonly kind: "plain-text" | "rich-text" | "checkbox" | "dropdown" | "combo-box" | "date" | "picture" | "unsupported";
  readonly id: string | null; readonly tag: string | null; readonly alias: string | null;
  readonly lock: string; readonly placeholder: boolean;
  readonly binding: null | { readonly storeItemId: string | null; readonly xpath: string | null; readonly prefixMappings: string | null };
  readonly value: string | boolean | ControlPicture | null;
  readonly choices: readonly { readonly value: string; readonly label: string }[];
  readonly support: "supported" | "unsupported"; readonly reason: string | null;
}
export interface ControlReadData { readonly items: readonly ControlSnapshot[]; }
export interface ControlEditData {
  readonly changed: boolean; readonly changes: readonly { readonly kind: "replace"; readonly before: Location; readonly after: Location }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null; readonly dryRun: boolean;
}
function attr(node: XmlElement | undefined, name: string, namespace = node?.namespace): string | null {
  return node?.attributes.find(attribute => attribute.namespace === namespace && attribute.localName === name)?.value ?? null;
}
function child(node: XmlElement, name: string, namespace = node.namespace): XmlElement | undefined {
  const result = node.children.filter(element => element.namespace === namespace && element.localName === name);
  if (result.length > 1) throw new UnsupportedEditError("Repeated control properties are unsupported.");
  return result[0];
}
function walk(node: XmlElement): XmlElement[] { return [node, ...node.children.flatMap(walk)]; }
function owners(root: XmlElement, path: readonly number[]): XmlElement[] {
  const result = [root]; for (const index of path) result.push(result.at(-1)!.children[index]!); return result;
}
function logicalText(content: XmlElement, xml: DocumentXmlEditor): string {
  const children = new Map<XmlElement, XmlElement[]>();
  const index = (nodes: readonly CompatibilityContent[]) => { for (const node of nodes) if ("source" in node) { children.set(node.source, node.content.filter(n => "source" in n).map(n => n.source)); index(node.content); } }; index(xml.compatibility.content);
  const visit = (node: XmlElement): string => node.localName === "t" && node.namespace === content.namespace ? node.text :
    node.namespace === content.namespace && ["tab", "br", "cr"].includes(node.localName) ? node.localName === "tab" ? "\t" : "\n" :
      (children.get(node) ?? []).map(visit).join(node.localName === "sdtContent" && (children.get(node) ?? []).every(n => n.localName === "p") ? "\n" : "");
  return visit(content);
}
function snapshot(node: XmlElement, location: Location<"control">, archive: ReturnType<DocumentArchiveEditor["snapshot"]>, context: ArchiveContext, xml: DocumentXmlEditor): ControlSnapshot {
  let kind: ControlSnapshot["kind"] = "unsupported", value: ControlSnapshot["value"] = null, reason: string | null = null;
  let properties: XmlElement | undefined, content: XmlElement | undefined;
  const choices: { value: string; label: string }[] = [];
  try {
    properties = child(node, "sdtPr"); content = child(node, "sdtContent");
    if (!properties || !content) throw new UnsupportedEditError("A control requires one properties and content owner.");
    if (properties.children.some(owner => owner.namespace === node.namespace && ["docPartObj", "docPartList", "citation", "bibliography", "equation", "group"].includes(owner.localName) || owner.namespace === w14 && ["repeatingSection", "repeatingSectionItem"].includes(owner.localName))) throw new UnsupportedEditError("This stored control type has no verified scalar semantics.");
    const kinds = properties.children.filter(n => n.namespace === node.namespace && ["text", "richText", "dropDownList", "comboBox", "date", "picture"].includes(n.localName) || n.namespace === w14 && n.localName === "checkbox");
    if (kinds.length > 1) throw new UnsupportedEditError("Conflicting control types are unsupported.");
    const type = kinds[0];
    const names: Readonly<Record<string, ControlSnapshot["kind"]>> = { text: "plain-text", checkbox: "checkbox", dropDownList: "dropdown", comboBox: "combo-box", date: "date", picture: "picture", richText: "rich-text" };
    kind = type ? names[type.localName]! : "rich-text";
    value = logicalText(content, xml);
    if (kind === "checkbox") { const checked = attr(child(type!, "checked", w14), "val", w14); value = checked === "1" || checked === "true"; if (!["0", "1", "true", "false"].includes(checked ?? "")) throw new UnsupportedEditError("Malformed checkbox state."); }
    if (kind === "dropdown" || kind === "combo-box") {
      for (const item of type!.children) {
        if (item.namespace !== node.namespace || item.localName !== "listItem") throw new UnsupportedEditError("Unsupported choice declaration.");
        const stored = attr(item, "value"), label = attr(item, "displayText");
        if (stored === null || label === null || choices.some(choice => choice.value === stored)) throw new UnsupportedEditError("Choice values must be distinct declared values.");
        choices.push({ value: stored, label });
      }
    }
    if (kind === "date") value = attr(type!, "fullDate");
    if (kind === "picture") value = readControlPicture(archive, location.value.part, content, context);
  } catch (error) { if (!(error instanceof UnsupportedEditError)) throw error; reason = error.message; }
  let id: string | null = null, tag: string | null = null, alias: string | null = null, lock = "unknown", placeholder = false, binding: ControlSnapshot["binding"] = null;
  try { if (properties) {
    id = attr(child(properties, "id"), "val"); tag = attr(child(properties, "tag"), "val"); alias = attr(child(properties, "alias"), "val"); lock = attr(child(properties, "lock"), "val") ?? "unlocked";
    placeholder = child(properties, "showingPlcHdr") !== undefined; const descriptor = child(properties, "dataBinding");
    if (descriptor) binding = { storeItemId: attr(descriptor, "storeItemID"), xpath: attr(descriptor, "xpath"), prefixMappings: attr(descriptor, "prefixMappings") };
  } } catch (error) { if (!(error instanceof UnsupportedEditError)) throw error; reason ??= error.message; }
  return { location, kind, id, tag, alias, lock, placeholder, binding,
    value, choices, support: reason === null ? "supported" : "unsupported", reason };
}
async function inventory(input: Uint8Array, options: DocxOperationArguments<"controls.list">, context: ArchiveContext) {
  const settings = archiveSettings(context); const document = await openDocumentLocations(input, settings); const archive = document.snapshot();
  const query = { ...(options.scope ? { scope: options.scope } : {}), ...(options.section ? { section: options.section } : {}) };
  let owner: Location | undefined = options.select ? document.resolve(options.select) : undefined;
  if (owner?.value.range) throw new UnsupportedEditError("Control selection requires a whole owner.");
  if (options.comment !== undefined || options.note !== undefined) owner = document.at("story", (options.comment ?? options.note)!, { scope: options.comment !== undefined ? "comments" : options.scope! });
  for (const kind of ["table", "cell", "paragraph", "run", "image", "link", "bookmark", "field"] as const) if (options[kind] !== undefined) {
    if (kind === "cell") owner = document.cell(owner!.token, options.cell!);
    else owner = document.at(kind, options[kind] as number, owner ? { owner: owner.token } : query);
  }
  let selected = document.list("control", owner ? { owner: owner.token } : query);
  if (options.control !== undefined) { const item = selected[options.control - 1]; if (!item) throw new SelectionError("missing-selection"); selected = [item]; }
  if (options.select && !selected.length) throw new SelectionError("missing-selection");
  const editor = new DocumentArchiveEditor(archive, {}, undefined, settings.budget);
  return { document, archive, editor, items: selected.map(location => { const xml = editor.xml(location.value.part.slice(1)); return snapshot(owners(xml.root, location.value.path).at(-1)!, location, archive, settings, xml); }) };
}
export async function inspectDocumentControls(input: Uint8Array, options: DocxOperationArguments<"controls.list"> = {}, context: ArchiveContext): Promise<ControlReadData> {
  const settings = archiveSettings(context); const invocation = validateDocxInvocation({ operation: "controls.list", inputs: ["document"], options }, settings.budget);
  const opts = invocation.options as typeof options; const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const result = await inventory(input, opts, { ...settings, budget }); return { items: result.items };
}
function opening(node: XmlElement): string {
  return `<${node.name}${node.attributes.map(a => ` ${a.name}="${xmlValue(a.value)}"`).join("")}>`;
}
function textReplacement(xml: DocumentXmlEditor, content: XmlElement, text: string, font?: string): string {
  const w = content.namespace; const nodes = walk(content);
  if (nodes.some(node => node.namespace !== w || !["sdtContent", "p", "pPr", "r", "rPr", "t", "tab", "br", "cr"].includes(node.localName) &&
    !nodes.some(owner => ["pPr", "rPr"].includes(owner.localName) && walk(owner).includes(node)))) throw new UnsupportedEditError("Only ordinary text containers support scalar filling.");
  if (content.children.some(n => !["r", "p"].includes(n.localName)) || content.children.some(n => n.localName === "p") && content.children.some(n => n.localName !== "p")) throw new UnsupportedEditError("Mixed text containers are unsupported.");
  const first = nodes.find(n => n.namespace === w && n.localName === "r"); const prefix = content.name.includes(":") ? content.name.slice(0, content.name.indexOf(":") + 1) : "";
  const name = (local: string) => prefix + local; const properties = first && child(first, "rPr");
  let propertyXml = properties ? xml.sourceXml(properties) : "";
  if (font) {
    const fonts = properties && child(properties, "rFonts"); const fontName = fonts?.name ?? name("rFonts");
    const retained = fonts?.attributes.filter(attribute => attribute.namespace !== w || !["ascii", "hAnsi", "eastAsia", "cs", "asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"].includes(attribute.localName)).map(attribute => ` ${attribute.name}="${xmlValue(attribute.value)}"`).join("") ?? "";
    const fontXml = `<${fontName}${retained}${["ascii", "hAnsi", "eastAsia", "cs"].map(local => ` ${prefix}${local}="${xmlValue(font)}"`).join("")}/>`;
    propertyXml = properties ? opening(properties) + xml.sourceXml(properties, fonts ? new Map([[fonts, fontXml]]) : new Map(), true) + (fonts ? "" : fontXml) + `</${properties.name}>` : `<${name("rPr")}>${fontXml}</${name("rPr")}>`;
  }
  let value = "", fragment = ""; const flush = () => { if (fragment) { value += `<${name("t")} xml:space="preserve">${xmlValue(fragment)}</${name("t")}>`; fragment = ""; } };
  for (const char of text) { if (char === "\t" || char === "\n") { flush(); value += `<${name(char === "\t" ? "tab" : "br")}/>`; } else fragment += char; } flush();
  let firstOpening = first ? opening(first) : "";
  if (first) {
    const inheritance = new Map<string, string>();
    const collect = (owner: XmlElement, inherited: ReadonlyMap<string, string>): boolean => {
      const next = new Map(inherited); for (const attribute of owner.attributes) if (attribute.namespace === "http://www.w3.org/XML/1998/namespace") {
        if (!["lang", "space"].includes(attribute.localName) && owner !== content && owner !== first) throw new UnsupportedEditError("Moving a run with unsupported inherited XML semantics is unsupported.");
        if (["lang", "space"].includes(attribute.localName)) next.set(attribute.localName, attribute.value);
      }
      if (owner === first) { for (const [key, value] of next) inheritance.set(key, value); return true; }
      return owner.children.some(child => collect(child, next));
    }; collect(content, new Map());
    const namespaces = [...first.namespaces].filter(([prefix]) => prefix !== "xml" && !first.attributes.some(attribute => attribute.namespace === "http://www.w3.org/2000/xmlns/" && (prefix ? attribute.localName === prefix : attribute.name === "xmlns"))).map(([prefix, uri]) => ` ${prefix ? "xmlns:" + prefix : "xmlns"}="${xmlValue(uri)}"`).join("");
    const lifted = [...inheritance].filter(([name]) => !first.attributes.some(attribute => attribute.namespace === "http://www.w3.org/XML/1998/namespace" && attribute.localName === name)).map(([name, value]) => ` xml:${name}="${xmlValue(value)}"`).join("");
    firstOpening = firstOpening.slice(0, -1) + namespaces + lifted + ">";
  }
  const run = first ? firstOpening + propertyXml + value + `</${first.name}>` : `<${name("r")}>${propertyXml}${value}</${name("r")}>`;
  if (content.children[0]?.localName === "p") { const paragraph = content.children[0]; const pPr = child(paragraph, "pPr"); return opening(content) + opening(paragraph) + (pPr ? xml.sourceXml(pPr) : "") + run + `</${paragraph.name}></${content.name}>`; }
  return opening(content) + run + `</${content.name}>`;
}
export async function editDocumentControls(input: Uint8Array, options: DocxOperationArguments<"controls.set"> & { readonly input?: PublicationInput }, context: ControlContext): Promise<ControlEditData> {
  const settings = archiveSettings(context); const { input: identity, ...args } = options;
  closedRecord(options, [...Object.keys(args), "input"]);
  const invocation = validateDocxInvocation({ operation: "controls.set", inputs: [identity?.path ?? "document"], options: args }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"controls.set">; const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const { output, inPlace, force, dryRun, json, all, allowEmpty, text, checked, choice, date, file, ...selectors } = opts; delete selectors.limit;
  const result = await inventory(input, selectors, { ...settings, budget }); assertDocumentEditable(result.archive, { ...settings, budget }, result.archive);
  const chosen = result.document.select(result.items.map(item => item.location), { ...(all === undefined ? {} : { all }), ...(allowEmpty === undefined ? {} : { allowEmpty }) }, "mutation");
  const stages: (() => void)[] = []; let picture: Uint8Array | undefined;
  for (const location of chosen) {
    budget.charge("work", 1); const item = result.items.find(item => item.location.token === location.token)!;
    const xml = result.editor.xml(location.value.part.slice(1)); const ancestors = owners(xml.root, location.value.path); const node = ancestors.at(-1)!;
    if (item.support !== "supported" || item.binding || item.lock !== "unlocked" || result.document.references(location.token).length > 1) throw new UnsupportedEditError("This control is unsupported, bound, locked or shared.");
    for (const owner of ancestors.slice(0, -1)) if (owner.namespace === node.namespace && owner.localName === "sdt") {
      const ancestor = snapshot(owner, item.location, result.archive, { ...settings, budget }, xml);
      if (ancestor.support !== "supported" || ancestor.kind === "unsupported") throw new UnsupportedEditError("Control ancestors require verified admission.");
      const ancestorPr = child(owner, "sdtPr"); if (!ancestorPr || attr(child(ancestorPr, "lock"), "val") && attr(child(ancestorPr, "lock"), "val") !== "unlocked" || child(ancestorPr, "dataBinding")) throw new UnsupportedEditError("Control ancestors must be admitted, unlocked and unbound.");
    }
    const properties = child(node, "sdtPr")!, content = child(node, "sdtContent")!;
    if (containsRevision(node) || ancestors.slice(0, -1).some(owner => ["ins", "del", "moveFrom", "moveTo"].includes(owner.localName))) throw new UnsupportedEditError("Control filling cannot cross revision owners.");
    const story = result.document.list("story", { scope: "all-stories" }).filter(owner => owner.value.story === location.value.story && pathContains(owner.value.path, location.value.path)).sort((a, b) => b.value.path.length - a.value.path.length)[0];
    if (!story) throw new UnsupportedEditError("Controls require an admitted story owner.");
    assertOutsideFields(parseFields(ancestors[story.value.path.length]!, story.value.path, budget, xml.compatibility.content), location.value.path);
    assertOutsideRevisionRanges(xml.root, node, budget, xml.compatibility.branches);
    if (walk(content).some(n => n.namespace === node.namespace && n.localName === "sdt")) throw new UnsupportedEditError("Scalar filling cannot erase nested controls.");
    const placeholder = child(properties, "showingPlcHdr"); let value: string | undefined, font: string | undefined;
    if (["plain-text", "rich-text"].includes(item.kind) && text !== undefined) value = text;
    else if (["dropdown", "combo-box"].includes(item.kind) && choice !== undefined) { const declaration = item.choices.find(item => item.value === choice); if (!declaration) throw new InvalidValueError("Expected a declared control choice value."); value = declaration.label; }
    else if (item.kind === "checkbox" && checked !== undefined) {
      const checkbox = child(properties, "checkbox", w14)!;
      if (walk(checkbox).some(owner => !xml.compatibility.canEdit(owner) || owner.attributes.some(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/" && !xml.compatibility.canEdit(attribute)))) throw new UnsupportedEditError("Checkbox metadata includes unsupported elements or attributes.");
      for (const name of ["checkedState", "uncheckedState"]) {
        const state = child(checkbox, name, w14), glyph = attr(state, "val", w14), font = attr(state, "font", w14);
        if (!glyph || glyph.length > 6 || [...glyph].some(c => !"0123456789abcdefABCDEF".includes(c)) || !font || font.trim() !== font || [...font].some(c => c.codePointAt(0)! < 32)) throw new UnsupportedEditError("Checkbox requires both declared glyph and font mappings.");
        const code = Number.parseInt(glyph, 16); if (code === 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) throw new UnsupportedEditError("Invalid checkbox Unicode glyph.");
      }
      const state = child(checkbox, checked ? "checkedState" : "uncheckedState", w14);
      const glyph = attr(state, "val", w14); font = attr(state, "font", w14) ?? undefined;
      if (!glyph || glyph.length > 6 || [...glyph].some(c => !"0123456789abcdefABCDEF".includes(c)) || !font || font.trim() !== font) throw new UnsupportedEditError("Checkbox requires a declared glyph and font.");
      const code = Number.parseInt(glyph, 16); if (code === 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) throw new UnsupportedEditError("Invalid checkbox Unicode glyph.");
      value = String.fromCodePoint(code); const current = child(checkbox, "checked", w14)!; stages.push(() => xml.setAttribute(current, { namespace: w14, localName: "val" }, checked ? "1" : "0"));
    } else if (item.kind === "date" && date !== undefined) {
      const stored = child(properties, "date")!; const format = attr(child(stored, "dateFormat"), "val") ?? "yyyy-MM-dd", language = attr(child(stored, "lid"), "val"), calendar = attr(child(stored, "calendar"), "val");
      if (!["yyyy-MM-dd", "MM-dd-yyyy", "dd/MM/yyyy"].includes(format) || language !== null && !["en-US", "en-GB"].includes(language) || calendar !== null && calendar !== "gregorian") throw new UnsupportedEditError("Stored date formatting has no deterministic support.");
      if (date.length !== 10 || date[4] !== "-" || date[7] !== "-" || [...date].some((c, index) => index !== 4 && index !== 7 && !"0123456789".includes(c))) throw new InvalidValueError("Expected a Gregorian date yyyy-MM-dd.");
      const canonical = date + "T00:00:00Z", parsed = new Date(canonical); if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new InvalidValueError("Invalid Gregorian date.");
      value = format === "MM-dd-yyyy" ? date.slice(5, 7) + "-" + date.slice(8) + "-" + date.slice(0, 4) : format === "dd/MM/yyyy" ? date.slice(8) + "/" + date.slice(5, 7) + "/" + date.slice(0, 4) : date;
      if (attr(stored, "fullDate") !== null) stages.push(() => xml.setAttribute(stored, { namespace: node.namespace, localName: "fullDate" }, canonical));
      else { const prefix = stored.name.includes(":") ? stored.name.slice(0, stored.name.indexOf(":") + 1) : "";
        const replacement = opening(stored).slice(0, -1) + ` ${prefix}fullDate="${canonical}">` + xml.sourceXml(stored, new Map(), true) + `</${stored.name}>`;
        stages.push(() => xml.replaceElement(stored, replacement)); }
    } else if (item.kind === "picture" && file !== undefined) {
      if (!item.value || typeof item.value !== "object" || item.value.external || !item.value.contentType?.startsWith("image/")) throw new UnsupportedEditError("Only an existing internal picture occurrence supports filling.");
      picture ??= await acquireControlPng(file as DocxBinaryInput, { ...context, budget });
      stages.push(() => replaceControlPicture(result.editor, result.archive, location.value.part, content, picture!, { ...settings, budget }));
    } else throw new UnsupportedEditError("The explicit value does not match the control type.");
    if (value !== undefined) { const replacement = textReplacement(xml, content, value, font); stages.push(() => xml.replaceElement(content, replacement)); }
    if (placeholder) stages.push(() => xml.replaceElement(placeholder, ""));
  }
  const changes = chosen.map(before => { const value = { ...before.value, generation: 1 }; return { kind: "replace" as const, before, after: { ...before, value, token: encodeLocation(value) } }; });
  const prospective = { changed: chosen.length > 0, changes, output: dryRun ? null : { path: inPlace ? identity?.path ?? null : output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) }, dryRun: dryRun ?? false };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: "controls.set", ok: true, data: prospective, affected: changes.length, locations: changes.map(change => change.after), warnings: [], errors: [] }) + "\n").length);
  for (const stage of stages) stage();
  const published = await publishDocumentArchive(finishControlPictures(result.editor, result.archive, { ...settings, budget }), { ...(identity ? { input: identity } : {}), ...(output === undefined ? {} : { output }), ...(inPlace ===undefined ? {} : { inPlace }), ...(force === undefined ? {} : { force }), ...(dryRun === undefined ? {} : { dryRun }), ...(json === undefined ? {} : { json }) }, { ...context, budget }, result.archive);
  return { ...prospective, output: published.published.length ? { path: published.published[0]!.path, bytes: published.published[0]!.bytes, sha256: published.archiveSha256! } : null };
}
