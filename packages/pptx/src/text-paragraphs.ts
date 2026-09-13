import { FillFormat } from "./shapes.js";
import { ColorFormat } from "./text-run-color.js";
import { Length, Pt } from "./length.js";
import type { BinaryInput, Location } from "./contracts.js";
import { OfficeError, InvalidHandleError } from "./errors.js";
import { SaxesParser } from "saxes";
import { protectedEquationNodes } from "./equations-compatibility.js";
import {
  readRunFormatting,
  runPropertiesMerge,
  validateTextRunOptions,
  textUnderlineStyles,
  type TextRunFormatting,
  type MSO_TEXT_UNDERLINE_TYPE
} from "./text-runs.js";
import { loadShared } from "./masters.js";
import { SelectionError, type SelectionContext } from "./selectors.js";
import {
  readTextBodies,
  validateTextReadingOptions,
  type ReadPresentationTextOptions
} from "./text-reading.js";
import type { XmlElement, XmlMerge, XmlPart } from "./xml.js";

import { PP_PARAGRAPH_ALIGNMENT } from "./paragraph-alignment.js";
export { PP_PARAGRAPH_ALIGNMENT, PP_ALIGN } from "./paragraph-alignment.js";
export const paragraphAlignments = [
  "left",
  "center",
  "right",
  "justify",
  "distributed",
  "thaiDistributed",
  "justifyLow"
] as const;
export const paragraphNumberingSchemes = [
  "alphaLcParenBoth",
  "alphaUcParenBoth",
  "alphaLcParenR",
  "alphaUcParenR",
  "alphaLcPeriod",
  "alphaUcPeriod",
  "arabicParenBoth",
  "arabicParenR",
  "arabicPeriod",
  "arabicPlain",
  "romanLcParenBoth",
  "romanUcParenBoth",
  "romanLcParenR",
  "romanUcParenR",
  "romanLcPeriod",
  "romanUcPeriod",
  "circleNumDbPlain",
  "circleNumWdBlackPlain",
  "circleNumWdWhitePlain",
  "arabicDbPeriod",
  "arabicDbPlain",
  "ea1ChsPeriod",
  "ea1ChsPlain",
  "ea1ChtPeriod",
  "ea1ChtPlain",
  "ea1JpnChsDbPeriod",
  "ea1JpnKorPlain",
  "ea1JpnKorPeriod",
  "arabic1Minus",
  "arabic2Minus",
  "hebrew2Minus",
  "thaiAlphaPeriod",
  "thaiAlphaParenR",
  "thaiAlphaParenBoth",
  "thaiNumPeriod",
  "thaiNumParenR",
  "thaiNumParenBoth",
  "hindiAlphaPeriod",
  "hindiNumPeriod",
  "hindiNumParenR",
  "hindiAlpha1Period"
] as const;
export interface ParagraphSpacing {
  readonly unit: "pt" | "multiple";
  readonly value: number;
}
export type ParagraphBullet =
  | { readonly kind: "none" }
  | { readonly kind: "character"; readonly character: string }
  | {
      readonly kind: "numbered";
      readonly scheme: (typeof paragraphNumberingSchemes)[number];
      readonly startAt?: number;
    };
