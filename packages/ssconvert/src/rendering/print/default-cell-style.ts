import {SsconvertError} from "../../contracts.js";
import type {ImportedValue} from "../../workbook.js";

const styleDefaults: Readonly<Record<string, string>> = {
  HAlign: "GNM_HALIGN_GENERAL", VAlign: "GNM_VALIGN_BOTTOM", WrapText: "0", ShrinkToFit: "0",
  Rotation: "0", Shade: "0", Indent: "0", Locked: "1", Hidden: "0", Fore: "0:0:0",
  Back: "FFFF:FFFF:FFFF", PatternColor: "0:0:0", Format: "General"
};
const fontDefaults: Readonly<Record<string, string>> = {Unit: "10", Bold: "0", Italic: "0", Underline: "0", StrikeThrough: "0", Script: "0"};

/** Admit a fully materialized neutral Gnumeric style, without dropping unknown effects. */
export function admitDefaultCellPrintStyle(style: Readonly<Record<string, ImportedValue>>, tick: (amount?: number) => void): void {
  const fail = (): never => {throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: PDF styled or merged cells");};
  const record = (value: ImportedValue | undefined): Readonly<Record<string, ImportedValue>> => {
    tick();
    if (!value || typeof value !== "object" || Array.isArray(value)) fail();
    return value as Readonly<Record<string, ImportedValue>>;
  };
  const attributes = (node: Readonly<Record<string, ImportedValue>>, expected: Readonly<Record<string, string>>) => {
    if (!Array.isArray(node.attributes) || node.attributes.length !== Object.keys(expected).length) fail();
    const names = new Set<string>();
    for (const value of node.attributes as readonly ImportedValue[]) {
      const a = record(value);
      if (a.namespace !== "" || typeof a.name !== "string" || typeof a.value !== "string") fail();
      const name = a.name as string, text = a.value as string;
      tick(name.length + text.length);
      if (!Object.hasOwn(expected, name) || expected[name] !== text || names.has(name)) fail();
      names.add(name);
    }
  };
  tick();
  if (Object.keys(style).length !== 1 || !Object.hasOwn(style, "gnumeric")) fail();
  const node = record(style.gnumeric);
  if (node.name !== "Style" || node.namespace !== "http://www.gnumeric.org/v10.dtd" || typeof node.text !== "string") fail();
  tick((node.text as string).length);
  if ((node.text as string).trim() !== "" || !Array.isArray(node.children) || node.children.length !== 1) fail();
  attributes(node, styleDefaults);
  const font = record((node.children as readonly ImportedValue[])[0]);
  if (font.name !== "Font" || font.namespace !== "http://www.gnumeric.org/v10.dtd" || font.text !== "Sans" || !Array.isArray(font.children) || font.children.length) fail();
  attributes(font, fontDefaults);
}
