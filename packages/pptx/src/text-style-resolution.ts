import { OfficeError } from "./errors.js";
import type { XmlElement } from "./xml.js";

export interface StylePart {
  readonly part: string;
  readonly root: XmlElement;
}
export interface TextStyleContext {
  readonly slide: StylePart;
  readonly layout?: StylePart | undefined;
  readonly master?: StylePart | undefined;
  readonly theme?: StylePart | undefined;
  readonly themeOverrides?: readonly StylePart[];
  readonly presentation?: StylePart | undefined;
}
export interface StyleSource {
  readonly part: string;
  readonly layer: string;
  readonly path: string;
}
export interface EffectiveStyleValue {
  readonly value: string | number | boolean | null;
  readonly token: string | null;
  readonly status: "resolved" | "unresolved" | "absent";
  readonly source: StyleSource | null;
  readonly references: readonly StyleSource[];
  readonly reason: string | null;
}
export interface TextStyleRecord {
  readonly part: string;
  readonly shapeId: string;
  readonly paragraph: number;
  readonly run: number | null;
  readonly properties: Readonly<
    Record<
      | "bold"
      | "italic"
      | "size"
      | "latin"
      | "eastAsia"
      | "complex"
      | "color"
      | "language"
      | "underline"
      | "strike"
      | "baseline"
      | "capitalization"
      | "spacing"
      | "highlight",
      EffectiveStyleValue
    >
  >;
}
type Layer = { node: XmlElement; source: StyleSource };
const drawingNamespaces = [
  "http://schemas.openxmlformats.org/drawingml/2006/main",
  "http://purl.oclc.org/ooxml/drawingml/main"
];
function attr(node: XmlElement | undefined, name: string) {
  return node?.attributes.find((a) => a.name.namespace === "" && a.name.localName === name)?.value;
}
function children(node: XmlElement | undefined, name: string, ns = node?.name.namespace) {
  return node?.children.filter((n) => n.name.localName === name && n.name.namespace === ns) ?? [];
}
function one(node: XmlElement | undefined, name: string, ns = node?.name.namespace) {
  const found = children(node, name, ns);
  if (found.length > 1) throw new OfficeError("invalid-xml", "Ambiguous style structure.", "index");
  return found[0];
}
function shapes(root: XmlElement) {
  const result: XmlElement[] = [];
  const pending = [...(one(one(root, "cSld"), "spTree")?.children ?? [])];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.name.namespace !== root.name.namespace) continue;
    if (node.name.localName === "sp") result.push(node);
    if (node.name.localName === "grpSp") pending.push(...node.children);
  }
  return result.reverse();
}
function placeholder(shape: XmlElement | undefined) {
  return one(one(one(shape, "nvSpPr"), "nvPr"), "ph");
}
function match(part: StylePart | undefined, predicate: (ph: XmlElement) => boolean) {
  const found = part
    ? shapes(part.root).filter((s) => {
        const ph = placeholder(s);
        return ph && predicate(ph);
      })
    : [];
  if (found.length > 1)
    throw new OfficeError("ambiguous-selection", "Ambiguous style placeholder.", "index");
  return found[0];
}
function baseType(type: string) {
  return type === "ctrTitle"
    ? "title"
    : ["subTitle", "obj", "chart", "tbl", "clipArt", "dgm", "media", "pic"].includes(type)
      ? "body"
      : type;
}
function resolveProperty(
  layers: readonly Layer[],
  property: string,
  context: TextStyleContext,
  a: string
): EffectiveStyleValue {
  const absent: EffectiveStyleValue = {
    value: null,
    token: null,
    status: "absent",
    source: null,
    references: [],
    reason: null
  };
  for (const layer of layers) {
    const attribute = {
      bold: "b",
      italic: "i",
      size: "sz",
      language: "lang",
      underline: "u",
      strike: "strike",
      baseline: "baseline",
      capitalization: "cap",
      spacing: "spc"
    }[property];
    const font = { latin: "latin", eastAsia: "ea", complex: "cs" }[property];
    const fill = one(layer.node, property === "highlight" ? "highlight" : "solidFill", a);
    const color = fill?.children.find((n) => n.name.namespace === a);
    const token = attribute
      ? attr(layer.node, attribute)
      : font
        ? attr(one(layer.node, font, a), "typeface")
        : color
          ? (attr(color, "val") ?? color.name.localName)
          : undefined;
    if (property === "color" && !color) {
      const other = layer.node.children.find(
        (n) =>
          n.name.namespace === a &&
          ["noFill", "gradFill", "pattFill", "blipFill", "grpFill"].includes(n.name.localName)
      );
      if (other)
        return {
          ...absent,
          token: other.name.localName,
          status: "unresolved",
          source: layer.source,
          reason: "non-solid-color"
        };
    }
    if (token === undefined) continue;
    const references: StyleSource[] = [];
    const result = (
      value: EffectiveStyleValue["value"],
      reason: string | null = null
    ): EffectiveStyleValue => ({
      value,
      token: token!,
      source: layer.source,
      status: reason ? "unresolved" : "resolved",
      references,
      reason
    });
    if (attribute) {
      if (property === "language") return token ? result(token) : result(null, "invalid-language");
      if (["underline", "strike", "capitalization"].includes(property)) {
        const values: Record<string, readonly string[]> = {
          underline: [
            "none",
            "words",
            "sng",
            "dbl",
            "heavy",
            "dotted",
            "dottedHeavy",
            "dash",
            "dashHeavy",
            "dashLong",
            "dashLongHeavy",
            "dotDash",
            "dotDashHeavy",
            "dotDotDash",
            "dotDotDashHeavy",
            "wavy",
            "wavyHeavy",
            "wavyDbl"
          ],
          strike: ["noStrike", "sngStrike", "dblStrike"],
          capitalization: ["none", "small", "all"]
        };
        if (!values[property]!.includes(token)) return result(null, "invalid-character-format");
        return result(
          property === "strike"
            ? { noStrike: "none", sngStrike: "single", dblStrike: "double" }[token]!
            : token
        );
      }
      if (property === "baseline" || property === "spacing") {
        const digits = token.startsWith("-") || token.startsWith("+") ? token.slice(1) : token;
        const value = Number(token),
          max = property === "baseline" ? 100000 : 400000;
        return digits.length > 0 &&
          [...digits].every((c) => c >= "0" && c <= "9") &&
          Number.isInteger(value) &&
          Math.abs(value) <= max
          ? result(value / (property === "baseline" ? 1000 : 100))
          : result(null, "invalid-character-format");
      }
      if (property !== "size")
        return ["0", "1", "true", "false"].includes(token)
          ? result(token === "1" || token === "true")
          : result(null, "invalid-boolean");
      return token.length > 0 &&
        [...token].every((c) => c >= "0" && c <= "9") &&
        Number(token) >= 100 &&
        Number(token) <= 400000
        ? result(Number(token) / 100)
        : result(null, "invalid-font-size");
    }
    const themeParts = [
      ...(context.themeOverrides ?? []),
      ...(context.theme ? [context.theme] : [])
    ];
    const scheme = (name: string) => {
      for (const part of themeParts) {
        const container =
          part.root.name.localName === "themeOverride"
            ? part.root
            : one(part.root, "themeElements", a);
        const node = one(container, name, a);
        if (node) return { part, node };
      }
      return undefined;
    };
    if (font) {
      if (!token.startsWith("+")) return result(token);
      const variants: Record<string, [string, string]> = {
        "+mj-lt": ["majorFont", "latin"],
        "+mn-lt": ["minorFont", "latin"],
        "+mj-ea": ["majorFont", "ea"],
        "+mn-ea": ["minorFont", "ea"],
        "+mj-cs": ["majorFont", "cs"],
        "+mn-cs": ["minorFont", "cs"]
      };
      const variant = variants[token];
      const selected = scheme("fontScheme");
      if (!variant || !selected) return result(null, "theme-font-unavailable");
      references.push({
        part: selected.part.part,
        layer: "theme",
        path: `fontScheme/${variant.join("/")}`
      });
      const value = attr(one(one(selected.node, variant[0], a), variant[1], a), "typeface");
      return value ? result(value) : result(null, "theme-font-unavailable");
    }
    if (!color) return result(null, "color-unavailable");
    if (color.children.length) return result(null, "color-transform");
    let resolvedColor = color;
    if (color.name.localName === "schemeClr") {
      let slot = token;
      let mapping: { part: StylePart; node: XmlElement } | undefined;
      for (const part of [context.slide, context.layout]) {
        if (!part) continue;
        const override = one(part.root, "clrMapOvr");
        const map = one(override, "overrideClrMapping", a);
        if (map) {
          mapping = { part, node: map };
          break;
        }
        if (one(override, "masterClrMapping", a)) break;
      }
      if (!mapping && context.master) {
        const map = one(context.master.root, "clrMap");
        if (map) mapping = { part: context.master, node: map };
      }
      if (mapping) {
        slot = attr(mapping.node, token) ?? token;
        references.push({
          part: mapping.part.part,
          layer: "color-map",
          path: `${mapping.node.name.localName}/@${token}`
        });
      }
      const selected = scheme("clrScheme");
      const entry = selected && one(selected.node, slot, a);
      const candidate = entry?.children.find((n) => n.name.namespace === a);
      if (!candidate || !selected) return result(null, "theme-color-unavailable");
      references.push({ part: selected.part.part, layer: "theme", path: `clrScheme/${slot}` });
      resolvedColor = candidate;
    }
    if (resolvedColor.children.length) return result(null, "color-transform");
    if (resolvedColor.name.localName !== "srgbClr") return result(null, "color-kind-unavailable");
    const rgb = attr(resolvedColor, "val");
    return rgb?.length === 6 && [...rgb.toUpperCase()].every((c) => "0123456789ABCDEF".includes(c))
      ? result(rgb.toUpperCase())
      : result(null, "invalid-rgb");
  }
  return absent;
}