export interface ParagraphTab {
  readonly position: number;
  readonly alignment: "left" | "center" | "right" | "decimal";
}
export interface TextParagraphFormatting {
  readonly alignment?:
    | (typeof paragraphAlignments)[number]
    | PP_PARAGRAPH_ALIGNMENT
    | keyof typeof PP_PARAGRAPH_ALIGNMENT
    | null;
  readonly marginLeft?: number | null;
  readonly marginRight?: number | null;
  readonly indent?: number | null;
  readonly defaultTabSize?: number | null;
  readonly lineSpacing?: ParagraphSpacing | null;
  readonly spaceBefore?: number | null;
  readonly spaceAfter?: number | null;
  readonly level?: number | null;
  readonly rtl?: boolean | null;
  readonly bullet?: ParagraphBullet | null;
  readonly tabs?: readonly ParagraphTab[] | null;
}
export interface MutateTextParagraphsOptions
  extends ReadPresentationTextOptions, TextParagraphFormatting {
  readonly paragraph?: number;
  readonly all?: boolean;
  readonly allowEmpty?: boolean;
}
const formatKeys = [
  "alignment",
  "marginLeft",
  "marginRight",
  "indent",
  "defaultTabSize",
  "lineSpacing",
  "spaceBefore",
  "spaceAfter",
  "level",
  "rtl",
  "bullet",
  "tabs"
] as const;
const alignmentTokens = ["l", "ctr", "r", "just", "dist", "thaiDist", "justLow"];
function alignmentIndex(value: NonNullable<TextParagraphFormatting["alignment"]>): number {
  return typeof value === "number"
    ? value - 1
    : (paragraphAlignments as readonly string[]).includes(value)
      ? (paragraphAlignments as readonly string[]).indexOf(value)
      : Number(PP_PARAGRAPH_ALIGNMENT[value as keyof typeof PP_PARAGRAPH_ALIGNMENT]) - 1;
}
function invalid(): never {
  throw new OfficeError("invalid-value", "Invalid paragraph formatting options.", "usage");
}
function object(value: unknown, keys: readonly string[]): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Object.keys(value).every((k) => keys.includes(k))
  );
}
function number(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
export function validateTextParagraphOptions(options: MutateTextParagraphsOptions): void {
  if (
    !object(options, [...formatKeys, "paragraph", "all", "allowEmpty", "scope", "select", "shape"])
  )
    invalid();
  const { scope, select, shape } = options;
  validateTextReadingOptions({
    ...(scope === undefined ? {} : { scope }),
    ...(select === undefined ? {} : { select }),
    ...(shape === undefined ? {} : { shape })
  });
  if (!formatKeys.some((k) => options[k] !== undefined)) invalid();
  if (
    options.paragraph !== undefined &&
    (!Number.isSafeInteger(options.paragraph) || options.paragraph < 0)
  )
    invalid();
  for (const key of ["all", "allowEmpty"] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean") invalid();
  for (const key of ["rtl"] as const)
    if (options[key] != null && typeof options[key] !== "boolean") invalid();
  if (options.alignment != null && !alignmentTokens[alignmentIndex(options.alignment)]) invalid();
  for (const key of ["marginLeft", "marginRight", "indent", "defaultTabSize"] as const)
    if (
      options[key] != null &&
      !number(options[key], key === "indent" ? -51206400 / 12700 : 0, 51206400 / 12700)
    )
      invalid();
  for (const key of ["spaceBefore", "spaceAfter"] as const)
    if (options[key] != null && !number(options[key], 0, 20116800 / 100)) invalid();
  if (options.level != null && (!Number.isInteger(options.level) || !number(options.level, 0, 8)))
    invalid();
  if (options.lineSpacing != null) {
    const s = options.lineSpacing;
    if (
      !object(s, ["unit", "value"]) ||
      !["pt", "multiple"].includes(s.unit) ||
      !number(s.value, 0, s.unit === "pt" ? 201168 : 132)
    )
      invalid();
  }
  if (options.bullet != null) {
    const b = options.bullet;
    if (!object(b, ["kind", "character", "scheme", "startAt"])) invalid();
    if (b.kind === "none") {
      if (Object.keys(b).length !== 1) invalid();
    } else if (b.kind === "character") {
      if (
        Object.keys(b).some((k) => !["kind", "character"].includes(k)) ||
        typeof b.character !== "string" ||
        Array.from(b.character).length !== 1 ||
        b.character.codePointAt(0)! < 32 ||
        (b.character.codePointAt(0)! >= 0xd800 && b.character.codePointAt(0)! <= 0xdfff) ||
        [0xfffe, 0xffff].includes(b.character.codePointAt(0)!)
      )
        invalid();
    } else if (b.kind === "numbered") {
      if (
        Object.keys(b).some((k) => !["kind", "scheme", "startAt"].includes(k)) ||
        !paragraphNumberingSchemes.includes(b.scheme) ||
        (b.startAt !== undefined && (!Number.isInteger(b.startAt) || !number(b.startAt, 1, 32767)))
      )
        invalid();
    } else invalid();
  }
  if (options.tabs != null) {
    if (!Array.isArray(options.tabs) || options.tabs.length > 10000) invalid();
    let previous = -1;
    for (const tab of options.tabs) {
      if (
        !object(tab, ["position", "alignment"]) ||
        !number(tab.position, 0, 51206400 / 12700) ||
        !["left", "center", "right", "decimal"].includes(tab.alignment) ||
        Math.round(tab.position * 12700) <= previous
      )
        invalid();
      previous = Math.round(tab.position * 12700);
    }
  }
}
const sequence = [
  "lnSpc",
  "spcBef",
  "spcAft",
  "buClrTx",
  "buClr",
  "buSzTx",
  "buSzPct",
  "buSzPts",
  "buFontTx",
  "buFont",
  "buNone",
  "buAutoNum",
  "buChar",
  "buBlip",
  "tabLst",
  "defRPr",
  "extLst"
];
export function paragraphPropertiesMerge(
  options: TextParagraphFormatting,
  namespace: string
): XmlMerge {
  const name = (localName: string) => ({ namespace, localName });
  const attributes: NonNullable<XmlMerge["attributes"]>[number][] = [];
  for (const [key, localName] of Object.entries({
    alignment: "algn",
    marginLeft: "marL",
    marginRight: "marR",
    indent: "indent",
    defaultTabSize: "defTabSz",
    level: "lvl",
    rtl: "rtl"
  })) {
    const value = options[key as keyof TextParagraphFormatting];
    if (value === undefined) continue;
    attributes.push({
      namespace: "",
      localName,
      value:
        value === null
          ? null
          : key === "alignment"
            ? alignmentTokens[
                alignmentIndex(value as NonNullable<TextParagraphFormatting["alignment"]>)
              ]!
            : key === "rtl"
              ? value
                ? "1"
                : "0"
              : String(
                  ["marginLeft", "marginRight", "indent", "defaultTabSize"].includes(key)
                    ? Math.sign(Number(value)) * Math.round(Math.abs(Number(value)) * 12700)
                    : value
                )
    });
  }
  const remove: ReturnType<typeof name>[] = [];
  const upsert: NonNullable<XmlMerge["children"]>["upsert"][number][] = [];
  for (const [key, local] of [
    ["lineSpacing", "lnSpc"],
    ["spaceBefore", "spcBef"],
    ["spaceAfter", "spcAft"]
  ] as const) {
    const value = options[key];
    if (value === undefined) continue;
    if (value === null) {
      remove.push(name(local));
      continue;
    }
    const spacing = typeof value === "number" ? { unit: "pt", value } : value;
    const child = spacing.unit === "pt" ? "spcPts" : "spcPct";
    upsert.push({
      name: name(local),
      merge: {
        children: {
          sequence: [name("spcPct"), name("spcPts")],
          remove: [name(child === "spcPts" ? "spcPct" : "spcPts")],
          upsert: [
            {
              name: name(child),
              merge: {
                attributes: [
                  {
                    namespace: "",
                    localName: "val",
                    value: String(
                      Math.round(spacing.value * (spacing.unit === "pt" ? 100 : 100000))
                    )
                  }
                ]
              }
            }
          ]
        }
      }
    });
  }
  if (options.bullet !== undefined) {
    const b = options.bullet;
    const selected =
      b?.kind === "none"
        ? "buNone"
        : b?.kind === "character"
          ? "buChar"
          : b?.kind === "numbered"
            ? "buAutoNum"
            : null;
    remove.push(
      ...["buNone", "buAutoNum", "buChar", "buBlip"].filter((n) => n !== selected).map(name)
    );
    if (b) {
      const local = b.kind === "none" ? "buNone" : b.kind === "character" ? "buChar" : "buAutoNum";
      const values =
        b.kind === "none"
          ? {}
          : b.kind === "character"
            ? { char: b.character }
            : {
                type: b.scheme,
                ...(b.startAt === undefined ? {} : { startAt: String(b.startAt) })
              };
      upsert.push({
        name: name(local),
        merge: {
          attributes: Object.entries(values).map(([localName, value]) => ({
            namespace: "",
            localName,
            value
          }))
        }
      });
    }
  }
  if (options.tabs !== undefined) {
    if (options.tabs === null) remove.push(name("tabLst"));
    else upsert.push({ name: name("tabLst"), merge: {} });
  }
  return { attributes, children: { sequence: sequence.map(name), remove, upsert } };
}
export function applyParagraphFormatting(
  document: XmlPart,
  node: XmlElement,
  options: TextParagraphFormatting
): XmlPart {
  validateTextParagraphOptions(options);
  if (
    node.name.localName !== "p" ||
    ![
      "http://schemas.openxmlformats.org/drawingml/2006/main",
      "http://purl.oclc.org/ooxml/drawingml/main"
    ].includes(node.name.namespace)
  )
    invalid();
  const path: number[] = [];
  function locate(current: XmlElement): boolean {
    if (current === node) return true;
    for (const [i, c] of current.children.entries()) {
      path.push(i);
      if (locate(c)) return true;
      path.pop();
    }
    return false;
  }
  if (!locate(document.root)) invalid();
  const ns = node.name.namespace;
  let result = document;
  if (!node.children.some((n) => n.name.namespace === ns && n.name.localName === "pPr")) {
    result = result.spliceChildren(node, 0, 0, [`<pPr xmlns="${ns}"/>`]);
    node = path.reduce((n, i) => n.children[i]!, result.root);
  }
  result = result.merge(
    node.children.find((n) => n.name.namespace === ns && n.name.localName === "pPr")!,
    paragraphPropertiesMerge(options, ns)
  );
  if (options.tabs != null) {
    const p = path.reduce((n, i) => n.children[i]!, result.root);
    let list = p.children
      .find((n) => n.name.namespace === ns && n.name.localName === "pPr")!
      .children.find((n) => n.name.namespace === ns && n.name.localName === "tabLst")!;
    const tokens = { left: "l", center: "ctr", right: "r", decimal: "dec" };
    const removed = list.children.flatMap((child, index) =>
      child.name.namespace === ns && child.name.localName === "tab" ? [index] : []
    );
    for (const index of removed.reverse()) {
      result = result.spliceChildren(list, index, 1, []);
      list = path
        .reduce((n, i) => n.children[i]!, result.root)
        .children.find((n) => n.name.namespace === ns && n.name.localName === "pPr")!
        .children.find((n) => n.name.namespace === ns && n.name.localName === "tabLst")!;
    }
    result = result.spliceChildren(
      list,
      0,
      0,
      options.tabs.map(
        (t) =>
          `<tab xmlns="${ns}" pos="${Math.round(t.position * 12700)}" algn="${tokens[t.alignment]}"/>`
      )
    );
  }
  return result;
}
export function readParagraphFormatting(paragraph: XmlElement) {
  const ns = paragraph.name.namespace;
  const candidates = paragraph.children.filter(
    (n) => n.name.namespace === ns && n.name.localName === "pPr"
  );
  if (candidates.length > 1)
    throw new OfficeError("invalid-xml", "Ambiguous paragraph properties.", "parse");
  const p = candidates[0];
  const attr = (n: XmlElement | undefined, key: string) =>
    n?.attributes.find((a) => !a.name.namespace && a.name.localName === key)?.value ?? null;
  const child = (key: string) =>
    p?.children.find((n) => n.name.namespace === ns && n.name.localName === key);
  const numeric = (value: string | null, scale: number) => {
    if (value === null) return null;
    if (!value.trim() || !Number.isFinite(Number(value)))
      throw new OfficeError("invalid-xml", "Invalid paragraph number.", "parse");
    return Number(value) / scale;
  };
  const spacing = (key: string): ParagraphSpacing | null => {
    const n = child(key)?.children.find(
      (n) => n.name.namespace === ns && ["spcPts", "spcPct"].includes(n.name.localName)
    );
    if (!n) return null;
    const value = attr(n, "val");
    if (value === null) return null;
    return {
      unit: n.name.localName === "spcPts" ? "pt" : "multiple",
      value:
        n.name.localName === "spcPts"
          ? numeric(value, 100)!
          : value.endsWith("%")
            ? numeric(value.slice(0, -1), 100)!
            : numeric(value, 100000)!
    };
  };
  const bulletNode = p?.children.find(
    (n) =>
      n.name.namespace === ns &&
      ["buNone", "buAutoNum", "buChar", "buBlip"].includes(n.name.localName)
  );
  const bullet =
    bulletNode?.name.localName === "buNone"
      ? { kind: "none" as const }
      : bulletNode?.name.localName === "buChar"
        ? { kind: "character" as const, character: attr(bulletNode, "char") }
        : bulletNode?.name.localName === "buAutoNum"
          ? {
              kind: "numbered" as const,
              scheme: attr(bulletNode, "type"),
              ...(attr(bulletNode, "startAt") === null
                ? {}
                : { startAt: Number(attr(bulletNode, "startAt")) })
            }
          : bulletNode
            ? { kind: "picture" as const }
            : null;
  const before = spacing("spcBef"),
    after = spacing("spcAft");
  const align = attr(p, "algn");
  const rtl = attr(p, "rtl");
  if (rtl !== null && !["0", "1", "false", "true"].includes(rtl))
    throw new OfficeError("invalid-xml", "Invalid paragraph direction.", "parse");
  return {
    alignment:
      align === null ? null : (paragraphAlignments[alignmentTokens.indexOf(align)] ?? align),
    marginLeft: numeric(attr(p, "marL"), 12700),
    marginRight: numeric(attr(p, "marR"), 12700),
    indent: numeric(attr(p, "indent"), 12700),
    defaultTabSize: numeric(attr(p, "defTabSz"), 12700),
    level: numeric(attr(p, "lvl"), 1),
    rtl: rtl === null ? null : ["1", "true"].includes(rtl),
    lineSpacing: spacing("lnSpc"),
    spaceBefore: before?.unit === "pt" ? before.value : null,
    spaceAfter: after?.unit === "pt" ? after.value : null,
    bullet,
    tabs:
      child("tabLst")
        ?.children.filter((n) => n.name.namespace === ns && n.name.localName === "tab")
        .map((n) => ({
          position: numeric(attr(n, "pos"), 12700),
          alignment:
            ({ l: "left", ctr: "center", r: "right", dec: "decimal" } as Record<string, string>)[
              attr(n, "algn") ?? "l"
            ] ?? attr(n, "algn")
        })) ?? null
  };
}
export async function readTextParagraphs(
  input: BinaryInput,
  options: ReadPresentationTextOptions & { readonly paragraph?: number },
  context: SelectionContext
) {
  const { paragraph, ...reading } = options;
  if (paragraph !== undefined && (!Number.isSafeInteger(paragraph) || paragraph < 0)) invalid();
  const bodies = await readTextBodies(input, reading, context);
  return bodies.flatMap((body) =>
    body.paragraphs.flatMap((p, i) =>
      paragraph !== undefined && paragraph !== i
        ? []
        : [
            {
              location: body.segment.location,
              paragraph: i,
              coordinateSystem: "zero-based" as const,
              formatting: readParagraphFormatting(p.node)
            }
          ]
    )
  );
}
export async function mutateTextParagraphs(
  input: BinaryInput,
  options: MutateTextParagraphsOptions,
  context: SelectionContext
): Promise<{
  readonly bytes: Uint8Array;
  readonly affected: number;
  readonly locations: readonly Location[];
}> {
  validateTextParagraphOptions(options);
  if (
    !options.all &&
    options.select === undefined &&
    options.shape === undefined &&
    options.paragraph === undefined
  )
    throw new SelectionError("missing-selection");
  const state = await loadShared(input, context);
  const { scope, select, shape } = options;
  const bodies = await readTextBodies(
    state.source,
    {
      ...(scope === undefined ? {} : { scope }),
      ...(select === undefined ? {} : { select }),
      ...(shape === undefined ? {} : { shape })
    },
    context
  );
  const edits = new Map<string, { document: XmlPart; nodes: Set<XmlElement> }>();
  const locations: Location[] = [];
  let affected = 0;
  for (const body of bodies)
    for (const [i, p] of body.paragraphs.entries()) {
      if (options.paragraph !== undefined && options.paragraph !== i) continue;
      const edit = edits.get(body.part) ?? {
        document: body.document,
        nodes: new Set<XmlElement>()
      };
      if (!edit.nodes.has(p.node)) {
        edit.nodes.add(p.node);
        affected++;
      }
      edits.set(body.part, edit);
      if (!locations.includes(body.segment.location)) locations.push(body.segment.location);
    }
  if (!affected && !options.allowEmpty) throw new SelectionError("missing-selection");
  if (affected > 1 && !options.all) throw new SelectionError("ambiguous-selection");
  for (const [part, edit] of edits) {
    const paths: number[][] = [];
    const visit = (node: XmlElement, path: number[]) => {
      if (edit.nodes.has(node)) paths.push(path);
      node.children.forEach((n, i) => visit(n, [...path, i]));
    };
    visit(edit.document.root, []);
    let document = edit.document;
    for (const path of paths.reverse()) {
      context.signal?.throwIfAborted();
      document = applyParagraphFormatting(
        document,
        path.reduce((n, i) => n.children[i]!, document.root),
        options
      );
    }
    state.save(part, document);
  }
  if (!affected) return { bytes: state.source, affected, locations };
  return { bytes: (await state.finish(state.main, [])).bytes, affected, locations };
}

export class Paragraph {
  #storedXml: XmlPart;
  #binding:
    | {
        readonly read: () => XmlPart;
        readonly write: (xml: XmlPart) => void;
        readonly parent?: unknown;
      }
    | undefined;
  #generation = 0;
  #runs: Run[] = [];
  #font: Font | undefined;
  get #xml(): XmlPart {
    return this.#binding?.read() ?? this.#storedXml;
  }
  set #xml(xml: XmlPart) {
    if (this.#binding) this.#binding.write(xml);
    else this.#storedXml = xml;
  }
  constructor(
    xml: XmlPart,
    binding?: {
      readonly read: () => XmlPart;
      readonly write: (xml: XmlPart) => void;
      readonly parent?: unknown;
    }
  ) {
    if (
      xml.root.name.localName !== "p" ||
      ![
        "http://schemas.openxmlformats.org/drawingml/2006/main",
        "http://purl.oclc.org/ooxml/drawingml/main"
      ].includes(xml.root.name.namespace)
    )
      invalid();
    readParagraphFormatting(xml.root);
    this.#storedXml = xml;
    this.#binding = binding;
  }
  get xml(): XmlPart {
    return this.#xml;
  }
  get parent(): unknown {
    this.#binding?.read();
    return this.#binding?.parent;
  }
  get runs(): readonly Run[] {
    const xml = this.#xml;
    const count = xml.root.children.filter(
      (n) => n.name.namespace === xml.root.name.namespace && n.name.localName === "r"
    ).length;
    const generation = this.#generation;
    for (let i = this.#runs.length; i < count; i++) {
      this.#runs.push(
        new Run({
          parent: this,
          read: () => {
            if (generation !== this.#generation) throw new InvalidHandleError();
            const document = this.#xml;
            const node = document.root.children.filter(
              (n) => n.name.namespace === document.root.name.namespace && n.name.localName === "r"
            )[i];
            if (!node) throw new InvalidHandleError();
            return { document, node };
          },
          write: (xml) => {
            this.#xml = xml;
          }
        })
      );
    }
    return Object.freeze(this.#runs.slice(0, count));
  }
  add_run(): Run {
    const xml = this.#xml;
    const end = xml.root.children.findIndex(
      (n) => n.name.namespace === xml.root.name.namespace && n.name.localName === "endParaRPr"
    );
    this.#xml = xml.spliceChildren(xml.root, end < 0 ? xml.root.children.length : end, 0, [
      `<r xmlns="${xml.root.name.namespace}"><t/></r>`
    ]);
    return this.runs.at(-1)!;
  }
  add_line_break(): void {
    const xml = this.#xml;
    const end = xml.root.children.findIndex(
      (n) => n.name.namespace === xml.root.name.namespace && n.name.localName === "endParaRPr"
    );
    this.#xml = xml.spliceChildren(xml.root, end < 0 ? xml.root.children.length : end, 0, [
      `<br xmlns="${xml.root.name.namespace}"/>`
    ]);
  }
  clear(): this {
    this.#xml = replaceParagraphContent(this.#xml, []);
    this.#generation++;
    this.#runs = [];
    return this;
  }
  get text(): string {
    const xml = this.#xml;
    return xml.root.children
      .filter(
        (n) =>
          n.name.namespace === xml.root.name.namespace &&
          ["r", "br", "fld"].includes(n.name.localName)
      )
      .map((n) => (n.name.localName === "br" ? "\v" : nodeText(xml, n)))
      .join("");
  }
  set text(value: string) {
    if (typeof value !== "string") invalid();
    const ns = this.#xml.root.name.namespace;
    const fragments = value
      .split("\n")
      .join("\v")
      .split("\v")
      .flatMap((piece, index) => [
        ...(index ? [`<br xmlns="${ns}"/>`] : []),
        ...(piece ? [`<r xmlns="${ns}"><t>${escapeModelText(piece)}</t></r>`] : [])
      ]);
    this.#xml = replaceParagraphContent(this.#xml, fragments);
    this.#generation++;
    this.#runs = [];
  }
  get font(): Font {
    let xml = this.#xml;
    const ns = xml.root.name.namespace;
    let properties = xml.root.children.find(
      (n) => n.name.namespace === ns && n.name.localName === "pPr"
    );
    if (!properties) {
      xml = xml.spliceChildren(xml.root, 0, 0, [`<pPr xmlns="${ns}"/>`]);
      properties = xml.root.children[0]!;
    }
    if (
      !properties.children.some((n) => n.name.namespace === ns && n.name.localName === "defRPr")
    ) {
      xml = xml.merge(properties, {
        children: {
          sequence: sequence.map((localName) => ({ namespace: ns, localName })),
          upsert: [{ name: { namespace: ns, localName: "defRPr" }, merge: {} }]
        }
      });
    }
    this.#xml = xml;
    return (this.#font ??= new Font({
      read: () => {
        const document = this.#xml;
        const node = document.root.children
          .find(
            (n) => n.name.namespace === document.root.name.namespace && n.name.localName === "pPr"
          )
          ?.children.find(
            (n) =>
              n.name.namespace === document.root.name.namespace && n.name.localName === "defRPr"
          );
        if (!node) throw new InvalidHandleError();
        return { document, node };
      },
      write: (xml) => {
        this.#xml = xml;
      }
    }));
  }
  get alignment(): PP_PARAGRAPH_ALIGNMENT | null {
    const value = readParagraphFormatting(this.#xml.root).alignment;
    if (value === null) return null;
    const index = (paragraphAlignments as readonly string[]).indexOf(value);
    if (index < 0) throw new OfficeError("invalid-xml", "Unknown paragraph alignment.", "parse");
    return index + 1;
  }
  set alignment(value: PP_PARAGRAPH_ALIGNMENT | null) {
    this.#xml = applyParagraphFormatting(this.#xml, this.#xml.root, { alignment: value });
  }
  get level(): number {
    return readParagraphFormatting(this.#xml.root).level ?? 0;
  }
  set level(value: number) {
    this.#xml = applyParagraphFormatting(this.#xml, this.#xml.root, { level: value });
  }
  get line_spacing(): number | Length | null {
    const value = readParagraphFormatting(this.#xml.root).lineSpacing;
    return value === null ? null : value.unit === "multiple" ? value.value : new Pt(value.value);
  }
  set line_spacing(value: number | Length | null) {
    if (value !== null && typeof value !== "number" && !(value instanceof Length)) invalid();
    this.#xml = applyParagraphFormatting(this.#xml, this.#xml.root, {
      lineSpacing:
        value === null
          ? null
          : typeof value === "number"
            ? { unit: "multiple", value }
            : { unit: "pt", value: value.pt }
    });
  }
  get space_before(): Length | null {
    const value = readParagraphFormatting(this.#xml.root).spaceBefore;
    return value === null ? null : new Pt(value);
  }
  set space_before(value: Length | null) {
    if (value !== null && !(value instanceof Length)) invalid();
    this.#xml = applyParagraphFormatting(this.#xml, this.#xml.root, {
      spaceBefore: value === null ? null : value.pt
    });
  }
  get space_after(): Length | null {
    const value = readParagraphFormatting(this.#xml.root).spaceAfter;
    return value === null ? null : new Pt(value);
  }
  set space_after(value: Length | null) {
    if (value !== null && !(value instanceof Length)) invalid();
    this.#xml = applyParagraphFormatting(this.#xml, this.#xml.root, {
      spaceAfter: value === null ? null : value.pt
    });
  }
}

