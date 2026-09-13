import { parseContentTypes } from "./content-types.js";
import type { PackageReader } from "./package-reader.js";
import { OfficeError } from "./errors.js";
import { SaxesParser } from "saxes";
import type { BinaryInput, Location } from "./contracts.js";
import { attr, child, escape, invalid, loadShared, nextRel, relPart } from "./masters.js";
import { relativePartReference } from "./package-uri.js";
import {
  decodeSelectionToken,
  SelectionError,
  type SelectionContext,
  type SelectionQuery
} from "./selectors.js";
import { parseXmlPart } from "./xml.js";
export interface CommentRecord {
  readonly id: string;
  readonly selector: string;
  readonly location: Location;
  readonly slide: number;
  readonly part: string;
  readonly authorId: string;
  readonly index: number;
  readonly author: string;
  readonly initials: string;
  readonly text: string;
  readonly timestamp: string;
  readonly left: number;
  readonly top: number;
}
export interface MutateCommentsOptions {
  readonly selection: SelectionQuery;
  readonly id?: string;
  readonly text?: string;
  readonly author?: string;
  readonly authorId?: string;
  readonly initials?: string;
  readonly timestamp?: string;
  readonly left?: number;
  readonly top?: number;
  readonly all?: boolean;
  readonly allowEmpty?: boolean;
}
type State = Awaited<ReturnType<typeof loadShared>>;
function ticks(emu: number) {
  return Math.sign(emu) * Math.round(Math.abs(emu) / 1587.5);
}
const relns = "http://schemas.openxmlformats.org/package/2006/relationships";
function plain(value: unknown, keys: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    invalid("Invalid comment options.");
}
function text(value: unknown) {
  if (typeof value !== "string") invalid("Comment fields require text.");
  for (const c of value) {
    const n = c.codePointAt(0)!;
    if (
      (n < 32 && ![9, 10, 13].includes(n)) ||
      (n >= 0xd800 && n <= 0xdfff) ||
      n === 0xfffe ||
      n === 0xffff
    )
      invalid("Comment text requires valid XML characters.");
  }
}
function uint(value: string | undefined) {
  if (
    !value ||
    [...value].some((c) => c < "0" || c > "9") ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > 4294967295
  )
    invalid("Invalid comment identity.");
  return Number(value);
}
function coordinate(value: string | undefined): number {
  if (value === undefined) return 0;
  const digits = value.startsWith("-") || value.startsWith("+") ? value.slice(1) : value;
  const n = Number(value);
  if (
    !digits ||
    [...digits].some((c) => c < "0" || c > "9") ||
    !Number.isInteger(n) ||
    n < -2147483648 ||
    n > 2147483647
  )
    invalid("Invalid comment position.");
  return n * 1587.5;
}
function xmlNames(
  reader: PackageReader,
  changes: Map<string, Uint8Array>,
  deleted: ReadonlySet<string>,
  limits: SelectionContext["xmlLimits"]
) {
  const names = new Set([...reader.names, ...changes.keys()]);
  const types = parseContentTypes(
    changes.get("/[Content_Types].xml") ?? reader.get("/[Content_Types].xml"),
    { ...limits, maxEntries: names.size }
  );
  return [...names].filter(
    (name) =>
      !deleted.has(name) &&
      name !== "/[Content_Types].xml" &&
      (types.get(name).endsWith("+xml") ||
        ["application/xml", "text/xml"].includes(types.get(name)))
  );
}
function authorsPart(s: State) {
  const edges = s.index.inventory.relationships.filter(
    (e) => e.owner === s.main && e.type === `${s.r}/commentAuthors` && !e.external
  );
  if (edges.length > 1) invalid("Multiple comment author lists.");
  return edges[0]?.targetPart ?? [...s.changes.keys()].find((n) => n === "/ppt/commentAuthors.xml");
}
function authors(s: State) {
  const part = authorsPart(s);
  if (!part) return [];
  const doc = s.doc(part);
  if (doc.root.name.namespace !== s.p || doc.root.name.localName !== "cmAuthorLst")
    invalid("Invalid comment author list.");
  const result = doc.root.children.filter(
    (n) => n.name.namespace === s.p && n.name.localName === "cmAuthor"
  );
  const ids = result.map((n) => String(uint(attr(n, "id"))));
  if (new Set(ids).size !== ids.length) invalid("Duplicate comment author IDs.");
  return result;
}
function resolveSelection(
  s: State,
  selection: SelectionQuery
): { selection: SelectionQuery; location?: Location } {
  if (selection.token === undefined) return { selection };
  const location = decodeSelectionToken(selection.token);
  if (location.fingerprint !== s.index.fingerprint) throw new SelectionError("stale-selection");
  const edge = s.index.inventory.relationships.find(
    (e) => e.targetPart === location.owner && e.type === `${s.r}/comments` && !e.external
  );
  if (!edge) return { selection };
  if (
    Object.keys(selection).some((k) => !["kind", "token"].includes(k)) ||
    location.scope !== "slides"
  )
    throw new SelectionError("invalid-selection");
  const slide = s.index.slides.find((n) => n.part === edge.owner);
  if (!slide) throw new SelectionError("missing-selection");
  return { selection: { kind: "slide", token: slide.token }, location };
}
function records(s: State, selection?: SelectionQuery): CommentRecord[] {
  const resolved = selection ? resolveSelection(s, selection) : undefined;
  const query = resolved?.selection;
  const selected = query
    ? s.index.select({ ...query, kind: query.kind ?? "slide" })
    : s.index.slides;
  if (selected.some((n) => n.kind !== "slide")) throw new SelectionError("invalid-selection");
  const authorNodes = authors(s);
  const result = selected.flatMap((slide) =>
    s.index.inventory.relationships
      .filter((e) => e.owner === slide.part && e.type === `${s.r}/comments` && !e.external)
      .flatMap((edge) => {
        const part = edge.targetPart!;
        const doc = s.doc(part);
        if (doc.root.name.namespace !== s.p || doc.root.name.localName !== "cmLst")
          invalid("Invalid legacy comment list.");
        return doc.root.children
          .filter((n) => n.name.namespace === s.p && n.name.localName === "cm")
          .map((n) => {
            const authorId = String(uint(attr(n, "authorId"))),
              index = uint(attr(n, "idx"));
            const author = authorNodes.find((a) => String(uint(attr(a, "id"))) === authorId);
            if (!author) invalid("Comment author is missing.");
            const position = child(n, "pos"),
              content = child(n, "text");
            let value = "";
            if (content) {
              const parser = new SaxesParser({ xmlns: true });
              parser.on("text", (v) => (value += v));
              parser.on("cdata", (v) => (value += v));
              parser.write(doc.markup(content, true)).close();
            }
            const location: Location = {
              fingerprint: s.index.fingerprint,
              scope: "slides",
              owner: part,
              objectId: `${authorId}:${index}`,
              coordinateSystem: "identity"
            };
            return {
              id: `${authorId}:${index}`,
              selector: JSON.stringify(location),
              location,
              slide: slide.position,
              part,
              authorId,
              index,
              author: attr(author, "name") ?? "",
              initials: attr(author, "initials") ?? "",
              text: value,
              timestamp: attr(n, "dt") ?? "",
              left: coordinate(position ? attr(position, "x") : undefined),
              top: coordinate(position ? attr(position, "y") : undefined)
            };
          });
      })
  );
  const identities = result.map((r) => `${r.slide}:${r.part}:${r.id}`);
  if (new Set(identities).size !== identities.length)
    throw new SelectionError("ambiguous-selection");
  return resolved?.location
    ? result.filter(
        (r) => r.part === resolved.location!.owner && r.id === resolved.location!.objectId
      )
    : result;
}

