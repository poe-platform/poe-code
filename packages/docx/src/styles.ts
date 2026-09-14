import { archiveSettings, InvalidValueError, type ArchiveContext } from "./archive.js";
import { readDocumentArchive, type AdmittedDocumentArchive } from "./admission.js";
import { validateDocxInvocation } from "./command.js";
import { createDocumentArchive } from "./create.js";
import { addDocumentStylesPart } from "./styles-part.js";
import { xmlValue } from "./create-content.js";
import { documentDialects } from "./dialect.js";
import { closedRecord, SelectionError } from "./location-token.js";
import { DocumentArchiveEditor } from "./package-write.js";
import { type XmlElement } from "./package-xml.js";
import { paragraphProperties } from "./paragraph-properties.js";
import { formattedRunProperties } from "./run-properties.js";
import { mergeStyleChildren, readStyleProperties, styleAttribute as attr, styleChild as child, styleToggle, type StyleProperties } from "./style-properties.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { validateDocumentArchive, SemanticValidationError, type ValidationDiagnostic } from "./validation.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import type { DocxOperationArguments } from "./operation-types.js";

export type StyleInspectionOptions = Pick<DocxOperationArguments<"styles.get">, "name" | "json" | "limit"> extends infer T ? Partial<T> : never;
export type StyleEditOptions = ({ readonly operation: "styles.add" } & DocxOperationArguments<"styles.add"> |
  { readonly operation: "styles.set" } & DocxOperationArguments<"styles.set"> |
  { readonly operation: "styles.defaults.set" } & DocxOperationArguments<"styles.defaults.set">) & { readonly input?: PublicationInput };
export interface StyleInfo {
  readonly id: string; readonly name: string; readonly type: string; readonly builtin: boolean;
  readonly base: string | null; readonly next: string | null; readonly linkedStyle: string | null;
  readonly defaultForType: boolean; readonly priority: number | null;
  readonly hidden: boolean; readonly locked: boolean; readonly quickStyle: boolean; readonly unhideWhenUsed: boolean;
  readonly direct: StyleProperties; readonly effective: StyleProperties | null;
  readonly runXml: string | null; readonly paragraphXml: string | null; readonly tableXml: string | null;
}
export interface StyleInspectionData {
  readonly styles: readonly StyleInfo[];
  readonly defaults: { readonly run: StyleProperties; readonly paragraph: StyleProperties };
  readonly latentXml: string | null;
  readonly diagnostics: readonly ValidationDiagnostic[];
}
export interface StyleMutationData {
  readonly changed: boolean; readonly changes: readonly { readonly kind: "style"; readonly id: string }[];
  readonly dryRun: boolean; readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
}

function stylePart(archive: AdmittedDocumentArchive): string | undefined {
  const edges = archive.package.relationships("/" + archive.mainPart).filter(e => e.reltype === `${documentDialects[archive.dialect].r}/styles`);
  if (edges.length > 1 || edges[0]?.is_external) throw new UnsupportedEditError("Expected one internal styles part.");
  return edges[0]?.target_part.name;
}

