import {SsconvertError} from "../../contracts.js";
import type {ImportedValue} from "../../workbook.js";

const alignments = {GNM_HALIGN_GENERAL: "general", GNM_HALIGN_LEFT: "left", GNM_HALIGN_RIGHT: "right", GNM_HALIGN_CENTER: "center"} as const;
const styleDefaults: Readonly<Record<string, string | readonly string[]>> = {
  HAlign: Object.keys(alignments), VAlign: "GNM_VALIGN_BOTTOM", WrapText: "0", ShrinkToFit: "0",
  Rotation: "0", Shade: ["0", "1"], Indent: "0", Locked: "1", Hidden: "0", Fore: ["0:0:0", "FFFF:0:0"],
  Back: ["FFFF:FFFF:FFFF", "FFFF:FFFF:0"], PatternColor: "0:0:0", Format: "General"
};
const fontDefaults: Readonly<Record<string, string | readonly string[]>> = {Unit: ["8", "10", "14"], Bold: ["0", "1"], Italic: "0", Underline: "0", StrikeThrough: "0", Script: "0"};

export interface CellPrintStyle {
  readonly alignment: "general" | "left" | "right" | "center";
  readonly bold: boolean;
  readonly size: number;
  readonly foreground: readonly [number, number, number];
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
  const attributes = (node: Readonly<Record<string, ImportedValue>>, expected: Readonly<Record<string, string | readonly string[]>>) => {
    if (!Array.isArray(node.attributes) || node.attributes.length !== Object.keys(expected).length) fail();
    const values: Record<string, string> = Object.create(null);
    for (const value of node.attributes as readonly ImportedValue[]) {
      const a = record(value);
      if (a.namespace !== "" || typeof a.name !== "string" || typeof a.value !== "string") fail();
      const name = a.name as string, text = a.value as string;
      tick(name.length + text.length);
      const accepted = expected[name];
      if (!Object.hasOwn(expected, name) || (typeof accepted === "string" ? accepted !== text : !accepted?.includes(text)) || Object.hasOwn(values, name)) fail();
      values[name] = text;
    }
    return values;
  };
  tick();
  if (Object.keys(style).length !== 1 || !Object.hasOwn(style, "gnumeric")) fail();
  const node = record(style.gnumeric);
  if (node.name !== "Style" || node.namespace !== "http://www.gnumeric.org/v10.dtd" || typeof node.text !== "string") fail();
  tick((node.text as string).length);
  if ((node.text as string).trim() !== "" || !Array.isArray(node.children) || node.children.length !== 1) fail();
  const effects = attributes(node, styleDefaults);
  const font = record((node.children as readonly ImportedValue[])[0]);
  if (font.name !== "Font" || font.namespace !== "http://www.gnumeric.org/v10.dtd" || font.text !== "Sans" || !Array.isArray(font.children) || font.children.length) fail();
  const selected = attributes(font, fontDefaults);
  return {alignment: alignments[effects.HAlign as keyof typeof alignments], bold: selected.Bold === "1", size: Number(selected.Unit),
    foreground: effects.Fore === "FFFF:0:0" ? [1, 0, 0] : [0, 0, 0],
    ...(effects.Shade === "1" ? {background: effects.Back === "FFFF:FFFF:0" ? [1, 1, 0] as const : [1, 1, 1] as const} : {})};
}
