import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { readImages, type ReadImagesOptions, type ImageOccurrence } from "./images.js";
import { attr, child, escape, invalid, loadShared, required } from "./masters.js";
import { nodeFor } from "./shape-operations.js";
import { applyShapeUpdate, validateShapeOptions } from "./shapes.js";
import { SelectionError, type SelectionContext } from "./selectors.js";
import type { XmlElement, XmlPart } from "./xml.js";

export interface SetImageOptions {
  readonly cropLeft?: number;
  readonly cropRight?: number;
  readonly cropTop?: number;
  readonly cropBottom?: number;
  readonly rotation?: number;
  readonly flipHorizontal?: boolean;
  readonly flipVertical?: boolean;
  readonly opacity?: number;
  readonly borderColor?: string;
  readonly borderWidth?: number;
  readonly altText?: string;
  readonly all?: boolean;
  readonly allowEmpty?: boolean;
}
export interface SetImageResult {
  readonly bytes: Uint8Array;
  readonly affected: number;
  readonly occurrences: readonly ImageOccurrence[];
  readonly affectedSlides: readonly number[];
}
const sides = [
  ["cropLeft", "l"],
  ["cropTop", "t"],
  ["cropRight", "r"],
  ["cropBottom", "b"]
] as const;
function fields(value: unknown, allowed: readonly string[]) {
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
    invalid("Invalid picture options.");
}
function quantize(value: number, scale: number) {
  return Math.sign(value) * Math.round(Math.abs(value) * scale);
}
function validate(options: SetImageOptions) {
  fields(options, [
    ...sides.map((x) => x[0]),
    "rotation",
    "flipHorizontal",
    "flipVertical",
    "opacity",
    "borderColor",
    "borderWidth",
    "altText",
    "all",
    "allowEmpty"
  ]);
  for (const [key] of sides) {
    const value = options[key];
    if (
      value !== undefined &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < -21474.83648 ||
        value > 21474.83647)
    )
      invalid("Crop requires a bounded signed fraction.");
  }
  for (const key of ["all", "allowEmpty", "flipHorizontal", "flipVertical"] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean")
      invalid("Picture switches require booleans.");
  if (
    options.opacity !== undefined &&
    (typeof options.opacity !== "number" ||
      !Number.isFinite(options.opacity) ||
      options.opacity < 0 ||
      options.opacity > 1)
  )
    invalid("Opacity requires a fraction from zero to one.");
  if (
    options.borderWidth !== undefined &&
    (!Number.isSafeInteger(options.borderWidth) ||
      options.borderWidth < 0 ||
      options.borderWidth > 20116800)
  )
    invalid("Picture outline width requires bounded integer EMUs.");
  if (options.altText !== undefined && typeof options.altText !== "string")
    invalid("Picture alternative text requires text.");
  if (options.borderColor !== undefined && typeof options.borderColor !== "string")
    invalid("Picture outline color requires a hex string.");
  validateShapeOptions({
    ...(options.rotation === undefined ? {} : { rotation: options.rotation }),
    ...(options.borderColor === undefined ? {} : { lineColor: options.borderColor })
  });
  if (!Object.keys(options).some((key) => key !== "all" && key !== "allowEmpty"))
    invalid("Provide a picture property to set.");
}