/** Read-only, bounded definition inspection. Effective values are the supported style subset, not layout. */
export async function inspectDocumentStyles(input: Uint8Array, options: StyleInspectionOptions, context: ArchiveContext): Promise<StyleInspectionData> {
  closedRecord(options, ["name", "json", "limit"]);
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: options.name === undefined ? "styles.list" : "styles.get", inputs: ["document"], options }, settings.budget);
  const budget = settings.budget.lower(Object.fromEntries((invocation.options.limit as StyleInspectionOptions["limit"] ?? []).map(v => [v.name, v.value])));
  const archive = await readDocumentArchive(input, { ...settings, budget });
  const part = stylePart(archive);
  const xml = part ? new DocumentXmlEditor(archive.members.find(m => m.name === part)!.bytes, {}, undefined, budget) : undefined;
  const nodes = xml?.root.children.filter(n => n.namespace === xml.root.namespace && n.localName === "style") ?? [];
  const defaults = child(xml?.root, "docDefaults");
  const runDefaults = readStyleProperties(child(child(defaults, "rPrDefault"), "rPr"), undefined);
  const paragraphDefaults = readStyleProperties(undefined, child(child(defaults, "pPrDefault"), "pPr"));
  const defined = new Map(nodes.map(n => [attr(n, "styleId"), n]));
  const name = (id: string | undefined): string | null => id === undefined ? null : attr(child(defined.get(id), "name"), "val") ?? id;
  const resolved = new Map<XmlElement, StyleProperties | null>();
  const defaultProperties = { ...runDefaults, outlineLevel: paragraphDefaults.outlineLevel, keepWithNext: paragraphDefaults.keepWithNext,
    spaceBefore: paragraphDefaults.spaceBefore, spaceAfter: paragraphDefaults.spaceAfter, numbering: paragraphDefaults.numbering };
  for (const start of nodes) {
    if (resolved.has(start)) continue;
    const chain: XmlElement[] = [], seen = new Set<XmlElement>();
    let node: XmlElement | undefined = start;
    while (node && !resolved.has(node) && !seen.has(node)) {
      budget.charge("work", 1); chain.push(node); seen.add(node); node = defined.get(attr(child(node, "basedOn"), "val"));
    }
    let value: StyleProperties | null = node && seen.has(node) ? null : node ? resolved.get(node)! : defaultProperties;
    for (const current of chain.reverse()) {
      const direct = readStyleProperties(child(current, "rPr"), child(current, "pPr"));
      if (value !== null) {
        const inherited: StyleProperties = value;
        value = Object.fromEntries(Object.entries(direct).map(([key, item]) => [key, item === null ? inherited[key as keyof StyleProperties] : item])) as unknown as StyleProperties;
        // In style definitions these are OOXML toggle properties; false leaves the inherited state unchanged.
        value = { ...value, bold: direct.bold === null ? inherited.bold : direct.bold ? !inherited.bold : inherited.bold,
          italic: direct.italic === null ? inherited.italic : direct.italic ? !inherited.italic : inherited.italic,
          numbering: direct.numbering === null ? inherited.numbering : { id: direct.numbering.id ?? inherited.numbering?.id ?? null, level: direct.numbering.level ?? inherited.numbering?.level ?? null } };
      }
      resolved.set(current, value);
    }
  }
  const selected = options.name === undefined ? nodes : nodes.filter(n => attr(child(n, "name"), "val") === options.name);
  if (options.name !== undefined && selected.length !== 1) throw new SelectionError(selected.length ? "ambiguous-selection" : "missing-selection");
  const report = validateDocumentArchive(archive, {}, budget);
  const data: StyleInspectionData = { styles: selected.map(n => {
    const source = (tag: string) => child(n, tag) ? xml!.sourceXml(child(n, tag)!) : null;
    return { id: attr(n, "styleId") ?? "", name: attr(child(n, "name"), "val") ?? "", type: attr(n, "type") ?? "",
      builtin: !["1", "true", "on"].includes(attr(n, "customStyle") ?? "0"), base: name(attr(child(n, "basedOn"), "val")),
      next: name(attr(child(n, "next"), "val")) ?? (attr(n, "type") === "paragraph" ? attr(child(n, "name"), "val") ?? null : null),
      linkedStyle: name(attr(child(n, "link"), "val")), defaultForType: ["1", "true", "on"].includes(attr(n, "default") ?? "0"),
      priority: child(n, "uiPriority") ? Number(attr(child(n, "uiPriority"), "val")) : null,
      hidden: styleToggle(child(n, "semiHidden")) ?? false, locked: styleToggle(child(n, "locked")) ?? false,
      quickStyle: styleToggle(child(n, "qFormat")) ?? false, unhideWhenUsed: styleToggle(child(n, "unhideWhenUsed")) ?? false,
      direct: readStyleProperties(child(n, "rPr"), child(n, "pPr")), effective: resolved.get(n) ?? null,
      runXml: source("rPr"), paragraphXml: source("pPr"), tableXml: source("tblPr") };
  }), defaults: { run: runDefaults, paragraph: paragraphDefaults }, latentXml: child(xml?.root, "latentStyles") ? xml!.sourceXml(child(xml!.root, "latentStyles")!) : null,
  diagnostics: report.diagnostics.filter(d => d.code.startsWith("style-") || d.code.startsWith("numbering-")) };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify(data)).length);
  return data;
}

const styleOrder = "name aliases basedOn next link autoRedefine hidden uiPriority semiHidden unhideWhenUsed qFormat locked personal personalCompose personalReply rsid pPr rPr tblPr trPr tcPr tblStylePr".split(" ");