export async function readComments(
  input: BinaryInput,
  options: { readonly selection?: SelectionQuery; readonly id?: string },
  context: SelectionContext
): Promise<readonly CommentRecord[]> {
  plain(options, ["selection", "id"]);
  if (options.id !== undefined) text(options.id);
  const found = records(await loadShared(input, context, false), options.selection);
  return options.id === undefined ? found : found.filter((r) => r.id === options.id);
}
export function validateCommentsOptions(
  action: "add" | "set" | "remove",
  options: MutateCommentsOptions
) {
  plain(options, [
    "selection",
    "id",
    "text",
    "author",
    "authorId",
    "initials",
    "timestamp",
    "left",
    "top",
    "all",
    "allowEmpty"
  ]);
  if (
    !["add", "set", "remove"].includes(action) ||
    !options.selection ||
    typeof options.selection !== "object"
  )
    invalid("Comment selection is required.");
  for (const key of ["id", "text", "author", "authorId", "initials", "timestamp"] as const)
    if (options[key] !== undefined) text(options[key]);
  if (options.authorId !== undefined) uint(options.authorId);
  if (options.timestamp !== undefined) {
    const t = options.timestamp;
    const parsed = new Date(t);
    if (
      !t.endsWith("Z") ||
      t.length < 20 ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 19) !== t.slice(0, 19)
    )
      invalid("Timestamp must be an explicit valid UTC date-time.");
  }
  for (const key of ["left", "top"] as const)
    if (
      options[key] !== undefined &&
      (!Number.isFinite(options[key]) ||
        !Number.isSafeInteger(options[key]) ||
        Math.abs(options[key]! / 1587.5) > 2147483647)
    )
      invalid("Comment positions require representable eighth-point lengths.");
  for (const key of ["all", "allowEmpty"] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean")
      invalid("Comment cardinality flags require booleans.");
  if (
    action === "add" &&
    (options.text === undefined ||
      !options.author ||
      options.timestamp === undefined ||
      options.id !== undefined)
  )
    invalid("Comment creation requires text, author and timestamp.");
  if (
    action === "remove" &&
    ["text", "author", "authorId", "initials", "timestamp", "left", "top"].some(
      (k) => options[k as keyof MutateCommentsOptions] !== undefined
    )
  )
    invalid("Comment removal forbids edit fields.");
  if (
    action === "set" &&
    !["text", "author", "authorId", "initials", "timestamp", "left", "top"].some(
      (k) => options[k as keyof MutateCommentsOptions] !== undefined
    )
  )
    invalid("Comment edit requires a field.");
  if (
    options.initials !== undefined &&
    options.author === undefined &&
    options.authorId === undefined
  )
    invalid("Initials require an explicit author.");
}
function createPart(
  s: State,
  part: string,
  root: string,
  kind: string,
  owner: string,
  context: SelectionContext
) {
  s.save(
    part,
    parseXmlPart(new TextEncoder().encode(`<p:${root} xmlns:p="${s.p}"/>`), context.xmlLimits)
  );
  const types = s.doc("/[Content_Types].xml");
  s.save(
    "/[Content_Types].xml",
    types.spliceChildren(types.root, types.root.children.length, 0, [
      `<Override xmlns="${types.root.name.namespace}" PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${kind}+xml"/>`
    ])
  );
  const name = relPart(owner),
    rel =
      s.reader.has(name) || s.changes.has(name)
        ? s.doc(name)
        : parseXmlPart(
            new TextEncoder().encode(`<Relationships xmlns="${relns}"/>`),
            context.xmlLimits
          );
  s.save(
    name,
    rel.spliceChildren(rel.root, rel.root.children.length, 0, [
      `<Relationship xmlns="${relns}" Id="${nextRel(rel)}" Type="${s.r}/${kind}" Target="${escape(relativePartReference(part, owner.slice(0, owner.lastIndexOf("/"))))}"/>`
    ])
  );
}
function authorFor(s: State, options: MutateCommentsOptions, context: SelectionContext) {
  let part = authorsPart(s);
  if (!part) {
    part = "/ppt/commentAuthors.xml";
    if (s.reader.has(part)) invalid("Comment author part is already occupied.");
    createPart(s, part, "cmAuthorLst", "commentAuthors", s.main, context);
  }
  const nodes = authors(s);
  const matches =
    options.authorId !== undefined
      ? nodes.filter((n) => uint(attr(n, "id")) === uint(options.authorId))
      : nodes.filter((n) => attr(n, "name") === options.author);
  if (matches.length > 1) throw new SelectionError("ambiguous-selection");
  if (matches[0]) {
    const n = matches[0];
    if (
      (options.author !== undefined && options.author !== attr(n, "name")) ||
      (options.initials !== undefined && options.initials !== attr(n, "initials"))
    )
      invalid("An existing author identity has different details.");
    return String(uint(attr(n, "id")));
  }
  if (!options.author) invalid("New authors require a display name.");
  const used = new Set(nodes.map((n) => uint(attr(n, "id"))));
  let id = options.authorId === undefined ? 0 : uint(options.authorId);
  while (used.has(id)) id++;
  if (id > 4294967295) invalid("Comment author IDs exhausted.");
  const doc = s.doc(part);
  s.save(
    part,
    doc.spliceChildren(doc.root, doc.root.children.length, 0, [
      `<p:cmAuthor xmlns:p="${s.p}" id="${id}" name="${escape(options.author)}" initials="${escape(options.initials ?? "")}" lastIdx="0" clrIdx="${id}"/>`
    ])
  );
  return String(id);
}
function nextIndex(s: State, authorId: string, context: SelectionContext) {
  const part = authorsPart(s)!;
  let doc = s.doc(part);
  const node = authors(s).find((n) => String(uint(attr(n, "id"))) === authorId)!;
  let index = uint(attr(node, "lastIdx"));
  for (const name of xmlNames(s.reader, s.changes, s.deleted, context.xmlLimits)) {
    const parsed = s.doc(name);
    if (parsed.root.name.namespace !== s.p || parsed.root.name.localName !== "cmLst") continue;
    for (const cm of parsed.root.children)
      if (
        cm.name.namespace === s.p &&
        cm.name.localName === "cm" &&
        String(uint(attr(cm, "authorId"))) === authorId
      )
        index = Math.max(index, uint(attr(cm, "idx")));
  }
  if (index === 4294967295) invalid("Comment indices exhausted.");
  index++;
  const target = doc.root.children.find((n) => String(uint(attr(n, "id"))) === authorId)!;
  doc = doc.merge(target, {
    attributes: [{ namespace: "", localName: "lastIdx", value: String(index) }]
  });
  s.save(part, doc);
  return index;
}
export async function mutateComments(
  input: BinaryInput,
  action: "add" | "set" | "remove",
  options: MutateCommentsOptions,
  context: SelectionContext
): Promise<{ bytes: Uint8Array; affected: number; locations: readonly Location[] }> {
  validateCommentsOptions(action, options);
  const s = await loadShared(input, context);
  let slides: typeof s.index.slides;
  try {
    const resolved = resolveSelection(s, options.selection);
    if (action === "add" && resolved.location) throw new SelectionError("invalid-selection");
    slides = s.index.select({ ...resolved.selection, kind: resolved.selection.kind ?? "slide" });
  } catch (e) {
    if (!(e instanceof SelectionError) || e.code !== "missing-selection" || !options.allowEmpty)
      throw e;
    slides = [];
  }
  if (slides.some((n) => n.kind !== "slide")) throw new SelectionError("invalid-selection");
  const matches =
    action === "add" || !slides.length
      ? []
      : records(s, options.selection).filter(
          (r) => options.id === undefined || r.id === options.id
        );
  const count = action === "add" ? slides.length : matches.length;
  if (!count) {
    if (!options.allowEmpty) throw new SelectionError("missing-selection");
    return { bytes: s.source, affected: 0, locations: [] };
  }
  if (count > 1 && !options.all) throw new SelectionError("ambiguous-selection");
  const touchedParts =
    action === "add"
      ? s.index.inventory.relationships
          .filter(
            (e) =>
              slides.some((slide) => slide.part === e.owner) &&
              e.type === `${s.r}/comments` &&
              !e.external
          )
          .map((e) => e.targetPart!)
      : matches.map((r) => r.part);
  for (const part of new Set(touchedParts)) {
    const incoming = s.index.inventory.relationships.filter((e) => e.targetPart === part);
    if (
      incoming.length !== 1 ||
      incoming[0]!.type !== `${s.r}/comments` ||
      !slides.some((slide) => slide.part === incoming[0]!.owner)
    )
      throw new OfficeError(
        "unsupported-edit",
        "Shared comment parts cannot be edited safely.",
        "validate-intent"
      );
  }

  const changedAuthors = new Set<string>();
  const locations: Location[] = [];
  if (action === "add") {
    const authorId = authorFor(s, options, context);
    for (const slide of slides) {
      let part = s.index.inventory.relationships.find(
        (e) => e.owner === slide.part && e.type === `${s.r}/comments` && !e.external
      )?.targetPart;
      if (!part) {
        let i = 1;
        while (
          s.reader.has(`/ppt/comments/comment${i}.xml`) ||
          s.changes.has(`/ppt/comments/comment${i}.xml`)
        )
          i++;
        part = `/ppt/comments/comment${i}.xml`;
        createPart(s, part, "cmLst", "comments", slide.part, context);
      }
      const index = nextIndex(s, authorId, context),
        doc = s.doc(part);
      s.save(
        part,
        doc.spliceChildren(doc.root, doc.root.children.length, 0, [
          `<p:cm xmlns:p="${s.p}" authorId="${authorId}" dt="${escape(options.timestamp!.slice(0, 19) + "Z")}" idx="${index}"><p:pos x="${ticks(options.left ?? 0)}" y="${ticks(options.top ?? 0)}"/><p:text>${escape(options.text!)}</p:text></p:cm>`
        ])
      );
      locations.push(slide.location);
    }
  } else
    for (const record of matches) {
      let doc = s.doc(record.part);
      const find = () =>
        doc.root.children.find(
          (n) =>
            n.name.namespace === s.p &&
            n.name.localName === "cm" &&
            String(uint(attr(n, "authorId"))) === record.authorId &&
            Number(attr(n, "idx")) === record.index
        )!;
      let node = find();
      if (action === "remove") {
        doc = doc.spliceChildren(doc.root, doc.root.children.indexOf(node), 1, []);
        changedAuthors.add(record.authorId);
      } else {
        if (options.author !== undefined || options.authorId !== undefined) {
          const authorId = authorFor(s, options, context);
          if (authorId !== record.authorId) {
            const index = nextIndex(s, authorId, context);
            doc = doc.merge(node, {
              attributes: [
                { namespace: "", localName: "authorId", value: authorId },
                { namespace: "", localName: "idx", value: String(index) }
              ]
            });
            node = doc.root.children.find(
              (n) =>
                String(uint(attr(n, "authorId"))) === authorId && Number(attr(n, "idx")) === index
            )!;
            changedAuthors.add(record.authorId);
          }
        }
        const at = doc.root.children.indexOf(node);
        if (options.timestamp !== undefined)
          doc = doc.merge(node, {
            attributes: [
              { namespace: "", localName: "dt", value: options.timestamp.slice(0, 19) + "Z" }
            ]
          });
        if (options.text !== undefined) {
          node = doc.root.children[at]!;
          const old = child(node, "text");
          doc = doc.spliceChildren(
            node,
            old ? node.children.indexOf(old) : node.children.length,
            old ? 1 : 0,
            [`<p:text xmlns:p="${s.p}">${escape(options.text)}</p:text>`]
          );
        }
        if (options.left !== undefined || options.top !== undefined) {
          node = doc.root.children[at]!;
          const old = child(node, "pos");
          doc = old
            ? doc.merge(old, {
                attributes: [
                  {
                    namespace: "",
                    localName: "x",
                    value: String(ticks(options.left ?? record.left))
                  },
                  { namespace: "", localName: "y", value: String(ticks(options.top ?? record.top)) }
                ]
              })
            : doc.spliceChildren(node, 0, 0, [
                `<p:pos xmlns:p="${s.p}" x="${ticks(options.left ?? record.left)}" y="${ticks(options.top ?? record.top)}"/>`
              ]);
        }
      }
      s.save(record.part, doc);
      locations.push(record.location);
    }
  cleanupCommentAuthors(
    s.reader,
    s.changes,
    s.deleted,
    changedAuthors,
    s.p,
    context.xmlLimits,
    authorsPart(s)
  );

  return {
    bytes: (
      await s.finish(
        s.main,
        slides.map((n) => n.position)
      )
    ).bytes,
    affected: count,
    locations
  };
}

