import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { PROG_ID, type OleApplication } from "./ole-enum.js";
import { admitImage } from "./image-admission.js";
import { child, escape, loadShared, nextRel, relPart, required } from "./masters.js";
import { relativePartReference } from "./package-uri.js";
import { SelectionError, type SelectionContext } from "./selectors.js";
import { ShapeIdAllocator } from "./shape-id.js";
import { parseXmlPart } from "./xml.js";

export interface AddOleObjectOptions {
  readonly slide: number;
  readonly bytes: Uint8Array;
  readonly progId: string | OleApplication;
  readonly iconBytes: Uint8Array;
  readonly iconContentType: string;
  readonly left?: number;
  readonly top?: number;
  readonly width?: number;
  readonly height?: number;
  readonly iconWidth?: number;
  readonly iconHeight?: number;
  readonly name?: string;
}
function invalid(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}

export async function addOleObject(
  input: BinaryInput,
  options: AddOleObjectOptions,
  context: SelectionContext
): Promise<Uint8Array> {
  context.signal?.throwIfAborted();
  const fields = [
    "slide",
    "bytes",
    "progId",
    "iconBytes",
    "iconContentType",
    "left",
    "top",
    "width",
    "height",
    "iconWidth",
    "iconHeight",
    "name"
  ];
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(
      (key) =>
        typeof key !== "string" ||
        !fields.includes(key) ||
        !("value" in Object.getOwnPropertyDescriptor(options, key)!)
    )
  )
    invalid("Invalid object insertion options.");
  if (!Number.isSafeInteger(options.slide) || options.slide < 1)
    invalid("Select a positive slide position.");
  if (!(options.bytes instanceof Uint8Array) || options.bytes.length === 0)
    invalid("Object insertion requires nonempty explicit bytes.");
  const application = Object.values(PROG_ID).find((value) => value === options.progId);
  const progId = application?.progId ?? options.progId;
  if (typeof progId !== "string" || progId.trim().length === 0 || progId.length > 255)
    invalid("Object insertion requires a bounded program identity.");
  if (options.name !== undefined && typeof options.name !== "string")
    invalid("Object name requires text.");
  for (const key of ["left", "top", "width", "height", "iconWidth", "iconHeight"] as const) {
    const value = options[key];
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) ||
        Math.abs(value) > 27273042316900 ||
        (key !== "left" && key !== "top" && value <= 0))
    )
      invalid("Object geometry requires bounded integer EMUs.");
  }
  if (!(options.iconBytes instanceof Uint8Array))
    invalid("Object insertion requires explicit icon bytes.");
  for (const bytes of [options.bytes, options.iconBytes])
    if (bytes.byteLength > Math.min(context.limits.maxBytes, context.archiveLimits.maxEntryBytes))
      throw new OfficeError(
        "resource-limit",
        "Object payload exceeds the admitted byte budget.",
        "admit"
      );
  const icon = admitImage(options.iconBytes, options.iconContentType);
  const naturalWidth =
    icon.pixelWidth === null ? undefined : Math.round((icon.pixelWidth * 914400) / icon.dpiX);
  const naturalHeight =
    icon.pixelHeight === null ? undefined : Math.round((icon.pixelHeight * 914400) / icon.dpiY);
  const width = options.width ?? application?.width.emu ?? 914400;
  const height = options.height ?? application?.height.emu ?? 914400;
  const iconWidth = options.iconWidth ?? options.width ?? naturalWidth ?? width;
  const iconHeight = options.iconHeight ?? options.height ?? naturalHeight ?? height;
  if (
    [iconWidth, iconHeight, width, height].some(
      (value) =>
        value === undefined || !Number.isSafeInteger(value) || value < 1 || value > 27273042316900
    )
  )
    invalid("Unavailable icon dimensions require explicit bounded geometry.");
  options = {
    ...options,
    bytes: new Uint8Array(options.bytes),
    iconBytes: new Uint8Array(options.iconBytes)
  };
  const s = await loadShared(input, context);
  const target = s.index.inventory.slides.find((slide) => slide.position === options.slide);
  if (!target) throw new SelectionError("missing-selection");
  const doc = s.doc(target.part),
    tree = required(required(doc.root, "cSld"), "spTree");
  const allocator = new ShapeIdAllocator(() => doc);
  allocator.turbo_add_enabled = true;
  const id = allocator.next();
  const pictureId = allocator.next();
  const availablePart = (prefix: string, extension: string) => {
    let n = 1;
    while (
      s.reader.names.some(
        (name) => name.toLowerCase() === `${prefix}${n}.${extension}`.toLowerCase()
      )
    )
      n++;
    return `${prefix}${n}.${extension}`;
  };
  const packageTypes = {
    DOCX: {
      extension: "docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    },
    PPTX: {
      extension: "pptx",
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    },
    XLSX: {
      extension: "xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }
  } as const;
  const payload = application
    ? packageTypes[application.name]
    : { extension: "bin", contentType: "application/vnd.openxmlformats-officedocument.oleObject" };
  const objectPart = availablePart("/ppt/embeddings/oleObject", payload.extension);
  const iconPart = availablePart("/ppt/media/oleIcon", icon.extension);
  const relns = "http://schemas.openxmlformats.org/package/2006/relationships";
  const relationsPart = relPart(target.part);
  let rels = s.reader.names.includes(relationsPart)
    ? s.doc(relationsPart)
    : parseXmlPart(
        new TextEncoder().encode(`<Relationships xmlns="${relns}"/>`),
        context.xmlLimits
      );
  const ids: string[] = [];
  for (const [part, type] of [
    [objectPart, application ? "package" : "oleObject"],
    [iconPart, "image"]
  ] as const) {
    const rid = nextRel(rels);
    ids.push(rid);
    rels = rels.spliceChildren(rels.root, rels.root.children.length, 0, [
      `<Relationship xmlns="${relns}" Id="${rid}" Type="${s.r}/${type}" Target="${escape(relativePartReference(part, target.part.slice(0, target.part.lastIndexOf("/"))))}"/>`
    ]);
  }
  s.save(relationsPart, rels);
  const types = s.doc("/[Content_Types].xml");
  s.save(
    "/[Content_Types].xml",
    types.spliceChildren(
      types.root,
      types.root.children.length,
      0,
      [
        [objectPart, payload.contentType],
        [iconPart, options.iconContentType]
      ].map(
        ([part, type]) =>
          `<Override xmlns="${types.root.name.namespace}" PartName="${part}" ContentType="${escape(type!)}"/>`
      )
    )
  );
  s.changes.set(objectPart, options.bytes);
  s.changes.set(iconPart, options.iconBytes);
  const left = options.left ?? 0,
    top = options.top ?? 0;
  const frame = `<p:graphicFrame xmlns:p="${s.p}" xmlns:a="${s.a}" xmlns:r="${s.r}"><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${escape(options.name ?? `Object ${id}`)}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${left}" y="${top}"/><a:ext cx="${width}" cy="${height}"/></p:xfrm><a:graphic><a:graphicData uri="${s.p.slice(0, s.p.lastIndexOf("/"))}/ole"><p:oleObj showAsIcon="1" r:id="${ids[0]}" imgW="${iconWidth}" imgH="${iconHeight}" progId="${escape(progId)}"><p:embed/><p:pic><p:nvPicPr><p:cNvPr id="${pictureId}" name="Object icon ${pictureId}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${ids[1]}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${left}" y="${top}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:oleObj></a:graphicData></a:graphic></p:graphicFrame>`;
  const extension = child(tree, "extLst");
  s.save(
    target.part,
    doc.spliceChildren(
      tree,
      extension ? tree.children.indexOf(extension) : tree.children.length,
      0,
      [frame]
    )
  );
  return (await s.finish(target.part, [options.slide])).bytes;
}