/** Edit named definitions using the same typed operation and publication rules as the CLI. */
export async function editDocumentStyles(input: Uint8Array, options: StyleEditOptions, context: PublicationContext): Promise<StyleMutationData> {
  const settings = archiveSettings(context);
  const { operation, input: identity, ...args } = options;
  if (!["styles.add", "styles.set", "styles.defaults.set"].includes(operation)) throw new InvalidValueError("Expected a style edit operation.");
  const invocation = validateDocxInvocation({ operation, inputs: [identity?.path ?? "document"], options: args }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"styles.set"> & Partial<DocxOperationArguments<"styles.add">>;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(v => [v.name, v.value])));
  let archive = await readDocumentArchive(input, { ...settings, budget });
  assertDocumentEditable(archive, { ...settings, budget });
  const report = validateDocumentArchive(archive, {}, budget);
  if (!report.valid) throw new SemanticValidationError(report.diagnostics);
  let added = false;
  if (operation === "styles.add") {
    if (!["paragraph", "character", "table"].includes(opts.type!)) throw new UnsupportedEditError("Creation supports paragraph, character and table styles.");
    archive = await createDocumentArchive({ template: input, content: { version: 1, blocks: [], styles: [{ name: opts.name, type: opts.type as "paragraph" | "character" | "table" }] } }, { ...settings, budget });
    added = true;
  }
  let part = stylePart(archive);
  const absentPart = part === undefined;
  let writable = archive;
  if (!part) {
    if (operation !== "styles.defaults.set") throw new SelectionError("missing-selection");
    const materialized = addDocumentStylesPart(archive, archive, "", budget);
    part = materialized.name;
    writable = { ...archive, ...materialized.archive };
  }
  const editor = new DocumentArchiveEditor(writable, {}, undefined, budget);
  const xml = editor.xml(part), w = xml.root.namespace;
  const nodes = xml.root.children.filter(n => n.namespace === w && n.localName === "style");
  const resolve = (name: string): XmlElement => {
    const matches = nodes.filter(n => attr(child(n, "name"), "val") === name);
    if (matches.length !== 1) throw new SelectionError(matches.length ? "ambiguous-selection" : "missing-selection");
    return matches[0]!;
  };
  const element = (tag: string, value: string) => `<st:${tag} xmlns:st="${w}" st:val="${xmlValue(value)}"/>`;
  const changes: { kind: "style"; id: string }[] = [];
  const patches = new Map<XmlElement, Map<string, string>>();
  const attributes = new Map<XmlElement, Record<string, string | null>>();
  const update = (node: XmlElement, tag: string, markup: string) => {
    const map = patches.get(node) ?? new Map<string, string>(); map.set(tag, markup); patches.set(node, map);
  };
  const setValue = (node: XmlElement, tag: string, value: string | null) => {
    const existing = child(node, tag);
    if (value === null ? !existing : attr(existing, "val") === value) { patches.get(node)?.delete(tag); return; }
    update(node, tag, value === null ? "" : element(tag, value));
  };
  const formatting = (node: XmlElement) => {
    const run = formattedRunProperties(xml, node, opts);
    const para = paragraphProperties(xml, node, opts);
    if (run !== (child(node, "rPr") ? xml.sourceXml(child(node, "rPr")!) : "")) update(node, "rPr", run);
    if (para !== (child(node, "pPr") ? xml.sourceXml(child(node, "pPr")!) : "")) update(node, "pPr", para);
  };
  if (operation === "styles.defaults.set") {
    const defaults = child(xml.root, "docDefaults");
    const defaultsXml = defaults ? xml : new DocumentXmlEditor(new TextEncoder().encode(`<st:docDefaults xmlns:st="${w}"/>`), {}, undefined, budget);
    const target = defaults ?? defaultsXml.root;
    const updates = new Map<string, string>();
    for (const [container, property] of [["rPrDefault", "rPr"], ["pPrDefault", "pPr"]] as const) {
      const existing = child(target, container);
      const fragment = existing ? defaultsXml : new DocumentXmlEditor(new TextEncoder().encode(`<st:${container} xmlns:st="${w}"/>`), {}, undefined, budget);
      const owner = existing ?? fragment.root;
      const props = property === "rPr" ? formattedRunProperties(fragment, owner, opts) : paragraphProperties(fragment, owner, opts);
      const old = child(owner, property);
      if (props === (old ? fragment.sourceXml(old) : "")) continue;
      updates.set(container, mergeStyleChildren(fragment, owner, new Map([[property, props]]), [property]));
    }
    if (updates.size) {
      const markup = mergeStyleChildren(defaultsXml, target, updates, ["rPrDefault", "pPrDefault"]);
      if (defaults) xml.replaceElement(defaults, markup); else xml.insertChildren(xml.root, markup, xml.root.children[0]);
      changes.push({ kind: "style", id: "docDefaults" });
    }
  } else {
    const selected = resolve(opts.name), type = attr(selected, "type");
    if (!["paragraph", "character", "table"].includes(type!)) throw new UnsupportedEditError("Editing supports paragraph, character and table styles.");
    if (type === "character" && [opts.outlineLevel, opts.keepWithNext, opts.spaceBefore, opts.spaceAfter].some(v => v !== undefined))
      throw new InvalidValueError("Character styles cannot contain paragraph properties.");
    for (const [key, tag] of [["base", "basedOn"], ["next", "next"]] as const) {
      const value = opts[key]; if (value === undefined) continue;
      if (key === "next" && type !== "paragraph") throw new InvalidValueError("Next style requires a paragraph style.");
      const target = value === null ? undefined : resolve(value);
      if (target && attr(target, "type") !== type) throw new InvalidValueError("Style relationship requires matching types.");
      setValue(selected, tag, target ? attr(target, "styleId")! : null);
    }
    if (opts.linkedStyle !== undefined) {
      const target = opts.linkedStyle === null ? undefined : resolve(opts.linkedStyle);
      if (target && !((type === "paragraph" && attr(target, "type") === "character") || (type === "character" && attr(target, "type") === "paragraph")))
        throw new InvalidValueError("Linked styles require paragraph and character types.");
      const unlink = (node: XmlElement) => {
        const old = nodes.find(n => attr(n, "styleId") === attr(child(node, "link"), "val"));
        if (old && attr(child(old, "link"), "val") === attr(node, "styleId")) setValue(old, "link", null);
      };
      unlink(selected); if (target) unlink(target);
      setValue(selected, "link", target ? attr(target, "styleId")! : null);
      if (target) setValue(target, "link", attr(selected, "styleId")!);
    }
    if (opts.defaultForType !== undefined) {
      if (opts.defaultForType !== ["1", "true", "on"].includes(attr(selected, "default") ?? "0")) attributes.set(selected, { default: opts.defaultForType ? "1" : null });
      if (opts.defaultForType) for (const node of nodes) if (node !== selected && attr(node, "type") === type && attr(node, "default") !== undefined) attributes.set(node, { default: null });
    }
    for (const [key, tag] of [["hidden", "semiHidden"], ["locked", "locked"], ["quickStyle", "qFormat"]] as const)
      if (opts[key] !== undefined) setValue(selected, tag, opts[key] ? "1" : "0");
    if (opts.priority !== undefined) setValue(selected, "uiPriority", String(opts.priority));
    formatting(selected);
    for (const node of new Set([...patches.keys(), ...attributes.keys()])) {
      const markup = mergeStyleChildren(xml, node, patches.get(node) ?? new Map(), styleOrder, attributes.get(node));
      if (markup === xml.sourceXml(node)) continue;
      xml.replaceElement(node, markup); changes.push({ kind: "style", id: attr(node, "styleId")! });
    }
    if (added && !changes.some(c => c.id === attr(selected, "styleId"))) changes.push({ kind: "style", id: attr(selected, "styleId")! });
  }
  const staged = absentPart && changes.length === 0 ? archive : editor.snapshot();
  const publication = { ...(identity ? { input: identity } : {}), ...(opts.output === undefined ? {} : { output: opts.output }), ...(opts.inPlace === undefined ? {} : { inPlace: opts.inPlace }), ...(opts.force === undefined ? {} : { force: opts.force }), ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }), ...(opts.json === undefined ? {} : { json: opts.json }) };
  const prospective = { changed: changes.length > 0, changes, dryRun: opts.dryRun ?? false, output: { path: opts.output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation, ok: true, data: prospective, affected: changes.length, locations: [], errors: [], warnings: [] }) + "\n").length);
  const result = await publishDocumentArchive(staged, publication, { ...context, budget });
  return { changed: changes.length > 0, changes, dryRun: opts.dryRun ?? false, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
