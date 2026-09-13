import { OfficeError } from "./errors.js";
import { Length } from "./length.js";
import { attr, child, escape } from "./masters.js";
import { readRunColor, validateRunColor, type RunColor } from "./text-run-color.js";
import type { ShapeLength } from "./shapes.js";
import type { XmlElement, XmlPart } from "./xml.js";
export type DrawingColor =
  | string
  | { readonly rgb: string; readonly brightness?: number; readonly opacity?: number }
  | { readonly theme: string; readonly brightness?: number; readonly opacity?: number };
export type DrawingFill =
  | { readonly kind: "inherit" | "none" }
  | { readonly kind: "solid"; readonly color?: DrawingColor }
  | {
      readonly kind: "gradient";
      readonly stops: readonly { readonly position: number; readonly color: DrawingColor }[];
      readonly angle: number;
    }
  | {
      readonly kind: "pattern";
      readonly preset: string;
      readonly foreground?: DrawingColor;
      readonly background?: DrawingColor;
    }
  | {
      readonly kind: "picture";
      readonly relationshipId?: string;
      readonly mode: "stretch" | "tile";
      readonly crop?: {
        readonly left: number;
        readonly top: number;
        readonly right: number;
        readonly bottom: number;
      };
    };
export interface DrawingUpdate {
  readonly fill?: DrawingFill;
  readonly line?: {
    readonly fill?: DrawingFill;
    readonly width?: ShapeLength | null;
    readonly dash?: string | null;
  };
  readonly shadow?: {
    readonly blur: ShapeLength;
    readonly color: DrawingColor;
    readonly opacity: number;
  } | null;
  readonly shadowInherit?: boolean;
}
const fills = ["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"];
export const patternPresets = [
  "pct5",
  "pct10",
  "pct20",
  "pct25",
  "pct30",
  "pct40",
  "pct50",
  "pct60",
  "pct70",
  "pct75",
  "pct80",
  "pct90",
  "horz",
  "vert",
  "ltHorz",
  "ltVert",
  "dkHorz",
  "dkVert",
  "narHorz",
  "narVert",
  "dashHorz",
  "dashVert",
  "cross",
  "dnDiag",
  "upDiag",
  "ltDnDiag",
  "ltUpDiag",
  "dkDnDiag",
  "dkUpDiag",
  "wdDnDiag",
  "wdUpDiag",
  "dashDnDiag",
  "dashUpDiag",
  "diagCross",
  "smCheck",
  "lgCheck",
  "smGrid",
  "lgGrid",
  "dotGrid",
  "smConfetti",
  "lgConfetti",
  "horzBrick",
  "diagBrick",
  "solidDmnd",
  "openDmnd",
  "dotDmnd",
  "plaid",
  "sphere",
  "weave",
  "divot",
  "shingle",
  "wave",
  "trellis",
  "zigZag"
] as const;
export const dashPresets = [
  "solid",
  "dot",
  "dash",
  "lgDash",
  "dashDot",
  "lgDashDot",
  "lgDashDotDot",
  "sysDash",
  "sysDot",
  "sysDashDot",
  "sysDashDotDot"
] as const;
function invalid(message = "Invalid drawing format."): never {
  throw new OfficeError("invalid-value", message, "usage");
}
function unsupported(): never {
  throw new OfficeError(
    "unsupported-edit",
    "Advanced drawing effects cannot be replaced.",
    "validate-intent"
  );
}
function fields(v: unknown, keys: readonly string[]): void {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    invalid();
}
function ratio(v: unknown): asserts v is number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)
    invalid("Opacity and positions require a ratio in [0, 1].");
}
function length(v: ShapeLength) {
  let n: number;
  if (v instanceof Length) n = v.emu;
  else {
    fields(v, ["value", "unit"]);
    const factors = { emu: 1, in: 914400, cm: 360000, mm: 36000, pt: 12700 };
    if (typeof v.value !== "number" || !Object.hasOwn(factors, v.unit)) invalid();
    n = new Length(v.value * factors[v.unit]).emu;
  }
  if (!Number.isSafeInteger(n) || n < 0 || n > 2147483647)
    invalid("Drawing length exceeds nonnegative coordinate bounds.");
  return n;
}
export function drawingColorXml(v: DrawingColor, a: string): string {
  const opacity = typeof v === "object" && v !== null ? v.opacity : undefined;
  const color =
    typeof v === "object" && v !== null
      ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "opacity"))
      : v;
  validateRunColor(color);
  if (opacity !== undefined) ratio(opacity);
  const c = color as RunColor;
  const rgb = typeof c === "string" ? c : "rgb" in c ? c.rgb : undefined;
  const bright = typeof c === "string" ? undefined : c.brightness;
  const transforms =
    (bright === undefined || bright === 0
      ? ""
      : `<a:lumMod val="${Math.round((bright > 0 ? 1 - bright : 1 + bright) * 100000)}"/>${bright > 0 ? `<a:lumOff val="${Math.round(bright * 100000)}"/>` : ""}`) +
    (opacity === undefined ? "" : `<a:alpha val="${Math.round(opacity * 100000)}"/>`);
  const tag = rgb === undefined ? "schemeClr" : "srgbClr";
  return `<a:${tag} xmlns:a="${a}" val="${rgb?.toUpperCase() ?? (c as { theme: string }).theme}">${transforms}</a:${tag}>`;
}
function fillXml(v: DrawingFill, a: string, r: string): string {
  if (!v || typeof v !== "object") invalid();
  const open = (tag: string, body: string, attrs = "") =>
    `<a:${tag} xmlns:a="${a}"${attrs}>${body}</a:${tag}>`;
  switch (v.kind) {
    case "inherit":
    case "none":
      fields(v, ["kind"]);
      return v.kind === "inherit" ? "" : open("noFill", "");
    case "solid":
      fields(v, ["kind", "color"]);
      return open("solidFill", v.color === undefined ? "" : drawingColorXml(v.color, a));
    case "gradient": {
      fields(v, ["kind", "stops", "angle"]);
      if (
        !Array.isArray(v.stops) ||
        v.stops.length < 2 ||
        v.stops.length > 10000 ||
        typeof v.angle !== "number" ||
        !Number.isFinite(v.angle) ||
        Math.abs(v.angle) > 360000
      )
        invalid();
      let last = -1;
      for (const stop of v.stops) {
        fields(stop, ["position", "color"]);
        ratio(stop.position);
        if (stop.position < last) invalid();
        last = stop.position;
      }
      if (v.stops[0]!.position !== 0 || last !== 1) invalid("Gradient endpoints must be 0 and 1.");
      return open(
        "gradFill",
        `<a:gsLst>${v.stops.map((s) => `<a:gs pos="${Math.round(s.position * 100000)}">${drawingColorXml(s.color, a)}</a:gs>`).join("")}</a:gsLst><a:lin ang="${Math.round((((v.angle % 360) + 360) % 360) * 60000) % 21600000}" scaled="1"/>`
      );
    }
    case "pattern":
      fields(v, ["kind", "preset", "foreground", "background"]);
      if (!(patternPresets as readonly string[]).includes(v.preset))
        invalid("Unknown pattern preset.");
      return open(
        "pattFill",
        (v.foreground === undefined
          ? ""
          : `<a:fgClr>${drawingColorXml(v.foreground, a)}</a:fgClr>`) +
          (v.background === undefined
            ? ""
            : `<a:bgClr>${drawingColorXml(v.background, a)}</a:bgClr>`),
        ` prst="${v.preset}"`
      );
    case "picture": {
      fields(v, ["kind", "relationshipId", "mode", "crop"]);
      if (
        typeof v.relationshipId !== "string" ||
        !v.relationshipId.length ||
        !["stretch", "tile"].includes(v.mode)
      )
        invalid();
      let crop = "";
      if (v.crop) {
        fields(v.crop, ["left", "top", "right", "bottom"]);
        for (const key of ["left", "top", "right", "bottom"] as const) ratio(v.crop[key]);
        if (v.crop.left + v.crop.right >= 1 || v.crop.top + v.crop.bottom >= 1) invalid();
        crop = `<a:srcRect l="${Math.round(v.crop.left * 100000)}" t="${Math.round(v.crop.top * 100000)}" r="${Math.round(v.crop.right * 100000)}" b="${Math.round(v.crop.bottom * 100000)}"/>`;
      }
      return open(
        "blipFill",
        `<a:blip xmlns:r="${r}" r:embed="${escape(v.relationshipId)}"/>${crop}${v.mode === "tile" ? "<a:tile/>" : "<a:stretch><a:fillRect/></a:stretch>"}`
      );
    }
    default:
      invalid();
  }
}
function properties(node: XmlElement) {
  return child(node, node.name.localName === "grpSp" ? "grpSpPr" : "spPr");
}
function namespaces(node: XmlElement) {
  const strict = node.name.namespace === "http://purl.oclc.org/ooxml/presentationml/main";
  if (
    !strict &&
    node.name.namespace !== "http://schemas.openxmlformats.org/presentationml/2006/main"
  )
    invalid();
  return {
    a: strict
      ? "http://purl.oclc.org/ooxml/drawingml/main"
      : "http://schemas.openxmlformats.org/drawingml/2006/main",
    r: strict
      ? "http://purl.oclc.org/ooxml/officeDocument/relationships"
      : "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  };
}
export function readDrawingColor(parent: XmlElement) {
  const color = readRunColor(parent);
  const n = parent.children.find(
    (c) =>
      c.name.namespace === parent.name.namespace &&
      ["srgbClr", "schemeClr", "scrgbClr", "hslClr", "sysClr", "prstClr"].includes(c.name.localName)
  );
  const alpha = n && child(n, "alpha");
  return color ? { ...color, opacity: alpha ? Number(attr(alpha, "val")) / 100000 : null } : null;
}
export function readDrawingFill(parent: XmlElement | undefined, a: string) {
  const nodes =
    parent?.children.filter((n) => n.name.namespace === a && fills.includes(n.name.localName)) ??
    [];
  if (nodes.length > 1) throw new OfficeError("invalid-xml", "Multiple fill choices.", "index");
  const fill = nodes[0];
  const kind = fill
    ? ({
        noFill: "none",
        solidFill: "solid",
        gradFill: "gradient",
        pattFill: "pattern",
        blipFill: "picture",
        grpFill: "group"
      }[fill.name.localName] ?? "unsupported")
    : "inherit";
  const lin = fill && child(fill, "lin", a);
  const stops = fill && child(fill, "gsLst", a);
  const blip = fill && child(fill, "blip", a);
  const crop = fill && child(fill, "srcRect", a);
  return {
    kind,
    color: fill && kind === "solid" ? readDrawingColor(fill) : null,
    angle: lin ? Number(attr(lin, "ang")) / 60000 : null,
    stops:
      stops?.children
        .filter((n) => n.name.namespace === a && n.name.localName === "gs")
        .map((n) => ({ position: Number(attr(n, "pos")) / 100000, color: readDrawingColor(n) })) ??
      [],
    preset: fill && kind === "pattern" ? (attr(fill, "prst") ?? null) : null,
    foreground: fill && child(fill, "fgClr", a) ? readDrawingColor(child(fill, "fgClr", a)!) : null,
    background: fill && child(fill, "bgClr", a) ? readDrawingColor(child(fill, "bgClr", a)!) : null,
    relationshipId:
      blip?.attributes.find(
        (at) =>
          at.name.localName === "embed" &&
          [
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
            "http://purl.oclc.org/ooxml/officeDocument/relationships"
          ].includes(at.name.namespace)
      )?.value ?? null,
    mode:
      kind === "picture" && fill
        ? child(fill, "tile", a)
          ? "tile"
          : child(fill, "stretch", a)
            ? "stretch"
            : null
        : null,
    crop: crop
      ? {
          left: Number(attr(crop, "l") ?? 0) / 100000,
          top: Number(attr(crop, "t") ?? 0) / 100000,
          right: Number(attr(crop, "r") ?? 0) / 100000,
          bottom: Number(attr(crop, "b") ?? 0) / 100000
        }
      : null
  };
}
export function readDrawingFormat(node: XmlElement) {
  const { a } = namespaces(node);
  const pr = properties(node),
    ln = pr && child(pr, "ln", a),
    effects = pr && child(pr, "effectLst", a),
    shadow = effects && child(effects, "outerShdw", a);
  const c = shadow && readDrawingColor(shadow);
  return {
    fill: readDrawingFill(pr, a),
    line: {
      fill: readDrawingFill(ln, a),
      width: ln && attr(ln, "w") !== undefined ? Number(attr(ln, "w")) : null,
      dash: ln && child(ln, "prstDash", a) ? (attr(child(ln, "prstDash", a)!, "val") ?? null) : null
    },
    shadow: shadow
      ? {
          blur: Number(attr(shadow, "blurRad") ?? 0),
          distance: Number(attr(shadow, "dist") ?? 0),
          color: c,
          opacity: c?.opacity ?? null
        }
      : null,
    shadowInherit: !effects && !(pr && child(pr, "effectDag", a)),
    preserved:
      pr?.children
        .filter(
          (n) =>
            n.name.namespace === a && ["effectDag", "scene3d", "sp3d"].includes(n.name.localName)
        )
        .map((n) => n.name.localName) ?? []
  };
}
export function validateDrawingUpdate(update: DrawingUpdate) {
  fields(update, ["fill", "line", "shadow", "shadowInherit"]);
  if (!Object.values(update).some((v) => v !== undefined)) invalid();
  if (update.fill !== undefined) fillXml(update.fill, "a", "r");
  if (update.line !== undefined) {
    fields(update.line, ["fill", "width", "dash"]);
    if (!Object.values(update.line).some((v) => v !== undefined)) invalid();
    if (update.line.fill !== undefined) {
      if (update.line.fill?.kind === "picture") invalid("Picture fill is unavailable for lines.");
      fillXml(update.line.fill, "a", "r");
    }
    if (update.line.width !== undefined && update.line.width !== null) length(update.line.width);
    if (
      update.line.dash !== undefined &&
      update.line.dash !== null &&
      !(dashPresets as readonly string[]).includes(update.line.dash)
    )
      invalid();
  }
  if (update.shadow !== undefined && update.shadowInherit !== undefined) invalid();
  if (update.shadowInherit !== undefined && typeof update.shadowInherit !== "boolean") invalid();
  if (update.shadow !== undefined && update.shadow !== null) {
    fields(update.shadow, ["blur", "color", "opacity"]);
    length(update.shadow.blur);
    ratio(update.shadow.opacity);
    drawingColorXml(update.shadow.color, "a");
  }
}
export function applyDrawingUpdate(
  document: XmlPart,
  node: XmlElement,
  update: DrawingUpdate
): XmlPart {
  validateDrawingUpdate(update);
  const { a, r } = namespaces(node);
  const pr = properties(node);
  if (!pr) invalid("Drawing properties are unavailable.");
  const path: number[] = [];
  const locate = (n: XmlElement): boolean => {
    if (n === node) return true;
    for (let i = 0; i < n.children.length; i++) {
      path.push(i);
      if (locate(n.children[i]!)) return true;
      path.pop();
    }
    return false;
  };
  if (!locate(document.root)) invalid();
  const order = [
    "xfrm",
    "prstGeom",
    "custGeom",
    ...fills,
    "ln",
    "effectLst",
    "effectDag",
    "scene3d",
    "sp3d",
    "extLst"
  ];
  const replace = (
    parent: XmlElement,
    choices: readonly string[],
    markup: string,
    sequence: readonly string[] = order
  ) => {
    const existing = parent.children.filter(
      (n) => n.name.namespace === a && choices.includes(n.name.localName)
    );
    if (existing.length > 1) invalid("Ambiguous drawing choices.");
    const old = existing[0];
    let position = old
      ? parent.children.indexOf(old)
      : parent.children.findIndex(
          (n) =>
            n.name.namespace === a &&
            sequence.indexOf(n.name.localName) > sequence.indexOf(choices[0]!)
        );
    if (position < 0) position = parent.children.length;
    document = document.spliceChildren(parent, position, old ? 1 : 0, markup ? [markup] : []);
  };
  const current = () => {
    let n = document.root;
    for (const i of path) n = n.children[i]!;
    return properties(n)!;
  };
  if (update.fill !== undefined) replace(current(), fills, fillXml(update.fill, a, r));
  if (update.line !== undefined) {
    const parent = current();
    let ln = child(parent, "ln", a);
    if (!ln) {
      replace(parent, ["ln"], `<a:ln xmlns:a="${a}"/>`);
      ln = child(current(), "ln", a)!;
    }
    if (update.line.width !== undefined) {
      document = document.merge(ln, {
        attributes: [
          {
            namespace: "",
            localName: "w",
            value: update.line.width === null ? null : String(length(update.line.width))
          }
        ]
      });
      ln = child(current(), "ln", a)!;
    }
    if (update.line.fill !== undefined) {
      replace(ln, fills, fillXml(update.line.fill, a, r), [
        ...fills,
        "prstDash",
        "custDash",
        "round",
        "bevel",
        "miter",
        "headEnd",
        "tailEnd",
        "extLst"
      ]);
      ln = child(current(), "ln", a)!;
    }
    if (update.line.dash !== undefined)
      replace(
        ln,
        ["prstDash", "custDash"],
        update.line.dash === null ? "" : `<a:prstDash xmlns:a="${a}" val="${update.line.dash}"/>`,
        [
          ...fills,
          "prstDash",
          "custDash",
          "round",
          "bevel",
          "miter",
          "headEnd",
          "tailEnd",
          "extLst"
        ]
      );
  }
  if (update.shadow !== undefined || update.shadowInherit !== undefined) {
    const parent = current();
    if (child(parent, "effectDag", a)) unsupported();
    let effects = child(parent, "effectLst", a);
    if (update.shadowInherit === true) {
      if (effects && (effects.attributes.length || effects.children.length)) unsupported();
      if (effects) replace(parent, ["effectLst"], "");
    } else {
      if (!effects) {
        replace(parent, ["effectLst"], `<a:effectLst xmlns:a="${a}"/>`);
        effects = child(current(), "effectLst", a)!;
      }
      const old = child(effects, "outerShdw", a);
      if (
        old &&
        (old.attributes.some(
          (at) =>
            !["blurRad", "dist", "dir", "algn", "rotWithShape"].includes(at.name.localName) ||
            at.name.namespace !== ""
        ) ||
          Number(attr(old, "dist") ?? 0) !== 0 ||
          old.children.some(
            (n) =>
              n.name.namespace !== a ||
              !["srgbClr", "schemeClr"].includes(n.name.localName) ||
              n.attributes.some((at) => at.name.namespace !== "" || at.name.localName !== "val") ||
              n.children.some(
                (t) =>
                  t.name.namespace !== a ||
                  !["alpha", "lumMod", "lumOff"].includes(t.name.localName) ||
                  t.children.length > 0 ||
                  t.attributes.some((at) => at.name.namespace !== "" || at.name.localName !== "val")
              )
          ))
      )
        unsupported();
      if (update.shadow !== undefined) {
        const s = update.shadow;
        const color = s
          ? typeof s.color === "string"
            ? { rgb: s.color, opacity: s.opacity }
            : { ...s.color, opacity: s.opacity }
          : undefined;
        replace(
          effects,
          ["outerShdw"],
          s
            ? `<a:outerShdw xmlns:a="${a}" blurRad="${length(s.blur)}" dist="0" dir="0" algn="ctr" rotWithShape="0">${drawingColorXml(color!, a)}</a:outerShdw>`
            : "",
          [
            "blur",
            "fillOverlay",
            "glow",
            "innerShdw",
            "outerShdw",
            "prstShdw",
            "reflection",
            "softEdge"
          ]
        );
      }
    }
  }
  return document;
}
