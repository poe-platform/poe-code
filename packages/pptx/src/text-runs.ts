import type { BinaryInput, Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { loadShared } from "./masters.js";
import { SelectionError, type SelectionContext } from "./selectors.js";
import {
  readTextBodies,
  validateTextReadingOptions,
  type ReadPresentationTextOptions
} from "./text-reading.js";
import { readRunColor, colorMerge, validateRunColor, type RunColor } from "./text-run-color.js";
import type { XmlElement, XmlMerge, XmlPart } from "./xml.js";
export enum MSO_TEXT_UNDERLINE_TYPE {
  NONE = 0,
  WORDS = 1,
  SINGLE_LINE = 2,
  DOUBLE_LINE = 3,
  HEAVY_LINE = 4,
  DOTTED_LINE = 5,
  DOTTED_HEAVY_LINE = 6,
  DASH_LINE = 7,
  DASH_HEAVY_LINE = 8,
  DASH_LONG_LINE = 9,
  DASH_LONG_HEAVY_LINE = 10,
  DOT_DASH_LINE = 11,
  DOT_DASH_HEAVY_LINE = 12,
  DOT_DOT_DASH_LINE = 13,
  DOT_DOT_DASH_HEAVY_LINE = 14,
  WAVY_LINE = 15,
  WAVY_HEAVY_LINE = 16,
  WAVY_DOUBLE_LINE = 17,
  MIXED = -2
}
export { MSO_TEXT_UNDERLINE_TYPE as MSO_UNDERLINE };
export const textUnderlineStyles = [
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
] as const;
export const textStrikeStyles = ["none", "single", "double"] as const;
export const textCapitalizationStyles = ["none", "small", "all"] as const;
export interface TextRunFormatting {
  readonly font?: string | null;
  readonly eastAsiaFont?: string | null;
  readonly complexScriptFont?: string | null;
  readonly complexScriptCharset?: number | null;
  readonly complexScriptPitchFamily?: number | null;
  readonly complexScriptPanose?: string | null;
  readonly symbolFont?: string | null;
  readonly alternateLanguage?: string | null;
  readonly rtl?: boolean | null;
  readonly size?: number | null;
  readonly language?: string | null;
  readonly bold?: boolean | null;
  readonly italic?: boolean | null;
  readonly underline?:
    | (typeof textUnderlineStyles)[number]
    | MSO_TEXT_UNDERLINE_TYPE
    | keyof typeof MSO_TEXT_UNDERLINE_TYPE
    | boolean
    | null;
  readonly strike?: (typeof textStrikeStyles)[number] | null;
  readonly baseline?: number | null;
  readonly capitalization?: (typeof textCapitalizationStyles)[number] | null;
  readonly spacing?: number | null;
  readonly color?: RunColor | null;
  readonly highlight?: RunColor | null;
}
export interface MutateTextRunsOptions extends ReadPresentationTextOptions, TextRunFormatting {
  readonly text?: string;
  readonly paragraph?: number;
  readonly run?: number;
  readonly all?: boolean;
  readonly allowEmpty?: boolean;
}
const formatKeys = [
  "font",
  "eastAsiaFont",
  "complexScriptFont",
  "complexScriptCharset",
  "complexScriptPitchFamily",
  "complexScriptPanose",
  "symbolFont",
  "alternateLanguage",
  "rtl",
  "size",
  "language",
  "bold",
  "italic",
  "underline",
  "strike",
  "baseline",
  "capitalization",
  "spacing",
  "color",
  "highlight"
];
const pitchFamilies = [0, 1, 2, 16, 17, 18, 32, 33, 34, 48, 49, 50, 64, 65, 66, 80, 81, 82];
function invalid(): never {
  throw new OfficeError("invalid-value", "Invalid run formatting options.", "usage");
}
export function validateTextRunOptions(options: MutateTextRunsOptions): void {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Object.keys(options).some(
      (k) =>
        ![
          ...formatKeys,
          "text",
          "paragraph",
          "run",
          "all",
          "allowEmpty",
          "scope",
          "select",
          "shape"
        ].includes(k)
    )
  )
    invalid();
  validateTextReadingOptions({
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    ...(options.select === undefined ? {} : { select: options.select }),
    ...(options.shape === undefined ? {} : { shape: options.shape })
  });
  if (
    ![...formatKeys, "text"].some(
      (k) => Object.hasOwn(options, k) && options[k as keyof MutateTextRunsOptions] !== undefined
    )
  )
    invalid();
  for (const key of ["paragraph", "run"] as const)
    if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key]! < 0))
      invalid();
  if (
    options.complexScriptCharset != null &&
    (!Number.isInteger(options.complexScriptCharset) ||
      options.complexScriptCharset < -128 ||
      options.complexScriptCharset > 127)
  )
    invalid();
  if (
    options.complexScriptPitchFamily != null &&
    !pitchFamilies.includes(options.complexScriptPitchFamily)
  )
    invalid();
  if (
    options.complexScriptPanose != null &&
    (typeof options.complexScriptPanose !== "string" ||
      options.complexScriptPanose.length !== 20 ||
      [...options.complexScriptPanose.toUpperCase()].some((c) => !"0123456789ABCDEF".includes(c)))
  )
    invalid();
  if (
    options.complexScriptFont === null &&
    [
      options.complexScriptCharset,
      options.complexScriptPitchFamily,
      options.complexScriptPanose
    ].some((value) => value != null)
  )
    invalid();
  for (const key of ["all", "allowEmpty"] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean") invalid();
  for (const key of [
    "font",
    "eastAsiaFont",
    "complexScriptFont",
    "symbolFont",
    "language",
    "alternateLanguage",
    "text"
  ] as const) {
    const value = options[key];
    if (value === undefined || (value === null && key !== "text")) continue;
    if (typeof value !== "string" || (key !== "text" && !value)) invalid();
    for (const c of value) {
      const p = c.codePointAt(0)!;
      if (
        (key !== "text" && p < 32 && ![9, 10, 13].includes(p)) ||
        (p >= 0xd800 && p <= 0xdfff) ||
        p === 0xfffe ||
        p === 0xffff
      )
        invalid();
    }
  }
  for (const key of ["bold", "italic", "rtl"] as const)
    if (options[key] != null && typeof options[key] !== "boolean") invalid();
  for (const [key, min, max] of [
    ["size", 1, 4000],
    ["spacing", -4000, 4000],
    ["baseline", -100, 100]
  ] as const) {
    const value = options[key];
    if (
      value != null &&
      (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    )
      invalid();
  }
  if (
    options.underline != null &&
    typeof options.underline !== "boolean" &&
    !textUnderlineStyles.includes(
      underlineToken(options.underline) as (typeof textUnderlineStyles)[number]
    )
  )
    invalid();
  if (options.strike != null && !textStrikeStyles.includes(options.strike)) invalid();
  if (options.capitalization != null && !textCapitalizationStyles.includes(options.capitalization))
    invalid();
  for (const key of ["color", "highlight"] as const)
    if (options[key] != null) validateRunColor(options[key]);
}
function underlineToken(value: string | number): string {
  if (typeof value === "number") return (textUnderlineStyles as readonly string[])[value] ?? "";
  const code = MSO_TEXT_UNDERLINE_TYPE[value as keyof typeof MSO_TEXT_UNDERLINE_TYPE];
  return typeof code === "number"
    ? ((textUnderlineStyles as readonly string[])[code] ?? "")
    : value;
}
export function runPropertiesMerge(
  options: TextRunFormatting,
  namespace: string,
  properties?: XmlElement
): XmlMerge {
  const name = (localName: string) => ({ namespace, localName });
  const attributes: NonNullable<XmlMerge["attributes"]>[number][] = [];
  const mapping = {
    bold: "b",
    italic: "i",
    size: "sz",
    language: "lang",
    alternateLanguage: "altLang",
    underline: "u",
    strike: "strike",
    baseline: "baseline",
    capitalization: "cap",
    spacing: "spc"
  };
  for (const [key, localName] of Object.entries(mapping)) {
    const value = options[key as keyof TextRunFormatting];
    if (value === undefined) continue;
    let encoded: string | null = value === null ? null : String(value);
    if (value !== null) {
      if (key === "bold" || key === "italic") encoded = value ? "1" : "0";
      if (key === "underline")
        encoded =
          typeof value === "boolean"
            ? value
              ? "sng"
              : "none"
            : underlineToken(value as string | number);
      if (key === "size" || key === "spacing")
        encoded = String(Math.sign(Number(value)) * Math.round(Math.abs(Number(value)) * 100));
      if (key === "baseline")
        encoded = String(Math.sign(Number(value)) * Math.round(Math.abs(Number(value)) * 1000));
      if (key === "strike")
        encoded = { none: "noStrike", single: "sngStrike", double: "dblStrike" }[value as "none"];
    }
    attributes.push({ namespace: "", localName, value: encoded });
  }
  const sequence = [
    "ln",
    "noFill",
    "solidFill",
    "gradFill",
    "blipFill",
    "pattFill",
    "grpFill",
    "effectLst",
    "effectDag",
    "highlight",
    "uLnTx",
    "uLn",
    "uFillTx",
    "uFill",
    "latin",
    "ea",
    "cs",
    "sym",
    "hlinkClick",
    "hlinkMouseOver",
    "rtl",
    "extLst"
  ].map(name);
  const remove: ReturnType<typeof name>[] = [];
  const upsert: NonNullable<XmlMerge["children"]>["upsert"][number][] = [];
  for (const [key, local] of [
    ["font", "latin"],
    ["eastAsiaFont", "ea"],
    ["complexScriptFont", "cs"],
    ["symbolFont", "sym"]
  ] as const) {
    const value = options[key];
    if (value === undefined) continue;
    if (value === null) remove.push(name(local));
    else
      upsert.push({
        name: name(local),
        merge: { attributes: [{ namespace: "", localName: "typeface", value }] }
      });
  }
  const classification = [
    ["complexScriptCharset", "charset"],
    ["complexScriptPitchFamily", "pitchFamily"],
    ["complexScriptPanose", "panose"]
  ] as const;
  const fontAttributes = classification.flatMap(([key, localName]) =>
    options[key] === undefined
      ? []
      : [
          {
            namespace: "",
            localName,
            value: options[key] === null ? null : String(options[key]).toUpperCase()
          }
        ]
  );
  if (fontAttributes.length && options.complexScriptFont !== null) {
    const existing = properties?.children.find(
      (n) => n.name.namespace === namespace && n.name.localName === "cs"
    );
    if (
      !existing?.attributes.some(
        (attribute) => !attribute.name.namespace && attribute.name.localName === "typeface"
      ) &&
      options.complexScriptFont === undefined &&
      fontAttributes.some((a) => a.value !== null)
    )
      throw new OfficeError(
        "invalid-value",
        "Complex-script font attributes require an existing or explicit typeface.",
        "validate-intent"
      );
    if (existing || options.complexScriptFont !== undefined) {
      const font = upsert.find((child) => child.name.localName === "cs");
      if (font) upsert.splice(upsert.indexOf(font), 1);
      upsert.push({
        name: name("cs"),
        merge: { attributes: [...(font?.merge.attributes ?? []), ...fontAttributes] }
      });
    }
  }
  if (options.rtl !== undefined) {
    if (options.rtl === null) remove.push(name("rtl"));
    else
      upsert.push({
        name: name("rtl"),
        merge: { attributes: [{ namespace: "", localName: "val", value: options.rtl ? "1" : "0" }] }
      });
  }
  for (const key of ["color", "highlight"] as const) {
    const value = options[key];
    if (value === undefined) continue;
    const local = key === "color" ? "solidFill" : "highlight";
    if (key === "color")
      remove.push(...["noFill", "gradFill", "blipFill", "pattFill", "grpFill"].map(name));
    if (value === null) remove.push(name(local));
    else upsert.push({ name: name(local), merge: colorMerge(value, namespace) });
  }
  return { attributes, children: { sequence, remove, upsert } };
}
export async function mutateTextRuns(
  input: BinaryInput,
  options: MutateTextRunsOptions,
  context: SelectionContext
): Promise<{
  readonly bytes: Uint8Array;
  readonly affected: number;
  readonly locations: readonly Location[];
}> {
  validateTextRunOptions(options);
  if (
    !options.all &&
    options.select === undefined &&
    options.shape === undefined &&
    options.paragraph === undefined &&
    options.run === undefined
  )
    throw new SelectionError("missing-selection");
  const reading = {
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    ...(options.select === undefined ? {} : { select: options.select }),
    ...(options.shape === undefined ? {} : { shape: options.shape })
  };
  const state = await loadShared(input, context);
  const bodies = await readTextBodies(state.source, reading, context);
  const edits = new Map<string, { document: XmlPart; nodes: Set<XmlElement> }>();
  const locations: Location[] = [];
  let affected = 0;
  for (const body of bodies) {
    for (const [paragraphIndex, paragraph] of body.paragraphs.entries()) {
      if (options.paragraph !== undefined && options.paragraph !== paragraphIndex) continue;
      const runs = paragraph.inlines.filter(
        (n) => n.name.namespace === state.a && ["r", "fld", "br"].includes(n.name.localName)
      );
      for (const [runIndex, node] of runs.entries()) {
        if (options.run !== undefined && options.run !== runIndex) continue;
        if (options.text !== undefined && node.name.localName !== "r")
          throw new OfficeError(
            "unsupported-edit",
            "Only ordinary runs support text assignment.",
            "validate-intent"
          );
        const edit = edits.get(body.part) ?? {
          document: body.document,
          nodes: new Set<XmlElement>()
        };
        if (!edit.nodes.has(node)) {
          edit.nodes.add(node);
          affected++;
        }
        edits.set(body.part, edit);
        if (!locations.includes(body.segment.location)) locations.push(body.segment.location);
      }
    }
  }
  if (!affected && !options.allowEmpty) throw new SelectionError("missing-selection");
  if (affected > 1 && !options.all) throw new SelectionError("ambiguous-selection");
  for (const [part, edit] of edits) {
    const paths: number[][] = [];
    const visit = (node: XmlElement, path: number[]) => {
      if (edit.nodes.has(node)) paths.push(path);
      node.children.forEach((child, i) => visit(child, [...path, i]));
    };
    visit(edit.document.root, []);
    let document = edit.document;
    for (const path of paths.reverse()) {
      context.signal?.throwIfAborted();
      const find = () => path.reduce((node, i) => node.children[i]!, document.root);
      let node = find();
      if (options.text !== undefined) {
        const texts = node.children.filter(
          (n) => n.name.namespace === state.a && n.name.localName === "t"
        );
        if (texts.length !== 1)
          throw new OfficeError(
            "unsupported-edit",
            "Expected one run text element.",
            "validate-intent"
          );
        const text = Array.from(options.text, (character) => {
          const point = character.codePointAt(0)!;
          return point < 32 && ![9, 10, 13].includes(point)
            ? `_x${point.toString(16).toUpperCase().padStart(4, "0")}_`
            : character;
        }).join("");
        document = document.setText(texts[0]!, text);
        node = find();
      }
      if (formatKeys.some((k) => options[k as keyof MutateTextRunsOptions] !== undefined)) {
        const name = { namespace: state.a, localName: "rPr" };
        document = document.merge(node, {
          children: {
            sequence: [name, { namespace: state.a, localName: "t" }],
            upsert: [
              {
                name,
                merge: runPropertiesMerge(
                  options,
                  state.a,
                  node.children.find(
                    (child) => child.name.namespace === state.a && child.name.localName === "rPr"
                  )
                )
              }
            ]
          }
        });
      }
    }
    state.save(part, document);
  }
  if (!affected) return { bytes: state.source, affected, locations };
  const result = await state.finish(state.main, []);
  return { bytes: result.bytes, affected, locations };
}

export function readRunFormatting(run: XmlElement) {
  const ns = run.name.namespace;
  const nodes = run.children.filter((n) => n.name.namespace === ns && n.name.localName === "rPr");
  if (nodes.length > 1) throw new OfficeError("invalid-xml", "Ambiguous run properties.", "parse");
  const properties = nodes[0];
  const attribute = (key: string) =>
    properties?.attributes.find((a) => !a.name.namespace && a.name.localName === key)?.value ??
    null;
  const child = (key: string) =>
    properties?.children.find((n) => n.name.namespace === ns && n.name.localName === key);
  const boolean = (key: string) => {
    const value = attribute(key);
    if (value === null) return null;
    if (!["0", "1", "false", "true"].includes(value))
      throw new OfficeError("invalid-xml", "Invalid run boolean.", "parse");
    return value === "1" || value === "true";
  };
  const numeric = (key: string, scale: number) => {
    const value = attribute(key);
    if (value === null) return null;
    if (!value || !Number.isFinite(Number(value)))
      throw new OfficeError("invalid-xml", "Invalid run number.", "parse");
    return Number(value) / scale;
  };
  const fontAttribute = (key: string) =>
    child("cs")?.attributes.find((a) => !a.name.namespace && a.name.localName === key)?.value ??
    null;
  const fontNumber = (key: string) => {
    const raw = fontAttribute(key);
    if (raw === null) return null;
    const value = raw.trim(),
      digits = value.startsWith("-") || value.startsWith("+") ? value.slice(1) : value;
    if (!digits || [...digits].some((c) => c < "0" || c > "9") || !Number.isInteger(Number(value)))
      throw new OfficeError("invalid-xml", "Invalid complex-script font classification.", "parse");
    return Number(value);
  };
  const classification = {
    complexScriptCharset: fontNumber("charset"),
    complexScriptPitchFamily: fontNumber("pitchFamily"),
    complexScriptPanose: fontAttribute("panose")?.trim().toUpperCase() ?? null
  };
  try {
    validateTextRunOptions(classification);
  } catch {
    throw new OfficeError("invalid-xml", "Invalid complex-script font classification.", "parse");
  }
  const rtlValue = child("rtl")?.attributes.find(
    (a) => !a.name.namespace && a.name.localName === "val"
  )?.value;
  const directionTokens =
    ns === "http://schemas.openxmlformats.org/drawingml/2006/main"
      ? ["0", "1", "true", "false", "on", "off"]
      : ["0", "1", "true", "false"];
  if (rtlValue !== undefined && !directionTokens.includes(rtlValue))
    throw new OfficeError("invalid-xml", "Invalid run direction.", "parse");
  return {
    eastAsiaFont:
      child("ea")?.attributes.find((a) => !a.name.namespace && a.name.localName === "typeface")
        ?.value ?? null,
    complexScriptFont:
      child("cs")?.attributes.find((a) => !a.name.namespace && a.name.localName === "typeface")
        ?.value ?? null,
    symbolFont:
      child("sym")?.attributes.find((a) => !a.name.namespace && a.name.localName === "typeface")
        ?.value ?? null,
    ...classification,
    alternateLanguage: attribute("altLang"),
    rtl: child("rtl") ? ["1", "true", "on"].includes(rtlValue ?? "0") : null,
    font:
      child("latin")?.attributes.find((a) => !a.name.namespace && a.name.localName === "typeface")
        ?.value ?? null,
    size: numeric("sz", 100),
    language: attribute("lang"),
    bold: boolean("b"),
    italic: boolean("i"),
    underline: attribute("u"),
    strike:
      ({ noStrike: "none", sngStrike: "single", dblStrike: "double" } as Record<string, string>)[
        attribute("strike") ?? ""
      ] ?? attribute("strike"),
    baseline: numeric("baseline", 1000),
    capitalization: attribute("cap"),
    spacing: numeric("spc", 100),
    color: child("solidFill") ? readRunColor(child("solidFill")!) : null,
    highlight: child("highlight") ? readRunColor(child("highlight")!) : null
  };
}
export async function readTextRuns(
  input: BinaryInput,
  options: ReadPresentationTextOptions & { readonly paragraph?: number; readonly run?: number },
  context: SelectionContext
) {
  const { paragraph, run, ...reading } = options;
  for (const value of [paragraph, run])
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) invalid();
  const bodies = await readTextBodies(input, reading, context);
  return bodies.flatMap((body) =>
    body.paragraphs.flatMap((p, paragraphIndex) =>
      paragraph !== undefined && paragraph !== paragraphIndex
        ? []
        : p.inlines
            .filter((n) => ["r", "fld", "br"].includes(n.name.localName))
            .flatMap((node, runIndex) =>
              run !== undefined && run !== runIndex
                ? []
                : [
                    {
                      location: body.segment.location,
                      paragraph: paragraphIndex,
                      run: runIndex,
                      coordinateSystem: "zero-based" as const,
                      formatting: readRunFormatting(node)
                    }
                  ]
            )
    )
  );
}
