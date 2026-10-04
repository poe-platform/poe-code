import {SsconvertError} from "../../contracts.js";
import type {ImportedValue} from "@poe-code/spreadsheet-ast";

const alignments = {GNM_HALIGN_GENERAL: "general", GNM_HALIGN_LEFT: "left", GNM_HALIGN_RIGHT: "right", GNM_HALIGN_CENTER: "center"} as const;
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
const styleDefaults: Readonly<Record<string, AttributeRule>> = {
  HAlign: Object.keys(alignments), VAlign: "GNM_VALIGN_BOTTOM", WrapText: "0", ShrinkToFit: "0",
  Rotation: "0", Shade: ["0", "1"], Indent: "0", Locked: "1", Hidden: "0", Fore: validColor,
  Back: validColor, PatternColor: validColor, Format: "General"
};
const fontDefaults: Readonly<Record<string, AttributeRule>> = {Unit: value => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) > 0, Bold: ["0", "1"], Italic: ["0", "1"], Underline: ["0", "1", "2", "3", "4"], StrikeThrough: "0", Script: "0"};

export interface CellPrintStyle {
  readonly alignment: "general" | "left" | "right" | "center";
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly size: number;
  readonly underline: number;
  readonly foreground: readonly [number, number, number];
  readonly foregroundAlpha: number;
  readonly backgroundAlpha?: number;
  readonly background?: readonly [number, number, number];
}

/** Project the qualified Gnumeric style effects, refusing every unknown effect. */
export function cellPrintStyle(style: Readonly<Record<string, ImportedValue>>, tick: (amount?: number) => void): CellPrintStyle {
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
  if ((node.text as string).trim() !== "" || !Array.isArray(node.children) || node.children.length !== 1) fail();
  // BIFF stores number formats on the cell and has no indent/shrink fields before BIFF8.
  const defaults: Record<string, string> = biff ? { Format: "General", ...(biff.revision === 7 ? { Indent: "0", ShrinkToFit: "0" } : {}) } : {};
  const effects = attributes(node, styleDefaults, defaults);
  const font = record((node.children as readonly ImportedValue[])[0]);
  if (font.name !== "Font" || font.namespace !== "http://www.gnumeric.org/v10.dtd" || typeof font.text !== "string" || !Array.isArray(font.children) || font.children.length) fail();
  tick((font.text as string).length);
  if ((font.text as string).trim() === "") fail();
  const selected = attributes(font, fontDefaults);
  const foreground = colorChannels(effects.Fore!), background = colorChannels(effects.Back!);
  return {alignment: alignments[effects.HAlign as keyof typeof alignments], family: font.text as string, bold: selected.Bold === "1", italic: selected.Italic === "1", size: Number(selected.Unit), underline: Number(selected.Underline),
    foreground: [foreground[0], foreground[1], foreground[2]], foregroundAlpha: foreground[3],
    ...(effects.Shade === "1" ? {background: [background[0], background[1], background[2]] as const, backgroundAlpha: background[3]} : {})};
}