export function applyPictureUpdate(
  document: XmlPart,
  node: XmlElement,
  options: SetImageOptions
): XmlPart {
  validate(options);
  const p = node.name.namespace;
  const a =
    p === "http://purl.oclc.org/ooxml/presentationml/main"
      ? "http://purl.oclc.org/ooxml/drawingml/main"
      : "http://schemas.openxmlformats.org/drawingml/2006/main";
  if (node.name.localName !== "pic")
    throw new OfficeError(
      "unsupported-edit",
      "Picture formatting requires a picture shape.",
      "validate-intent"
    );
  const id = attr(required(required(node, "nvPicPr"), "cNvPr"), "id")!;
  const current = () => nodeFor(document.root, id);
  if (sides.some(([key]) => options[key] !== undefined)) {
    const fill = required(current(), "blipFill"),
      crop = child(fill, "srcRect", a);
    const values = sides.map(([key, attribute]) => {
      if (options[key] !== undefined) return quantize(options[key]!, 100000);
      const raw = crop && attr(crop, attribute);
      if (raw === undefined) return 0;
      const value = raw.trim();
      const result = value.endsWith("%") ? Number(value.slice(0, -1)) * 1000 : Number(value);
      if (!Number.isFinite(result) || result < -2147483648 || result > 2147483647)
        invalid("Stored crop is outside the editable range.");
      return result;
    });
    if (values[0]! + values[2]! >= 100000 || values[1]! + values[3]! >= 100000)
      invalid("Crop must leave positive visible width and height after rounding.");
    if (crop)
      document = document.merge(crop, {
        attributes: sides.flatMap(([key, attribute]) =>
          options[key] === undefined
            ? []
            : [
                {
                  namespace: "",
                  localName: attribute,
                  value: String(quantize(options[key]!, 100000))
                }
              ]
        )
      });
    else
      document = document.spliceChildren(
        fill,
        child(fill, "blip", a) ? fill.children.indexOf(child(fill, "blip", a)!) + 1 : 0,
        0,
        [
          `<a:srcRect xmlns:a="${a}" ${sides
            .filter(([key]) => options[key] !== undefined)
            .map(([key, attribute]) => `${attribute}="${quantize(options[key]!, 100000)}"`)
            .join(" ")}/>`
        ]
      );
  }
  const transform = {
    ...(options.rotation === undefined ? {} : { rotation: options.rotation }),
    ...(options.flipHorizontal === undefined ? {} : { flipHorizontal: options.flipHorizontal }),
    ...(options.flipVertical === undefined ? {} : { flipVertical: options.flipVertical })
  };
  if (Object.keys(transform).length) document = applyShapeUpdate(document, current(), transform);
  if (options.opacity !== undefined) {
    const blip = child(required(current(), "blipFill"), "blip", a);
    if (!blip)
      throw new OfficeError("unsupported-edit", "Picture has no image binding.", "validate-intent");
    const alpha = child(blip, "alphaModFix", a);
    if (alpha)
      document = document.merge(alpha, {
        attributes: [
          { namespace: "", localName: "amt", value: String(quantize(options.opacity, 100000)) }
        ]
      });
    else {
      const extension = child(blip, "extLst", a);
      document = document.spliceChildren(
        blip,
        extension ? blip.children.indexOf(extension) : blip.children.length,
        0,
        [`<a:alphaModFix xmlns:a="${a}" amt="${quantize(options.opacity, 100000)}"/>`]
      );
    }
  }
  if (options.borderColor !== undefined || options.borderWidth !== undefined) {
    let properties = required(current(), "spPr"),
      line = child(properties, "ln", a);
    if (!line) {
      const following = properties.children.findIndex(
        (x) =>
          x.name.namespace === a &&
          ["effectLst", "effectDag", "scene3d", "sp3d", "extLst"].includes(x.name.localName)
      );
      document = document.spliceChildren(
        properties,
        following < 0 ? properties.children.length : following,
        0,
        [`<a:ln xmlns:a="${a}"/>`]
      );
    }
    properties = required(current(), "spPr");
    line = child(properties, "ln", a)!;
    if (options.borderWidth !== undefined)
      document = document.merge(line, {
        attributes: [{ namespace: "", localName: "w", value: String(options.borderWidth) }]
      });
    if (options.borderColor !== undefined) {
      line = child(required(current(), "spPr"), "ln", a)!;
      const fills = line.children.filter(
        (x) =>
          x.name.namespace === a &&
          ["noFill", "solidFill", "gradFill", "pattFill"].includes(x.name.localName)
      );
      if (fills.length > 1)
        throw new OfficeError(
          "unsupported-edit",
          "Ambiguous picture outline fill.",
          "validate-intent"
        );
      const old = fills[0];
      document = document.spliceChildren(line, old ? line.children.indexOf(old) : 0, old ? 1 : 0, [
        `<a:solidFill xmlns:a="${a}"><a:srgbClr val="${escape(options.borderColor.toUpperCase())}"/></a:solidFill>`
      ]);
    }
  }
  if (options.altText !== undefined)
    document = document.merge(required(required(current(), "nvPicPr"), "cNvPr"), {
      attributes: [{ namespace: "", localName: "descr", value: options.altText }]
    });
  return document;
}

export async function setImage(
  input: BinaryInput,
  selector: Omit<ReadImagesOptions, "unique">,
  options: SetImageOptions,
  context: SelectionContext
): Promise<SetImageResult> {
  context.signal?.throwIfAborted();
  validate(options);
  fields(selector, ["scope", "slide", "image", "select"]);
  if (
    selector.scope === "shared" ||
    (!options.all && selector.image === undefined && selector.select === undefined) ||
    (selector.select !== undefined && options.all !== undefined) ||
    (selector.image !== undefined &&
      selector.slide === undefined &&
      (selector.scope === undefined || selector.scope === "slides"))
  )
    throw new SelectionError("invalid-selection");
  options = { ...options };
  selector = { ...selector };
  const s = await loadShared(input, context);
  const occurrences = (await readImages(s.source, selector, context)).occurrences;
  if (!occurrences.length && !options.allowEmpty) throw new SelectionError("missing-selection");
  if (occurrences.length > 1 && !options.all)
    throw new SelectionError(
      "ambiguous-selection",
      occurrences.map((x) => x.location)
    );
  if (occurrences.some((x) => x.kind !== "picture" || x.role !== "primary" || !x.shapeId))
    throw new OfficeError(
      "unsupported-edit",
      "Select primary picture occurrences for formatting.",
      "validate-intent"
    );
  for (const occurrence of occurrences) {
    context.signal?.throwIfAborted();
    const doc = s.doc(occurrence.sourcePart);
    s.save(
      occurrence.sourcePart,
      applyPictureUpdate(doc, nodeFor(doc.root, occurrence.shapeId!), options)
    );
  }
  const affectedSlides = s.index.inventory.slides
    .filter((slide) =>
      occurrences.some((x) => x.sourcePart === slide.part || x.inheritedBy.includes(slide.position))
    )
    .map((x) => x.position);
  const bytes = occurrences.length
    ? (await s.finish(occurrences[0]!.sourcePart, affectedSlides)).bytes
    : s.source;
  const ids = new Set(occurrences.map((x) => x.id));
  return {
    bytes,
    affected: occurrences.length,
    affectedSlides,
    occurrences: (await readImages(bytes, { scope: "shared" }, context)).occurrences.filter((x) =>
      ids.has(x.id)
    )
  };
}
