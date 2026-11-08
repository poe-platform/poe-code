import { ShapeIdAllocator } from "./shape-id.js";
import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { child, loadShared, required } from "./masters.js";
import { nodeFor, selected, validateSelection, type ShapeSelection } from "./shape-operations.js";
import { SelectionError, type SelectionContext, type SelectionRecord } from "./selectors.js";
import {
  applyConnectorUpdate,
  createConnectorXml,
  readConnector,
  removeDrawingObjects,
  validateConnectorUpdate,
  type ConnectorUpdate
} from "./connectors.js";
import type { XmlElement } from "./xml.js";
function optionsFor(options: ShapeSelection, action: "read" | "add" | "set") {
  if (
    !options ||
    typeof options !== "object" ||
    Reflect.ownKeys(options).some(
      (k) => typeof k !== "string" || !("value" in Object.getOwnPropertyDescriptor(options, k)!)
    )
  )
    throw new SelectionError("invalid-selection");
  validateSelection(options, action);
  if (options.scope !== undefined && options.scope !== "slides")
    throw new SelectionError("invalid-selection");
}
export function validateConnectorOptions(update: ConnectorUpdate, adding = false) {
  validateConnectorUpdate(update, adding);
  if (!adding && !Object.keys(update).some((k) => update[k as keyof ConnectorUpdate] !== undefined))
    throw new OfficeError("invalid-value", "A connector edit is required.", "usage");
  let attached = false;
  for (const key of ["beginTarget", "endTarget"] as const) {
    const loc = update[key];
    if (loc === undefined || loc === null) continue;
    attached = true;
    if (
      typeof loc !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(loc)) ||
      Reflect.ownKeys(loc).some(
        (k) =>
          typeof k !== "string" ||
          !["fingerprint", "scope", "owner", "objectId", "coordinateSystem"].includes(k) ||
          !("value" in Object.getOwnPropertyDescriptor(loc, k)!)
      ) ||
      loc.scope !== "slides" ||
      loc.coordinateSystem !== "identity" ||
      [loc.fingerprint, loc.owner, loc.objectId].some((v) => typeof v !== "string" || !v.length)
    )
      throw new SelectionError("invalid-selection");
  }
  if (attached !== (update.site !== undefined))
    throw new OfficeError(
      "invalid-value",
      "An explicit site is required with an attached target.",
      "usage"
    );
  if (
    update.detachPolicy === "remove" &&
    Object.keys(update).some(
      (k) => k !== "detachPolicy" && update[k as keyof ConnectorUpdate] !== undefined
    )
  )
    throw new OfficeError(
      "invalid-value",
      "Remove policy cannot be combined with connector edits.",
      "usage"
    );
}
function targetsFor(
  s: Awaited<ReturnType<typeof loadShared>>,
  part: string,
  update: ConnectorUpdate,
  root: XmlElement
) {
  const targets: { begin?: XmlElement; end?: XmlElement } = {};
  for (const end of ["begin", "end"] as const) {
    const location = update[`${end}Target`];
    if (!location) continue;
    if (location.fingerprint !== s.index.fingerprint) throw new SelectionError("stale-selection");
    const matches = s.index.objects.filter(
      (r) =>
        r.part === part &&
        r.location.scope === location.scope &&
        r.location.owner === location.owner &&
        r.location.objectId === location.objectId
    );
    if (matches.length !== 1)
      throw new SelectionError(matches.length ? "ambiguous-selection" : "missing-selection");
    targets[end] = nodeFor(root, matches[0]!.id);
  }
  return targets;
}
export async function readConnectors(
  input: BinaryInput,
  options: ShapeSelection,
  context: SelectionContext
) {
  optionsFor(options, "read");
  const s = await loadShared(input, context, false);
  return selected(s, options)
    .filter((r) => nodeFor(s.doc(r.part).root, r.id).name.localName === "cxnSp")
    .map((r) => ({
      ...readConnector(nodeFor(s.doc(r.part).root, r.id)),
      location: r.location,
      token: r.token,
      part: r.part
    }));
}
export async function addConnector(
  input: BinaryInput,
  options: ShapeSelection & { readonly update: ConnectorUpdate },
  context: SelectionContext
) {
  optionsFor(options, "add");
  validateConnectorOptions(options.update, true);
  if (options.shape !== undefined) throw new SelectionError("invalid-selection");
  const s = await loadShared(input, context),
    records = selected(s, options, true);
  if (records.length !== 1)
    throw new SelectionError(records.length ? "ambiguous-selection" : "missing-selection");
  const record = records[0]!,
    doc = s.doc(record.part),
    tree = required(required(doc.root, "cSld"), "spTree");
  const id = new ShapeIdAllocator(() => doc).next();
  const extension = child(tree, "extLst");
  let next = doc.spliceChildren(
    tree,
    extension ? tree.children.indexOf(extension) : tree.children.length,
    0,
    [
      createConnectorXml(
        id,
        Object.fromEntries(
          Object.entries(options.update).filter(
            ([key]) => !["beginTarget", "endTarget", "site"].includes(key)
          )
        ) as ConnectorUpdate,
        doc.root.name.namespace
      )
    ]
  );
  s.save(record.part, next);
  const targets = targetsFor(s, record.part, options.update, next.root);
  next = applyConnectorUpdate(next, nodeFor(next.root, String(id)), options.update, targets);
  s.save(record.part, next);
  return {
    ...(await s.finish(
      record.part,
      s.index.inventory.slides.filter((x) => x.part === record.part).map((x) => x.position)
    )),
    affected: 1,
    records: [{ ...record, id: String(id) }]
  };
}
export async function mutateConnectors(
  input: BinaryInput,
  options: ShapeSelection & { readonly update: ConnectorUpdate },
  context: SelectionContext
) {
  optionsFor(options, "set");
  validateConnectorOptions(options.update);
  if (options.update.detachPolicy === "remove")
    return removeConnectors(
      input,
      Object.fromEntries(Object.entries(options).filter(([k]) => k !== "update")),
      context
    );
  const s = await loadShared(input, context),
    records = selected(s, options).filter(
      (r) => nodeFor(s.doc(r.part).root, r.id).name.localName === "cxnSp"
    );
  checkCount(records, options);
  for (const r of records) {
    const doc = s.doc(r.part);
    s.save(
      r.part,
      applyConnectorUpdate(
        doc,
        nodeFor(doc.root, r.id),
        options.update,
        targetsFor(s, r.part, options.update, doc.root)
      )
    );
  }
  return {
    ...(await s.finish(
      records[0]?.part ?? s.main,
      s.index.inventory.slides
        .filter((x) => records.some((r) => r.part === x.part))
        .map((x) => x.position)
    )),
    affected: records.length,
    records
  };
}
function checkCount(records: readonly SelectionRecord[], options: ShapeSelection) {
  if (
    !options.select &&
    options.shape === undefined &&
    options.slide === undefined &&
    !options.part &&
    !options.all
  )
    throw new SelectionError("invalid-selection");
  if (!records.length && !options.allowEmpty) throw new SelectionError("missing-selection");
  if (records.length > 1 && !options.all)
    throw new SelectionError(
      "ambiguous-selection",
      records.map((r) => r.location)
    );
}
export async function removeConnectors(
  input: BinaryInput,
  options: ShapeSelection,
  context: SelectionContext
) {
  optionsFor(options, "set");
  if (Object.hasOwn(options, "update"))
    throw new OfficeError("invalid-value", "Deletion does not accept updates.", "usage");
  return removeObjects(input, options, context, true);
}
export async function removeShapes(
  input: BinaryInput,
  options: ShapeSelection & { readonly detachPolicy?: "detach" | "remove" },
  context: SelectionContext
) {
  if (
    !options ||
    typeof options !== "object" ||
    Reflect.ownKeys(options).some(
      (k) => typeof k !== "string" || !("value" in Object.getOwnPropertyDescriptor(options, k)!)
    )
  )
    throw new SelectionError("invalid-selection");
  const { detachPolicy, ...selection } = options;
  optionsFor(selection, "set");
  if (Object.hasOwn(selection, "update"))
    throw new OfficeError("invalid-value", "Deletion does not accept updates.", "usage");
  if (detachPolicy !== undefined && !["detach", "remove"].includes(detachPolicy))
    throw new OfficeError("invalid-value", "Invalid detach policy.", "usage");
  return removeObjects(input, options, context, false);
}
async function removeObjects(
  input: BinaryInput,
  options: ShapeSelection & { readonly detachPolicy?: "detach" | "remove" },
  context: SelectionContext,
  connectorsOnly: boolean
) {
  const { detachPolicy, ...selection } = options;
  optionsFor(selection, "set");
  const s = await loadShared(input, context),
    records = selected(s, selection).filter(
      (r) => !connectorsOnly || nodeFor(s.doc(r.part).root, r.id).name.localName === "cxnSp"
    );
  checkCount(records, selection);
  for (const part of new Set(records.map((r) => r.part)))
    s.save(
      part,
      removeDrawingObjects(
        s.doc(part),
        records.filter((r) => r.part === part).map((r) => r.id),
        detachPolicy
      )
    );
  return {
    ...(await s.finish(
      records[0]?.part ?? s.main,
      s.index.inventory.slides
        .filter((x) => records.some((r) => r.part === x.part))
        .map((x) => x.position)
    )),
    affected: records.length,
    records
  };
}
