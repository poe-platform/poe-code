import {SsconvertError} from "../../contracts.js";
import type {ImportedValue} from "@poe-code/spreadsheet-ast";

const alignments = {GNM_HALIGN_GENERAL: "general", GNM_HALIGN_LEFT: "left", GNM_HALIGN_RIGHT: "right", GNM_HALIGN_CENTER: "center", GNM_HALIGN_FILL: "fill", GNM_HALIGN_JUSTIFY: "justify", GNM_HALIGN_DISTRIBUTED: "distributed"} as const;
const verticalAlignments = {GNM_VALIGN_TOP: "top", GNM_VALIGN_BOTTOM: "bottom", GNM_VALIGN_CENTER: "center", GNM_VALIGN_JUSTIFY: "justify", GNM_VALIGN_DISTRIBUTED: "distributed"} as const;
type AttributeRule = string | readonly string[] | ((value: string) => boolean);
function validColor(value: string): boolean {
  const parts = value.split(":");
  return (parts.length === 3 || parts.length === 4) && parts.every(part => part.length > 0 && part.length <= 4 &&
    Array.from(part).every(char => "0123456789abcdefABCDEF".includes(char)));
}
function colorChannels(value: string): readonly [number, number, number, number] {
  const parts = value.split(":").map(part => (Number.parseInt(part, 16) >>> 8) / 255);
  return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
}
// Native transports ShrinkToFit but does not apply it when rendering cells.
const styleDefaults: Readonly<Record<string, AttributeRule>> = {
  HAlign: Object.keys(alignments), VAlign: Object.keys(verticalAlignments), WrapText: ["0", "1"], ShrinkToFit: ["0", "1"],
  Rotation: "0", Shade: ["0", "1"], Indent: value => value.trim() !== "" && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 2147483647, Locked: ["0", "1"], Hidden: ["0", "1"], Fore: validColor,
  Back: validColor, PatternColor: validColor, Format: "General"
};
const fontDefaults: Readonly<Record<string, AttributeRule>> = {Unit: value => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) > 0, Bold: ["0", "1"], Italic: ["0", "1"], Underline: ["0", "1", "2", "3", "4"], StrikeThrough: ["0", "1"], Script: "0"};

export interface CellPrintBorder {
  readonly side: "Top" | "Bottom" | "Left" | "Right" | "Diagonal" | "Rev-Diagonal";
  readonly style: number;
  readonly color: readonly [number, number, number];
  readonly alpha: number;
}
export interface CellPrintStyle {
  readonly borders?: readonly CellPrintBorder[];
  readonly alignment: "general" | "left" | "right" | "center" | "fill" | "justify" | "distributed";
  readonly verticalAlignment: "top" | "bottom" | "center" | "justify" | "distributed";
  readonly family: string;
  readonly wrap?: boolean;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly size: number;
  readonly underline: number;
  readonly indent: number;
  readonly strikeThrough: boolean;
  readonly foreground: readonly [number, number, number];
  readonly foregroundAlpha: number;
  readonly backgroundAlpha?: number;
  readonly background?: readonly [number, number, number];
}

