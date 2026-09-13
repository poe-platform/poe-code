import { SaxesParser } from "saxes";
import type { BinaryInput, Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { attr, child, escape, invalid, loadShared, type SharedEditResult } from "./masters.js";
import {
  SelectionError,
  decodeSelectionToken,
  type SelectionContext,
  type SelectionQuery,
  type SelectionRecord
} from "./selectors.js";
import { partName } from "./package-uri.js";
import { parseXmlPart, type XmlElement, type XmlPart } from "./xml.js";
export type AnimationKind = "appear" | "fade-in" | "fade-out" | "pulse";
export type AnimationTrigger = "on-click" | "with-previous" | "after-previous";
export type AnimationTarget =
  | string
  | Location
  | { readonly slide: NonNullable<SelectionQuery["position"]>; readonly shape: string };
export interface MutateAnimationsOptions {
  readonly selection?: SelectionQuery;
  readonly target?: AnimationTarget;
  readonly kind?: AnimationKind;
  readonly trigger?: AnimationTrigger;
  readonly duration?: number;
  readonly delay?: number;
  readonly allowEmpty?: boolean;
}
export interface AnimationEditResult extends SharedEditResult {
  readonly affected: number;
  readonly locations: readonly Location[];
}
interface Effect {
  group?: number;
  id: number;
  behavior: number;
  second?: number;
  target: string;
  kind: AnimationKind;
  trigger: AnimationTrigger;
  duration: number;
  delay: number;
}
function unsupported(message = "Unsupported animation structure cannot be edited safely."): never {
  throw new OfficeError("unsupported-edit", message, "validate-intent");
}
function descendants(node: XmlElement): XmlElement[] {
  const result: XmlElement[] = [],
    pending = [node];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const n = pending[cursor]!;
    result.push(n);
    for (const c of n.children) pending.push(c);
  }
  return result;
}
function canonical(xml: string): string {
  const result: unknown[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) =>
    result.push([
      tag.uri,
      tag.local,
      Object.values(tag.attributes)
        .filter((a) => a.uri !== "http://www.w3.org/2000/xmlns/")
        .map((a) => [a.uri, a.local, a.value])
        .sort()
    ])
  );
  parser.on("text", (text) => {
    if (text.trim()) result.push(text);
  });
  parser.on("closetag", () => result.push("/"));
  parser.on("comment", () => unsupported());
  parser.on("cdata", () => unsupported());
  parser.on("processinginstruction", () => unsupported());
  parser.write(xml).close();
  return JSON.stringify(result);
}

