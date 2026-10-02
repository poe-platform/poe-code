import { OfficeError } from "./errors.js";
import { readBinary } from "./bytes.js";
import { readPackage } from "./package-reader.js";
import type { BinaryInput, Location } from "./contracts.js";
import { attr, invalid } from "./masters.js";
import {
  readSelectionIndex,
  SelectionError,
  type SelectionContext,
  type SelectionQuery
} from "./selectors.js";
import { parseXmlPart, type XmlAttribute, type XmlElement } from "./xml.js";

export interface AnimationTimingReference {
  readonly timingId: string;
  readonly nodeIds: readonly string[];
}
export interface AnimationNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly children: readonly string[];
  readonly namespace: string;
  readonly type: string;
  readonly kind: "sequence" | "parallel" | "effect" | "trigger" | "media" | "timing" | "opaque";
  readonly timingId: string | null;
  readonly targetShapeId: string | null;
  readonly effectType: string | null;
  readonly triggerType: string | null;
  readonly mediaInteraction: string | null;
  readonly motionPath: string | null;
  readonly attributes: readonly XmlAttribute[];
  readonly timingReferences: readonly AnimationTimingReference[];
}
export interface AnimationDiagnostic {
  readonly code:
    | "duplicate-timing-id"
    | "duplicate-shape-id"
    | "missing-target"
    | "missing-timing-reference"
    | "ambiguous-timing-reference"
    | "timing-cycle";
  readonly nodeIds: readonly string[];
  readonly reference: string;
}
export interface AnimationRecord {
  readonly selector: string;
  readonly location: Location;
  readonly slide: number;
  readonly part: string;
  readonly roots: readonly string[];
  readonly xml: readonly string[];
  readonly nodes: readonly AnimationNode[];
  readonly diagnostics: readonly AnimationDiagnostic[];
  readonly targetShapeIds: readonly string[];
  readonly executionVerified: false;
}