interface TextNodeBinding {
  readonly read: () => { readonly document: XmlPart; readonly node: XmlElement };
  readonly write: (xml: XmlPart) => void;
}
function nodeText(document: XmlPart, node: XmlElement): string {
  let text = "";
  for (const child of node.children.filter(
    (n) => n.name.namespace === node.name.namespace && n.name.localName === "t"
  )) {
    const parser = new SaxesParser({ xmlns: false });
    parser.on("text", (value) => {
      text += value;
    });
    parser.on("cdata", (value) => {
      text += value;
    });
    parser.write(document.markup(child)).close();
  }
  return text;
}
function escapeModelText(value: string): string {
  return Array.from(value)
    .map((c) => {
      const code = c.codePointAt(0)!;
      if (
        (code < 32 && ![9, 10, 13].includes(code)) ||
        (code >= 0xd800 && code <= 0xdfff) ||
        [0xfffe, 0xffff].includes(code)
      )
        return `_x${code.toString(16).toUpperCase().padStart(4, "0")}_`;
      return c === "&"
        ? "&amp;"
        : c === "<"
          ? "&lt;"
          : c === ">"
            ? "&gt;"
            : c === "\r"
              ? "&#13;"
              : c;
    })
    .join("");
}
function replaceParagraphContent(xml: XmlPart, fragments: readonly string[]): XmlPart {
  if (protectedEquationNodes(xml.root).size)
    throw new OfficeError(
      "unsupported-edit",
      "Whole text replacement cannot remove equations or their fallbacks.",
      "validate-intent"
    );
  const ns = xml.root.name.namespace;
  const indexes = xml.root.children.flatMap((n, i) =>
    n.name.namespace === ns && ["r", "br", "fld"].includes(n.name.localName) ? [i] : []
  );
  let result = xml;
  for (const i of indexes.reverse()) result = result.spliceChildren(result.root, i, 1, []);
  if (fragments.length) {
    const end = result.root.children.findIndex(
      (n) => n.name.namespace === ns && n.name.localName === "endParaRPr"
    );
    result = result.spliceChildren(
      result.root,
      end < 0 ? result.root.children.length : end,
      0,
      fragments
    );
  }
  return result;
}
export class Run {
  readonly #binding: TextNodeBinding & { readonly parent: Paragraph };
  #font: Font | undefined;
  constructor(binding: TextNodeBinding & { readonly parent: Paragraph }) {
    this.#binding = binding;
  }
  get parent(): Paragraph {
    this.#binding.read();
    return this.#binding.parent;
  }
  get text(): string {
    const { document, node } = this.#binding.read();
    return nodeText(document, node);
  }
  set text(value: string) {
    if (typeof value !== "string") invalid();
    const { document, node } = this.#binding.read();
    if (protectedEquationNodes(node).size)
      throw new OfficeError(
        "unsupported-edit",
        "Text replacement cannot remove equations.",
        "validate-intent"
      );
    const texts = node.children.flatMap((n, i) =>
      n.name.namespace === node.name.namespace && n.name.localName === "t" ? [i] : []
    );
    if (texts.length !== 1)
      throw new OfficeError("invalid-xml", "A text run requires one text element.", "parse");
    this.#binding.write(
      document.spliceChildren(node, texts[0]!, 1, [
        `<t xmlns="${node.name.namespace}">${escapeModelText(value)}</t>`
      ])
    );
  }
  get font(): Font {
    const { document, node } = this.#binding.read();
    if (
      !node.children.some(
        (n) => n.name.namespace === node.name.namespace && n.name.localName === "rPr"
      )
    )
      this.#binding.write(
        document.spliceChildren(node, 0, 0, [`<rPr xmlns="${node.name.namespace}"/>`])
      );
    return (this.#font ??= new Font({
      read: () => {
        const { document, node } = this.#binding.read();
        const properties = node.children.find(
          (n) => n.name.namespace === node.name.namespace && n.name.localName === "rPr"
        );
        if (!properties) throw new InvalidHandleError();
        return { document, node: properties };
      },
      write: this.#binding.write
    }));
  }
}
export class Font {
  readonly #binding: TextNodeBinding;
  #color: ColorFormat | undefined;
  #fill: FillFormat | undefined;
  constructor(binding: TextNodeBinding) {
    this.#binding = binding;
  }
  get #format() {
    const { node } = this.#binding.read();
    return readRunFormatting({
      name: { namespace: node.name.namespace, localName: "r" },
      attributes: [],
      children: [{ ...node, name: { namespace: node.name.namespace, localName: "rPr" } }]
    });
  }
  #set(options: TextRunFormatting): void {
    validateTextRunOptions(options);
    const { document, node } = this.#binding.read();
    this.#binding.write(document.merge(node, runPropertiesMerge(options, node.name.namespace)));
  }
  get fill(): FillFormat {
    this.#binding.read();
    return (this.#fill ??= new FillFormat(
      () => {
        const { document, node } = this.#binding.read();
        return document.subtree(node);
      },
      undefined,
      false,
      (transform) => {
        const { document, node } = this.#binding.read();
        this.#binding.write(transform(document, node));
      },
      (node) => node
    ));
  }
  get color(): ColorFormat {
    this.fill.solid();
    const read = () => {
      const { document, node } = this.#binding.read();
      const selected = node.children.find(
        (n) => n.name.namespace === node.name.namespace && n.name.localName === "solidFill"
      );
      if (!selected) throw new InvalidHandleError();
      return document.subtree(selected);
    };
    return (this.#color ??= new ColorFormat(read(), {
      read,
      write: (xml) => {
        const { document, node } = this.#binding.read();
        const index = node.children.findIndex(
          (n) => n.name.namespace === node.name.namespace && n.name.localName === "solidFill"
        );
        if (index < 0) throw new InvalidHandleError();
        this.#binding.write(document.spliceChildren(node, index, 1, [xml.markup(xml.root, true)]));
      }
    }));
  }
  get bold(): boolean | null {
    return this.#format.bold;
  }
  set bold(value: boolean | null) {
    this.#set({ bold: value });
  }
  get italic(): boolean | null {
    return this.#format.italic;
  }
  set italic(value: boolean | null) {
    this.#set({ italic: value });
  }
  get name(): string | null {
    return this.#format.font;
  }
  set name(value: string | null) {
    this.#set({ font: value });
  }
  get size(): Length | null {
    const value = this.#format.size;
    return value === null ? null : new Pt(value);
  }
  set size(value: Length | null) {
    if (value !== null && !(value instanceof Length)) invalid();
    this.#set({ size: value === null ? null : value.pt });
  }
  get underline(): boolean | MSO_TEXT_UNDERLINE_TYPE | null {
    const value = this.#format.underline;
    if (value === null) return null;
    if (value === "none") return false;
    if (value === "sng") return true;
    const index = textUnderlineStyles.indexOf(value as (typeof textUnderlineStyles)[number]);
    if (index < 0) throw new OfficeError("invalid-xml", "Unknown text underline.", "parse");
    return index;
  }
  set underline(value: boolean | MSO_TEXT_UNDERLINE_TYPE | null) {
    this.#set({ underline: value });
  }
}
