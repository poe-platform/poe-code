import { validatePictureInput } from "./picture-input.js";
import { readShapeGeometry } from "./shape-transforms.js";
import { readBinary } from "./bytes.js";
import { relativePartReference } from "./package-uri.js";
import { parseXmlPart } from "./xml.js";
import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { loadShared, escape, nextRel, relPart } from "./masters.js";
import { SelectionError, type SelectionContext } from "./selectors.js";
import { nodeFor, selected, validateSelection, type ShapeSelection } from "./shape-operations.js";
import { readShape } from "./shapes.js";
import {
  applyDrawingUpdate,
  readDrawingFormat,
  validateDrawingUpdate,
  type DrawingUpdate
} from "./drawing-format.js";
export async function readDrawing(
  input: BinaryInput,
  options: ShapeSelection,
  context: SelectionContext
) {
  validateSelection(options, "read");
  const s = await loadShared(input, context, false);
  return selected(s, options).map((record) => {
    const root = s.doc(record.part).root;
    const node = nodeFor(root, record.id);
    return {
      ...readShape(node),
      geometry: readShapeGeometry(root, node),
      location: record.location,
      token: record.token,
      part: record.part,
      drawing: readDrawingFormat(node)
    };
  });
}
export async function mutateDrawing(
  input: BinaryInput,
  options: ShapeSelection & { readonly update: DrawingUpdate; readonly image?: BinaryInput },
  context: SelectionContext
) {
  if (!options || typeof options !== "object")
    throw new OfficeError("invalid-value", "Invalid drawing selection options.", "usage");
  const { image, ...selectionOptions } = options;
  validateSelection(selectionOptions, "set");
  if (!options.update || typeof options.update !== "object")
    throw new OfficeError("invalid-value", "Drawing update is required.", "usage");
  if (
    image !== undefined &&
    (options.update.fill?.kind !== "picture" || options.update.fill.relationshipId !== undefined)
  )
    throw new OfficeError(
      "invalid-value",
      "Image input requires a picture fill without a relationship ID.",
      "usage"
    );
  const update =
    image !== undefined && options.update.fill?.kind === "picture"
      ? { ...options.update, fill: { ...options.update.fill, relationshipId: "pending" } }
      : options.update;
  validateDrawingUpdate(update);
  if (
    !options.select &&
    options.shape === undefined &&
    options.slide === undefined &&
    !options.part &&
    !options.all
  )
    throw new SelectionError("invalid-selection");
  const s = await loadShared(input, context);
  const records = selected(s, options);
  if (!records.length && !options.allowEmpty) throw new SelectionError("missing-selection");
  if (records.length > 1 && !options.all)
    throw new SelectionError(
      "ambiguous-selection",
      records.map((x) => x.location)
    );
  let imagePart: string | undefined;
  if (image !== undefined && records.length) {
    const bytes = await readBinary(image, context);
    const png = validatePictureInput(bytes) === "png";
    const extension = png ? "png" : "jpg";
    let index = 1;
    while (
      s.reader.names.some((name) => name.toLowerCase() === `/ppt/media/image${index}.${extension}`)
    )
      index++;
    imagePart = `/ppt/media/image${index}.${extension}`;
    s.changes.set(imagePart, bytes);
    const types = s.doc("/[Content_Types].xml");
    s.save(
      "/[Content_Types].xml",
      types.spliceChildren(types.root, types.root.children.length, 0, [
        `<Override xmlns="${types.root.name.namespace}" PartName="${imagePart}" ContentType="image/${png ? "png" : "jpeg"}"/>`
      ])
    );
  }
  const relationships = new Map<string, string>();
  for (const record of records) {
    let shapeUpdate = update;
    const fill = update.fill;
    if (imagePart && fill?.kind === "picture") {
      let id = relationships.get(record.part);
      if (!id) {
        const part = relPart(record.part);
        const rels = s.reader.has(part)
          ? s.doc(part)
          : parseXmlPart(
              new TextEncoder().encode(
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
              ),
              context.xmlLimits
            );
        id = nextRel(rels);
        relationships.set(record.part, id);
        s.save(
          part,
          rels.spliceChildren(rels.root, rels.root.children.length, 0, [
            `<Relationship xmlns="${rels.root.name.namespace}" Id="${id}" Type="${s.r}/image" Target="${escape(relativePartReference(imagePart, record.part.slice(0, record.part.lastIndexOf("/"))))}"/>`
          ])
        );
      }
      shapeUpdate = { ...update, fill: { ...fill, relationshipId: id } };
    }
    if (fill?.kind === "picture" && !imagePart) {
      const relation = s.index.inventory.relationships.find(
        (e) => e.owner === record.part && e.id === fill.relationshipId
      );
      if (
        !relation ||
        relation.external ||
        !relation.targetPart ||
        relation.type !== `${s.r}/image` ||
        !s.reader.has(relation.targetPart)
      )
        throw new OfficeError(
          "invalid-value",
          "Picture fill requires an existing internal image relationship.",
          "validate-intent"
        );
    }
    const doc = s.doc(record.part);
    s.save(record.part, applyDrawingUpdate(doc, nodeFor(doc.root, record.id), shapeUpdate));
  }
  return {
    ...(await s.finish(
      records[0]?.part ?? s.main,
      s.index.inventory.slides
        .filter((x) => records.some((r) => [x.part, x.master, x.layout].includes(r.part)))
        .map((x) => x.position)
    )),
    affected: records.length,
    records
  };
}
