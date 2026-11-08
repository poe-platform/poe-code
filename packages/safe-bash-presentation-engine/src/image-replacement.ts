import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { admitImage } from "./image-admission.js";
import { readImages, type ImageOccurrence, type ReadImagesOptions } from "./images.js";
import { attr, child, escape, loadShared, nextRel, relPart } from "./masters.js";
import { asciiKey, partName, relativePartReference } from "./package-uri.js";
import { SelectionError, type SelectionContext } from "./selectors.js";
import type { XmlElement, XmlPart } from "./xml.js";

export interface ReplaceImageOptions {
  readonly contentType: string;
  readonly shared?: boolean;
  readonly all?: boolean;
  readonly allowEmpty?: boolean;
  readonly preserveCrop?: boolean;
  readonly preserveGeometry?: boolean;
  readonly preserveAltText?: boolean;
  readonly altText?: string;
}
export interface ReplaceImageResult {
  readonly bytes: Uint8Array;
  readonly affected: number;
  readonly occurrences: readonly ImageOccurrence[];
  readonly affectedSlides: readonly number[];
}
function invalid(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
function fields(value: unknown, allowed: readonly string[]): void {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== "string" ||
        !allowed.includes(key) ||
        !("value" in Object.getOwnPropertyDescriptor(value, key)!)
    )
  )
    invalid("Invalid image replacement options.");
}
function nodes(root: XmlElement): XmlElement[] {
  return [root, ...root.children.flatMap(nodes)];
}
function binding(doc: XmlPart, occurrence: ImageOccurrence, r: string, a: string, p: string) {
  let position = 0;
  let found:
    | {
        node: XmlElement;
        attribute: string;
        shape: XmlElement | undefined;
        fill: XmlElement | undefined;
      }
    | undefined;
  const visit = (node: XmlElement, shape?: XmlElement, fill?: XmlElement): void => {
    if (
      node.name.namespace === p &&
      ["pic", "sp", "cxnSp", "graphicFrame", "grpSp"].includes(node.name.localName)
    )
      shape = node;
    if ([p, a].includes(node.name.namespace) && node.name.localName === "blipFill") fill = node;
    if (
      (node.name.namespace === a && node.name.localName === "blip") ||
      (node.name.namespace === "http://schemas.microsoft.com/office/drawing/2016/SVG/main" &&
        node.name.localName === "svgBlip")
    ) {
      for (const attribute of node.attributes.filter(
        (x) => x.name.namespace === r && ["embed", "link"].includes(x.name.localName)
      )) {
        position++;
        if (
          `${occurrence.sourcePart}#image-${position}-${attribute.name.localName}` === occurrence.id
        )
          found = { node, attribute: attribute.name.localName, shape, fill };
      }
    }
    for (const next of node.children) visit(next, shape, fill);
  };
  visit(doc.root);
  if (!found) throw new SelectionError("missing-selection");
  return found;
}

