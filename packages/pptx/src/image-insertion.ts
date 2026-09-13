import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { admitImage } from "./image-admission.js";
import { attr, child, escape, loadShared, nextRel, relPart, required } from "./masters.js";
import { relativePartReference } from "./package-uri.js";
import { SelectionError, type SelectionContext } from "./selectors.js";
import { parseXmlPart } from "./xml.js";

export interface AddImageOptions {
  readonly slide: number;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly left?: number;
  readonly top?: number;
  readonly width?: number;
  readonly height?: number;
  readonly fit?: "contain" | "cover" | "stretch";
  readonly altText?: string;
}
function invalid(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}

export async function addImage(
  input: BinaryInput,
  options: AddImageOptions,
  context: SelectionContext
): Promise<Uint8Array> {
  context.signal?.throwIfAborted();
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(
      (key) =>
        typeof key !== "string" ||
        ![
          "slide",
          "bytes",
          "contentType",
          "left",
          "top",
          "width",
          "height",
          "fit",
          "altText"
        ].includes(key) ||
        !("value" in Object.getOwnPropertyDescriptor(options, key)!)
    )
  )
    invalid("Invalid image options.");
  if (!Number.isSafeInteger(options.slide) || options.slide < 1)
    invalid("Select a positive slide position.");
  for (const key of ["left", "top", "width", "height"] as const) {
    const value = options[key];
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) ||
        Math.abs(value) > 27273042316900 ||
        ((key === "width" || key === "height") && value <= 0))
    )
      invalid("Image geometry requires bounded integer EMUs.");
  }
  if (options.altText !== undefined && typeof options.altText !== "string")
    invalid("Image alt text requires text.");
  if (options.fit !== undefined && !["contain", "cover", "stretch"].includes(options.fit))
    invalid("Unknown image fit.");
  if ((options.width !== undefined && options.height !== undefined) !== (options.fit !== undefined))
    invalid("Two image dimensions require an explicit fit; fit requires both dimensions.");
  const metadata = admitImage(options.bytes, options.contentType);
  if (
    options.bytes.byteLength >
    Math.min(context.limits.maxBytes, context.archiveLimits.maxEntryBytes)
  )
    throw new OfficeError("resource-limit", "Image exceeds the admitted byte budget.", "admit");
  const bytes = new Uint8Array(options.bytes);
  options = { ...options, bytes };
  let width = options.width,
    height = options.height;
  let left = options.left ?? 0,
    top = options.top ?? 0;
  let cropX = 0,
    cropY = 0;
  if (metadata.pixelWidth === null || metadata.pixelHeight === null) {
    if (width === undefined || height === undefined || options.fit !== "stretch")
      invalid("Unavailable image dimensions require explicit width, height and stretch fit.");
  } else {
    const naturalWidth = (metadata.pixelWidth * 914400) / metadata.dpiX;
    const naturalHeight = (metadata.pixelHeight * 914400) / metadata.dpiY;
    const ratio = naturalWidth / naturalHeight;
    if (width === undefined && height === undefined) {
      width = naturalWidth;
      height = naturalHeight;
    } else if (width === undefined) width = height! * ratio;
    else if (height === undefined) height = width / ratio;
    else if (options.fit === "contain") {
      const scale = Math.min(width / naturalWidth, height / naturalHeight);
      const fittedWidth = naturalWidth * scale,
        fittedHeight = naturalHeight * scale;
      left += (width - fittedWidth) / 2;
      top += (height - fittedHeight) / 2;
      width = fittedWidth;
      height = fittedHeight;
    } else if (options.fit === "cover") {
      const boxRatio = width / height;
      if (ratio > boxRatio) cropX = (1 - boxRatio / ratio) * 50000;
      else cropY = (1 - ratio / boxRatio) * 50000;
    }
  }
  const round = (value: number) => Math.sign(value) * Math.round(Math.abs(value));
  width = round(width!);
  height = round(height!);
  left = round(left);
  top = round(top);
  if (
    [left, top, width, height].some(
      (value) => !Number.isSafeInteger(value) || Math.abs(value) > 27273042316900
    ) ||
    width < 1 ||
    height < 1
  )
    invalid("Computed image geometry is outside the supported range.");
  if (Math.round(cropX) >= 50000 || Math.round(cropY) >= 50000)
    invalid("Image crop cannot leave an empty source rectangle.");
  const s = await loadShared(input, context);
  const target = s.index.inventory.slides.find((slide) => slide.position === options.slide);
  if (!target) throw new SelectionError("missing-selection");
  const doc = s.doc(target.part),
    tree = required(required(doc.root, "cSld"), "spTree");
  const used = new Set<number>();
  const pending = [tree];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.name.namespace === s.p && node.name.localName === "cNvPr")
      used.add(Number(attr(node, "id")));
    pending.push(...node.children);
  }
  let id = 1;
  while (used.has(id)) id++;
  if (id > 4294967295) invalid("No available picture identity.");
  let mediaIndex = 1;
  while (
    s.reader.names.some(
      (name) => name.toLowerCase() === `/ppt/media/image${mediaIndex}.${metadata.extension}`
    )
  )
    mediaIndex++;
  const media = `/ppt/media/image${mediaIndex}.${metadata.extension}`;
  const relationsPart = relPart(target.part);
  const relns = "http://schemas.openxmlformats.org/package/2006/relationships";
  const rels = s.reader.names.includes(relationsPart)
    ? s.doc(relationsPart)
    : parseXmlPart(
        new TextEncoder().encode(`<Relationships xmlns="${relns}"/>`),
        context.xmlLimits
      );
  const rid = nextRel(rels);
  s.save(
    relationsPart,
    rels.spliceChildren(rels.root, rels.root.children.length, 0, [
      `<Relationship xmlns="${relns}" Id="${rid}" Type="${s.r}/image" Target="${escape(relativePartReference(media, target.part.slice(0, target.part.lastIndexOf("/"))))}"/>`
    ])
  );
  const types = s.doc("/[Content_Types].xml");
  s.save(
    "/[Content_Types].xml",
    types.spliceChildren(types.root, types.root.children.length, 0, [
      `<Override xmlns="${types.root.name.namespace}" PartName="${media}" ContentType="${options.contentType}"/>`
    ])
  );
  s.changes.set(media, bytes);
  const picture = `<p:pic xmlns:p="${s.p}" xmlns:a="${s.a}" xmlns:r="${s.r}"><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}" descr="${escape(options.altText ?? "")}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:srcRect l="${Math.round(cropX)}" t="${Math.round(cropY)}" r="${Math.round(cropX)}" b="${Math.round(cropY)}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${left}" y="${top}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  const extension = child(tree, "extLst");
  s.save(
    target.part,
    doc.spliceChildren(
      tree,
      extension ? tree.children.indexOf(extension) : tree.children.length,
      0,
      [picture]
    )
  );
  return (await s.finish(target.part, [options.slide])).bytes;
}
