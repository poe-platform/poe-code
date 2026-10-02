import { SaxesParser } from "saxes";
import type { BinaryInput, Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { attr, child, invalid, loadShared, type SharedEditResult } from "./masters.js";
import {
  SelectionError,
  type SelectionContext,
  type SelectionQuery,
  type SelectionRecord
} from "./selectors.js";
import type { XmlElement, XmlPart } from "./xml.js";
export type TransitionKind = "cut" | "fade" | "push" | "wipe";
export type TransitionDirection = "left" | "right" | "up" | "down";
export interface MutateTransitionsOptions {
  readonly selection: SelectionQuery;
  readonly kind?: TransitionKind;
  readonly direction?: TransitionDirection;
  readonly duration?: number;
  readonly advanceAfter?: number | null;
  readonly advanceOnClick?: boolean;
  readonly allowEmpty?: boolean;
}
export interface TransitionRecord {
  readonly selector: string;
  readonly location: Location;
  readonly slide: number;
  readonly part: string;
  readonly kind: TransitionKind | "unsupported" | null;
  readonly direction: TransitionDirection | null;
  readonly duration: number | null;
  readonly advanceAfter: number | null;
  readonly advanceOnClick: boolean | null;
}
const durationNamespace = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const compatibilityNamespace = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const directions = { left: "l", right: "r", up: "u", down: "d" };
const kinds = ["cut", "fade", "push", "wipe"] as const;
function unsupported(): never {
  throw new OfficeError(
    "unsupported-edit",
    "Unsupported transition content is preserve-only.",
    "validate-intent"
  );
}
function milliseconds(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2147483647)
    invalid("Transition times must be integer milliseconds in 0..2147483647.");
}
export function validateTransitionOptions(
  action: "add" | "set" | "remove",
  options: MutateTransitionsOptions
): void {
  if (
    !["add", "set", "remove"].includes(action) ||
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Object.keys(options).some(
      (k) =>
        ![
          "selection",
          "kind",
          "direction",
          "duration",
          "advanceAfter",
          "advanceOnClick",
          "allowEmpty"
        ].includes(k)
    )
  )
    invalid("Invalid transition options.");
  if (
    action === "set" &&
    [
      options.kind,
      options.direction,
      options.duration,
      options.advanceAfter,
      options.advanceOnClick
    ].every((v) => v === undefined)
  )
    invalid("Setting a transition requires an update.");
  if (options.kind !== undefined && !kinds.includes(options.kind))
    invalid("Unsupported transition kind.");
  if (action === "add" && options.kind === undefined)
    invalid("Adding a transition requires a kind.");
  if (
    action === "remove" &&
    [
      options.kind,
      options.direction,
      options.duration,
      options.advanceAfter,
      options.advanceOnClick
    ].some((v) => v !== undefined)
  )
    invalid("Removal accepts no transition settings.");
  if (
    options.direction !== undefined &&
    (typeof options.direction !== "string" || !Object.hasOwn(directions, options.direction))
  )
    invalid("Invalid transition direction.");
  if (options.duration !== undefined) milliseconds(options.duration);
  if (options.advanceAfter !== undefined && options.advanceAfter !== null)
    milliseconds(options.advanceAfter);
  if (options.advanceOnClick !== undefined && typeof options.advanceOnClick !== "boolean")
    invalid("Click advance requires a boolean.");
  if (options.allowEmpty !== undefined && typeof options.allowEmpty !== "boolean")
    invalid("allowEmpty requires a boolean.");
  if ((options.kind === "cut" || options.kind === "fade") && options.direction !== undefined)
    invalid("Cut and fade forbid direction.");
  if ((options.kind === "push" || options.kind === "wipe") && options.direction === undefined)
    invalid("Push and wipe require direction.");
  if (options.kind === "cut" && options.duration !== undefined && options.duration !== 0)
    invalid("Cut duration must be zero.");
}
function transition(doc: XmlPart) {
  if (
    doc.root.children.filter(
      (n) => n.name.namespace === doc.root.name.namespace && n.name.localName === "transition"
    ).length > 1
  )
    throw new OfficeError("invalid-xml", "Multiple slide transitions.", "parse");
  const direct = child(doc.root, "transition");
  const wrapped = doc.root.children.some(
    (n) =>
      n !== direct && n.name.localName !== "cSld" && containsTransition(n, doc.root.name.namespace)
  );
  return { direct, wrapped };
}
function containsTransition(node: XmlElement, ns: string): boolean {
  return (
    (node.name.namespace === ns && node.name.localName === "transition") ||
    node.children.some((n) => containsTransition(n, ns))
  );
}
function effectKind(node: XmlElement): TransitionKind | "unsupported" {
  if (
    node.attributes.some(
      (a) =>
        !(
          (a.name.namespace === "" && ["advTm", "advClick", "spd"].includes(a.name.localName)) ||
          (a.name.namespace === durationNamespace && a.name.localName === "dur") ||
          a.name.namespace === compatibilityNamespace
        )
    ) ||
    node.children.filter(
      (n) => n.name.namespace === node.name.namespace && n.name.localName === "sndAc"
    ).length > 1
  )
    return "unsupported";
  const effects = node.children.filter(
    (n) => n.name.namespace !== node.name.namespace || n.name.localName !== "sndAc"
  );
  const effect = effects[0];
  if (
    effects.length !== 1 ||
    !effect ||
    effect.name.namespace !== node.name.namespace ||
    !kinds.includes(effect.name.localName as TransitionKind) ||
    effect.children.length
  )
    return "unsupported";
  const kind = effect.name.localName as TransitionKind;
  if (
    effect.attributes.some(
      (a) =>
        a.name.namespace !== "" ||
        !(kind === "push" || kind === "wipe"
          ? a.name.localName === "dir" && Object.values(directions).includes(a.value)
          : a.name.localName === "thruBlk" && ["0", "false"].includes(a.value))
    )
  )
    return "unsupported";
  return kind;
}
function record(doc: XmlPart, selected: SelectionRecord): TransitionRecord {
  const { direct: node, wrapped } = transition(doc),
    kind = wrapped ? "unsupported" : node ? effectKind(node) : null;
  const effect = node?.children.find(
    (n) => n.name.localName === kind && n.name.namespace === node.name.namespace
  );
  const dir = effect ? attr(effect, "dir") : undefined;
  const duration = node?.attributes.find(
    (a) => a.name.namespace === durationNamespace && a.name.localName === "dur"
  )?.value;
  for (const value of [duration, node && attr(node, "advTm")])
    if (
      value !== undefined &&
      (value.trim() === "" ||
        ![...(value.trim().startsWith("+") ? value.trim().slice(1) : value.trim())].every(
          (c) => c >= "0" && c <= "9"
        ) ||
        !Number.isInteger(Number(value)) ||
        Number(value) < 0 ||
        Number(value) > 2147483647)
    )
      throw new OfficeError("invalid-xml", "Invalid transition millisecond metadata.", "parse");
  if (
    node &&
    attr(node, "advClick") !== undefined &&
    !["0", "1", "true", "false"].includes(attr(node, "advClick")!)
  )
    throw new OfficeError("invalid-xml", "Invalid transition click metadata.", "parse");
  return {
    selector: selected.token,
    location: selected.location,
    slide: selected.position,
    part: selected.part,
    kind,
    direction:
      kind === "push" || kind === "wipe"
        ? ((Object.entries(directions).find(
            ([, v]) => v === (dir ?? "l")
          )?.[0] as TransitionDirection) ?? null)
        : null,
    duration: kind === "cut" ? 0 : duration === undefined ? null : Number(duration),
    advanceAfter: node && attr(node, "advTm") !== undefined ? Number(attr(node, "advTm")) : null,
    advanceOnClick: node ? !["0", "false"].includes(attr(node, "advClick") ?? "true") : null
  };
}
function selectedSlides(s: Awaited<ReturnType<typeof loadShared>>, selection: SelectionQuery) {
  const selected = s.index.select({ ...selection, kind: selection.kind ?? "slide" });
  if (selected.some((n) => n.kind !== "slide")) throw new SelectionError("invalid-selection");
  return selected;
}
export async function readTransitions(
  input: BinaryInput,
  options: { readonly selection?: SelectionQuery },
  context: SelectionContext
): Promise<readonly TransitionRecord[]> {
  if (!options || Object.keys(options).some((k) => k !== "selection"))
    invalid("Invalid transition query.");
  const s = await loadShared(input, context, false);
  const selected = options.selection ? selectedSlides(s, options.selection) : s.index.slides;
  return selected.map((n) => record(s.doc(n.part), n));
}
function exactDuration(doc: XmlPart, duration: number): XmlPart {
  let node = child(doc.root, "transition")!;
  doc = doc.merge(node, {
    attributes: [{ namespace: durationNamespace, localName: "dur", value: String(duration) }]
  });
  node = child(doc.root, "transition")!;
  let prefix = "";
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === "transition" && tag.uri === node.name.namespace)
      prefix =
        Object.values(tag.attributes).find((a) => a.uri === durationNamespace && a.local === "dur")
          ?.prefix ?? "";
  });
  parser.write(doc.markup(node, true)).close();
  const existing =
    node.attributes.find(
      (a) => a.name.namespace === compatibilityNamespace && a.name.localName === "Ignorable"
    )?.value ?? "";
  return doc.merge(node, {
    attributes: [
      {
        namespace: compatibilityNamespace,
        localName: "Ignorable",
        value: [...new Set(`${existing} ${prefix}`.split(" ").filter(Boolean))].join(" ")
      }
    ]
  });
}
export async function mutateTransitions(
  input: BinaryInput,
  action: "add" | "set" | "remove",
  options: MutateTransitionsOptions,
  context: SelectionContext
): Promise<SharedEditResult> {
  validateTransitionOptions(action, options);
  if (!options.selection) throw new SelectionError("invalid-selection");
  const s = await loadShared(input, context);
  let selected: readonly SelectionRecord[];
  try {
    selected = selectedSlides(s, options.selection);
  } catch (error) {
    if (
      !(error instanceof SelectionError) ||
      error.code !== "missing-selection" ||
      !options.allowEmpty
    )
      throw error;
    selected = [];
  }
  if (action === "add" && selected.length > 1) throw new SelectionError("ambiguous-selection");
  const affected: number[] = [];
  for (const slide of selected) {
    let doc = s.doc(slide.part);
    const { direct, wrapped } = transition(doc);
    let node = direct;
    if (wrapped || (node && effectKind(node) === "unsupported")) unsupported();
    if (action === "add" && node) invalid("A transition already exists.");
    if (action === "remove") {
      if (!node) continue;
      affected.push(slide.position);
      if (node) doc = doc.spliceChildren(doc.root, doc.root.children.indexOf(node), 1, []);
      s.save(slide.part, doc);
      continue;
    }
    const current = record(doc, slide),
      kind = options.kind ?? current.kind;
    if (!kind || kind === "unsupported") invalid("Creating a transition requires a kind.");
    const directional = kind === "push" || kind === "wipe";
    const direction =
      options.direction ?? (directional && current.kind === kind ? current.direction : undefined);
    if ((directional && !direction) || (!directional && options.direction !== undefined))
      invalid("Transition direction conflicts with its kind.");
    if (kind === "cut" && options.duration !== undefined && options.duration !== 0)
      invalid("Cut duration must be zero.");
    const duration =
      kind === "cut"
        ? 0
        : (options.duration ?? (!node || current.kind === "cut" ? 500 : undefined));
    if (!node) {
      const before = doc.root.children.findIndex(
        (n) => n.name.namespace === s.p && ["timing", "extLst"].includes(n.name.localName)
      );
      doc = doc.spliceChildren(doc.root, before < 0 ? doc.root.children.length : before, 0, [
        `<p:transition xmlns:p="${s.p}" advClick="1"/>`
      ]);
      node = child(doc.root, "transition")!;
    }
    if (options.kind !== undefined || options.direction !== undefined || !node.children.length) {
      const effect = node.children.find(
        (n) => n.name.namespace === s.p && kinds.includes(n.name.localName as TransitionKind)
      );
      doc = doc.spliceChildren(node, effect ? node.children.indexOf(effect) : 0, effect ? 1 : 0, [
        `<p:${kind} xmlns:p="${s.p}"${directional ? ` dir="${directions[direction!]}"` : ""}/>`
      ]);
      node = child(doc.root, "transition")!;
    }
    doc = doc.merge(node, {
      attributes: [
        ...(options.advanceAfter === undefined
          ? []
          : [
              {
                namespace: "",
                localName: "advTm",
                value: options.advanceAfter === null ? null : String(options.advanceAfter)
              }
            ]),
        ...(options.advanceOnClick === undefined
          ? []
          : [{ namespace: "", localName: "advClick", value: options.advanceOnClick ? "1" : "0" }])
      ]
    });
    if (duration !== undefined) doc = exactDuration(doc, duration);
    s.save(slide.part, doc);
    affected.push(slide.position);
  }
  if (!affected.length && !options.allowEmpty) throw new SelectionError("missing-selection");
  return s.finish(selected[0]?.part ?? s.main, affected);
}