export function cleanupCommentAuthors(
  reader: PackageReader,
  changes: Map<string, Uint8Array>,
  deleted: ReadonlySet<string>,
  candidates: ReadonlySet<string>,
  namespace: string,
  xmlLimits: SelectionContext["xmlLimits"],
  authorPart: string | null | undefined
): void {
  if (candidates.size) {
    const used = new Set<string>();
    let safe = true;
    for (const name of xmlNames(reader, changes, deleted, xmlLimits)) {
      const doc = parseXmlPart(changes.get(name) ?? reader.get(name), xmlLimits);
      if (doc.root.name.namespace !== namespace || doc.root.name.localName !== "cmLst") continue;
      for (const n of doc.root.children) {
        if (n.name.namespace !== namespace || n.name.localName !== "cm") {
          safe = false;
          continue;
        }
        used.add(String(uint(attr(n, "authorId"))));
        if (
          n.children.some(
            (c) => c.name.namespace !== namespace || !["pos", "text"].includes(c.name.localName)
          )
        )
          safe = false;
      }
    }
    const part = authorPart;
    if (safe && part) {
      let doc = parseXmlPart(changes.get(part) ?? reader.get(part), xmlLimits);
      if (
        doc.root.children.some(
          (n) => n.name.namespace !== namespace || n.name.localName !== "cmAuthor"
        )
      )
        return;
      for (let i = doc.root.children.length - 1; i >= 0; i--) {
        const n = doc.root.children[i]!;
        const id = String(uint(attr(n, "id")));
        if (
          n.name.namespace === namespace &&
          n.name.localName === "cmAuthor" &&
          id &&
          candidates.has(id) &&
          !used.has(id) &&
          !n.children.length
        )
          doc = doc.spliceChildren(doc.root, i, 1, []);
      }
      changes.set(part, doc.bytes());
    }
  }
}