function effectXml(e: Effect, p: string, previous?: Effect): string {
  const condition =
    e.trigger === "on-click"
      ? `<p:cond delay="${e.delay}"/>`
      : `<p:cond evt="${e.trigger === "with-previous" ? "onBegin" : "onEnd"}" delay="${e.delay}"><p:tn val="${previous!.id}"/></p:cond>`;
  const behavior = (id: number, duration: number, delay = 0) =>
    `<p:cBhvr><p:cTn id="${id}" dur="${duration}" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${escape(e.target)}"/></p:tgtEl>${e.kind === "pulse" ? "" : `<p:attrNameLst><p:attrName>${e.kind === "appear" ? "style.visibility" : "style.opacity"}</p:attrName></p:attrNameLst>`}</p:cBhvr>`;
  const half = Math.floor(e.duration / 2);
  const body =
    e.kind === "appear"
      ? `<p:set>${behavior(e.behavior, 0)}<p:to><p:strVal val="visible"/></p:to></p:set>`
      : e.kind === "pulse"
        ? `<p:animScale>${behavior(e.behavior, half)}<p:from x="100000" y="100000"/><p:to x="110000" y="110000"/></p:animScale><p:animScale>${behavior(e.second!, e.duration - half, half)}<p:from x="110000" y="110000"/><p:to x="100000" y="100000"/></p:animScale>`
        : `<p:animEffect transition="${e.kind === "fade-in" ? "in" : "out"}" filter="fade">${behavior(e.behavior, e.duration)}</p:animEffect>`;
  return `<p:par xmlns:p="${p}"><p:cTn id="${e.id}" dur="${e.duration}" fill="hold" presetID="${e.kind === "appear" ? 1 : e.kind === "pulse" ? 26 : 10}" presetClass="${e.kind === "fade-out" ? "exit" : e.kind === "pulse" ? "emph" : "entr"}" nodeType="${e.trigger === "on-click" ? "clickEffect" : e.trigger === "with-previous" ? "withEffect" : "afterEffect"}"><p:stCondLst>${condition}</p:stCondLst><p:childTnLst>${body}</p:childTnLst></p:cTn></p:par>`;
}
function groupXml(effects: readonly Effect[], p: string): string[] {
  const groups: { id: number; content: string[] }[] = [];
  effects.forEach((e, i) => {
    if (e.trigger === "on-click") groups.push({ id: e.group!, content: [] });
    if (!groups.length) unsupported();
    groups.at(-1)!.content.push(effectXml(e, p, effects[i - 1]));
  });
  return groups.map(
    (g) =>
      `<p:par xmlns:p="${p}"><p:cTn id="${g.id}" fill="hold"><p:stCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:stCondLst><p:childTnLst>${g.content.join("")}</p:childTnLst></p:cTn></p:par>`
  );
}
function optionsValid(options: MutateAnimationsOptions) {
  if (
    options.kind !== undefined &&
    !["appear", "fade-in", "fade-out", "pulse"].includes(options.kind)
  )
    invalid("Invalid animation kind.");
  if (
    options.trigger !== undefined &&
    !["on-click", "with-previous", "after-previous"].includes(options.trigger)
  )
    invalid("Invalid animation trigger.");
  for (const value of [options.duration, options.delay])
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 2147483647))
      invalid("Animation times must be integer milliseconds.");
  if (options.kind === "appear" && options.duration !== undefined && options.duration !== 0)
    invalid("Appear duration must be zero.");
}
export function applyAnimationEdit(
  doc: XmlPart,
  action: "add" | "set" | "remove",
  options: Omit<MutateAnimationsOptions, "selection" | "target"> & {
    readonly targetId?: string;
    readonly shapeIds?: readonly string[];
    readonly all?: boolean;
  }
): XmlPart {
  optionsValid(options);
  if (!["add", "set", "remove"].includes(action)) invalid("Invalid animation action.");
  const p = doc.root.name.namespace;
  const all = descendants(doc.root),
    timing = child(doc.root, "timing");
  if (all.some((n) => n.name.localName === "timing" && n !== timing)) unsupported();
  const ids = all
    .filter((n) => n.name.namespace === p && n.name.localName === "cTn")
    .map((n) => Number(attr(n, "id")));
  if (ids.some((n) => !Number.isInteger(n) || n < 0) || new Set(ids).size !== ids.length)
    unsupported();
  let next = ids.reduce((maximum, id) => Math.max(maximum, id), 0) + 1;
  const allocate = () => {
    if (next > 4294967295) unsupported("Timing ID space exhausted.");
    return next++;
  };
  const targetIds = all
    .filter((n) => n.name.namespace === p && n.name.localName === "cNvPr")
    .map((n) => attr(n, "id"));
  if (
    options.targetId !== undefined &&
    targetIds.filter((id) => id === options.targetId).length !== 1
  )
    throw new SelectionError("missing-selection");
  const roots = all.filter(
    (n) => n.name.namespace === p && n.name.localName === "cTn" && attr(n, "nodeType") === "tmRoot"
  );
  if (
    roots.length > 1 ||
    (!roots.length && all.some((n) => n.name.namespace === p && attr(n, "nodeType") === "mainSeq"))
  )
    unsupported();
  const root = roots[0],
    rootPar = timing && child(timing, "tnLst")?.children.find((n) => n.children.includes(root!));
  let effectList: XmlElement | undefined, rootId: number, seqId: number;
  const effects: Effect[] = [];
  if (root) {
    const list = child(root, "childTnLst"),
      seq = list?.children[0],
      seqNode = seq && child(seq, "cTn");
    effectList = seqNode && child(seqNode, "childTnLst");
    if (
      !rootPar ||
      !seqNode ||
      !effectList ||
      list!.children.length !== 1 ||
      seq!.name.localName !== "seq"
    )
      unsupported();
    rootId = Number(attr(root, "id"));
    seqId = Number(attr(seqNode, "id"));
    for (const group of effectList.children) {
      const groupNode = child(group, "cTn"),
        groupChildren = groupNode && child(groupNode, "childTnLst");
      if (!groupNode || !groupChildren || !groupChildren.children.length) unsupported();
      for (const [groupPosition, par] of groupChildren.children.entries()) {
        const ct = child(par, "cTn"),
          items = ct && child(ct, "childTnLst"),
          condition = ct && child(ct, "stCondLst")?.children[0];
        if (!ct || !items || !condition) unsupported();
        const type = attr(ct, "nodeType"),
          kind: AnimationKind =
            attr(ct, "presetClass") === "emph"
              ? "pulse"
              : attr(ct, "presetClass") === "exit"
                ? "fade-out"
                : attr(ct, "presetID") === "1"
                  ? "appear"
                  : "fade-in";
        const behaviors = descendants(items).filter((n) => n.name.localName === "cBhvr");
        const e: Effect = {
          id: Number(attr(ct, "id")),
          ...(groupPosition === 0 ? { group: Number(attr(groupNode, "id")) } : {}),
          behavior: Number(attr((behaviors[0] && child(behaviors[0], "cTn")) || ct, "id")),
          ...(behaviors[1] ? { second: Number(attr(child(behaviors[1], "cTn")!, "id")) } : {}),
          target:
            attr(descendants(items).find((n) => n.name.localName === "spTgt") || ct, "spid") ?? "",
          kind,
          trigger:
            type === "clickEffect"
              ? "on-click"
              : type === "withEffect"
                ? "with-previous"
                : "after-previous",
          duration: Number(attr(ct, "dur")),
          delay: Number(attr(condition, "delay"))
        };
        if (e.trigger !== "on-click" && !effects.length) unsupported();
        try {
          optionsValid(e);
        } catch {
          unsupported();
        }
        const generated = parseXmlPart(new TextEncoder().encode(effectXml(e, p, effects.at(-1))), {
          maxBytes: 100000,
          maxNodes: 1000,
          maxDepth: 30
        });
        if (canonical(doc.markup(par, true)) !== canonical(generated.markup(generated.root, true)))
          unsupported();
        if ((groupPosition === 0) !== (e.trigger === "on-click")) unsupported();
        effects.push(e);
      }
    }
    const skeleton = (content: string) =>
      `<p:par xmlns:p="${p}"><p:cTn id="${rootId}" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="${seqId}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${content}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par>`;
    if (canonical(doc.markup(rootPar, true)) !== canonical(skeleton(groupXml(effects, p).join(""))))
      unsupported();
  } else {
    rootId = allocate();
    seqId = allocate();
  }
  let selected = effects.filter((e) => !options.shapeIds || options.shapeIds.includes(e.target));
  if (action !== "add" && selected.length > 1 && !options.all)
    throw new SelectionError("ambiguous-selection");
  if (action !== "add" && !selected.length) {
    if (options.allowEmpty) return doc;
    throw new SelectionError("missing-selection");
  }
  if (action === "add") {
    if (!options.kind || !options.trigger || !options.targetId)
      invalid("Animation add requires kind, trigger and target.");
    if (options.trigger !== "on-click" && !effects.length)
      invalid("Previous-effect trigger requires a preceding effect.");
    effects.push({
      id: allocate(),
      behavior: allocate(),
      ...(options.kind === "pulse" ? { second: allocate() } : {}),
      ...(options.trigger === "on-click" ? { group: allocate() } : {}),
      kind: options.kind,
      trigger: options.trigger,
      target: options.targetId,
      duration: options.duration ?? (options.kind === "appear" ? 0 : 500),
      delay: options.delay ?? 0
    });
    selected = [];
  }
  const removedIds = new Set(
    selected.flatMap((e) => [
      e.id,
      e.behavior,
      ...(e.group ? [e.group] : []),
      ...(e.second ? [e.second] : [])
    ])
  );
  if (action === "remove") {
    for (let i = 0; i < effects.length; i++)
      if (
        !selected.includes(effects[i]!) &&
        effects[i]!.trigger !== "on-click" &&
        selected.includes(effects[i - 1]!)
      )
        unsupported("Removing this effect would strand another trigger.");
    for (const n of all)
      if (
        n.name.namespace === p &&
        n.name.localName === "tn" &&
        removedIds.has(Number(attr(n, "val"))) &&
        !rootPar?.children.includes(n) &&
        !descendants(rootPar!).includes(n)
      )
        unsupported("Removing this effect would strand an external timing reference.");
  }
  const result = effects
    .filter((e) => action !== "remove" || !selected.includes(e))
    .map((e, i) => {
      if (action !== "set" || !selected.includes(e)) return e;
      const kind = options.kind ?? e.kind,
        trigger = options.trigger ?? e.trigger;
      if (trigger !== "on-click" && i === 0)
        invalid("Previous-effect trigger requires a preceding effect.");
      const duration =
        options.duration ?? (kind === "appear" ? 0 : e.kind === "appear" ? 500 : e.duration);
      optionsValid({ kind, duration });
      return {
        ...e,
        kind,
        trigger,
        ...(trigger === "on-click"
          ? { group: e.trigger === "on-click" ? e.group! : allocate() }
          : {}),
        duration,
        delay: options.delay ?? e.delay,
        target: options.targetId ?? e.target,
        ...(kind === "pulse" ? { second: e.second ?? allocate() } : {})
      };
    });
  const retainedIds = new Set(
    result.flatMap((e) => [
      e.id,
      e.behavior,
      ...(e.trigger === "on-click" && e.group ? [e.group] : []),
      ...(e.kind === "pulse" && e.second ? [e.second] : [])
    ])
  );
  const lostIds = new Set(
    effects
      .flatMap((e) => [
        e.id,
        e.behavior,
        ...(e.group ? [e.group] : []),
        ...(e.second ? [e.second] : [])
      ])
      .filter((id) => !retainedIds.has(id))
  );
  if (rootPar && lostIds.size) {
    const inside = new Set(descendants(rootPar));
    for (const n of all)
      if (
        !inside.has(n) &&
        n.name.namespace === p &&
        n.name.localName === "tn" &&
        lostIds.has(Number(attr(n, "val")))
      )
        unsupported("Editing this effect would strand an external timing reference.");
  }
  const content = groupXml(result, p);
  if (effectList) return doc.spliceChildren(effectList, 0, effectList.children.length, content);
  const markup = `<p:par xmlns:p="${p}"><p:cTn id="${rootId}" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="${seqId}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${content.join("")}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par>`;
  if (timing) {
    const list = child(timing, "tnLst");
    if (!list) unsupported();
    return doc.spliceChildren(list, list.children.length, 0, [markup]);
  }
  const before = doc.root.children.findIndex(
    (n) => n.name.localName === "extLst" && n.name.namespace === p
  );
  return doc.spliceChildren(doc.root, before < 0 ? doc.root.children.length : before, 0, [
    `<p:timing xmlns:p="${p}"><p:tnLst>${markup}</p:tnLst></p:timing>`
  ]);
}
export async function mutateAnimations(
  input: BinaryInput,
  action: "add" | "set" | "remove",
  options: MutateAnimationsOptions,
  context: SelectionContext
): Promise<AnimationEditResult> {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(
      (k) =>
        typeof k !== "string" ||
        !["selection", "target", "kind", "trigger", "duration", "delay", "allowEmpty"].includes(
          k
        ) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(options, k)!, "value")
    )
  )
    invalid("Invalid animation options.");
  validateAnimationOptions(action, options);
  const s = await loadShared(input, context);
  let target: SelectionRecord | undefined;
  if (options.target !== undefined) {
    const t = options.target;
    let found: readonly SelectionRecord[];
    if (typeof t === "string") found = s.index.select({ token: t });
    else if ("fingerprint" in t) {
      if (t.fingerprint !== s.index.fingerprint) throw new SelectionError("stale-selection");
      found = s.index.objects.filter(
        (n) =>
          n.location.scope === t.scope &&
          n.location.owner === t.owner &&
          n.location.objectId === t.objectId
      );
    } else {
      const slide = s.index.select({ kind: "slide", position: t.slide })[0]!;
      found = s.index.objects.filter((n) => n.part === slide.part && n.name === t.shape);
    }
    if (found.length !== 1)
      throw new SelectionError(found.length ? "ambiguous-selection" : "missing-selection");
    target = found[0]!;
    if (target.kind !== "object" || target.scope !== "slides")
      throw new SelectionError("invalid-selection");
  }
  let selected: readonly SelectionRecord[];
  try {
    selected = options.selection
      ? s.index.select(
          options.selection.token
            ? options.selection
            : { ...options.selection, kind: options.selection.kind ?? "slide" }
        )
      : target
        ? [target]
        : [];
  } catch (error) {
    if (
      !(error instanceof SelectionError) ||
      error.code !== "missing-selection" ||
      !options.allowEmpty
    )
      throw error;
    selected = [];
  }
  if (selected.some((n) => n.scope !== "slides" || !["slide", "object"].includes(n.kind)))
    throw new SelectionError("invalid-selection");
  const slides = s.index.slides.filter((n) => selected.some((v) => v.part === n.part));
  if (target && (!slides.length || slides.some((n) => n.part !== target!.part)))
    throw new SelectionError("invalid-selection");
  if (!slides.length && !options.allowEmpty) throw new SelectionError("missing-selection");
  if (action === "add" && slides.length !== 1) throw new SelectionError("ambiguous-selection");
  const affected: number[] = [];
  const locations: Location[] = [];
  for (const slide of slides) {
    const doc = s.doc(slide.part),
      objects = selected.filter((n) => n.part === slide.part && n.kind === "object");
    const changed = applyAnimationEdit(doc, action, {
      ...options,
      ...(target ? { targetId: target.id } : {}),
      ...(options.selection?.all !== undefined ? { all: options.selection.all } : {}),
      ...(objects.length ? { shapeIds: objects.map((n) => n.id) } : {})
    });
    if (changed !== doc) {
      const sourceEffects =
        action === "add"
          ? [target!.id]
          : descendants(doc.root)
              .filter(
                (n) =>
                  n.name.namespace === s.p &&
                  n.name.localName === "cTn" &&
                  ["clickEffect", "withEffect", "afterEffect"].includes(attr(n, "nodeType") ?? "")
              )
              .map((n) => attr(descendants(n).find((v) => v.name.localName === "spTgt")!, "spid")!)
              .filter((id) => !objects.length || objects.some((o) => o.id === id));
      for (const id of sourceEffects) {
        const object = s.index.objects.find((n) => n.part === slide.part && n.id === id);
        if (object) locations.push(object.location);
      }

      s.save(slide.part, changed);
      affected.push(slide.position);
    }
  }
  return {
    ...(await s.finish(slides[0]?.part ?? s.main, affected)),
    affected: locations.length,
    locations
  };
}

