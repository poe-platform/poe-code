import { sha1 } from "@noble/hashes/legacy.js";
import { readBinary } from "./bytes.js";
import type { BinaryInput, Location, Scope } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { attr, child } from "./masters.js";
import { readPackage } from "./package-reader.js";
import { readSelectionIndex, SelectionError, type SelectionContext } from "./selectors.js";
import { readShapeGeometry, type ShapeGeometry } from "./shape-transforms.js";
import { parseXmlPart, type XmlElement } from "./xml.js";
import { imageMetadata } from "./image-metadata.js";

export interface ReadImagesOptions {
  readonly scope?: Scope;
  readonly slide?: number;
  readonly image?: number;
  readonly select?: string;
  readonly unique?: boolean;
}
export interface ImageOccurrence {
  readonly id: string;
  readonly location: Location;
  readonly sourcePart: string;
  readonly relationshipId: string;
  readonly target: string;
  readonly external: boolean;
  readonly mediaPart: string | null;
  readonly shapeId: string | null;
  readonly shapeName: string | null;
  readonly scope: Scope;
  readonly inheritedBy: readonly number[];
  readonly kind: "picture" | "fill" | "background";
  readonly role: "primary" | "svg" | "fallback";
  readonly position: number;
  readonly crop: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
  readonly altText: string | null;
  readonly title: string | null;
  readonly geometry: ShapeGeometry | null;
  readonly sha256: string | null;
  readonly contentType: string | null;
  readonly bytes: number | null;
}
export interface ImageMedia {
  readonly sha1: string;
  readonly contentTypes: readonly (string | null)[];
  readonly parts: readonly string[];
  readonly sha256: string;
  readonly contentType: string | null;
  readonly bytes: number;
  readonly occurrenceIds: readonly string[];
  readonly pixelWidth: number | null;
  readonly pixelHeight: number | null;
  readonly dpiX: number;
  readonly dpiY: number;
}
export interface ImageInventory {
  readonly occurrences: readonly ImageOccurrence[];
  readonly media: readonly ImageMedia[];
}
const p = [
  "http://schemas.openxmlformats.org/presentationml/2006/main",
  "http://purl.oclc.org/ooxml/presentationml/main"
];
const a = [
  "http://schemas.openxmlformats.org/drawingml/2006/main",
  "http://purl.oclc.org/ooxml/drawingml/main"
];
const r = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships"
];
const svg = "http://schemas.microsoft.com/office/drawing/2016/SVG/main";
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const scopes: readonly Scope[] = [
  "slides",
  "layouts",
  "masters",
  "notes",
  "notes-master",
  "handout-master",
  "shared"
];
function descendants(node: XmlElement): XmlElement[] {
  return node.children.flatMap((x) => [x, ...descendants(x)]);
}
export async function readImages(
  input: BinaryInput,
  options: ReadImagesOptions,
  context: SelectionContext
): Promise<ImageInventory> {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Object.keys(options).some(
      (x) => !["scope", "slide", "image", "select", "unique"].includes(x)
    ) ||
    (options.scope !== undefined && !scopes.includes(options.scope)) ||
    (options.unique !== undefined && typeof options.unique !== "boolean") ||
    (options.select !== undefined && (typeof options.select !== "string" || !options.select.length))
  )
    throw new OfficeError("invalid-value", "Invalid image selection options.", "usage");
  for (const key of ["slide", "image"] as const)
    if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key]! < 1))
      throw new OfficeError(
        "invalid-value",
        "Image positions require positive safe integers.",
        "usage"
      );
  if (
    options.select &&
    (options.scope !== undefined || options.slide !== undefined || options.image !== undefined)
  )
    throw new SelectionError("invalid-selection");
  const source = await readBinary(input, context);
  const reader = await readPackage(source, context);
  const index = await readSelectionIndex(source, context);
  const selected = options.select ? index.select({ token: options.select }) : undefined;
  if (
    selected &&
    options.scope !== undefined &&
    options.scope !== "shared" &&
    selected.some((x) => x.scope !== options.scope)
  )
    throw new SelectionError("invalid-selection");
  const relationships = index.inventory.relationships;
  const related = (owner: string, type: string) =>
    relationships
      .filter((x) => x.owner === owner && r.some((ns) => x.type === `${ns}/${type}`) && !x.external)
      .map((x) => x.targetPart);
  const owners = index.parts.filter(
    (owner) =>
      owner.scope !== "shared" &&
      scopes.includes(owner.scope) &&
      (selected
        ? selected.some((x) => x.part === owner.part)
        : options.scope === "shared" || owner.scope === (options.scope ?? "slides"))
  );
  owners.sort((left, right) => {
    const leftSlide = index.slides.findIndex((x) => x.part === left.part);
    const rightSlide = index.slides.findIndex((x) => x.part === right.part);
    if (leftSlide >= 0 || rightSlide >= 0)
      return (
        (leftSlide < 0 ? Number.MAX_SAFE_INTEGER : leftSlide) -
        (rightSlide < 0 ? Number.MAX_SAFE_INTEGER : rightSlide)
      );
    return left.part < right.part ? -1 : left.part > right.part ? 1 : 0;
  });
  const occurrences: ImageOccurrence[] = [];
  for (const owner of owners) {
    context.signal?.throwIfAborted();
    const slidePositions = index.inventory.slides
      .filter(
        (slide) =>
          slide.part === owner.part ||
          slide.layout === owner.part ||
          slide.master === owner.part ||
          related(slide.part, "notesSlide").some(
            (notes) =>
              notes === owner.part || (notes && related(notes, "notesMaster").includes(owner.part))
          )
      )
      .map((x) => x.position);
    if (options.slide !== undefined && !slidePositions.includes(options.slide)) continue;
    const root = parseXmlPart(reader.get(owner.part), context.xmlLimits).root;
    let picturePosition = 0;
    let otherPosition = 0;
    let referencePosition = 0;
    const positions = new Map<XmlElement | string, number>();
    const visit = (
      node: XmlElement,
      shape: XmlElement | null,
      fill: XmlElement | null,
      background: boolean,
      fallback: boolean
    ): void => {
      if (
        p.includes(node.name.namespace) &&
        ["pic", "sp", "cxnSp", "graphicFrame", "grpSp"].includes(node.name.localName)
      )
        shape = node;
      if (p.includes(node.name.namespace) && node.name.localName === "bg") {
        background = true;
        shape = null;
      }
      if (
        (a.includes(node.name.namespace) || p.includes(node.name.namespace)) &&
        node.name.localName === "blipFill"
      )
        fill = node;
      if (node.name.namespace === mc && node.name.localName === "Fallback") fallback = true;
      const isSvg = node.name.namespace === svg && node.name.localName === "svgBlip";
      if (isSvg || (a.includes(node.name.namespace) && node.name.localName === "blip")) {
        const nv = shape?.children.find(
          (x) =>
            p.includes(x.name.namespace) &&
            ["nvPicPr", "nvSpPr", "nvCxnSpPr", "nvGraphicFramePr", "nvGrpSpPr"].includes(
              x.name.localName
            )
        );
        const identity = nv && child(nv, "cNvPr");
        const shapeId = identity ? (attr(identity, "id") ?? null) : null;
        const bindings = node.attributes.filter(
          (x) => r.includes(x.name.namespace) && ["embed", "link"].includes(x.name.localName)
        );
        const cropNode = fill?.children.find(
          (x) => a.includes(x.name.namespace) && x.name.localName === "srcRect"
        );
        const fraction = (key: string) => {
          const raw = cropNode && attr(cropNode, key);
          if (raw === undefined) return 0;
          const trimmed = raw.trim();
          const percent = trimmed.endsWith("%");
          const value = percent ? trimmed.slice(0, -1) : trimmed;
          const unsigned = value.startsWith("-") || value.startsWith("+") ? value.slice(1) : value;
          const components = unsigned.split(".");
          if (
            components.length > (percent ? 2 : 1) ||
            components.some(
              (component) => !component || [...component].some((c) => !"0123456789".includes(c))
            ) ||
            !Number.isFinite(Number(value)) ||
            (percent
              ? Math.abs(Number(value)) > Number.MAX_SAFE_INTEGER
              : !Number.isSafeInteger(Number(value)))
          )
            throw new OfficeError("invalid-xml", "Invalid image crop metadata.", "index");
          return Number(value) / (percent ? 100 : 100000);
        };
        const positionOwner =
          shape?.name.localName === "pic" && shapeId !== null ? shapeId : (shape ?? fill ?? node);
        let currentPosition = positions.get(positionOwner);
        if (currentPosition === undefined) {
          currentPosition = shape?.name.localName === "pic" ? ++picturePosition : ++otherPosition;
          positions.set(positionOwner, currentPosition);
        }
        for (const binding of bindings) {
          const referenceId = ++referencePosition;
          const edge = relationships.find((x) => x.owner === owner.part && x.id === binding.value);
          if (!edge || !r.some((ns) => edge.type === `${ns}/image`))
            throw new OfficeError(
              "missing-binding",
              "Image relationship is absent or has the wrong type.",
              "index"
            );
          const media =
            edge.targetPart === null
              ? undefined
              : index.inventory.parts.find((x) => x.part === edge.targetPart);
          if (!edge.external && !media)
            throw new OfficeError("missing-binding", "Image media part is absent.", "index");
          if (
            (options.image !== undefined &&
              (shape?.name.localName !== "pic" || options.image !== currentPosition)) ||
            (selected &&
              !selected.some(
                (x) => x.part === owner.part && (x.kind !== "object" || x.id === shapeId)
              ))
          )
            continue;
          const hasSvg = descendants(node).some(
            (x) => x.name.namespace === svg && x.name.localName === "svgBlip"
          );
          occurrences.push({
            id: `${owner.part}#image-${referenceId}-${binding.name.localName}`,
            location:
              index.objects.find((x) => x.part === owner.part && x.id === shapeId)?.location ??
              owner.location,
            sourcePart: owner.part,
            relationshipId: edge.id,
            target: edge.target,
            external: edge.external,
            mediaPart: edge.targetPart,
            shapeId,
            shapeName: identity ? (attr(identity, "name") ?? null) : null,
            scope: owner.scope,
            inheritedBy: ["layouts", "masters", "notes-master"].includes(owner.scope)
              ? slidePositions
              : [],
            kind: background ? "background" : shape?.name.localName === "pic" ? "picture" : "fill",
            role: isSvg ? "svg" : fallback || hasSvg ? "fallback" : "primary",
            position: currentPosition,
            crop: {
              left: fraction("l"),
              top: fraction("t"),
              right: fraction("r"),
              bottom: fraction("b")
            },
            altText: identity ? (attr(identity, "descr") ?? null) : null,
            title: identity ? (attr(identity, "title") ?? null) : null,
            geometry: shape ? readShapeGeometry(root, shape) : null,
            sha256: media?.sha256 ?? null,
            contentType: media?.contentType ?? null,
            bytes: media?.bytes ?? null
          });
        }
      }
      for (const next of node.children) visit(next, shape, fill, background, fallback);
    };
    visit(root, null, null, false, false);
  }
  const media: ImageMedia[] = [];
  for (const part of [
    ...new Set(occurrences.flatMap((x) => (x.mediaPart ? [x.mediaPart] : [])))
  ].sort()) {
    const metadata = index.inventory.parts.find((x) => x.part === part)!;
    const ids = occurrences.filter((x) => x.mediaPart === part).map((x) => x.id);
    const existing = options.unique ? media.find((x) => x.sha256 === metadata.sha256) : undefined;
    if (existing) {
      const contentTypes = [...new Set([...existing.contentTypes, metadata.contentType])];
      const offset = media.indexOf(existing);
      media[offset] = {
        ...existing,
        ...(contentTypes.length > 1
          ? { pixelWidth: null, pixelHeight: null, dpiX: 72, dpiY: 72 }
          : {}),
        contentTypes,
        contentType: contentTypes.length === 1 ? contentTypes[0]! : null,
        parts: [...existing.parts, part],
        occurrenceIds: [...existing.occurrenceIds, ...ids]
      };
    } else
      media.push({
        parts: [part],
        sha1: Array.from(sha1(reader.get(part)), (byte) => byte.toString(16).padStart(2, "0")).join(
          ""
        ),
        contentTypes: [metadata.contentType],
        sha256: metadata.sha256,
        contentType: metadata.contentType,
        bytes: metadata.bytes,
        occurrenceIds: ids,
        ...imageMetadata(reader.get(part), metadata.contentType ?? "")
      });
  }
  return { occurrences, media };
}