export function resolveTextStyles(context: TextStyleContext): readonly TextStyleRecord[] {
  const p = context.slide.root.name.namespace;
  const a =
    p === "http://purl.oclc.org/ooxml/presentationml/main"
      ? drawingNamespaces[1]!
      : drawingNamespaces[0]!;
  const result: TextStyleRecord[] = [];
  for (const shape of shapes(context.slide.root)) {
    const shapeId = attr(one(one(shape, "nvSpPr"), "cNvPr"), "id") ?? "";
    const ph = placeholder(shape);
    const layoutShape = ph
      ? match(context.layout, (n) => (attr(n, "idx") ?? "0") === (attr(ph, "idx") ?? "0"))
      : undefined;
    const type = attr(placeholder(layoutShape), "type") ?? attr(ph, "type") ?? "obj";
    const masterShape = ph
      ? match(context.master, (n) => (attr(n, "type") ?? "obj") === baseType(type))
      : undefined;
    const body = one(shape, "txBody");
    const paragraphs = children(body, "p", a);
    for (const [paragraph, node] of paragraphs.entries()) {
      const pPr = one(node, "pPr", a);
      const rawLevel = attr(pPr, "lvl") ?? "0";
      const level =
        rawLevel.length === 1 && "012345678".includes(rawLevel) ? Number(rawLevel) + 1 : null;
      if (level === null) throw new OfficeError("invalid-xml", "Invalid paragraph level.", "index");
      const runs = node.children.filter(
        (n) => n.name.namespace === a && ["r", "fld", "br"].includes(n.name.localName)
      );
      for (const [run, runNode] of (runs.length ? runs : [undefined]).entries()) {
        const layers: Layer[] = [];
        const add = (
          node: XmlElement | undefined,
          part: StylePart | undefined,
          layer: string,
          path: string
        ) => {
          if (node && part) layers.push({ node, source: { part: part.part, layer, path } });
        };
        const path = `shape[${shapeId}]/p[${paragraph}]`;
        add(one(runNode, "rPr", a), context.slide, "run", `${path}/run[${run}]/rPr`);
        if (!runNode)
          add(one(node, "endParaRPr", a), context.slide, "paragraph", `${path}/endParaRPr`);
        add(one(pPr, "defRPr", a), context.slide, "paragraph", `${path}/pPr/defRPr`);
        for (const [ownerShape, part, layer] of [
          [shape, context.slide, "shape"],
          [layoutShape, context.layout, "layout"],
          [masterShape, context.master, "master"]
        ] as const) {
          const list = one(one(ownerShape, "txBody"), "lstStyle", a);
          for (const key of [`lvl${level}pPr`, "defPPr"])
            add(
              one(one(list, key, a), "defRPr", a),
              part,
              layer,
              `shape[${attr(one(one(ownerShape, "nvSpPr"), "cNvPr"), "id") ?? ""}]/lstStyle/${key}/defRPr`
            );
        }
        const masterStyle = one(
          one(context.master?.root, "txStyles"),
          ph && baseType(type) === "title"
            ? "titleStyle"
            : ph && baseType(type) === "body"
              ? "bodyStyle"
              : "otherStyle"
        );
        for (const key of [`lvl${level}pPr`, "defPPr"]) {
          add(
            one(one(masterStyle, key, a), "defRPr", a),
            context.master,
            "master-text",
            `txStyles/${masterStyle?.name.localName}/${key}/defRPr`
          );
        }
        for (const key of [`lvl${level}pPr`, "defPPr"]) {
          add(
            one(one(one(context.presentation?.root, "defaultTextStyle"), key, a), "defRPr", a),
            context.presentation,
            "presentation",
            `defaultTextStyle/${key}/defRPr`
          );
        }
        for (const [ownerShape, part] of [
          [shape, context.slide],
          [layoutShape, context.layout],
          [masterShape, context.master]
        ] as const) {
          const reference = one(one(ownerShape, "style"), "fontRef", a);
          if (!reference) continue;
          const idx = attr(reference, "idx");
          const prefix = idx === "major" ? "+mj" : idx === "minor" ? "+mn" : null;
          const fonts: XmlElement[] = prefix
            ? [
                ["latin", "lt"],
                ["ea", "ea"],
                ["cs", "cs"]
              ].map(([name, suffix]) => ({
                name: { namespace: a, localName: name! },
                attributes: [
                  { name: { namespace: "", localName: "typeface" }, value: `${prefix}-${suffix}` }
                ],
                children: []
              }))
            : [];
          add(
            {
              name: { namespace: a, localName: "defRPr" },
              attributes: [],
              children: [
                ...fonts,
                {
                  name: { namespace: a, localName: "solidFill" },
                  attributes: [],
                  children: reference.children
                }
              ]
            },
            part,
            "font-reference",
            `shape[${attr(one(one(ownerShape, "nvSpPr"), "cNvPr"), "id") ?? ""}]/style/fontRef`
          );
        }
        const properties = Object.fromEntries(
          [
            "bold",
            "italic",
            "size",
            "latin",
            "eastAsia",
            "complex",
            "color",
            "language",
            "underline",
            "strike",
            "baseline",
            "capitalization",
            "spacing",
            "highlight"
          ].map((property) => [property, resolveProperty(layers, property, context, a)])
        ) as unknown as TextStyleRecord["properties"];
        result.push({
          part: context.slide.part,
          shapeId,
          paragraph,
          run: runNode ? run : null,
          properties
        });
      }
    }
  }
  return result;
}
