import type { BinaryInput } from "./contracts.js";
import { Length } from "./length.js";
import { OfficeError } from "./errors.js";
import { loadShared, required } from "./masters.js";
import { SelectionError, type SelectionContext } from "./selectors.js";
import {
  addShape,
  nodeFor,
  selected,
  validateSelection,
  type ShapeSelection
} from "./shape-operations.js";
import { validateShapeOptions, type ShapeUpdate } from "./shapes.js";
import {
  applyShapePath,
  readShapePath,
  shapePathXml,
  validateShapePath,
  type ShapePath
} from "./shape-paths.js";
export interface AddShapePathOptions extends ShapeSelection {
  readonly path: ShapePath;
  readonly update: Omit<ShapeUpdate, "kind">;
}
export interface SetShapePathOptions extends ShapeSelection {
  readonly path: ShapePath;
}
function optionsFor(options: SetShapePathOptions | AddShapePathOptions, adding = false) {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(
      (key) =>
        typeof key !== "string" || !("value" in Object.getOwnPropertyDescriptor(options, key)!)
    )
  )
    throw new OfficeError("invalid-value", "Invalid path options.", "usage");
  if (!adding && Object.hasOwn(options, "update"))
    throw new OfficeError("invalid-value", "Unexpected path edit property.", "usage");
  const { path, ...rest } = options;
  validateShapePath(path);
  validateSelection(rest, adding ? "add" : "set");
  if (adding) {
    const update = (options as AddShapePathOptions).update;
    if (
      !update ||
      typeof update !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(update)) ||
      Reflect.ownKeys(update).some(
        (key) =>
          typeof key !== "string" || !("value" in Object.getOwnPropertyDescriptor(update, key)!)
      ) ||
      Object.hasOwn(update, "kind")
    )
      throw new OfficeError(
        "invalid-value",
        "Path creation does not accept a preset kind.",
        "usage"
      );
    for (const key of ["left", "top", "width", "height", "lineWidth"] as const) {
      const value = update[key];
      if (value && typeof value === "object") {
        const allowed = value instanceof Length ? ["emu"] : ["value", "unit"];
        if (
          Reflect.ownKeys(value).some(
            (name) =>
              typeof name !== "string" ||
              !allowed.includes(name) ||
              !("value" in Object.getOwnPropertyDescriptor(value, name)!)
          ) ||
          allowed.some((name) => !Object.hasOwn(value, name))
        )
          throw new OfficeError("invalid-value", "Path lengths require data properties.", "usage");
      }
    }
    validateShapeOptions({ ...update, kind: "RECTANGLE" }, true);
  }
  return rest;
}
export async function readShapePaths(
  input: BinaryInput,
  options: ShapeSelection,
  context: SelectionContext
) {
  validateSelection(options, "read");
  const s = await loadShared(input, context, false);
  return selected(s, options)
    .filter((record) =>
      ["sp", "pic", "cxnSp"].includes(nodeFor(s.doc(record.part).root, record.id).name.localName)
    )
    .map((record) => {
      const doc = s.doc(record.part);
      return {
        ...readShapePath(doc, nodeFor(doc.root, record.id)),
        shapeId: Number(record.id),
        name: record.name,
        location: record.location,
        token: record.token,
        part: record.part
      };
    });
}
export async function setShapePath(
  input: BinaryInput,
  options: SetShapePathOptions,
  context: SelectionContext
) {
  optionsFor(options);
  const s = await loadShared(input, context);
  if (
    !options.select &&
    options.shape === undefined &&
    options.slide === undefined &&
    !options.part &&
    !options.all
  )
    throw new SelectionError("invalid-selection");
  const records = selected(s, options);
  if (!records.length && !options.allowEmpty) throw new SelectionError("missing-selection");
  if (records.length > 1 && !options.all)
    throw new SelectionError(
      "ambiguous-selection",
      records.map((x) => x.location)
    );
  for (const record of records) {
    const doc = s.doc(record.part);
    s.save(record.part, applyShapePath(doc, nodeFor(doc.root, record.id), options.path));
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
export async function addShapePath(
  input: BinaryInput,
  options: AddShapePathOptions,
  context: SelectionContext
) {
  optionsFor(options, true);
  const { path, update, ...selection } = options;
  const added = await addShape(
    input,
    { ...selection, update: { ...update, kind: "RECTANGLE" } },
    context
  );
  const record = added.records[0]!;
  const s = await loadShared(added.bytes, context);
  const doc = s.doc(record.part),
    node = nodeFor(doc.root, record.id),
    props = required(node, "spPr");
  const preset = props.children.find((x) => x.name.localName === "prstGeom")!;
  s.save(
    record.part,
    doc.spliceChildren(props, props.children.indexOf(preset), 1, [
      shapePathXml(path, preset.name.namespace)
    ])
  );
  return {
    ...(await s.finish(
      record.part,
      s.index.inventory.slides
        .filter((x) => [x.part, x.master, x.layout].includes(record.part))
        .map((x) => x.position)
    )),
    affected: 1,
    records: added.records
  };
}