export async function replaceImage(
  input: BinaryInput,
  selector: Omit<ReadImagesOptions, "unique">,
  bytes: Uint8Array,
  options: ReplaceImageOptions,
  context: SelectionContext
): Promise<ReplaceImageResult> {
  context.signal?.throwIfAborted();
  fields(options, [
    "contentType",
    "shared",
    "all",
    "allowEmpty",
    "preserveCrop",
    "preserveGeometry",
    "preserveAltText",
    "altText"
  ]);
  fields(selector, ["scope", "slide", "image", "select"]);
  for (const key of [
    "shared",
    "all",
    "allowEmpty",
    "preserveCrop",
    "preserveGeometry",
    "preserveAltText"
  ] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean")
      invalid("Image replacement policies require booleans.");
  if (options.altText !== undefined && typeof options.altText !== "string")
    invalid("Image alt text requires text.");
  if (
    (selector.select !== undefined && options.all !== undefined) ||
    (!options.all && selector.image === undefined && selector.select === undefined) ||
    (selector.image !== undefined &&
      (!selector.scope || selector.scope === "slides") &&
      selector.slide === undefined) ||
    (selector.scope === "shared" && !options.shared)
  )
    throw new SelectionError("invalid-selection");
  if (!(bytes instanceof Uint8Array)) invalid("Image input requires bytes.");
  if (bytes.byteLength > Math.min(context.limits.maxBytes, context.archiveLimits.maxEntryBytes))
    throw new OfficeError("resource-limit", "Image exceeds the admitted byte budget.", "admit");
  const metadata = admitImage(bytes, options.contentType);
  bytes = new Uint8Array(bytes);
  options = { ...options };
  selector = { ...selector };
  const s = await loadShared(input, context);
  const selected = (await readImages(s.source, selector, context)).occurrences;
  if (!selected.length) {
    if (!options.allowEmpty) throw new SelectionError("missing-selection");
    return { bytes: s.source, affected: 0, occurrences: [], affectedSlides: [] };
  }
  if (selected.length !== 1 && !options.all)
    throw new SelectionError(
      "ambiguous-selection",
      selected.map((x) => x.location)
    );
  const all = (await readImages(s.source, { scope: "shared" }, context)).occurrences;
  const oldParts = new Set(selected.map((x) => x.mediaPart));
  const affected = options.shared ? all.filter((x) => oldParts.has(x.mediaPart)) : selected;
  if (
    affected.some(
      (x) => x.external || !x.mediaPart || x.role !== "primary" || x.contentType === "image/svg+xml"
    )
  )
    throw new OfficeError(
      "unsupported-edit",
      "Replacement requires embedded images without vector fallback bindings.",
      "validate-intent"
    );
  if (
    options.shared &&
    s.index.inventory.relationships.some(
      (x) => x.targetPart && oldParts.has(x.targetPart) && x.type !== `${s.r}/image`
    )
  )
    throw new OfficeError(
      "unsupported-edit",
      "Shared media has an unsupported relationship consumer.",
      "validate-intent"
    );
  const affectedSlides = s.index.inventory.slides
    .filter((slide) =>
      affected.some(
        (x) =>
          x.sourcePart === slide.part ||
          x.inheritedBy.includes(slide.position) ||
          (x.scope === "notes" &&
            s.index.inventory.relationships.some(
              (edge) =>
                edge.owner === slide.part &&
                edge.targetPart === x.sourcePart &&
                edge.type === `${s.r}/notesSlide`
            ))
      )
    )
    .map((x) => x.position);
  if (
    options.preserveCrop !== false &&
    options.preserveGeometry !== false &&
    options.preserveAltText !== false &&
    affected.every((occurrence) => {
      const original = s.reader.get(occurrence.mediaPart!);
      return (
        occurrence.contentType === options.contentType &&
        original.length === bytes.length &&
        original.every((value, index) => value === bytes[index]) &&
        (options.altText === undefined || options.altText === occurrence.altText)
      );
    })
  ) {
    context.signal?.throwIfAborted();
    return { bytes: s.source, affected: affected.length, occurrences: affected, affectedSlides };
  }
  if (
    affected.some((occurrence) =>
      s.reader.names.some((name) => asciiKey(name) === asciiKey(relPart(occurrence.mediaPart!)))
    )
  )
    throw new OfficeError(
      "unsupported-edit",
      "Image resources with owned relationships cannot be replaced.",
      "validate-intent"
    );
  let width = 0,
    height = 0;
  if (options.preserveGeometry === false) {
    if (metadata.pixelWidth === null || metadata.pixelHeight === null)
      invalid("Geometry reset requires intrinsic image dimensions.");
    width = Math.round((metadata.pixelWidth * 914400) / metadata.dpiX);
    height = Math.round((metadata.pixelHeight * 914400) / metadata.dpiY);
    if ([width, height].some((x) => !Number.isSafeInteger(x) || x < 1 || x > 27273042316900))
      invalid("Computed image geometry is outside the supported range.");
  }
  let mediaIndex = 1;
  while (
    s.reader.names.some(
      (name) => asciiKey(name) === `/ppt/media/image${mediaIndex}.${metadata.extension}`
    )
  )
    mediaIndex++;
  const media = `/ppt/media/image${mediaIndex}.${metadata.extension}`;
  s.changes.set(media, bytes);
  const changedEdges = new Set<string>();
  const relationNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
  if (options.shared) {
    for (const edge of s.index.inventory.relationships.filter(
      (x) => x.targetPart && oldParts.has(x.targetPart)
    )) {
      const path = relPart(edge.owner),
        doc = s.doc(path);
      const node = doc.root.children.find((x) => attr(x, "Id") === edge.id)!;
      s.save(
        path,
        doc.merge(node, {
          attributes: [
            {
              namespace: "",
              localName: "Target",
              value: relativePartReference(media, edge.owner.slice(0, edge.owner.lastIndexOf("/")))
            }
          ]
        })
      );
      changedEdges.add(`${edge.owner}#${edge.id}`);
    }
  }
  for (const occurrence of affected) {
    context.signal?.throwIfAborted();
    const owner = occurrence.sourcePart;
    if (!options.shared) {
      const path = relPart(owner),
        rels = s.doc(path),
        rid = nextRel(rels);
      s.save(
        path,
        rels.spliceChildren(rels.root, rels.root.children.length, 0, [
          `<Relationship xmlns="${relationNamespace}" Id="${rid}" Type="${s.r}/image" Target="${escape(relativePartReference(media, owner.slice(0, owner.lastIndexOf("/"))))}"/>`
        ])
      );
      const doc = s.doc(owner),
        target = binding(doc, occurrence, s.r, s.a, s.p);
      s.save(
        owner,
        doc.merge(target.node, {
          attributes: [{ namespace: s.r, localName: target.attribute, value: rid }]
        })
      );
      changedEdges.add(`${owner}#${occurrence.relationshipId}`);
    }
    if (options.preserveCrop === false) {
      const doc = s.doc(owner),
        target = binding(doc, occurrence, s.r, s.a, s.p),
        crop = target.fill && child(target.fill, "srcRect", s.a);
      if (crop)
        s.save(owner, doc.spliceChildren(target.fill!, target.fill!.children.indexOf(crop), 1, []));
    }
    if (options.preserveGeometry === false) {
      const doc = s.doc(owner),
        target = binding(doc, occurrence, s.r, s.a, s.p);
      const properties = target.shape && child(target.shape, "spPr", s.p);
      if (!properties)
        throw new OfficeError(
          "unsupported-edit",
          "Geometry reset requires a shape transform.",
          "validate-intent"
        );
      const transform = child(properties, "xfrm", s.a);
      s.save(
        owner,
        doc.spliceChildren(
          properties,
          transform ? properties.children.indexOf(transform) : 0,
          transform ? 1 : 0,
          [
            `<a:xfrm xmlns:a="${s.a}"><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>`
          ]
        )
      );
    }
    if (options.preserveAltText === false || options.altText !== undefined) {
      const doc = s.doc(owner),
        target = binding(doc, occurrence, s.r, s.a, s.p);
      const identity = target.shape?.children
        .flatMap((x) => x.children)
        .find((x) => x.name.namespace === s.p && x.name.localName === "cNvPr");
      if (!identity)
        throw new OfficeError(
          "unsupported-edit",
          "Alternative text requires a shape identity.",
          "validate-intent"
        );
      s.save(
        owner,
        doc.merge(identity, {
          attributes: [
            { namespace: "", localName: "descr", value: options.altText ?? null },
            ...(options.preserveAltText === false
              ? [{ namespace: "", localName: "title", value: null }]
              : [])
          ]
        })
      );
    }
  }
  const removedEdges = new Set<string>();
  if (!options.shared)
    for (const edge of s.index.inventory.relationships) {
      const key = `${edge.owner}#${edge.id}`;
      if (!changedEdges.has(key)) continue;
      if (
        nodes(s.doc(edge.owner).root).some((node) =>
          node.attributes.some((x) => x.name.namespace === s.r && x.value === edge.id)
        )
      )
        continue;
      const path = relPart(edge.owner),
        doc = s.doc(path),
        node = doc.root.children.find((x) => attr(x, "Id") === edge.id)!;
      s.save(path, doc.spliceChildren(doc.root, doc.root.children.indexOf(node), 1, []));
      removedEdges.add(key);
    }
  for (const part of oldParts)
    if (
      part &&
      !s.index.inventory.relationships.some(
        (edge) =>
          edge.targetPart === part &&
          !(options.shared ? changedEdges : removedEdges).has(`${edge.owner}#${edge.id}`)
      )
    )
      s.deleted.add(part);
  let types = s.doc("/[Content_Types].xml");
  const extensions = new Set(
    [...s.deleted].map((part) => asciiKey(part.slice(part.lastIndexOf(".") + 1)))
  );
  for (let i = types.root.children.length - 1; i >= 0; i--) {
    const node = types.root.children[i]!;
    const deletedOverride =
      node.name.localName === "Override" &&
      [...s.deleted].some(
        (part) => asciiKey(part) === asciiKey(partName(attr(node, "PartName")!, false))
      );
    const extension = attr(node, "Extension");
    const unusedDefault =
      node.name.localName === "Default" &&
      extension &&
      extensions.has(asciiKey(extension)) &&
      ![...s.reader.names, ...s.changes.keys()].some(
        (name) =>
          !s.deleted.has(name) &&
          asciiKey(name.slice(name.lastIndexOf(".") + 1)) === asciiKey(extension)
      );
    if (deletedOverride || unusedDefault) types = types.spliceChildren(types.root, i, 1, []);
  }
  s.save(
    "/[Content_Types].xml",
    types.spliceChildren(types.root, types.root.children.length, 0, [
      `<Override xmlns="${types.root.name.namespace}" PartName="${media}" ContentType="${escape(options.contentType)}"/>`
    ])
  );

  const output = (await s.finish(media, affectedSlides)).bytes;
  const ids = new Set(affected.map((x) => x.id));
  const occurrences = (await readImages(output, { scope: "shared" }, context)).occurrences.filter(
    (x) => ids.has(x.id)
  );
  context.signal?.throwIfAborted();
  return { bytes: output, affected: occurrences.length, occurrences, affectedSlides };
}