/** Project native defaults or qualified Gnumeric styles, refusing unknown effects. */
export function cellPrintStyle(style: Readonly<Record<string, ImportedValue>> | undefined, tick: (amount?: number) => void): CellPrintStyle {
  if (style === undefined) {
    tick();
    return {alignment: "general", verticalAlignment: "bottom", family: "Sans", bold: false, italic: false,
      size: 10, underline: 0, indent: 0, strikeThrough: false, foreground: [0, 0, 0], foregroundAlpha: 1};
  }
  const fail = (): never => {throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: PDF styled or merged cells");};
  const record = (value: ImportedValue | undefined): Readonly<Record<string, ImportedValue>> => {
    tick();
    if (!value || typeof value !== "object" || Array.isArray(value)) fail();
    return value as Readonly<Record<string, ImportedValue>>;
  };
  const attributes = (node: Readonly<Record<string, ImportedValue>>, expected: Readonly<Record<string, AttributeRule>>, defaults: Readonly<Record<string, string>> = {}) => {
    if (!Array.isArray(node.attributes) || node.attributes.length > Object.keys(expected).length) fail();
    const values: Record<string, string> = Object.create(null);
    for (const value of node.attributes as readonly ImportedValue[]) {
      const a = record(value);
      if (a.namespace !== "" || typeof a.name !== "string" || typeof a.value !== "string") fail();
      const name = a.name as string, text = a.value as string;
      tick(name.length + text.length);
      const accepted = expected[name];
      if (!Object.hasOwn(expected, name) || (typeof accepted === "function" ? !accepted(text) : typeof accepted === "string" ? accepted !== text : !accepted?.includes(text)) || Object.hasOwn(values, name)) fail();
      values[name] = text;
    }
    for (const name of Object.keys(expected)) {
      tick();
      if (!Object.hasOwn(values, name)) {
        if (!Object.hasOwn(defaults, name)) fail();
        values[name] = defaults[name]!;
      }
    }
    return values;
  };
  tick();
  const biff = Object.hasOwn(style, "biff") ? record(style.biff) : undefined;
  if (Object.keys(style).length !== (biff ? 2 : 1) || !Object.hasOwn(style, "gnumeric")) fail();
  if (biff && (Object.keys(biff).length !== 2 || ![7, 8].includes(biff.revision as number) ||
    !Number.isInteger(biff.xf) || Number(biff.xf) < 0 || Number(biff.xf) > 65535)) fail();
  const node = record(style.gnumeric);
  if (node.name !== "Style" || node.namespace !== "http://www.gnumeric.org/v10.dtd" || typeof node.text !== "string") fail();
  tick((node.text as string).length);
  if ((node.text as string).trim() !== "" || !Array.isArray(node.children) || node.children.length > 2) fail();
  // Modern Gnumeric StyleRegions replace earlier regions using native defaults.
  // Keep BIFF's materialized style validation, including its revision-specific omissions.
  const defaults: Record<string, string> = biff
    ? { Format: "General", ...(biff.revision === 7 ? { Indent: "0", ShrinkToFit: "0" } : {}) }
    : {HAlign: "GNM_HALIGN_GENERAL", VAlign: "GNM_VALIGN_BOTTOM", WrapText: "0", ShrinkToFit: "0",
      Rotation: "0", Shade: "0", Indent: "0", Locked: "1", Hidden: "0", Fore: "0:0:0",
      Back: "FFFF:FFFF:FFFF", PatternColor: "0:0:0", Format: "General"};
  const effects = attributes(node, styleDefaults, defaults);
  const fontValues = {Unit: "10", Bold: "0", Italic: "0", Underline: "0", StrikeThrough: "0", Script: "0"};
  let selected: Record<string, string> = fontValues, family = "Sans";
  let child: ImportedValue | undefined;
  const borders: CellPrintBorder[] = [];
  let seenBorder = false;
  for (const item of node.children as readonly ImportedValue[]) {
    const entry = record(item);
    if (entry.name === "Font") {
      if (child !== undefined) fail();
      child = item;
      continue;
    }
    if (entry.name !== "StyleBorder" || seenBorder || entry.namespace !== node.namespace || typeof entry.text !== "string" || (entry.text as string).trim() !== "" || !Array.isArray(entry.children) || entry.children.length > 6) fail();
    tick((entry.text as string).length);
    attributes(entry, {});
    seenBorder = true;
    const seen = new Set<string>();
    for (const item of entry.children as readonly ImportedValue[]) {
      const side = record(item);
      if (typeof side.name !== "string" || !["Top", "Bottom", "Left", "Right", "Diagonal", "Rev-Diagonal"].includes(side.name as string) || side.namespace !== node.namespace || typeof side.text !== "string" || (side.text as string).trim() !== "" || !Array.isArray(side.children) || side.children.length || seen.has(side.name as string)) fail();
      tick((side.text as string).length);
      seen.add(side.name as string);
      const values = attributes(side, {Style: value => value.trim() !== "" && Array.from(value.trim()).every(char => "0123456789".includes(char)) && Number(value) <= 13, Color: validColor}, {Style: "0", Color: "0:0:0"});
      const kind = Number(values.Style);
      if (!kind) continue;
      const color = colorChannels(values.Color!);
      borders.push({side: side.name as CellPrintBorder["side"], style: kind, color: [color[0], color[1], color[2]], alpha: color[3]});
    }
  }
  if (child !== undefined) {
    const font = record(child);
    if (font.name !== "Font" || font.namespace !== "http://www.gnumeric.org/v10.dtd" || typeof font.text !== "string" || !Array.isArray(font.children) || font.children.length) fail();
    const text = font.text as string;
    tick(text.length);
    // A leading dash invokes native legacy X11 font decoding, not a family name.
    if (text.startsWith("-") || (text.length > 0 && text.trim() === "") || (biff && text.length === 0)) fail();
    if (text.length > 0) family = text;
    selected = attributes(font, fontDefaults, biff ? {} : fontValues);
  } else if (biff) fail();
  const foreground = colorChannels(effects.Fore!), background = colorChannels(effects.Back!);
  return {...(borders.length ? {borders} : {}), ...(effects.WrapText === "1" ? {wrap: true} : {}), alignment: alignments[effects.HAlign as keyof typeof alignments], verticalAlignment: verticalAlignments[effects.VAlign as keyof typeof verticalAlignments], family, bold: selected.Bold === "1", italic: selected.Italic === "1", size: Number(selected.Unit), underline: Number(selected.Underline), indent: Number(effects.Indent), strikeThrough: selected.StrikeThrough === "1",
    foreground: [foreground[0], foreground[1], foreground[2]], foregroundAlpha: foreground[3],
    ...(effects.Shade === "1" ? {background: [background[0], background[1], background[2]] as const, backgroundAlpha: background[3]} : {})};
}
