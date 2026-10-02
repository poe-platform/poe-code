import type { BinaryInput } from "./contracts.js";
import { readBinary } from "./bytes.js";
import { OfficeError } from "./errors.js";
import {
  attr,
  child,
  escape,
  fields,
  invalid,
  loadShared,
  nextRel,
  relPart,
  required,
  unique,
  type SharedEditResult
} from "./masters.js";
import { relativePartReference } from "./package-uri.js";
import type { SelectionContext } from "./selectors.js";
import { validateColor } from "./themes.js";
import { parseXmlPart, type XmlElement } from "./xml.js";
export interface GradientStop {
  readonly position: number;
  readonly color: string;
  readonly opacity?: number;
}
export type BackgroundScope = "slides" | "layouts" | "masters";
export interface MutateBackgroundOptions {
  readonly scope: BackgroundScope;
  readonly part: string;
  readonly kind: "solid" | "gradient" | "picture" | "inherit" | "style-reference";
  readonly color?: string;
  readonly stops?: readonly GradientStop[];
  readonly angle?: number;
  readonly image?: BinaryInput;
  readonly styleIndex?: number;
  readonly styleColor?: string;
}
export interface BackgroundRecord {
  readonly part: string;
  readonly kind: string;
  readonly color: string | null;
  readonly stops: readonly GradientStop[];
  readonly angle: number | null;
  readonly imagePart: string | null;
  readonly styleIndex: number | null;
  readonly styleColor: string | null;
  readonly affectedSlides: readonly number[];
}
const fills = ["solidFill", "gradFill", "blipFill", "noFill", "pattFill", "grpFill"];
function owners(s: Awaited<ReturnType<typeof loadShared>>, scope: BackgroundScope) {
  return scope === "slides"
    ? s.index.inventory.slides.map((slide) => slide.part)
    : scope === "masters"
      ? s.index.inventory.masters
      : s.index.inventory.layouts;
}
function affected(s: Awaited<ReturnType<typeof loadShared>>, part: string) {
  return s.index.inventory.slides
    .filter((slide) => [slide.part, slide.layout, slide.master].includes(part))
    .map((slide) => slide.position);
}
export async function readBackgrounds(
  input: BinaryInput,
  options: { readonly scope: BackgroundScope },
  context: SelectionContext
): Promise<readonly BackgroundRecord[]> {
  fields(options, ["scope"], ["slides", "layouts", "masters"]);
  const s = await loadShared(input, context, false);
  return owners(s, options.scope).map((part) => {
    const bg = child(required(s.doc(part).root, "cSld"), "bg"),
      pr = bg && child(bg, "bgPr"),
      ref = bg && child(bg, "bgRef"),
      fill = pr?.children.find((n) => n.name.namespace === s.a && fills.includes(n.name.localName));
    const rgb = (n: XmlElement | undefined) => {
      const c = n && child(n, "srgbClr", s.a);
      return c ? (attr(c, "val") ?? null) : null;
    };
    const stopList = fill && child(fill, "gsLst", s.a),
      line = fill && child(fill, "lin", s.a),
      blip = fill && child(fill, "blip", s.a);
    const rid = blip?.attributes.find(
      (a) => a.name.namespace === s.r && a.name.localName === "embed"
    )?.value;
    return {
      part,
      kind: ref
        ? "style-reference"
        : fill
          ? ({ solidFill: "solid", gradFill: "gradient", blipFill: "picture", noFill: "none" }[
              fill.name.localName
            ] ?? "unsupported")
          : bg
            ? "unsupported"
            : "inherit",
      color: rgb(fill),
      stops: (stopList?.children ?? []).map((n) => {
        const color = rgb(n) ?? "",
          c = child(n, "srgbClr", s.a),
          alpha = c && child(c, "alpha", s.a);
        return {
          position: Number(attr(n, "pos")) / 100000,
          color,
          ...(alpha ? { opacity: Number(attr(alpha, "val")) / 100000 } : {})
        };
      }),
      angle: line ? Number(attr(line, "ang")) / 60000 : null,
      imagePart: rid
        ? (s.index.inventory.relationships.find((e) => e.owner === part && e.id === rid)
            ?.targetPart ?? null)
        : null,
      styleIndex: ref ? Number(attr(ref, "idx")) : null,
      styleColor: rgb(ref),
      affectedSlides: affected(s, part)
    };
  });
}
export async function mutateBackground(
  input: BinaryInput,
  options: MutateBackgroundOptions,
  context: SelectionContext
): Promise<SharedEditResult> {
  fields(
    options,
    ["scope", "part", "kind", "color", "stops", "angle", "image", "styleIndex", "styleColor"],
    ["slides", "layouts", "masters"]
  );
  const payload: Record<string, readonly string[]> = {
    solid: ["color"],
    gradient: ["stops", "angle"],
    picture: ["image"],
    inherit: [],
    "style-reference": ["styleIndex", "styleColor"]
  };
  if (!Object.hasOwn(payload, options.kind)) invalid("Unknown background kind.");
  const allowed = payload[options.kind];
  if (
    !allowed ||
    ["color", "stops", "angle", "image", "styleIndex", "styleColor"].some(
      (k) => options[k as keyof MutateBackgroundOptions] !== undefined && !allowed.includes(k)
    )
  )
    invalid("Background payload does not match its kind.");
  if (options.kind === "solid") validateColor(options.color);
  if (options.kind === "picture" && options.image === undefined)
    invalid("Picture background requires image bytes.");
  if (options.kind === "style-reference") {
    validateColor(options.styleColor);
    if (!Number.isSafeInteger(options.styleIndex) || options.styleIndex! < 1)
      invalid("Invalid background style index.");
  }
  if (options.kind === "gradient") {
    if (
      !Array.isArray(options.stops) ||
      options.stops.length < 2 ||
      options.stops.length > context.xmlLimits.maxNodes
    )
      invalid("Gradient requires a bounded list of at least two stops.");
    let position = -1;
    for (const stop of options.stops) {
      if (!stop || Object.keys(stop).some((k) => !["position", "color", "opacity"].includes(k)))
        invalid("Invalid gradient stop.");
      validateColor(stop.color);
      if (
        !Number.isFinite(stop.position) ||
        stop.position < 0 ||
        stop.position > 1 ||
        stop.position < position ||
        (stop.opacity !== undefined &&
          (!Number.isFinite(stop.opacity) || stop.opacity < 0 || stop.opacity > 1))
      )
        invalid("Invalid gradient stop.");
      position = stop.position;
    }
    if (
      options.angle !== undefined &&
      (!Number.isFinite(options.angle) || Math.abs(options.angle) > 360000)
    )
      invalid("Invalid gradient angle.");
  }
  const s = await loadShared(input, context),
    part = unique(
      owners(s, options.scope).filter((p) => p === options.part),
      "Select one background owner."
    );
  let xml = s.doc(part);
  const common = required(xml.root, "cSld"),
    bg = child(common, "bg"),
    pr = bg && child(bg, "bgPr"),
    ref = bg && child(bg, "bgRef");
  if (pr && ref) invalid("Ambiguous background definition.");
  if (
    ref &&
    (ref.attributes.some((a) => a.name.namespace !== "" || a.name.localName !== "idx") ||
      ref.children.length !== 1 ||
      ref.children.some(
        (n) =>
          n.name.namespace !== s.a ||
          n.name.localName !== "srgbClr" ||
          n.children.length ||
          n.attributes.some((a) => a.name.namespace !== "" || a.name.localName !== "val")
      ))
  )
    throw new OfficeError(
      "unsupported-edit",
      "Unsupported style reference payload cannot be discarded.",
      "validate-intent"
    );
  if (options.kind === "inherit" || options.kind === "style-reference") {
    const safe = (n: XmlElement): boolean =>
      n.name.namespace === s.a &&
      (fills.includes(n.name.localName) ||
        (n.name.localName === "effectLst" && n.children.length === 0 && n.attributes.length === 0));
    if (
      bg &&
      (bg.attributes.length ||
        bg.children.some((n) => n !== pr && n !== ref) ||
        (pr && (pr.attributes.length || pr.children.some((n) => !safe(n)))) ||
        (ref && ref.children.some((n) => n.name.namespace !== s.a)))
    )
      throw new OfficeError(
        "unsupported-edit",
        "Background effects or extensions cannot be discarded.",
        "validate-intent"
      );
  }
  if (options.kind === "inherit") {
    if (bg) xml = xml.spliceChildren(common, common.children.indexOf(bg), 1, []);
    s.save(part, xml);
    return s.finish(part, affected(s, part));
  }
  let fill = "";
  if (options.kind === "solid")
    fill = `<a:solidFill xmlns:a="${s.a}"><a:srgbClr val="${options.color}"/></a:solidFill>`;
  if (options.kind === "gradient")
    fill = `<a:gradFill xmlns:a="${s.a}"><a:gsLst>${options.stops!.map((stop) => `<a:gs pos="${Math.round(stop.position * 100000)}"><a:srgbClr val="${stop.color}">${stop.opacity === undefined ? "" : `<a:alpha val="${Math.round(stop.opacity * 100000)}"/>`}</a:srgbClr></a:gs>`).join("")}</a:gsLst><a:lin ang="${Math.round(((((options.angle ?? 0) % 360) + 360) % 360) * 60000)}" scaled="1"/></a:gradFill>`;
  if (options.kind === "picture") {
    const bytes = await readBinary(options.image!, context);
    const png =
      bytes.length >= 24 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) &&
      [73, 72, 68, 82].every((v, i) => bytes[i + 12] === v);
    const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!png && !jpeg)
      throw new OfficeError(
        "unsupported-edit",
        "Only PNG and JPEG picture backgrounds are supported.",
        "validate-intent"
      );
    const ext = png ? "png" : "jpg";
    let i = 1;
    while (s.reader.names.some((p) => p.toLowerCase() === `/ppt/media/image${i}.${ext}`)) i++;
    const imagePart = `/ppt/media/image${i}.${ext}`;
    s.changes.set(imagePart, bytes);
    const relationPart = relPart(part),
      rels = s.reader.has(relationPart)
        ? s.doc(relationPart)
        : parseXmlPart(
            new TextEncoder().encode(
              '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
            ),
            context.xmlLimits
          ),
      rid = nextRel(rels);
    s.save(
      relationPart,
      rels.spliceChildren(rels.root, rels.root.children.length, 0, [
        `<Relationship xmlns="${rels.root.name.namespace}" Id="${rid}" Type="${s.r}/image" Target="${escape(relativePartReference(imagePart, part.slice(0, part.lastIndexOf("/"))))}"/>`
      ])
    );
    const types = s.doc("/[Content_Types].xml");
    s.save(
      "/[Content_Types].xml",
      types.spliceChildren(types.root, types.root.children.length, 0, [
        `<Override xmlns="${types.root.name.namespace}" PartName="${imagePart}" ContentType="image/${png ? "png" : "jpeg"}"/>`
      ])
    );
    fill = `<a:blipFill xmlns:a="${s.a}" xmlns:r="${s.r}"><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`;
  }
  if (options.kind === "style-reference") {
    const selectedSlide = s.index.inventory.slides.find((slide) => slide.part === part);
    const layout = selectedSlide?.layout;
    const master =
      options.scope === "masters"
        ? part
        : s.index.inventory.relationships.find(
            (e) => e.owner === (layout ?? part) && e.type === `${s.r}/slideMaster` && !e.external
          )?.targetPart;
    const theme = s.index.inventory.relationships.find(
      (e) => e.owner === master && e.type === `${s.r}/theme` && !e.external
    )?.targetPart;
    const lineage = [part, layout, master].filter(
      (x, i, all): x is string => !!x && all.indexOf(x) === i
    );
    const overrides = lineage.flatMap((owner) =>
      s.index.inventory.relationships
        .filter((e) => e.owner === owner && e.type === `${s.r}/themeOverride` && !e.external)
        .map((e) => e.targetPart!)
    );
    const fmt = [...overrides, ...(theme ? [theme] : [])]
      .map((p) => {
        const root = s.doc(p).root;
        return child(
          root.name.localName === "themeOverride" ? root : required(root, "themeElements"),
          "fmtScheme",
          s.a
        );
      })
      .find((n) => n !== undefined);
    const index = options.styleIndex!,
      list = fmt && child(fmt, index >= 1001 ? "bgFillStyleLst" : "fillStyleLst", s.a),
      offset = index >= 1001 ? index - 1001 : index - 1;
    if (!list || offset < 0 || offset >= list.children.length)
      invalid("Background style index is outside the effective theme style list.");
    const target = list.children[offset]!;
    if (target.name.namespace !== s.a || !fills.includes(target.name.localName))
      throw new OfficeError(
        "unsupported-edit",
        "Selected theme style is not a supported fill.",
        "validate-intent"
      );
    const reference = `<p:bgRef xmlns:p="${s.p}" xmlns:a="${s.a}" idx="${index}"><a:srgbClr val="${options.styleColor}"/></p:bgRef>`;
    if (bg) xml = xml.spliceChildren(bg, 0, bg.children.length, [reference]);
    else xml = xml.spliceChildren(common, 0, 0, [`<p:bg xmlns:p="${s.p}">${reference}</p:bg>`]);
  } else if (pr) {
    const existing = pr.children.filter(
      (n) => n.name.namespace === s.a && fills.includes(n.name.localName)
    );
    if (existing.length > 1) invalid("Ambiguous background fill.");
    xml = xml.spliceChildren(
      pr,
      existing[0] ? pr.children.indexOf(existing[0]) : 0,
      existing.length,
      [fill]
    );
  } else if (bg) {
    xml = xml.spliceChildren(bg, ref ? bg.children.indexOf(ref) : 0, ref ? 1 : 0, [
      `<p:bgPr xmlns:p="${s.p}" xmlns:a="${s.a}">${fill}<a:effectLst/></p:bgPr>`
    ]);
  } else
    xml = xml.spliceChildren(common, 0, 0, [
      `<p:bg xmlns:p="${s.p}" xmlns:a="${s.a}"><p:bgPr>${fill}<a:effectLst/></p:bgPr></p:bg>`
    ]);
  s.save(part, xml);
  return s.finish(part, affected(s, part));
}
