import { archiveSettings, InvalidValueError } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { validateDocxInvocation } from "./command.js";
import { xmlValue } from "./create-content.js";
import { dialectForNamespace, documentDialects } from "./dialect.js";
import { addressKey, LocationIndex } from "./location-index.js";
import { closedRecord, encodeLocation, type Location } from "./location-token.js";
import { openDocumentLocations } from "./locations.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { DocumentPackage } from "./package.js";
import { DocumentArchiveEditor } from "./package-write.js";
import { parseDocumentXml } from "./package-xml.js";
import { paragraphTextRun, replaceParagraphContent, splitParagraphContent } from "./paragraph-content.js";
import { paragraphProperties } from "./paragraph-properties.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { runElementOpen } from "./run-properties.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { UnsupportedEditError } from "./xml-write.js";

export type ParagraphEditOperation = "paragraphs.set" | "paragraphs.add" | "runs.add";
export type ParagraphEditRequest = { [K in ParagraphEditOperation]: { readonly operation: K; readonly options: DocxOperationArguments<K>; readonly input?: PublicationInput } }[ParagraphEditOperation];
export interface ParagraphEditData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "format" | "replace" | "insert"; readonly before: Location; readonly after: Location }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}

/** Paragraph edits and inline insertion share selection, XML preservation and publication. */
export async function editDocumentParagraphs(input: Uint8Array, request: ParagraphEditRequest, context: PublicationContext): Promise<ParagraphEditData> {
  closedRecord(request, ["operation", "options", "input"]);
  if (!["paragraphs.set", "paragraphs.add", "runs.add"].includes(request.operation)) throw new DocxUsageError("Expected a paragraph editing operation.");
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: request.operation, inputs: [request.input?.path ?? "document"], options: request.options }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"paragraphs.set"> & DocxOperationArguments<"paragraphs.add"> & DocxOperationArguments<"runs.add">;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const selected = resolveDocxSelection(document, invocation);
  const archive = document.snapshot();
  assertDocumentEditable(archive, { ...settings, budget });
  const editor = new DocumentArchiveEditor(archive, {}, undefined, budget);
  const body = document.list("story", { scope: "body" })[0]!;
  const main = body.value.part.slice(1);
  const dialect = dialectForNamespace(editor.xml(main).root.namespace)!;
  const w = documentDialects[dialect].w;
  const graph = new DocumentPackage(archive, settings.limits, budget);
  const stylesEdge = graph.relationships("/" + main).find(edge => edge.reltype === documentDialects[dialect].r + "/styles");
  const styles = stylesEdge && !stylesEdge.is_external ? parseDocumentXml(stylesEdge.target_part.bytes, {}, budget).root : undefined;
  let styleId: string | undefined;
  if (opts.style !== undefined) {
    const found = styles?.children.filter(node => node.namespace === w && node.localName === "style" && node.attributes.some(a => a.namespace === w && a.localName === "type" && a.value === (request.operation === "runs.add" ? "character" : "paragraph")) && node.children.some(c => c.namespace === w && c.localName === "name" && c.attributes.some(a => a.namespace === w && a.localName === "val" && a.value === opts.style))) ?? [];
    if (found.length !== 1) throw new InvalidValueError("Expected one existing style of the selected kind.");
    styleId = found[0]!.attributes.find(a => a.namespace === w && a.localName === "styleId")?.value;
    if (!styleId) throw new InvalidValueError("Selected style has no identifier.");
  }
  if (opts.level !== undefined) throw new UnsupportedEditError("Heading-style creation is a separate pending operation subset.");
  const updates: { before: Location; path: readonly number[]; kind: "format" | "replace" | "insert" }[] = [];
  for (const before of selected) {
    budget.charge("work", 1);
    const xml = editor.xml(before.value.part.slice(1));
    let node = xml.root, parent = node;
    const ancestors = [node];
    for (const index of before.value.path) { parent = node; node = node.children[index]!; ancestors.push(node); }
    if (ancestors.some(n => n.namespace === w && (["ins", "del", "moveFrom", "moveTo"].includes(n.localName) || n.children.some(c => c.namespace === w && c.localName === "pPr" && c.children.some(p => p.namespace === w && p.localName === "pPrChange")))))
      throw new UnsupportedEditError("Tracked paragraph edits require explicit revision operations.");
    const props = node.children.find(c => c.namespace === w && c.localName === "pPr");
    const originalProps = props ? xml.sourceXml(props) : "";
    if (request.operation === "paragraphs.set") {
      const properties = paragraphProperties(xml, node, opts, styleId);
      const original = xml.sourceXml(node);
      const replacement = opts.text !== undefined ? replaceParagraphContent(xml, node, properties, opts.text ?? "")
        : props ? xml.sourceXml(node, new Map([[props, properties]]))
        : runElementOpen(node) + properties + xml.sourceXml(node, new Map(), true) + `</${node.name}>`;
      if (properties === originalProps && opts.text === undefined || replacement === original) continue;
      xml.replaceElement(node, replacement);
      updates.push({ before, path: before.value.path, kind: opts.text === undefined ? "format" : "replace" });
      continue;
    }
    const range = before.value.range;
    if (range && (range.start !== range.end || before.kind !== "paragraph")) throw new DocxUsageError("Insertion requires a collapsed paragraph range.");
    if (opts.before !== undefined && (before.kind !== "paragraph" || range)) throw new DocxUsageError("Before requires a whole paragraph anchor.");
    const run = paragraphTextRun(w, opts.text ?? "", request.operation === "runs.add" ? styleId : undefined, opts.break);
    if (request.operation === "runs.add") {
      if (before.kind !== "paragraph") throw new DocxUsageError("Inline insertion requires a paragraph.");
      if (range) {
        const [prefix, suffix] = splitParagraphContent(xml, node, range.start);
        xml.replaceElement(node, runElementOpen(node) + originalProps + prefix + run + suffix + `</${node.name}>`);
      } else xml.insertChildren(node, run);
      updates.push({ before, path: before.value.path, kind: "insert" });
      continue;
    }
    const markup = `<pi:p xmlns:pi="${w}">${styleId === undefined ? "" : `<pi:pPr><pi:pStyle pi:val="${xmlValue(styleId)}"/></pi:pPr>`}${opts.text === undefined ? "" : run}</pi:p>`;
    if (before.kind === "paragraph") {
      const position = before.value.path.at(-1)!;
      if (!["body", "tc", "hdr", "ftr", "footnote", "endnote", "comment", "txbxContent", "sdtContent"].includes(parent.localName) || parent.namespace !== w)
        throw new UnsupportedEditError("Paragraph insertion requires a supported block container.");
      if (range) {
        const [prefix, suffix] = splitParagraphContent(xml, node, range.start);
        const section = props?.children.find(c => c.namespace === w && c.localName === "sectPr");
        const prefixProps = props && section ? xml.sourceXml(props, new Map([[section, ""]])) : originalProps;
        xml.replaceElement(node, runElementOpen(node) + prefixProps + prefix + `</${node.name}>` + markup + runElementOpen(node) + originalProps + suffix + `</${node.name}>`);
        updates.push({ before, path: [...before.value.path.slice(0, -1), position + 1], kind: "insert" });
      } else {
        const original = xml.sourceXml(node);
        xml.replaceElement(node, opts.before ? markup + original : original + markup);
        updates.push({ before, path: [...before.value.path.slice(0, -1), position + (opts.before ? 0 : 1)], kind: "insert" });
      }
    } else {
      if (!["body", "tc", "hdr", "ftr", "footnote", "endnote", "comment", "txbxContent"].includes(node.localName) || node.namespace !== w)
        throw new UnsupportedEditError("Block insertion requires a story or cell container.");
      const section = node.children.find(c => c.namespace === w && c.localName === "sectPr");
      xml.insertChildren(node, markup, section);
      updates.push({ before, path: [...before.value.path, section ? node.children.indexOf(section) : node.children.length], kind: "insert" });
    }
  }
  budget.check("matches", updates.length);
  const candidate = editor.snapshot();
  const index = new LocationIndex(candidate, settings.limits, main, dialect, budget);
  const changes = updates.map(({ before, path, kind }) => {
    const entry = index.byAddress.get(addressKey({ ...before.value, path }))?.find(e => e.kind === "paragraph");
    if (!entry) throw new UnsupportedEditError("Paragraph edit could not resolve its resulting location.");
    const value = { ...before.value, generation: 1, path, range: null };
    const after: Location = { kind: "paragraph", value, token: encodeLocation(value), positions: entry.positions };
    return { kind, before, after };
  });
  const publication = { ...(request.input ? { input: request.input } : {}), ...(opts.output === undefined ? {} : { output: opts.output }), ...(opts.inPlace === undefined ? {} : { inPlace: opts.inPlace }), ...(opts.force === undefined ? {} : { force: opts.force }), ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }), ...(opts.json === undefined ? {} : { json: opts.json }) };
  const prospective = { changed: changes.length > 0, changes, dryRun: opts.dryRun ?? false, output: opts.dryRun ? null : { path: opts.inPlace ? request.input?.path ?? null : opts.output === "-" ? null : opts.output ?? null, bytes: settings.limits.maxArchiveBytes, sha256: "0".repeat(64) } };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: request.operation, ok: true, data: prospective, affected: changes.length, locations: changes.map(c => c.after), warnings: [], errors: [] }) + "\n").length);
  const result = await publishDocumentArchive(candidate, publication, { ...context, budget });
  return { changed: changes.length > 0, changes, dryRun: opts.dryRun ?? false, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