export async function readAnimations(
  input: BinaryInput,
  options: { readonly selection?: SelectionQuery },
  context: SelectionContext
): Promise<readonly AnimationRecord[]> {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(
      (k) =>
        k !== "selection" || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, k)!, "value")
    )
  )
    invalid("Invalid animation query.");
  if (
    options.selection !== undefined &&
    (!options.selection ||
      typeof options.selection !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options.selection)) ||
      Reflect.ownKeys(options.selection).some(
        (k) =>
          typeof k !== "string" ||
          !["kind", "scope", "owner", "position", "id", "name", "part", "token", "all"].includes(
            k
          ) ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(options.selection!, k)!, "value")
      ))
  )
    throw new SelectionError("invalid-selection");
  if (options.selection?.kind && !["slide", "object"].includes(options.selection.kind))
    throw new SelectionError("invalid-selection");
  if (options.selection?.scope && options.selection.scope !== "slides")
    throw new SelectionError("invalid-selection");
  const source = await readBinary(input, context);
  const reader = await readPackage(source, context);
  const index = await readSelectionIndex(source, context);
  const selected = options.selection
    ? index.select(
        options.selection.token
          ? options.selection
          : { ...options.selection, kind: options.selection.kind ?? "slide" }
      )
    : index.slides;
  if (selected.some((n) => !["slide", "object"].includes(n.kind) || n.scope !== "slides"))
    throw new SelectionError("invalid-selection");
  const slides = index.slides.filter((n) => selected.some((v) => v.part === n.part));
  const records: AnimationRecord[] = [];
  for (const slide of slides) {
    const doc = parseXmlPart(reader.get(slide.part), context.xmlLimits);
    const nodes: (Omit<AnimationNode, "children" | "timingReferences"> & {
      children: string[];
      timingReferences: AnimationTimingReference[];
    })[] = [];
    const roots: string[] = [];
    const xml: string[] = [];
    const diagnostics: AnimationDiagnostic[] = [];
    const timingIds = new Map<string, string[]>();
    const shapeIds = new Map<string, number>();
    const targets = new Set<string>();
    const targetNodes = new Map<string, string[]>();
    const references: { nodeId: string; owner: string | null; timingId: string }[] = [];
    const stack: {
      element: XmlElement;
      parentId: string | null;
      owner: string | null;
      active: boolean;
    }[] = [{ element: doc.root, parentId: null, owner: null, active: false }];
    while (stack.length) {
      if (context.signal?.aborted)
        throw new OfficeError("cancelled", "Operation cancelled.", "parse");
      const item = stack.pop()!,
        element = item.element;
      const local = element.name.localName,
        native = element.name.namespace === doc.root.name.namespace;
      if (native && local === "cNvPr") {
        const id = attr(element, "id");
        if (id !== undefined) shapeIds.set(id, (shapeIds.get(id) ?? 0) + 1);
      }
      const active = item.active || (native && local === "timing");
      let parentId = item.parentId,
        owner = item.owner;
      if (active) {
        const id = `${slide.token}/timing/${nodes.length + 1}`;
        const timingId = native && local === "cTn" ? (attr(element, "id") ?? null) : null;
        if (timingId !== null) {
          const ids = timingIds.get(timingId) ?? [];
          ids.push(id);
          timingIds.set(timingId, ids);
          owner = id;
        }
        const targetShapeId = native && local === "spTgt" ? (attr(element, "spid") ?? null) : null;
        if (targetShapeId !== null) {
          targets.add(targetShapeId);
          const ids = targetNodes.get(targetShapeId) ?? [];
          ids.push(id);
          targetNodes.set(targetShapeId, ids);
        }
        const effect =
          native &&
          [
            "anim",
            "animClr",
            "animEffect",
            "animMotion",
            "animRot",
            "animScale",
            "set",
            "cmd"
          ].includes(local);
        const media = native && ["audio", "video", "cMediaNode", "sndTgt", "cmd"].includes(local);
        const node = {
          id,
          parentId,
          children: [] as string[],
          namespace: element.name.namespace,
          type: local,
          kind: (native && local === "seq"
            ? "sequence"
            : native && local === "par"
              ? "parallel"
              : effect
                ? "effect"
                : native && local === "cond"
                  ? "trigger"
                  : media
                    ? "media"
                    : native && local === "cTn"
                      ? "timing"
                      : "opaque") as AnimationNode["kind"],
          timingId,
          targetShapeId,
          effectType: effect
            ? local
            : native && local === "cTn"
              ? (attr(element, "presetClass") ?? null)
              : null,
          triggerType:
            native && local === "cond"
              ? (attr(element, "evt") ?? null)
              : native && local === "cTn"
                ? (attr(element, "nodeType") ?? null)
                : null,
          mediaInteraction: media
            ? local === "cmd"
              ? (attr(element, "cmd") ?? "cmd")
              : local
            : null,
          motionPath: native && local === "animMotion" ? (attr(element, "path") ?? null) : null,
          attributes: element.attributes,
          timingReferences: [] as AnimationTimingReference[]
        };
        if (parentId === null) {
          roots.push(id);
          xml.push(doc.markup(element, true));
        } else nodes[Number(parentId.slice(parentId.lastIndexOf("/") + 1)) - 1]!.children.push(id);
        nodes.push(node);
        if (native && local === "tn" && attr(element, "val") !== undefined)
          references.push({ nodeId: id, owner, timingId: attr(element, "val")! });
        parentId = id;
      }
      for (let i = element.children.length - 1; i >= 0; i--)
        stack.push({ element: element.children[i]!, parentId, owner, active });
    }
    for (const [id, ids] of timingIds)
      if (ids.length > 1)
        diagnostics.push({ code: "duplicate-timing-id", nodeIds: ids, reference: id });
    for (const [id, count] of shapeIds)
      if (count > 1)
        diagnostics.push({
          code: "duplicate-shape-id",
          nodeIds: targetNodes.get(id) ?? [],
          reference: id
        });
    for (const node of nodes)
      if (node.targetShapeId !== null && !shapeIds.has(node.targetShapeId))
        diagnostics.push({
          code: "missing-target",
          nodeIds: [node.id],
          reference: node.targetShapeId
        });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = new Map<string, string[]>();
    let resolvedDestinations = 0;
    for (const reference of references) {
      const ids = timingIds.get(reference.timingId) ?? [];
      resolvedDestinations += ids.length;
      if (resolvedDestinations > context.xmlLimits.maxNodes)
        throw new OfficeError(
          "resource-limit",
          "Animation reference expansion exceeds the XML node budget.",
          "parse"
        );
      byId
        .get(reference.nodeId)!
        .timingReferences.push({ timingId: reference.timingId, nodeIds: ids });
      if (ids.length !== 1)
        diagnostics.push({
          code: ids.length ? "ambiguous-timing-reference" : "missing-timing-reference",
          nodeIds: [reference.nodeId, ...ids],
          reference: reference.timingId
        });
      else if (reference.owner) {
        const list = edges.get(reference.owner) ?? [];
        list.push(ids[0]!);
        edges.set(reference.owner, list);
      }
    }
    const state = new Map<string, number>();
    for (const start of edges.keys()) {
      if (state.has(start)) continue;
      const pending: { id: string; cursor: number }[] = [{ id: start, cursor: 0 }];
      state.set(start, 1);
      while (pending.length) {
        if (context.signal?.aborted)
          throw new OfficeError("cancelled", "Operation cancelled.", "parse");
        const frame = pending[pending.length - 1]!,
          next = (edges.get(frame.id) ?? [])[frame.cursor++];
        if (next === undefined) {
          state.set(frame.id, 2);
          pending.pop();
          continue;
        }
        if (state.get(next) === 1)
          diagnostics.push({
            code: "timing-cycle",
            nodeIds: [frame.id, next],
            reference: byId.get(next)!.timingId!
          });
        else if (!state.has(next)) {
          state.set(next, 1);
          pending.push({ id: next, cursor: 0 });
        }
      }
    }
    if (
      selected.some((n) => n.kind === "slide" && n.part === slide.part) ||
      selected.some((n) => n.part === slide.part && targets.has(n.id))
    )
      records.push({
        selector: slide.token,
        location: slide.location,
        slide: slide.position,
        part: slide.part,
        roots,
        xml,
        nodes,
        diagnostics,
        targetShapeIds: [...targets],
        executionVerified: false
      });
  }
  return records;
}
