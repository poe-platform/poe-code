import { assertOutsideRevisionRanges, assertFormattingHistoryEditable } from "./revision-markup.js";
import { archiveSettings } from "./archive.js";
import { activeXmlChildren } from "./xml-active-children.js";
import { validateDocxInvocation } from "./command.js";
import { xmlValue } from "./create-content.js";
import { openDocumentLocations } from "./locations.js";
import { encodeLocation, SelectionError, type Location } from "./location-token.js";
import { pathContains } from "./location-index.js";
import { resolveDocxSelection } from "./simple-selection.js";
import { DocumentArchiveEditor } from "./package-write.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { UnsupportedEditError, replaceSplitTextRunXml, splitNativeTextRunXml, type DocumentXmlEditor } from "./xml-write.js";
import { assertDocumentEditable, publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { replaceRunContent } from "./paragraph-content.js";
import { equivalentRunKey, formattedRunProperties, runElementOpen } from "./run-properties.js";
import type { DocxOperationArguments } from "./operation-types.js";

export type RunFormatOptions = DocxOperationArguments<"runs.set"> & { readonly input?: PublicationInput };
export interface RunFormatData {
  readonly changed: boolean;
  readonly changes: readonly { readonly kind: "format" | "replace"; readonly before: Location; readonly after: Location }[];
  readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
  readonly dryRun: boolean;
}
interface Target { location: Location; run: Location; start: number; end: number; whole: boolean; }

function splitRun(editor: DocumentXmlEditor, run: XmlElement, start: number, end: number, properties: string): string {
  if (run.content.some(c => c.kind !== "element") || run.children.some(c => c.namespace !== run.namespace || !["rPr", "t", "tab", "ptab", "br", "cr", "noBreakHyphen", "softHyphen", "lastRenderedPageBreak"].includes(c.localName)
    || c.localName !== "rPr" && c.content.some(child => child.kind !== "text")))
    throw new UnsupportedEditError("Partial formatting requires a simple text run without opaque content or field markers.");
  const props = run.children.find(c => c.localName === "rPr");
  const original = props ? editor.sourceXml(props) : "";
  const fragments = ["", "", ""];
  let offset = 0;
  for (const child of run.children) {
    if (child === props) continue;
    if (child.localName === "lastRenderedPageBreak") {
      fragments[offset < start ? 0 : offset < end ? 1 : 2] += editor.sourceXml(child);
      continue;
    }
    const scalars = child.localName === "t" ? [...child.text] : [" "];
    const next = offset + scalars.length;
    const ranges = [[offset, Math.min(next, start)], [Math.max(offset, start), Math.min(next, end)], [Math.max(offset, end), next]];
    for (let i = 0; i < ranges.length; i++) {
      const [from, to] = ranges[i]!;
      if (from! >= to!) continue;
      if (from === offset && to === next) fragments[i] += editor.sourceXml(child);
      else {
        const attrs = child.attributes.filter(a => !(a.namespace === "http://www.w3.org/XML/1998/namespace" && a.localName === "space"));
        const open = runElementOpen({ ...child, attributes: attrs });
        fragments[i] += open.slice(0, -1) + ' xml:space="preserve">' + xmlValue(scalars.slice(from! - offset, to! - offset).join("")) + `</${child.name}>`;
      }
    }
    offset = next;
  }
  return fragments.map((content, i) => content ? runElementOpen(run) + (i === 1 ? properties : original) + content + `</${run.name}>` : "").join("");
}

/** Scoped direct formatting over admitted bytes; all I/O is explicitly supplied. */
export async function formatDocumentRuns(input: Uint8Array, options: RunFormatOptions, context: PublicationContext): Promise<RunFormatData> {
  const settings = archiveSettings(context);
  const { input: identity, ...operationOptions } = options;
  const invocation = validateDocxInvocation({ operation: "runs.set", inputs: [identity?.path ?? "document"], options: operationOptions }, settings.budget);
  const opts = invocation.options as DocxOperationArguments<"runs.set">;
  const budget = settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  const selected = resolveDocxSelection(document, invocation);
  const archive = document.snapshot();
  assertDocumentEditable(archive, { ...settings, budget });
  const editor = new DocumentArchiveEditor(archive, {}, undefined, budget);
  const targets: Target[] = [];
  const paragraphs = document.list("paragraph", { scope: "all-stories" });
  const textByParagraph = new Map<string, ReturnType<typeof document.text>>();
  const paragraphFor = (run: Location) => paragraphs.find(p => p.value.story === run.value.story && pathContains(p.value.path, run.value.path))!;
  const textFor = (paragraph: Location) => {
    let text = textByParagraph.get(paragraph.token);
    if (!text) { text = document.text({ select: paragraph.token }); textByParagraph.set(paragraph.token, text); }
    return text;
  };
  for (const location of selected) {
    if (opts.text !== undefined && (location.kind !== "run" || location.value.range !== null))
      throw new UnsupportedEditError("Whole run text assignment requires a whole run selection; ranges are formatting only.");
    budget.charge("work", 1);
    const range = location.value.range;
    if (location.kind === "run") {
      const full = document.resolve(encodeLocation({ ...location.value, range: null }), "run");
      const length = textFor(paragraphFor(full)).segments.filter(s => s.location.token === full.token).reduce((sum, s) => sum + [...s.text].length, 0);
      targets.push({ location, run: full, start: range?.start ?? 0, end: range?.end ?? length, whole: !range || range.start === 0 && range.end === length });
    } else {
      const text = textFor(document.resolve(encodeLocation({ ...location.value, range: null }), "paragraph"));
      const ranges = new Map<string, Target>();
      const offsets = new Map<string, number>();
      let offset = 0;
      for (const segment of text.segments) {
        budget.charge("work", segment.text.length + 1);
        const length = [...segment.text].length;
        const local = offsets.get(segment.location.token) ?? 0;
        const start = Math.max(offset, range!.start), end = Math.min(offset + length, range!.end);
        if (start < end) {
          const target = ranges.get(segment.location.token) ?? { location, run: segment.location, start: local + start - offset, end: 0, whole: false };
          target.end = local + end - offset; ranges.set(segment.location.token, target);
        }
        offsets.set(segment.location.token, local + length); offset += length;
      }
      for (const target of ranges.values()) {
        target.whole = target.start === 0 && target.end === offsets.get(target.run.token);
        targets.push(target);
      }
      const paths = [...ranges.values()].map(target => target.run.value.path.slice(0, -1).join("/"));
      if (new Set(paths).size > 1) throw new UnsupportedEditError("Formatting ranges cannot cross container boundaries.");
    }
  }
  const effective = targets.filter(target => target.whole && target.location.value.range === null || target.start < target.end);
  if (!effective.length && !opts.allowEmpty) throw new SelectionError("missing-selection");
  const parents = new Map<XmlElement, { xml: DocumentXmlEditor; patches: Map<XmlElement, string> }>();
  const selectedNodes = new Map<XmlElement, Location>();
  const changed = new Map<string, Location>();
  for (const target of effective) {
    const xml = editor.xml(target.run.value.part.slice(1));
    let node = xml.root, parent = node;
    const ancestors = [node];
    for (const index of target.run.value.path) { parent = node; node = node.children[index]!; ancestors.push(node); }
    xml.assertShapeEditAllowed(node);
    selectedNodes.set(node, target.location);
    const children = activeXmlChildren(xml, budget);
    assertOutsideRevisionRanges(xml.root, node, budget, xml.compatibility.branches, children);
    assertFormattingHistoryEditable(xml.root, node, children, budget);
    if (ancestors.some(n => n.namespace === node.namespace && ["moveFrom", "moveTo", "del"].includes(n.localName)))
      throw new UnsupportedEditError("Complex or deleted revision runs cannot be formatted.");
    const props = children(node).find(c => c.namespace === node.namespace && c.localName === "rPr");
    const original = props ? xml.sourceXml(props) : "";
    const properties = formattedRunProperties(xml, node, opts, children);
    if (properties === original && opts.text === undefined) continue;
    if (!target.whole && props && children(props).some(child => child.namespace === node.namespace && child.localName === "rPrChange"))
      throw new UnsupportedEditError("Partial formatting cannot duplicate an owned property-history identity.");
    let markup: string;
    if (opts.text !== undefined) markup = replaceRunContent(xml, node, properties, opts.text, budget);
    else if (target.whole) {
      markup = props ? xml.sourceXml(node, new Map([[props, properties]])) : runElementOpen(node) + properties + xml.sourceXml(node, new Map(), true) + `</${node.name}>`;
    } else if (node.children.some(child => child.namespace !== node.namespace) || props && props.children.some(child => child.namespace !== node.namespace)) {
      const fragments = [0, 1, 2].map(index => ({ properties: index === 1 ? properties : original, content: new Map<XmlElement, string>() }));
      let offset = 0;
      for (const child of children(node)) {
        if (child === props) continue;
        if (child.localName === "lastRenderedPageBreak") {
          fragments[offset < target.start ? 0 : offset < target.end ? 1 : 2]!.content.set(child, xml.sourceXml(child));
          continue;
        }
        const scalars = ["t", "delText"].includes(child.localName) ? [...child.text] : [" "];
        const next = offset + scalars.length;
        const ranges = [[offset, Math.min(next, target.start)], [Math.max(offset, target.start), Math.min(next, target.end)], [Math.max(offset, target.end), next]];
        for (let i = 0; i < ranges.length; i++) {
          const [from, to] = ranges[i]!;
          if (from! >= to!) continue;
          let content = xml.sourceXml(child);
          if (from !== offset || to !== next) {
            const attrs = child.attributes.filter(attribute => !(attribute.namespace === "http://www.w3.org/XML/1998/namespace" && attribute.localName === "space"));
            content = runElementOpen({ ...child, attributes: attrs }).slice(0, -1) + ' xml:space="preserve">' + xmlValue(scalars.slice(from! - offset, to! - offset).join("")) + `</${child.name}>`;
          }
          fragments[i]!.content.set(child, content);
        }
        offset = next;
      }
      xml[splitNativeTextRunXml](node, fragments.filter(fragment => fragment.content.size));
      changed.set(target.location.token, target.location);
      continue;
    } else markup = splitRun(xml, node, target.start, target.end, properties);
    if (markup === xml.sourceXml(node)) continue;
    // Check the selected run, rather than rejecting an opaque unselected sibling.
    const record = parents.get(parent) ?? { xml, patches: new Map() };
    record.patches.set(node, markup); parents.set(parent, record);
    changed.set(target.location.token, target.location);
  }
  for (const [parent, { xml, patches }] of parents) {
    // Merge only consecutive simple runs touched by this operation. Markers,
    // comments, differing direct properties and run metadata are boundaries.
    let previous: { source: XmlElement; nodes: XmlElement[]; key: string | undefined; changed: boolean } | undefined;
    for (const content of parent.content) {
      if (content.kind !== "element" || content.localName !== "r" || content.namespace !== parent.namespace || !selectedNodes.has(content)) { previous = undefined; continue; }
      const replacement = patches.get(content);
      const nodes = replacement === undefined ? [content] : parseDocumentXml(new TextEncoder().encode(`<root${[...content.namespaces].filter(([p]) => p !== "xml").map(([p, uri]) => ` ${p ? "xmlns:" + p : "xmlns"}="${xmlValue(uri)}"`).join("")}>${replacement}</root>`), {}, budget).root.children;
      const first = nodes[0], last = nodes.at(-1);
      const key = first && equivalentRunKey(first);
      if (opts.text === undefined && previous && previous.key !== undefined && previous.key === key && (previous.changed || replacement !== undefined) && previous.nodes.length === 1 && nodes.length === 1) {
        const left = previous.nodes[0]!;
        const right = first!;
        const serialize = (node: XmlElement): string => runElementOpen(node) + node.content.map(c => c.kind === "element" ? serialize(c) : c.kind === "text" ? xmlValue(c.text) : "").join("") + `</${node.name}>`;
        const combined = { ...left, children: [...left.children, ...right.children.filter(c => c.localName !== "rPr")], content: [...left.content, ...right.content.filter(c => c.kind !== "element" || c.localName !== "rPr")] };
        patches.set(previous.source, serialize(combined)); patches.set(content, "");
        for (const node of [previous.source, content]) {
          const location = selectedNodes.get(node)!;
          changed.set(location.token, location);
        }
        previous.nodes = [combined]; previous.changed = true;
      } else previous = { source: content, nodes, key: last && equivalentRunKey(last), changed: replacement !== undefined };
    }
    for (const [node, markup] of patches) xml[replaceSplitTextRunXml](node, markup);
  }
  const changes = selected.filter(location => changed.has(location.token)).map(before => {
    if (opts.text !== undefined) {
      const value = { ...before.value, generation: 1 };
      return { kind: "replace" as const, before, after: { ...before, value, token: encodeLocation(value) } };
    }
    const paragraph = before.kind === "paragraph" ? document.resolve(encodeLocation({ ...before.value, range: null })) : paragraphFor(before);
    let start = 0, length = 0;
    if (before.kind === "run") {
      for (const segment of textFor(paragraph).segments) {
        const size = [...segment.text].length;
        const path = segment.location.value.path;
        const differing = path.findIndex((index, i) => index !== before.value.path[i]);
        if (differing === -1) length += size;
        else if (path[differing]! < before.value.path[differing]!) start += size;
      }
    }
    const range = before.kind === "paragraph" ? before.value.range : { start: start + (before.value.range?.start ?? 0), end: start + (before.value.range?.end ?? length) };
    const value = { ...paragraph.value, generation: 1, range };
    const after = { ...paragraph, value, token: encodeLocation(value) };
    return { kind: "format" as const, before, after };
  });
  const publication = { ...(identity ? { input: identity } : {}), ...(opts.output === undefined ? {} : { output: opts.output }), ...(opts.inPlace === undefined ? {} : { inPlace: opts.inPlace }), ...(opts.force === undefined ? {} : { force: opts.force }), ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }), ...(opts.json === undefined ? {} : { json: opts.json }) };
  const prospective = { changed: changes.length > 0, changes, dryRun: opts.dryRun ?? false, output: opts.dryRun ? null : { path: opts.inPlace ? identity?.path ?? null : opts.output === "-" ? null : opts.output ?? null, bytes: Math.min(settings.limits.maxArchiveBytes, Number.MAX_SAFE_INTEGER), sha256: "0".repeat(64) } };
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: "runs.set", ok: true, data: prospective, affected: changes.length, locations: changes.map(c => c.after), warnings: [], errors: [] }) + "\n").length);
  const result = await publishDocumentArchive(editor.snapshot(), publication, { ...context, budget });
  return { changed: changes.length > 0, changes, dryRun: opts.dryRun ?? false, output: result.published.length ? { path: result.published[0]!.path, bytes: result.published[0]!.bytes, sha256: result.archiveSha256! } : null };
}