export function validateAnimationOptions(
  action: "add" | "set" | "remove",
  options: MutateAnimationsOptions
): void {
  const data = (value: unknown, keys: readonly string[]) => {
    if (
      !value ||
      typeof value !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(
        (k) =>
          typeof k !== "string" ||
          !keys.includes(k) ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k)!, "value")
      )
    )
      invalid("Expected plain animation options.");
  };
  const position = (value: NonNullable<SelectionQuery["position"]>) => {
    data(value, ["coordinateSystem", "value"]);
    if (!["one-based", "zero-based"].includes(value.coordinateSystem) ||
        !Number.isSafeInteger(value.value) ||
        value.value < (value.coordinateSystem === "one-based" ? 1 : 0))
      invalid("Invalid animation position.");
  };
  const token = (value: string) => {
    try { decodeSelectionToken(value); }
    catch { invalid("Invalid animation location."); }
  };
  data(options, ["selection", "target", "kind", "trigger", "duration", "delay", "allowEmpty"]);
  if (!["add", "set", "remove"].includes(action)) invalid("Invalid animation action.");
  if (options.allowEmpty !== undefined && typeof options.allowEmpty !== "boolean")
    invalid("Invalid allowEmpty.");
  if (options.selection !== undefined) {
    data(options.selection, [
      "kind",
      "scope",
      "owner",
      "position",
      "id",
      "name",
      "part",
      "token",
      "all"
    ]);
    const selection = options.selection;
    if (selection.kind !== undefined && !["slide", "object"].includes(selection.kind))
      invalid("Animations require slide or object selection.");
    if (selection.token !== undefined) {
      if (Object.keys(selection).some(key => !["kind", "token"].includes(key)))
        invalid("Opaque and simple selectors cannot be combined.");
      token(selection.token);
    } else {
      if (selection.scope !== undefined && selection.scope !== "slides")
        invalid("Animations require slides scope.");
      if (selection.all !== undefined && typeof selection.all !== "boolean")
        invalid("Invalid animation cardinality.");
      for (const key of ["owner", "id", "name", "part"] as const)
        if (selection[key] !== undefined && (typeof selection[key] !== "string" || !selection[key]))
          invalid("Invalid animation selector value.");
      if ([selection.position, selection.id, selection.name, selection.part].filter(value => value !== undefined).length > 1 ||
          selection.part !== undefined || (selection.kind === "object" && !selection.owner))
        invalid("Conflicting animation selectors.");
      if (selection.owner !== undefined) {
        try { partName(selection.owner, false); }
        catch { invalid("Invalid animation owner."); }
      }
      if (selection.position !== undefined) position(selection.position);
    }
  }
  if (options.target !== undefined && typeof options.target !== "string") {
    data(options.target, [
      "fingerprint",
      "scope",
      "owner",
      "objectId",
      "coordinateSystem",
      "slide",
      "shape"
    ]);
    if ("fingerprint" in options.target) {
      data(options.target, ["fingerprint", "scope", "owner", "objectId", "coordinateSystem"]);
      if (Object.values(options.target).some(value => typeof value !== "string"))
        invalid("Animation location fields must be strings.");
      token(JSON.stringify({ fingerprint: options.target.fingerprint, scope: options.target.scope,
        owner: options.target.owner, objectId: options.target.objectId, coordinateSystem: options.target.coordinateSystem }));
    } else {
      data(options.target, ["slide", "shape"]);
      position(options.target.slide);
      if (typeof options.target.shape !== "string" || !options.target.shape) invalid("Expected nonempty shape name.");
    }
  }
  if (typeof options.target === "string") token(options.target);
  optionsValid(options);
  const fields = [options.kind, options.trigger, options.target, options.duration, options.delay];
  if (action === "remove" && fields.some((v) => v !== undefined))
    invalid("Animation remove takes no effect settings.");
  if (action === "set" && fields.every((v) => v === undefined))
    invalid("Animation set requires a change.");
  if (action === "add" && (!options.kind || !options.trigger || !options.target))
    invalid("Animation add requires kind, trigger and target.");
}

