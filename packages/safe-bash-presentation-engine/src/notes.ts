import { SaxesParser } from "saxes";
import type { BinaryInput, Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { attr, child, escape, invalid, loadShared, nextRel, relPart, required } from "./masters.js";
import { relativePartReference } from "./package-uri.js";
import {
  SelectionError,
  type SelectionContext,
  type SelectionQuery,
  type SelectionRecord
} from "./selectors.js";
import { parseXmlPart, type XmlElement, type XmlPart } from "./xml.js";
export interface NotesRecord {
  readonly selector: string;
  readonly location: Location;
  readonly slide: number;
  readonly part: string;
  readonly master: string;
  readonly text: string | null;
  readonly bodyShapeId: string | null;
}
export interface MutateNotesOptions {
  readonly selection: SelectionQuery;
  readonly text?: string;
  readonly allowEmpty?: boolean;
}
type State = Awaited<ReturnType<typeof loadShared>>;
const relns = "http://schemas.openxmlformats.org/package/2006/relationships";
function notesPart(s: State, slide: SelectionRecord) {
  return s.index.inventory.relationships.find(
    (e) => e.owner === slide.part && e.type === `${s.r}/notesSlide` && !e.external
  )?.targetPart;
}
function placeholder(node: XmlElement) {
  const properties = child(node, "nvSpPr");
  const nonvisual = properties && child(properties, "nvPr");
  const ph = nonvisual && child(nonvisual, "ph");
  return ph && attr(ph, "type");
}
function body(doc: XmlPart) {
  const tree = required(required(doc.root, "cSld"), "spTree");
  const bodies = tree.children.filter(
    (n) =>
      n.name.namespace === doc.root.name.namespace &&
      n.name.localName === "sp" &&
      placeholder(n) === "body"
  );
  if (bodies.length > 1)
    throw new OfficeError("ambiguous-selection", "Notes have multiple speaker bodies.", "select");
  return bodies[0];
}
function speakerText(doc: XmlPart, shape: XmlElement | undefined): string | null {
  if (!shape) return null;
  const tx = child(shape, "txBody");
  if (!tx) return null;
  const a =
    doc.root.name.namespace === "http://purl.oclc.org/ooxml/presentationml/main"
      ? "http://purl.oclc.org/ooxml/drawingml/main"
      : "http://schemas.openxmlformats.org/drawingml/2006/main";
  return tx.children
    .filter((n) => n.name.namespace === a && n.name.localName === "p")
    .map((paragraph) =>
      paragraph.children
        .filter((n) => n.name.namespace === a && ["r", "br", "fld"].includes(n.name.localName))
        .map((inline) => {
          if (inline.name.localName === "br") return "\v";
          return inline.children
            .filter((n) => n.name.namespace === a && n.name.localName === "t")
            .map((node) => {
              let text = "";
              const parser = new SaxesParser({ xmlns: true });
              parser.on("text", (value) => {
                text += value;
              });
              parser.on("cdata", (value) => {
                text += value;
              });
              parser.write(doc.markup(node, true)).close();
              return text;
            })
            .join("");
        })
        .join("")
    )
    .join("\n");
}
function validateSelection(selection: unknown): asserts selection is SelectionQuery {
  if (
    !selection ||
    typeof selection !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(selection))
  )
    throw new SelectionError("invalid-selection");
}
function slides(s: State, selection: SelectionQuery) {
  const selected = s.index.select({ ...selection, kind: selection.kind ?? "slide" });
  if (selected.some((n) => n.kind !== "slide")) throw new SelectionError("invalid-selection");
  return selected;
}
export async function readNotes(
  input: BinaryInput,
  options: { readonly selection?: SelectionQuery },
  context: SelectionContext
): Promise<readonly NotesRecord[]> {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Object.keys(options).some((k) => k !== "selection")
  )
    invalid("Invalid notes query.");
  if (options.selection !== undefined) validateSelection(options.selection);
  const s = await loadShared(input, context, false);
  return (options.selection !== undefined ? slides(s, options.selection) : s.index.slides).flatMap(
    (slide) => {
      const part = notesPart(s, slide);
      if (!part) return [];
      const doc = s.doc(part),
        shape = body(doc);
      const props = shape && child(shape, "nvSpPr");
      const id = props && child(props, "cNvPr");
      return [
        {
          selector: slide.token,
          location: slide.location,
          slide: slide.position,
          part,
          master: s.index.inventory.relationships.find(
            (e) => e.owner === part && e.type === `${s.r}/notesMaster`
          )!.targetPart!,
          text: speakerText(doc, shape),
          bodyShapeId: id ? (attr(id, "id") ?? null) : null
        }
      ];
    }
  );
}
export function validateNotesOptions(
  action: "add" | "set" | "remove",
  options: MutateNotesOptions
): void {
  if (
    !["add", "set", "remove"].includes(action) ||
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Object.keys(options).some((k) => !["selection", "text", "allowEmpty"].includes(k))
  )
    invalid("Invalid notes options.");
  validateSelection(options.selection);
  if (options.allowEmpty !== undefined && typeof options.allowEmpty !== "boolean")
    invalid("allowEmpty requires a boolean.");
  if (action === "remove" ? options.text !== undefined : typeof options.text !== "string")
    invalid("Notes editing requires text; removal forbids text.");
  for (const c of options.text ?? "") {
    const n = c.codePointAt(0)!;
    if (
      (n < 32 && ![9, 10, 11, 13].includes(n)) ||
      (n >= 0xd800 && n <= 0xdfff) ||
      n === 0xfffe ||
      n === 0xffff
    )
      invalid("Notes text must contain valid Unicode scalars.");
  }
}
function editableParagraphs(nodes: readonly XmlElement[], a: string): void {
  const pending = [...nodes];
  while (pending.length) {
    const node = pending.pop()!;
    if (
      node.name.namespace !== a ||
      ["extLst", "ext"].includes(node.name.localName) ||
      node.attributes.some(
        (x) => x.name.namespace && x.name.namespace !== "http://www.w3.org/XML/1998/namespace"
      )
    )
      throw new OfficeError(
        "unsupported-edit",
        "Unsupported speaker text content is preserve-only.",
        "validate-intent"
      );
    pending.push(...node.children);
  }
}
function paragraphs(text: string, a: string) {
  return text.split("\n").map(
    (line) =>
      `<a:p xmlns:a="${a}">${line
        .split("\v")
        .map((run) => `<a:r><a:t>${escape(run)}</a:t></a:r>`)
        .join("<a:br/>")}</a:p>`
  );
}
function shapeMarkup(s: State, id: number, type: string, name: string) {
  return `<p:sp xmlns:p="${s.p}" xmlns:a="${s.a}"><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}" idx="${id - 2}"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}
function freshPart(s: State, directory: string, stem: string) {
  let i = 1;
  const occupied = new Set([...s.reader.names, ...s.changes.keys()].map((n) => n.toLowerCase()));
  while (
    occupied.has(`/ppt/${directory}/${stem}${i}.xml`.toLowerCase()) ||
    occupied.has(`/ppt/${directory}/_rels/${stem}${i}.xml.rels`.toLowerCase())
  )
    i++;
  return `/ppt/${directory}/${stem}${i}.xml`;
}
function registerType(s: State, part: string, kind: string) {
  const doc = s.doc("/[Content_Types].xml");
  s.save(
    "/[Content_Types].xml",
    doc.spliceChildren(doc.root, doc.root.children.length, 0, [
      `<Override xmlns="${doc.root.name.namespace}" PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${kind}+xml"/>`
    ])
  );
}
function relationship(
  s: State,
  owner: string,
  target: string,
  kind: string,
  context: SelectionContext
) {
  const name = relPart(owner);
  const doc =
    s.reader.has(name) || s.changes.has(name)
      ? s.doc(name)
      : parseXmlPart(
          new TextEncoder().encode(`<Relationships xmlns="${relns}"/>`),
          context.xmlLimits
        );
  const id = nextRel(doc);
  s.save(
    name,
    doc.spliceChildren(doc.root, doc.root.children.length, 0, [
      `<Relationship xmlns="${relns}" Id="${id}" Type="${s.r}/${kind}" Target="${escape(relativePartReference(target, owner.slice(0, owner.lastIndexOf("/"))))}"/>`
    ])
  );
  return id;
}
function newNotes(s: State, slide: SelectionRecord, context: SelectionContext) {
  let master = s.index.inventory.relationships.find(
    (e) => e.owner === s.main && e.type === `${s.r}/notesMaster` && !e.external
  )?.targetPart;
  if (!master)
    master = [...s.changes.keys()].find(
      (n) => n.startsWith("/ppt/notesMasters/") && n.endsWith(".xml")
    );
  if (!master) {
    master = freshPart(s, "notesMasters", "notesMaster");
    s.save(
      master,
      parseXmlPart(
        new TextEncoder().encode(
          `<p:notesMaster xmlns:p="${s.p}" xmlns:a="${s.a}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapeMarkup(s, 2, "sldImg", "Slide Image")}${shapeMarkup(s, 3, "body", "Notes Text")}${shapeMarkup(s, 4, "sldNum", "Slide Number")}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle/></p:notesMaster>`
        ),
        context.xmlLimits
      )
    );
    const theme = s.index.inventory.themes[0];
    if (theme) relationship(s, master, theme, "theme", context);
    registerType(s, master, "notesMaster");
    const id = relationship(s, s.main, master, "notesMaster", context);
    let doc = s.doc(s.main);
    if (!child(doc.root, "notesMasterIdLst")) {
      const anchor = doc.root.children.findIndex((n) =>
        ["handoutMasterIdLst", "sldIdLst", "sldSz", "notesSz"].includes(n.name.localName)
      );
      doc = doc.spliceChildren(doc.root, anchor < 0 ? doc.root.children.length : anchor, 0, [
        `<p:notesMasterIdLst xmlns:p="${s.p}"/>`
      ]);
    }
    const list = required(doc.root, "notesMasterIdLst");
    s.save(
      s.main,
      doc.spliceChildren(list, list.children.length, 0, [
        `<p:notesMasterId xmlns:p="${s.p}" xmlns:r="${s.r}" r:id="${id}"/>`
      ])
    );
  }
  const masterDoc = s.doc(master);
  const tree = required(required(masterDoc.root, "cSld"), "spTree");
  const clones = tree.children
    .filter(
      (n) =>
        n.name.namespace === s.p &&
        n.name.localName === "sp" &&
        ["sldImg", "body", "sldNum"].includes(placeholder(n) ?? "")
    )
    .map((n, index) => {
      let clone = parseXmlPart(
        new TextEncoder().encode(masterDoc.markup(n, true)),
        context.xmlLimits
      );
      const textBody = child(clone.root, "txBody");
      if (textBody)
        clone = clone.spliceChildren(clone.root, clone.root.children.indexOf(textBody), 1, [
          `<p:txBody xmlns:p="${s.p}" xmlns:a="${s.a}"><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>`
        ]);
      const pending = [clone.root];
      while (pending.length) {
        const node = pending.pop()!;
        if (node.attributes.some((attribute) => attribute.name.namespace === s.r))
          throw new OfficeError(
            "unsupported-edit",
            "Notes master placeholder dependencies require preservation.",
            "validate-intent"
          );
        pending.push(...node.children);
      }
      const identity = required(required(clone.root, "nvSpPr"), "cNvPr");
      clone = clone.merge(identity, {
        attributes: [{ namespace: "", localName: "id", value: String(index + 2) }]
      });
      return clone.markup(clone.root, true);
    });
  const part = freshPart(s, "notesSlides", "notesSlide");
  s.save(
    part,
    parseXmlPart(
      new TextEncoder().encode(
        `<p:notes xmlns:p="${s.p}" xmlns:a="${s.a}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${clones.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
      ),
      context.xmlLimits
    )
  );
  relationship(s, slide.part, part, "notesSlide", context);
  relationship(s, part, slide.part, "slide", context);
  relationship(s, part, master, "notesMaster", context);
  registerType(s, part, "notesSlide");
  return part;
}
export async function mutateNotes(
  input: BinaryInput,
  action: "add" | "set" | "remove",
  options: MutateNotesOptions,
  context: SelectionContext
): Promise<{ bytes: Uint8Array; affected: number; locations: readonly Location[] }> {
  validateNotesOptions(action, options);
  if ((options.text?.length ?? 0) > context.xmlLimits.maxBytes)
    throw new OfficeError("resource-limit", "Notes text exceeds XML limits.", "usage");
  const s = await loadShared(input, context);
  let selected: readonly SelectionRecord[];
  try {
    selected = slides(s, options.selection);
  } catch (error) {
    if (
      !(error instanceof SelectionError) ||
      error.code !== "missing-selection" ||
      !options.allowEmpty
    )
      throw error;
    selected = [];
  }
  const locations: Location[] = [];
  for (const slide of selected) {
    context.signal?.throwIfAborted();
    let part = notesPart(s, slide);
    if (action === "add" && part)
      throw new OfficeError(
        "invalid-value",
        "The selected slide already has notes.",
        "validate-intent"
      );
    if (action === "remove") {
      if (!part) continue;
      const incoming = s.index.inventory.relationships.filter((e) => e.targetPart === part);
      if (incoming.some((e) => e.owner !== slide.part || e.type !== `${s.r}/notesSlide`))
        throw new OfficeError(
          "dangling-reference",
          "Notes have additional references.",
          "validate-intent"
        );
      const rel = s.doc(relPart(slide.part));
      const edge = incoming[0]!;
      s.save(
        relPart(slide.part),
        rel.spliceChildren(
          rel.root,
          rel.root.children.findIndex((n) => attr(n, "Id") === edge.id),
          1,
          []
        )
      );
      const types = s.doc("/[Content_Types].xml");
      const at = types.root.children.findIndex((n) => attr(n, "PartName") === part);
      if (at >= 0) s.save("/[Content_Types].xml", types.spliceChildren(types.root, at, 1, []));
      s.deleted.add(part);
      if (s.reader.has(relPart(part))) s.deleted.add(relPart(part));
    } else {
      part ??= newNotes(s, slide, context);
      let doc = s.doc(part),
        target = body(doc);
      if (!target) {
        const tree = required(required(doc.root, "cSld"), "spTree");
        const ids: number[] = [];
        const pending = [tree];
        while (pending.length) {
          const n = pending.pop()!;
          if (n.name.namespace === s.p && n.name.localName === "cNvPr")
            ids.push(Number(attr(n, "id")));
          pending.push(...n.children);
        }
        const id = ids.reduce((maximum, id) => Math.max(maximum, id), 1) + 1;
        if (id > 4294967295) invalid("No notes shape identity available.");
        doc = doc.spliceChildren(tree, tree.children.length, 0, [
          shapeMarkup(s, id, "body", "Notes Text")
        ]);
        target = body(doc)!;
      }
      let tx = child(target, "txBody");
      if (!tx) {
        doc = doc.spliceChildren(target, target.children.length, 0, [
          `<p:txBody xmlns:p="${s.p}" xmlns:a="${s.a}"><a:bodyPr/><a:lstStyle/></p:txBody>`
        ]);
        target = body(doc)!;
        tx = required(target, "txBody");
      }
      const old = tx.children.filter((n) => n.name.namespace === s.a && n.name.localName === "p");
      editableParagraphs(old, s.a);
      for (let i = old.length - 1; i >= 0; i--) {
        tx = required(body(doc)!, "txBody");
        const paragraphs = tx.children.filter(
          (n) => n.name.namespace === s.a && n.name.localName === "p"
        );
        doc = doc.spliceChildren(tx, tx.children.indexOf(paragraphs[i]!), 1, []);
      }
      tx = required(body(doc)!, "txBody");
      const after = tx.children.reduce(
        (index, n, at) =>
          n.name.namespace === s.a && ["bodyPr", "lstStyle"].includes(n.name.localName)
            ? at
            : index,
        -1
      );
      doc = doc.spliceChildren(tx, after + 1, 0, paragraphs(options.text!, s.a));
      s.save(part, doc);
    }
    locations.push(slide.location);
  }
  if (!locations.length && !options.allowEmpty) throw new SelectionError("missing-selection");
  return {
    bytes: locations.length
      ? (
          await s.finish(
            s.main,
            selected.map((n) => n.position)
          )
        ).bytes
      : s.source,
    affected: locations.length,
    locations
  };
}
