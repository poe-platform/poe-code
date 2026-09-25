import type { XmlElement } from "@poe-code/safe-fs/xml";
import { parseA1, formatA1, type ImportedValue, type UnsupportedRecord } from "../workbook.js";
import { SsconvertError } from "../contracts.js";
import { gnumericNumber } from "./gnumeric-number.js";

const gnumericNamespace = "http://www.gnumeric.org/v10.dtd";
function attribute(node: XmlElement | undefined, name: string): string | undefined {
  return node?.attributes.find(a => !a.namespace && a.localName === name)?.value;
}
function element(node: XmlElement | undefined, name: string): XmlElement | undefined {
  return node?.children.find(c => c.localName === name);
}
function numeric(source: string | undefined, fallback: number): number {
  const value = source === undefined ? fallback : Number(source);
  if (!Number.isFinite(value)) throw new SsconvertError("io", "E Invalid XLSX: invalid print number");
  return value;
}
function gnode(name: string, attributes: Readonly<Record<string, string | number>> = {}, children: readonly ImportedValue[] = [], text = ""): ImportedValue {
  return { name, namespace: gnumericNamespace, attributes: Object.entries(attributes).map(([name, value]) => ({ name, namespace: "", value: String(value) })), children, text };
}
function header(source: string): Readonly<Record<string, string>> {
  const sections = { Left: "", Middle: "", Right: "" }; let current: keyof typeof sections = "Left";
  const fields: Readonly<Record<string, string>> = { P: "PAGE", N: "PAGES", D: "DATE", T: "TIME", A: "TAB", F: "FILE", Z: "PATH" };
  for (let at = 0; at < source.length; at++) {
    const c = source[at]!;
    if (c !== "&") { sections[current] += c; continue; }
    const next = source[++at];
    if (next === "L") current = "Left";
    else if (next === "C") current = "Middle";
    else if (next === "R") current = "Right";
    else if (next && fields[next]) sections[current] += `&[${fields[next]}]`;
    else if (next === "&") sections[current] += "&";
    else if (next !== undefined) sections[current] += "&" + next;
    else sections[current] += "&";
  }
  return sections;
}
/** Translate measured print and comment metadata into the existing workbook codec model. */
export function readXlsxMetadata(sheet: XmlElement, comments?: XmlElement): readonly UnsupportedRecord[] {
  const records: UnsupportedRecord[] = [];
  const margins = element(sheet, "pageMargins"), setup = element(sheet, "pageSetup"), hf = element(sheet, "headerFooter");
  const options = element(sheet, "printOptions");
  const rowBreaks = element(sheet, "rowBreaks"), colBreaks = element(sheet, "colBreaks");
  if (margins || setup || hf || rowBreaks || colBreaks || options) {
    const print: ImportedValue[] = [];
    for (const [source, target] of [["headings", "titles"], ["gridLines", "grid"], ["horizontalCentered", "hcenter"], ["verticalCentered", "vcenter"]] as const) {
      const value = attribute(options, source);
      if (value !== undefined) print.push(gnode(target, { value: value === "1" || value === "true" ? 1 : 0 }));
    }
    if (margins) print.push(gnode("Margins", {}, ["top", "bottom", "left", "right", "header", "footer"].flatMap(name => {
      const value = attribute(margins, name);
      return value === undefined ? [] : [gnode(name, { Points: gnumericNumber(numeric(value, 0) * 72, false, 4), PrefUnit: "mm" })];
    })));
    if (setup) {
      const fit = element(element(sheet, "sheetPr"), "pageSetUpPr");
      print.push(attribute(fit, "fitToPage") === "1" || attribute(fit, "fitToPage") === "true"
        ? gnode("Scale", { type: "fit", rows: numeric(attribute(setup, "fitToHeight"), 1), cols: numeric(attribute(setup, "fitToWidth"), 1) })
        : gnode("Scale", { type: "percentage", percentage: numeric(attribute(setup, "scale"), 100) }));
      for (const [source, target] of [["blackAndWhite", "monochrome"], ["draft", "draft"]] as const) {
        const value = attribute(setup, source); if (value !== undefined) print.push(gnode(target, { value: value === "1" || value === "true" ? 1 : 0 }));
      }
      print.push(gnode("order", {}, [], attribute(setup, "pageOrder") === "overThenDown" ? "r_then_d" : "d_then_r"));
      const orientation = attribute(setup, "orientation");
      if (orientation === "portrait" || orientation === "landscape" || orientation === "default") print.push(gnode("orientation", {}, [], orientation === "default" ? "portrait" : orientation));
      // Measured A4 and Letter; other paper codes stay in raw source metadata.
      const paper = attribute(setup, "paperSize");
      if (paper === "9" || paper === "1") print.push(gnode("paper", {}, [], paper === "9" ? "iso_a4" : "na_letter"));
      const commentsPlacement: Readonly<Record<string, string>> = { asDisplayed: "GNM_PRINT_COMMENTS_IN_PLACE", atEnd: "GNM_PRINT_COMMENTS_AT_END", none: "GNM_PRINT_COMMENTS_NONE" };
      const placement = commentsPlacement[attribute(setup, "cellComments") ?? ""];
      if (placement) print.push(gnode("comments", { placement }));
      const errorModes: Readonly<Record<string, string>> = { blank: "GNM_PRINT_ERRORS_AS_BLANK", dash: "GNM_PRINT_ERRORS_AS_DASHES", NA: "GNM_PRINT_ERRORS_AS_NA", displayed: "GNM_PRINT_ERRORS_AS_DISPLAYED" };
      const errors = errorModes[attribute(setup, "errors") ?? ""];
      if (errors) print.push(gnode("errors", { PrintErrorsAs: errors }));
    }
    for (const [source, target] of [["oddHeader", "Header"], ["oddFooter", "Footer"]] as const) {
      const value = element(hf, source); if (value) print.push(gnode(target, header(value.text)));
    }
    for (const [source, name] of [[rowBreaks, "vPageBreaks"], [colBreaks, "hPageBreaks"]] as const) if (source) {
      const breaks = source.children.filter(c => c.localName === "brk").map(node => gnode("break", {
        pos: numeric(attribute(node, "id"), 0), type: attribute(node, "pt") === "1" ? "data-slice" : attribute(node, "man") === "1" ? "manual" : "auto" }));
      print.push(gnode(name, { count: breaks.length }, breaks));
    }
    records.push({ source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained", data: gnode("PrintInformation", {}, print) });
  }
  if (comments) {
    const authors = element(comments, "authors")?.children.filter(c => c.localName === "author").map(c => c.text.trimEnd()) ?? [];
    const objects: ImportedValue[] = [];
    for (const comment of element(comments, "commentList")?.children ?? []) {
      if (comment.localName !== "comment") continue;
      const ref = attribute(comment, "ref"); if (!ref) continue;
      const author = authors[numeric(attribute(comment, "authorId"), 0)];
      const text = element(comment, "text"); let value = "";
      for (const node of text?.children ?? []) if (node.localName === "t") value += node.text;
        else if (node.localName === "r") value += element(node, "t")?.text ?? "";
      objects.push(gnode("CellComment", { ObjectBound: ref.split(":")[0]!, ObjectOffset: "1 0 1 0", Direction: 17, Print: 1,
        ...(author ? { Author: author } : {}), Text: value }));
    }
    records.push({ source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: gnode("Objects", {}, objects) });
  }
  const filter = element(sheet, "autoFilter");
  const area = attribute(filter, "ref");
  if (filter && area) {
    const fields: ImportedValue[] = [];
    const operators: Readonly<Record<string, string>> = { equal: "eq", notEqual: "ne", greaterThan: "gt", greaterThanOrEqual: "gte", lessThan: "lt", lessThanOrEqual: "lte" };
    for (const column of filter.children.filter(c => c.localName === "filterColumn")) {
      let field: ImportedValue | undefined;
      const index = numeric(attribute(column, "colId"), 0);
      for (const node of column.children) {
        if (node.localName === "customFilters") for (const custom of node.children.filter(c => c.localName === "customFilter")) {
          const value = attribute(custom, "val") ?? ""; const parsed = value.trim() ? Number(value) : NaN;
          // Released Gnumeric's XML writer reverses Value and ValueType attributes.
          field = gnode("Field", { Index: index, Type: "expr", Op0: operators[attribute(custom, "operator") ?? "equal"] ?? "eq",
            Value0: Number.isFinite(parsed) ? 40 : 60, ValueType0: Number.isFinite(parsed) ? String(parsed) : value });
        }
        else if (node.localName === "top10") field = gnode("Field", { Index: index, Type: "bucket",
          top: attribute(node, "top") === "0" || attribute(node, "top") === "false" ? 0 : 1,
          items: attribute(node, "percent") === "1" || attribute(node, "percent") === "true" ? 0 : 1,
          rel_range: 0, count: numeric(attribute(node, "val"), -1) });
      }
      if (field) fields.push(field);
    }
    records.push({ source: "Gnumeric_XmlIO:sax", kind: "Filters", disposition: "retained",
      data: gnode("Filters", {}, [gnode("Filter", { Area: area }, fields)]) });
  }
  const view = element(element(sheet, "sheetViews"), "sheetView");
  if (view) {
    const topLeft = attribute(view, "topLeftCell") ?? "A1";
    const pane = element(view, "pane");
    const layout: ImportedValue[] = [];
    if (pane && attribute(pane, "state") === "frozen") {
      const position = parseA1(topLeft);
      layout.push(gnode("FreezePanes", { FrozenTopLeft: topLeft, UnfrozenTopLeft: formatA1(
        position.row + numeric(attribute(pane, "ySplit"), 0), position.column + numeric(attribute(pane, "xSplit"), 0)) }));
    }
    records.push({ source: "Gnumeric_XmlIO:sax", kind: "SheetLayout", disposition: "retained",
      data: gnode("SheetLayout", { TopLeft: pane && attribute(pane, "state") === "frozen" ? attribute(pane, "topLeftCell") ?? topLeft : topLeft }, layout) });
  }
  return records;
}
