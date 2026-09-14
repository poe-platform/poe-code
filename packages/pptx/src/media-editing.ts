import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { admitImage } from "./image-admission.js";
import { addImage } from "./image-insertion.js";
import { readImages } from "./images.js";
import { attr, child, escape, invalid, loadShared, nextRel, relPart, required } from "./masters.js";
import { readMedia, type ReadMediaOptions } from "./media.js";
import { packageUri, relativePartReference } from "./package-uri.js";
import { SelectionError, type SelectionContext } from "./selectors.js";
import type { XmlElement } from "./xml.js";
export interface MediaPoster {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}
export interface AddMediaOptions {
  readonly slide: number;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly kind: "audio" | "video";
  readonly poster: MediaPoster;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly trimStart?: number;
  readonly trimEnd?: number;
  readonly loop?: boolean;
  readonly volume?: number;
}
export interface ReplaceMediaOptions extends ReadMediaOptions {
  readonly bytes: Uint8Array;
  readonly poster: MediaPoster;
  readonly contentType?: string;
  readonly kind?: "audio" | "video";
  readonly shared?: boolean;
  readonly all?: boolean;
  readonly allowEmpty?: boolean;
}
export interface ReplaceMediaResult {
  readonly bytes: Uint8Array;
  readonly affected: number;
  readonly affectedSlides: readonly number[];
}
const mediaNs = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const mediaRel = "http://schemas.microsoft.com/office/2007/relationships/media";
const relNs = "http://schemas.openxmlformats.org/package/2006/relationships";
function fields(value: unknown, names: readonly string[]): void {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== "string" ||
        !names.includes(key) ||
        !("value" in Object.getOwnPropertyDescriptor(value, key)!)
    )
  )
    invalid("Invalid media options.");
}
function budget(bytes: Uint8Array, context: SelectionContext): void {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength)
    invalid("Media requires nonempty supplied bytes.");
  if (
    bytes.byteLength >
    Math.min(268435456, context.limits.maxBytes, context.archiveLimits.maxEntryBytes)
  )
    throw new OfficeError("resource-limit", "Media exceeds the admitted byte budget.", "admit");
}
function admit(bytes: Uint8Array, type: string, kind: string, context: SelectionContext): string {
  context.signal?.throwIfAborted();
  budget(bytes, context);
  if (typeof type !== "string" || !["audio", "video"].includes(kind))
    invalid("Invalid media kind or content type.");
  const profiles: Record<string, [string, string]> = {
    "video/mp4": ["video", "mp4"],
    "audio/mp4": ["audio", "m4a"],
    "video/quicktime": ["video", "mov"],
    "video/mpeg": ["video", "mpg"],
    "audio/mpeg": ["audio", "mp3"],
    "audio/wav": ["audio", "wav"],
    "audio/x-wav": ["audio", "wav"],
    "video/x-msvideo": ["video", "avi"],
    "video/x-ms-wmv": ["video", "wmv"],
    "audio/x-ms-wma": ["audio", "wma"]
  };
  const profile = Object.hasOwn(profiles, type) ? profiles[type] : undefined;
  if (!profile || profile[0] !== kind) invalid("Unsupported media content type or kind mismatch.");
  const ascii = (offset: number, n: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + n));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let valid = false;
  if (["mp4", "m4a", "mov"].includes(profile[1])) {
    let offset = 0,
      header = false;
    while (offset + 8 <= bytes.length) {
      const size = view.getUint32(offset);
      const name = ascii(offset + 4, 4);
      if (size < 8 || size > bytes.length - offset) break;
      if (name === "ftyp" && size >= 16) header = true;
      offset += size;
    }
    valid = header && offset === bytes.length;
  } else if (["wav", "avi"].includes(profile[1]))
    valid =
      bytes.length >= 12 &&
      ascii(0, 4) === "RIFF" &&
      view.getUint32(4, true) === bytes.length - 8 &&
      ascii(8, 4) === (profile[1] === "wav" ? "WAVE" : "AVI ");
  else if (profile[1] === "mpg")
    valid =
      bytes.length >= 12 &&
      bytes[0] === 0 &&
      bytes[1] === 0 &&
      bytes[2] === 1 &&
      [0xba, 0xb3].includes(bytes[3]!);
  else if (profile[1] === "mp3")
    valid =
      (bytes.length >= 10 &&
        ascii(0, 3) === "ID3" &&
        bytes[3]! >= 2 &&
        bytes[3]! <= 4 &&
        bytes.subarray(6, 10).every((x) => x < 128) &&
        ((bytes[6]! << 21) | (bytes[7]! << 14) | (bytes[8]! << 7) | bytes[9]!) <=
          bytes.length - 10) ||
      (bytes.length >= 4 &&
        bytes[0] === 255 &&
        (bytes[1]! & 0xe0) === 0xe0 &&
        (bytes[1]! & 6) !== 0 &&
        (bytes[2]! & 0xf0) !== 0xf0 &&
        (bytes[2]! & 0x0c) !== 0x0c);
  else
    valid =
      bytes.length >= 30 &&
      [
        0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0, 0xaa, 0, 0x62, 0xce, 0x6c
      ].every((x, i) => bytes[i] === x) &&
      view.getBigUint64(16, true) <= BigInt(bytes.length);
  if (!valid) invalid("Media bytes do not match the declared container type.");
  return profile[1];
}
function poster(value: MediaPoster | undefined, context: SelectionContext): MediaPoster {
  if (value === undefined) invalid("Media requires an explicit poster.");
  fields(value, ["bytes", "contentType"]);
  budget(value.bytes, context);
  admitImage(value.bytes, value.contentType);
  return { bytes: new Uint8Array(value.bytes), contentType: value.contentType };
}
function walk(node: XmlElement): XmlElement[] {
  return [node, ...node.children.flatMap(walk)];
}
type Shared = Awaited<ReturnType<typeof loadShared>>;
function store(
  s: Shared,
  bytes: Uint8Array,
  type: string,
  extension: string,
  deduplicate = false
): string {
  if (deduplicate)
    for (const candidate of s.index.inventory.parts) {
      if (candidate.contentType !== type || candidate.bytes !== bytes.byteLength) continue;
      const existing = s.reader.get(candidate.part);
      if (existing.every((value, index) => value === bytes[index])) return candidate.part;
    }
  let i = 1;
  const names = [...s.reader.names, ...s.changes.keys()].map((x) => x.toLowerCase());
  while (names.includes(`/ppt/media/clip${i}.${extension}`)) i++;
  const part = `/ppt/media/clip${i}.${extension}`;
  s.changes.set(part, new Uint8Array(bytes));
  const types = s.doc("/[Content_Types].xml");
  s.save(
    "/[Content_Types].xml",
    types.spliceChildren(types.root, types.root.children.length, 0, [
      `<Override xmlns="${types.root.name.namespace}" PartName="${part}" ContentType="${escape(type)}"/>`
    ])
  );
  return part;
}
function edge(s: Shared, owner: string, part: string, type: string): string {
  const path = relPart(owner),
    doc = s.doc(path),
    id = nextRel(doc);
  s.save(
    path,
    doc.spliceChildren(doc.root, doc.root.children.length, 0, [
      `<Relationship xmlns="${relNs}" Id="${id}" Type="${type}" Target="${escape(relativePartReference(part, packageUri(owner).baseURI))}"/>`
    ])
  );
  return id;
}
export async function addMedia(
  input: BinaryInput,
  options: AddMediaOptions,
  context: SelectionContext
): Promise<Uint8Array> {
  fields(options, [
    "slide",
    "bytes",
    "contentType",
    "kind",
    "poster",
    "left",
    "top",
    "width",
    "height",
    "trimStart",
    "trimEnd",
    "loop",
    "volume"
  ]);
  const extension = admit(options.bytes, options.contentType, options.kind, context),
    icon = poster(options.poster, context),
    bytes = new Uint8Array(options.bytes);
  for (const key of ["left", "top", "width", "height"] as const)
    if (
      !Number.isSafeInteger(options[key]) ||
      Math.abs(options[key]) > 27273042316900 ||
      (["width", "height"].includes(key) && options[key] <= 0)
    )
      invalid("Media requires explicit bounded EMU geometry.");
  for (const key of ["trimStart", "trimEnd", "volume"] as const)
    if (
      options[key] !== undefined &&
      (!Number.isSafeInteger(options[key]) ||
        options[key]! < 0 ||
        options[key]! > (key === "volume" ? 100000 : 2147483647))
    )
      invalid("Invalid media playback metadata.");
  if (options.loop !== undefined && typeof options.loop !== "boolean")
    invalid("Loop requires a boolean.");
  const pictured = await addImage(
    input,
    {
      slide: options.slide,
      bytes: icon.bytes,
      contentType: icon.contentType,
      left: options.left,
      top: options.top,
      width: options.width,
      height: options.height
    },
    context
  );
  const image = (await readImages(pictured, { slide: options.slide }, context)).occurrences.at(-1)!;
  const s = await loadShared(pictured, context),
    owner = image.sourcePart,
    part = store(s, bytes, options.contentType, extension, true);
  const legacy = edge(s, owner, part, `${s.r}/${options.kind}`),
    modern = edge(s, owner, part, mediaRel);
  let doc = s.doc(owner);
  const shape = walk(doc.root).find(
    (node) =>
      node.name.localName === "pic" &&
      node.name.namespace === s.p &&
      child(child(node, "nvPicPr")!, "cNvPr") &&
      attr(child(child(node, "nvPicPr")!, "cNvPr")!, "id") === image.shapeId
  )!;
  const identity = required(required(shape, "nvPicPr"), "cNvPr");
  s.save(
    owner,
    doc.merge(identity, {
      attributes: [{ namespace: "", localName: "name", value: `Media ${image.shapeId}` }]
    })
  );
  doc = s.doc(owner);
  const nv = walk(doc.root).find(
    (node) =>
      node.name.localName === "nvPicPr" && attr(required(node, "cNvPr"), "id") === image.shapeId
  )!;
  const clickable = required(nv, "cNvPr");
  s.save(
    owner,
    doc.spliceChildren(clickable, 0, 0, [
      `<a:hlinkClick xmlns:a="${s.a}" action="ppaction://media"/>`
    ])
  );
  doc = s.doc(owner);
  const currentNv = walk(doc.root).find(
    (n) =>
      n.name.namespace === s.p &&
      n.name.localName === "nvPicPr" &&
      attr(required(n, "cNvPr"), "id") === image.shapeId
  )!;
  const nvPr = required(currentNv, "nvPr");
  s.save(
    owner,
    doc.spliceChildren(nvPr, 0, 0, [
      `<a:${options.kind}File xmlns:a="${s.a}" xmlns:r="${s.r}" r:link="${legacy}"/>`,
      `<p:extLst xmlns:p="${s.p}"><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><m:media xmlns:m="${mediaNs}" xmlns:r="${s.r}" r:embed="${modern}">${options.trimStart !== undefined || options.trimEnd !== undefined ? `<m:trim st="${options.trimStart ?? 0}" end="${options.trimEnd ?? 0}"/>` : ""}</m:media></p:ext></p:extLst>`
    ])
  );
  doc = s.doc(owner);
  const timing = child(doc.root, "timing");
  let id = 1;
  const used = new Set(
    walk(doc.root)
      .filter((n) => n.name.namespace === s.p && n.name.localName === "cTn")
      .map((n) => attr(n, "id"))
  );
  while (used.has(String(id))) id++;
  const node = `<p:${options.kind} xmlns:p="${s.p}"><p:cMediaNode${options.volume !== undefined ? ` vol="${options.volume}"` : ""}><p:cTn id="${id}" fill="hold" display="0"${options.loop === true ? ' repeatCount="indefinite"' : options.loop === false ? ' repeatCount="1000"' : ""}><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${image.shapeId}"/></p:tgtEl></p:cMediaNode></p:${options.kind}>`;
  if (timing) {
    const list = child(timing, "tnLst");
    s.save(
      owner,
      list
        ? doc.spliceChildren(list, list.children.length, 0, [node])
        : doc.spliceChildren(timing, 0, 0, [`<p:tnLst xmlns:p="${s.p}">${node}</p:tnLst>`])
    );
  } else {
    const ext = child(doc.root, "extLst");
    s.save(
      owner,
      doc.spliceChildren(
        doc.root,
        ext ? doc.root.children.indexOf(ext) : doc.root.children.length,
        0,
        [`<p:timing xmlns:p="${s.p}"><p:tnLst>${node}</p:tnLst></p:timing>`]
      )
    );
  }
  return (await s.finish(owner, [options.slide])).bytes;
}
export async function replaceMedia(
  input: BinaryInput,
  options: ReplaceMediaOptions,
  context: SelectionContext
): Promise<ReplaceMediaResult> {
  fields(options, [
    "scope",
    "slide",
    "shape",
    "select",
    "bytes",
    "poster",
    "contentType",
    "kind",
    "shared",
    "all",
    "allowEmpty"
  ]);
  for (const key of ["shared", "all", "allowEmpty"] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean")
      invalid("Media replacement policies require booleans.");
  if (options.poster === undefined) invalid("Media replacement requires an explicit poster.");
  const icon = poster(options.poster, context);
  budget(options.bytes, context);
  const bytes = new Uint8Array(options.bytes);
  const s = await loadShared(input, context);
  const selector = {
    ...(options.scope !== undefined ? { scope: options.scope } : {}),
    ...(options.slide !== undefined ? { slide: options.slide } : {}),
    ...(options.shape !== undefined ? { shape: options.shape } : {}),
    ...(options.select !== undefined ? { select: options.select } : {})
  };
  let selected = [...(await readMedia(s.source, selector, context)).occurrences];
  if (!selected.length && !options.allowEmpty) throw new SelectionError("missing-selection");
  if (selected.length > 1 && !options.all) throw new SelectionError("ambiguous-selection");
  const all = (await readMedia(s.source, { scope: "shared" }, context)).occurrences;
  const oldParts = new Set(
    selected.flatMap((x) => x.relationships.map((r) => r.mediaPart).filter((x) => x !== null))
  );
  if (options.shared)
    selected = all.filter(
      (x) =>
        selected.some((y) => y.id === x.id) ||
        x.relationships.some((r) => r.mediaPart !== null && oldParts.has(r.mediaPart))
    );
  for (const occurrence of selected) {
    if (
      !occurrence.shapeId ||
      !occurrence.posters.length ||
      [...occurrence.relationships, ...occurrence.posters].some((x) => x.external)
    )
      throw new OfficeError(
        "unsupported-edit",
        "Replacement requires an embedded media shape with an existing poster graph.",
        "validate-intent"
      );
    if (new Set(occurrence.relationships.map((x) => x.mediaPart)).size !== 1)
      invalid("Replacement requires one unambiguous media resource per shape.");
    const type = options.contentType ?? occurrence.relationships[0]!.contentType;
    if (!type) invalid("Replacement requires a media content type.");
    const kind = options.kind ?? occurrence.kind;
    if (kind !== occurrence.kind) invalid("Replacement cannot change media kind.");
    admit(bytes, type, kind, context);
    const doc = s.doc(occurrence.sourcePart);
    const shape = walk(doc.root).find(
      (node) =>
        node.name.namespace === s.p &&
        ["pic", "sp", "graphicFrame"].includes(node.name.localName) &&
        node.children.some((nv) =>
          nv.children.some(
            (identity) =>
              identity.name.namespace === s.p &&
              identity.name.localName === "cNvPr" &&
              attr(identity, "id") === occurrence.shapeId
          )
        )
    );
    if (!shape) throw new SelectionError("missing-selection");
    const bindings = new Map<XmlElement, string>();
    for (const container of shape.children.filter((node) => node.name.namespace === s.p)) {
      if (container.name.localName === "blipFill") {
        for (const node of container.children)
          if (node.name.namespace === s.a && node.name.localName === "blip")
            bindings.set(node, "embed");
      }
      if (!["nvPicPr", "nvSpPr", "nvGraphicFramePr"].includes(container.name.localName)) continue;
      for (const nv of container.children.filter(
        (node) => node.name.namespace === s.p && node.name.localName === "nvPr"
      )) {
        for (const node of nv.children) {
          if (node.name.namespace === s.a) {
            if (["videoFile", "audioFile"].includes(node.name.localName))
              bindings.set(node, "link");
            if (node.name.localName === "wavAudioFile") bindings.set(node, "embed");
          }
          if (node.name.namespace !== s.p || node.name.localName !== "extLst") continue;
          for (const ext of node.children.filter(
            (element) => element.name.namespace === s.p && element.name.localName === "ext"
          ))
            for (const media of ext.children)
              if (media.name.namespace === mediaNs && media.name.localName === "media")
                bindings.set(media, "embed");
        }
      }
    }
    const replacedIds = new Set(
      [...occurrence.relationships, ...occurrence.posters].map(
        (reference) => reference.relationshipId
      )
    );
    if (
      walk(shape).some((node) =>
        node.attributes.some(
          (attribute) =>
            attribute.name.namespace === s.r &&
            replacedIds.has(attribute.value) &&
            bindings.get(node) !== attribute.name.localName
        )
      )
    )
      throw new OfficeError(
        "unsupported-edit",
        "Replacement would rebind unsupported media or track metadata.",
        "validate-intent"
      );
  }
  const posters = admitImage(icon.bytes, icon.contentType);
  const affectedSlides = new Set<number>();
  const replacementParts = new Map<string, string>();
  for (const occurrence of selected) {
    const owner = occurrence.sourcePart;
    const type = options.contentType ?? occurrence.relationships[0]!.contentType!;
    const resourceKey = `${occurrence.relationships[0]!.mediaPart}#${type}`;
    const part =
      (options.shared ? replacementParts.get(resourceKey) : undefined) ??
      store(s, bytes, type, admit(bytes, type, occurrence.kind, context));
    replacementParts.set(resourceKey, part);
    const image = store(s, icon.bytes, icon.contentType, posters.extension);
    for (const reference of [...occurrence.relationships, ...occurrence.posters]) {
      const newPart = occurrence.posters.includes(reference) ? image : part;
      const ownerDoc = s.doc(owner);
      const ownerNodes = walk(ownerDoc.root);
      const selectedShape = ownerNodes.find(
        (n) =>
          n.name.namespace === s.p &&
          ["pic", "sp", "graphicFrame"].includes(n.name.localName) &&
          n.children.some((nv) =>
            nv.children.some(
              (c) =>
                c.name.namespace === s.p &&
                c.name.localName === "cNvPr" &&
                attr(c, "id") === occurrence.shapeId
            )
          )
      )!;
      const inside = new Set(walk(selectedShape));
      const sharedBinding = ownerNodes.some(
        (n) =>
          !inside.has(n) &&
          n.attributes.some((a) => a.name.namespace === s.r && a.value === reference.relationshipId)
      );
      if (!sharedBinding) {
        const path = relPart(owner),
          doc = s.doc(path),
          node = doc.root.children.find((n) => attr(n, "Id") === reference.relationshipId)!;
        s.save(
          path,
          doc.merge(node, {
            attributes: [
              {
                namespace: "",
                localName: "Target",
                value: relativePartReference(newPart, packageUri(owner).baseURI)
              }
            ]
          })
        );
      } else {
        const rid = edge(s, owner, newPart, reference.relationshipType);
        let doc = s.doc(owner);
        const shape = walk(doc.root).find(
          (n) =>
            n.name.namespace === s.p &&
            ["pic", "sp", "graphicFrame"].includes(n.name.localName) &&
            n.children.some((nv) =>
              nv.children.some(
                (c) => c.name.localName === "cNvPr" && attr(c, "id") === occurrence.shapeId
              )
            )
        )!;
        const matches = walk(shape).flatMap((n) =>
          n.attributes
            .filter((a) => a.name.namespace === s.r && a.value === reference.relationshipId)
            .map((a) => ({ index: walk(doc.root).indexOf(n), local: a.name.localName }))
        );
        for (const match of matches) {
          doc = s.doc(owner);
          const node = walk(doc.root)[match.index]!;
          s.save(
            owner,
            doc.merge(node, {
              attributes: [{ namespace: s.r, localName: match.local, value: rid }]
            })
          );
        }
      }
    }
    for (const slide of s.index.inventory.slides) {
      const notes = s.index.inventory.relationships
        .filter(
          (edge) => edge.owner === slide.part && !edge.external && edge.type === `${s.r}/notesSlide`
        )
        .flatMap((edge) => (edge.targetPart ? [edge.targetPart] : []));
      if (
        [slide.part, slide.layout, slide.master, ...notes].includes(owner) ||
        s.index.inventory.relationships.some(
          (edge) =>
            notes.includes(edge.owner) &&
            !edge.external &&
            edge.type === `${s.r}/notesMaster` &&
            edge.targetPart === owner
        )
      )
        affectedSlides.add(slide.position);
    }
  }
  if (!selected.length) return { bytes: s.source, affected: 0, affectedSlides: [] };
  return {
    bytes: (await s.finish(selected[0]!.sourcePart, [...affectedSlides])).bytes,
    affected: selected.length,
    affectedSlides: [...affectedSlides]
  };
}
