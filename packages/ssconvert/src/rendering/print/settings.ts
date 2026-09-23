import { SsconvertError, type CapabilityContext } from "../../contracts.js";
import type { ImportedValue, Sheet } from "../../workbook.js";
import type { PrintLayoutRequest } from "./layout.js";
import { type PrintBreak, printWork } from "./pagination.js";

interface PrintNode {
  name: string;
  text: string;
  attributes: Record<string, string>;
  children: PrintNode[];
}

/** Project retained Gnumeric print settings without consulting host preferences. */
export function sheetPrintSettings(sheet: Sheet, context: CapabilityContext) {
  const tick = printWork(context);
  const unsupported = (name: string): never => { throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: PDF print ${name}`); };
  const record = (value: ImportedValue | undefined): Readonly<Record<string, ImportedValue>> | undefined =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, ImportedValue>> : undefined;
  const project = (value: ImportedValue | undefined, depth = 0): PrintNode | undefined => {
    tick();
    if (depth > 16) unsupported("settings depth");
    const data = record(value);
    if (!data || data.namespace !== "http://www.gnumeric.org/v10.dtd" || typeof data.name !== "string" || typeof data.text !== "string") return undefined;
    tick(data.name.length + data.text.length);
    const attributes: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const value of Array.isArray(data.attributes) ? data.attributes : []) {
      tick();
      const attribute = record(value);
      if (attribute?.namespace === "" && typeof attribute.name === "string" && typeof attribute.value === "string") {
        tick(attribute.name.length + attribute.value.length);
        attributes[attribute.name] = attribute.value;
      }
    }
    const children: PrintNode[] = [];
    for (const value of Array.isArray(data.children) ? data.children : []) {
      const child = project(value, depth + 1);
      if (child) children.push(child);
    }
    return { name: data.name, text: data.text, attributes, children };
  };
  const margins = { top: 120, bottom: 120, left: 72, right: 72 };
  let headerPoints = 72, footerPoints = 72, paper: string | undefined;
  let orientation: PrintLayoutRequest["orientation"] = "portrait";
  let scale: PrintLayoutRequest["scale"] = { kind: "percentage", x: 100, y: 100 };
  let rowBreaks: PrintBreak[] = [], columnBreaks: PrintBreak[] = [];
  let centerHorizontally = false, centerVertically = false, acrossThenDown = false, doNotPrint = false;
  const header = { Left: "", Middle: "&[TAB]", Right: "" }, footer = { Left: "", Middle: "Page &[PAGE]", Right: "" };
  for (const retained of sheet.unsupportedRecords ?? []) {
    tick();
    if (retained.kind !== "PrintInformation") continue;
    const root = project(retained.data);
    if (!root || root.name !== "PrintInformation") return unsupported("settings representation");
    for (const node of root.children) {
      tick();
      const a = node.attributes;
      const number = (key: string, fallback: number) => {
        const value = a[key] === undefined || a[key]!.trim() === "" ? fallback : Number(a[key]);
        if (!Number.isFinite(value)) unsupported(`invalid ${node.name}`);
        return value;
      };
      if (node.name === "Margins") {
        for (const margin of node.children) {
          tick();
          const value = Number(margin.attributes.Points);
          if (margin.attributes.Points === undefined || !Number.isFinite(value) || value < 0) continue;
          if (Object.hasOwn(margins, margin.name)) margins[margin.name as keyof typeof margins] = value;
          else if (margin.name === "header") headerPoints = value;
          else if (margin.name === "footer") footerPoints = value;
        }
      } else if (node.name === "paper") paper = node.text;
      else if (node.name === "orientation") orientation = node.text === "landscape" ? "landscape" : "portrait";
      else if (node.name === "Scale") {
        if (a.type === "percentage") { const value = number("percentage", 100); scale = { kind: "percentage", x: value, y: value }; }
        else scale = { kind: "fit", columns: number("cols", 1), rows: number("rows", 1) };
      } else if (node.name === "hcenter") centerHorizontally = number("value", 0) === 1;
      else if (node.name === "vcenter") centerVertically = number("value", 0) === 1;
      else if (node.name === "order") acrossThenDown = node.text === "r_then_d";
      else if (node.name === "do_not_print") doNotPrint = number("value", 0) !== 0;
      else if (node.name === "Header" || node.name === "Footer") {
        const target = node.name === "Header" ? header : footer;
        for (const key of ["Left", "Middle", "Right"] as const) if (a[key] !== undefined) target[key] = a[key];
      } else if (["grid", "titles", "monochrome", "even_if_only_styles", "draft"].includes(node.name)) {
        if (number("value", 0)) unsupported(node.name);
      } else if (node.name === "repeat_top" || node.name === "repeat_left") {
        if (a.value) unsupported(node.name);
      } else if (node.name === "vPageBreaks" || node.name === "hPageBreaks") {
        const breaks: PrintBreak[] = [];
        let previous = -1;
        for (const child of node.children) {
          tick();
          if (child.name !== "break" || child.attributes.pos === undefined) continue;
          const raw = child.attributes.pos;
          tick(raw.length);
          let start = 0;
          while (start < raw.length && " \t\n\r\v\f".includes(raw[start]!)) start++;
          if (raw[start] === "+" || raw[start] === "-") start++;
          if (start === raw.length && raw.length) continue;
          if ([...raw.slice(start)].some(char => char < "0" || char > "9")) continue;
          const position = Number(raw);
          if (!Number.isInteger(position) || position < 0 || position > 2147483647) continue;
          const value = (child.attributes.type ?? "none").toLowerCase();
          const type: PrintBreak["type"] = value === "manual" || value === "auto" || value === "data-slice" ? value : "none";
          if (type === "none" || position <= previous) continue;
          previous = position;
          // Native appends in ascending order before cleaning automatic breaks.
          if (type !== "auto") breaks.push({ position, type });
        }
        if (node.name === "hPageBreaks") rowBreaks = breaks;
        else columnBreaks = breaks;
      } else if (node.name === "comments") {
        if (a.placement && a.placement !== "GNM_PRINT_COMMENTS_IN_PLACE") unsupported("comments");
      } else if (node.name === "errors") {
        if (a.PrintErrorsAs && a.PrintErrorsAs !== "GNM_PRINT_ERRORS_AS_DISPLAYED") unsupported("errors");
      } else if (!["PrintUnit", "print_range", "print-to-uri"].includes(node.name)) unsupported(node.name);
    }
  }
  return { rowBreaks, columnBreaks, margins, headerPoints, footerPoints, header, footer, paper, orientation, scale, centerHorizontally, centerVertically, acrossThenDown, doNotPrint };
}