export interface AnimationBatchOperation {
  readonly action: "add" | "set" | "remove";
  readonly options: MutateAnimationsOptions;
}
export interface AnimationBatchResult extends AnimationEditResult {
  readonly results: readonly Omit<AnimationEditResult, "bytes">[];
}
export async function mutateAnimationsBatch(
  input: BinaryInput,
  operations: readonly AnimationBatchOperation[],
  context: SelectionContext
): Promise<AnimationBatchResult> {
  if (
    !Array.isArray(operations) ||
    operations.length > Math.min(1000, context.xmlLimits.maxNodes) ||
    Object.getPrototypeOf(operations) !== Array.prototype ||
    Reflect.ownKeys(operations).length !== operations.length + 1 ||
    Array.from({ length: operations.length }, (_, i) =>
      Object.getOwnPropertyDescriptor(operations, String(i))
    ).some((d) => !d || !Object.hasOwn(d, "value"))
  )
    invalid("Animation batch requires a bounded dense operation array.");
  for (const operation of operations) {
    if (
      !operation ||
      typeof operation !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(operation)) ||
      Reflect.ownKeys(operation).some(
        (k) =>
          !["action", "options"].includes(String(k)) ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(operation, k)!, "value")
      )
    )
      invalid("Invalid animation batch operation.");
    validateAnimationOptions(operation.action, operation.options);
  }
  const original = await loadShared(input, context);
  let bytes = original.source,
    part = original.main;
  const results: Omit<AnimationEditResult, "bytes">[] = [];
  const affectedSlides = new Set<number>(),
    locations: Location[] = [];
  for (const operation of operations) {
    const options = { ...operation.options };
    if (options.selection?.token) {
      const record = original.index.select(options.selection)[0]!;
      options.selection = {
        kind: record.kind,
        ...(record.kind === "object" ? { owner: record.part } : {}),
        id: record.id,
        ...(options.selection.all !== undefined ? { all: options.selection.all } : {})
      };
    }
    if (typeof options.target === "string" || (options.target && "fingerprint" in options.target)) {
      const t = options.target;
      const record =
        typeof t === "string"
          ? original.index.select({ token: t })[0]
          : original.index.objects.find(
              (n) =>
                n.location.fingerprint === t.fingerprint &&
                n.location.owner === t.owner &&
                n.location.objectId === t.objectId &&
                n.scope === t.scope
            );
      if (!record) throw new SelectionError("stale-selection");
      const current = await loadShared(bytes, context);
      const found = current.index.objects.find((n) => n.part === record.part && n.id === record.id);
      if (!found) throw new SelectionError("missing-selection");
      options.target = found.location;
    }
    const result = await mutateAnimations(bytes, operation.action, options, context);
    results.push({
      part: result.part,
      affectedSlides: result.affectedSlides,
      affected: result.affected,
      locations: result.locations.map((location) => ({
        ...location,
        fingerprint: original.index.fingerprint
      }))
    });
    bytes = result.bytes;
    part = result.part;
    for (const slide of result.affectedSlides) affectedSlides.add(slide);
    for (const location of result.locations)
      locations.push({ ...location, fingerprint: original.index.fingerprint });
  }
  return {
    bytes,
    part,
    affectedSlides: [...affectedSlides],
    affected: locations.length,
    locations,
    results
  };
}
