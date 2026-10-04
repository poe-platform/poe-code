import { SsconvertError, type CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { ImportedValue, Sheet, UnsupportedRecord } from "@poe-code/spreadsheet-ast";
import { readXlsxMetadata } from "./xlsx-metadata.js";
import { xlsxNamespaces } from "./xlsx-schema.js";
import { encodeXlsxString } from "@poe-code/spreadsheet-engine/codecs/xlsx-strings";
import { escapeXlsx, metadataNode, type Attributes, type ElementWriter, type MetadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";

// The existing XLSX column-width convention, shared by explicit and default widths.
export const xlsxColumnWidthPoints = (130 / 18.5703125) * (72 / 96);

// OOXML flags deny operations; the workbook model describes allowed operations.
export const xlsxProtectionDefaults = {
  objects: false, scenarios: false, formatCells: true, formatColumns: true, formatRows: true,
  insertColumns: true, insertRows: true, insertHyperlinks: true, deleteColumns: true, deleteRows: true,
  selectLockedCells: false, sort: true, autoFilter: true, pivotTables: true, selectUnlockedCells: false
} as const;

const fields: Readonly<Record<string, readonly string[]>> = {
  sheetPr: ["syncHorizontal", "syncVertical", "syncRef", "transitionEvaluation", "transitionEntry", "published", "codeName", "filterMode", "enableFormatConditionsCalculation"],
  tabColor: ["auto", "indexed", "rgb", "theme", "tint"],
  outlinePr: ["applyStyles", "summaryBelow", "summaryRight", "showOutlineSymbols"],
  pageSetUpPr: ["autoPageBreaks", "fitToPage"],
  sheetFormatPr: ["baseColWidth", "defaultColWidth", "defaultRowHeight", "customHeight", "zeroHeight", "thickTop", "thickBottom", "outlineLevelRow", "outlineLevelCol"],
  sheetProtection: ["password", "algorithmName", "hashValue", "saltValue", "spinCount", "sheet", "objects", "scenarios", "formatCells", "formatColumns", "formatRows", "insertColumns", "insertRows", "insertHyperlinks", "deleteColumns", "deleteRows", "selectLockedCells", "sort", "autoFilter", "pivotTables", "selectUnlockedCells"],
  printOptions: ["headings", "gridLines", "gridLinesSet", "horizontalCentered", "verticalCentered"],
  pageMargins: ["left", "right", "top", "bottom", "header", "footer"],
  pageSetup: ["paperSize", "paperHeight", "paperWidth", "scale", "firstPageNumber", "fitToWidth", "fitToHeight", "pageOrder", "orientation", "usePrinterDefaults", "blackAndWhite", "draft", "cellComments", "useFirstPageNumber", "errors", "horizontalDpi", "verticalDpi", "copies"],
  headerFooter: ["differentOddEven", "differentFirst", "scaleWithDoc", "alignWithMargins"],
  oddHeader: ["xml:space"], oddFooter: ["xml:space"], evenHeader: ["xml:space"], evenFooter: ["xml:space"], firstHeader: ["xml:space"], firstFooter: ["xml:space"],
  rowBreaks: ["count", "manualBreakCount"], colBreaks: ["count", "manualBreakCount"], brk: ["id", "min", "max", "man", "pt"]
};
const children: Readonly<Record<string, readonly string[]>> = {
  sheetPr: ["tabColor", "outlinePr", "pageSetUpPr"],
  headerFooter: ["oddHeader", "oddFooter", "evenHeader", "evenFooter", "firstHeader", "firstFooter"],
  rowBreaks: ["brk"], colBreaks: ["brk"]
};
const biffPrintFlags: Readonly<Record<string, readonly [number, string]>> = {
  PRINTHEADERS: [0x2a, "titles"], PRINTGRIDLINES: [0x2b, "grid"], HCENTER: [0x83, "hcenter"], VCENTER: [0x84, "vcenter"]
};
const biffMargins: Readonly<Record<string, readonly [number, string]>> = {
  LEFT_MARGIN: [0x26, "left"], RIGHT_MARGIN: [0x27, "right"], TOP_MARGIN: [0x28, "top"], BOTTOM_MARGIN: [0x29, "bottom"]
};
const child = (node: MetadataNode | undefined, name: string) => node?.children.find(node => node.name === name);

function header(node: MetadataNode | undefined, fallback: string, charge: (amount?: number) => void): string {
  if (!node) return fallback;
  const codes: Readonly<Record<string, string>> = { PAGE: "P", PAGES: "N", DATE: "D", TIME: "T", TAB: "A", FILE: "F", PATH: "Z" };
  return ["Left", "Middle", "Right"].map((name, index) => {
    const source = node.attributes[name]; if (!source) return "";
    charge(source.length);
    let output = "";
    for (let at = 0; at < source.length; at++) {
      if (source[at] === "&" && source[at + 1] === "[") {
        const end = source.indexOf("]", at + 2), code = codes[source.slice(at + 2, end)];
        if (end >= 0 && code) { output += "&" + code; at = end; continue; }
      }
      output += source[at] === "&" ? "&&" : source[at];
    }
    return "&" + ["L", "C", "R"][index] + output;
  }).join("");
}

/** Preserve native settings, applying only changes to their normalized model. */
export async function writeXlsxSheetSettings(sheet: Sheet,
  records: readonly { readonly record: UnsupportedRecord; readonly node: MetadataNode | undefined }[],
  xml: ElementWriter, context: CapabilityContext, namespace: string, charge: (amount?: number) => void) {
  const handled = new Set<UnsupportedRecord>(), raw = new Map<string, MetadataNode>();
  for (const { record, node } of records) {
    charge();
    if (node && node.name === record.kind && ["sheetPr", "sheetFormatPr", "sheetProtection", "printOptions", "pageMargins", "pageSetup", "headerFooter", "rowBreaks", "colBreaks"].includes(record.kind) &&
      xlsxNamespaces.XL_NS_SS!.includes(node.namespace) && (!raw.has(record.kind) || record.kind === "sheetFormatPr")) {
      const previous = raw.get(record.kind);
      raw.set(record.kind, previous ? { ...node, attributes: { ...previous.attributes, ...node.attributes },
        children: [...previous.children, ...node.children] } : node);
      handled.add(record);
    }
  }
  const node = (name: string, attributes: Attributes = {}, content: readonly MetadataNode[] = [], text = ""): MetadataNode => {
    charge();
    return { name, namespace, attributes: Object.fromEntries(Object.entries(attributes).flatMap(([key, value]) => value === undefined ? [] : [[key, String(value)]])), children: content, text };
  };
  const originalPrint = metadataNode(readXlsxMetadata(node("worksheet", {}, [...raw.values()])).find(record => record.kind === "PrintInformation")?.data, charge);
  const currentPrint = records.find(record => record.record.kind === "PrintInformation")?.node ?? originalPrint;
  function printNodes(pi: MetadataNode | undefined) {
    const firstPage = child(pi, "first_page_number")?.attributes.value;
    const scale = child(pi, "Scale"), margins = child(pi, "Margins"), fitToPage = ["fit", "size_fit"].includes(scale?.attributes.type ?? "");
    const marginAttrs: Record<string, number> = { left: 1, right: 1, top: 120 / 72, bottom: 120 / 72, header: 1, footer: 1 };
    for (const margin of margins?.children ?? []) if (Object.hasOwn(marginAttrs, margin.name)) marginAttrs[margin.name] = Number(margin.attributes.Points) / 72;
    const comments: Readonly<Record<string, string>> = { GNM_PRINT_COMMENTS_IN_PLACE: "asDisplayed", GNM_PRINT_COMMENTS_AT_END: "atEnd", GNM_PRINT_COMMENTS_NONE: "none" };
    const errors: Readonly<Record<string, string>> = { GNM_PRINT_ERRORS_AS_BLANK: "blank", GNM_PRINT_ERRORS_AS_DASHES: "dash", GNM_PRINT_ERRORS_AS_NA: "NA", GNM_PRINT_ERRORS_AS_DISPLAYED: "displayed" };
    const values = [node("sheetPr", {}, [node("pageSetUpPr", { fitToPage: fitToPage ? 1 : 0 })]),
      node("printOptions", {
        headings: Number(child(pi, "titles")?.attributes.value ?? 0) ? 1 : undefined,
        gridLines: Number(child(pi, "grid")?.attributes.value ?? 0) ? 1 : undefined,
        horizontalCentered: Number(child(pi, "hcenter")?.attributes.value ?? 0) ? 1 : undefined,
        verticalCentered: Number(child(pi, "vcenter")?.attributes.value ?? 0) ? 1 : undefined
      }), node("pageMargins", marginAttrs), node("pageSetup", {
        blackAndWhite: Number(child(pi, "monochrome")?.attributes.value ?? 0), cellComments: comments[child(pi, "comments")?.attributes.placement ?? ""] ?? "asDisplayed",
        draft: Number(child(pi, "draft")?.attributes.value ?? 0), errors: errors[child(pi, "errors")?.attributes.PrintErrorsAs ?? ""] ?? "displayed",
        fitToHeight: fitToPage ? Number(scale?.attributes.rows ?? 0) : 0, fitToWidth: fitToPage ? Number(scale?.attributes.cols ?? 0) : 0,
        orientation: child(pi, "orientation")?.text ?? "portrait", pageOrder: child(pi, "order")?.text === "r_then_d" ? "overThenDown" : "downThenOver",
        paperSize: child(pi, "paper")?.text === "na_letter" ? 1 : 9, scale: Number(scale?.attributes.percentage ?? 100), firstPageNumber: firstPage, useFirstPageNumber: firstPage === undefined ? 0 : 1
      }), node("headerFooter", {}, [node("oddHeader", {}, [], encodeXlsxString(header(child(pi, "Header"), "&C&A", charge))), node("oddFooter", {}, [], encodeXlsxString(header(child(pi, "Footer"), "&CPage &P", charge)))])];
    return values;
  }
  const baseline = printNodes(originalPrint), current = printNodes(currentPrint);
  const format = raw.get("sheetFormatPr")?.attributes;
  const originalWidth = Number(format?.defaultColWidth) > 0 ? Number(format!.defaultColWidth) * xlsxColumnWidthPoints
    : Number(format?.baseColWidth) > 0 ? Number(format!.baseColWidth) * xlsxColumnWidthPoints + 3.75 : undefined;
  const defaultColumnWidth = typeof sheet.view?.defaultColumnWidth === "number" ? sheet.view.defaultColumnWidth : originalWidth ?? 48;
  const originalHeight = format?.defaultRowHeight === undefined ? undefined : Number(format.defaultRowHeight);
  const defaultRowHeight = typeof sheet.view?.defaultRowHeight === "number" ? sheet.view.defaultRowHeight : originalHeight ?? 12.75;
  baseline.push(node("sheetFormatPr", { defaultColWidth: originalWidth === undefined ? undefined : originalWidth / xlsxColumnWidthPoints,
    defaultRowHeight: originalHeight ?? 12.75, outlineLevelRow: format?.outlineLevelRow, outlineLevelCol: format?.outlineLevelCol }));
  current.push(node("sheetFormatPr", { defaultColWidth: typeof sheet.view?.defaultColumnWidth === "number" || originalWidth !== undefined || !format ? defaultColumnWidth / xlsxColumnWidthPoints : undefined,
    defaultRowHeight, outlineLevelRow: sheet.rows?.reduce((maximum, row) => { charge(); return Math.max(maximum, row.outlineLevel ?? 0); }, 0) || undefined,
    outlineLevelCol: sheet.columns?.reduce((maximum, column) => { charge(); return Math.max(maximum, column.outlineLevel ?? 0); }, 0) || undefined }));
  // Recognize BIFF records fully represented by editable portable settings.
  // Unknown flag values, zero heights and malformed payloads still need warnings.
  for (const { record } of records) {
    charge();
    if (record.source !== "biff" || !record.data || typeof record.data !== "object" || Array.isArray(record.data)) continue;
    const data = record.data as Readonly<Record<string, ImportedValue>>;
    if (Object.hasOwn(biffPrintFlags, record.kind)) {
      const [opcode, field] = biffPrintFlags[record.kind]!;
      const value = child(currentPrint, field)?.attributes.value;
      if (data.opcode === opcode && (data.bytes === "0000" || data.bytes === "0100") &&
        (value === "0" || value === "1")) handled.add(record);
      continue;
    }
    if (Object.hasOwn(biffMargins, record.kind)) {
      const [opcode, side] = biffMargins[record.kind]!, bytes = data.bytes;
      if (data.opcode !== opcode || typeof bytes !== "string" || bytes.length !== 16) continue;
      charge(16);
      if (![...bytes].every(character => "0123456789abcdefABCDEF".includes(character))) continue;
      const decoded = Uint8Array.from({ length: 8 }, (_, index) => Number.parseInt(bytes.slice(index * 2, index * 2 + 2), 16));
      const original = new DataView(decoded.buffer).getFloat64(0, true);
      const margins = currentPrint?.children.find(node => { charge(); return node.name === "Margins"; });
      const points = margins?.children.find(node => { charge(); return node.name === side; })?.attributes.Points;
      if (Number.isFinite(original * 72) && original >= 0 && points?.trim() &&
        Number.isFinite(Number(points)) && Number(points) >= 0) handled.add(record);
      continue;
    }
    if (typeof sheet.view?.defaultRowHeight !== "number" || !Number.isFinite(defaultRowHeight) || defaultRowHeight <= 0) continue;
    const legacy = record.kind === "DEFAULTROWHEIGHT_v0" && data.opcode === 0x25;
    if (!legacy && !(record.kind === "DEFAULTROWHEIGHT_v2" && data.opcode === 0x225)) continue;
    const bytes = data.bytes;
    if (typeof bytes !== "string" || bytes.length !== (legacy ? 4 : 8) ||
      ![...bytes].every(character => "0123456789abcdefABCDEF".includes(character)) ||
      !legacy && !bytes.startsWith("0000")) continue;
    const at = legacy ? 0 : 4;
    const height = Number.parseInt(bytes.slice(at, at + 2), 16) + 256 * Number.parseInt(bytes.slice(at + 2, at + 4), 16);
    if (height > 0 && (!legacy || height < 0x8000)) handled.add(record);
  }
  const view = sheet.view?.gnumeric && typeof sheet.view.gnumeric === "object" && !Array.isArray(sheet.view.gnumeric) ? sheet.view.gnumeric as Readonly<Record<string, ImportedValue>> : {};
  const protectedValue = raw.get("sheetProtection")?.attributes.sheet;
  const originalProtection = protectedValue === "1" || protectedValue === "true" ? 1 : undefined;
  const protection = { formatCells: 0, formatColumns: 0, formatRows: 0, insertColumns: 0, insertRows: 0, insertHyperlinks: 0,
    deleteColumns: 0, deleteRows: 0, selectLockedCells: 1, sort: 0, autoFilter: 0, pivotTables: 0, selectUnlockedCells: 1 };
  const allowed = sheet.view?.protectedAllow;
  const permissions: Record<string, number> = { ...protection };
  if (allowed !== undefined) {
    if (!allowed || typeof allowed !== "object" || Array.isArray(allowed))
      throw new SsconvertError("unsupported-feature", "Invalid XLSX sheet protection permission settings");
    const values = allowed as Readonly<Record<string, ImportedValue>>;
    for (const name of Object.keys(values)) {
      charge();
      if (!Object.hasOwn(xlsxProtectionDefaults, name) || typeof values[name] !== "boolean")
        throw new SsconvertError("unsupported-feature", "Invalid XLSX sheet protection permission: " + name);
    }
    for (const name of Object.keys(xlsxProtectionDefaults)) {
      charge();
      const value = Object.hasOwn(values, name) ? values[name] : name === "selectLockedCells" || name === "selectUnlockedCells";
      permissions[name] = value ? 0 : 1;
    }
  }
  const originalPermissions: Record<string, number> = { ...protection };
  if (allowed !== undefined && raw.has("sheetProtection")) {
    for (const [name, fallback] of Object.entries(xlsxProtectionDefaults)) {
      charge();
      const value = raw.get("sheetProtection")!.attributes[name];
      originalPermissions[name] = Number(value === undefined ? fallback : value === "1" || value === "true");
    }
  }
  baseline.push(node("sheetProtection", { sheet: originalProtection, ...originalPermissions }));
  current.push(node("sheetProtection", { sheet: view.Protected === undefined ? originalProtection : Number(view.Protected) ? 1 : undefined, ...permissions }));

  function merge(original: MetadataNode | undefined, before: MetadataNode | undefined, after: MetadataNode): MetadataNode {
    charge(); if (!original) return after;
    const attributes = { ...original.attributes };
    for (const name of new Set([...Object.keys(before?.attributes ?? {}), ...Object.keys(after.attributes)])) {
      charge();
      if (before?.attributes[name] !== after.attributes[name]) {
        if (after.attributes[name] === undefined) delete attributes[name]; else attributes[name] = after.attributes[name]!;
      }
    }
    // Break entries use IDs; other admitted child elements occur at most once.
    const key = (value: MetadataNode) => value.name === "brk" ? value.name + ":" + value.attributes.id : value.name;
    const content: MetadataNode[] = [];
    for (const saved of original.children) {
      charge(); const next = after.children.find(n => { charge(); return key(n) === key(saved); }), prior = before?.children.find(n => { charge(); return key(n) === key(saved); });
      if (next) content.push(merge(saved, prior, next)); else if (!prior) content.push(saved);
    }
    for (const next of after.children) {
      charge();
      if (!original.children.some(n => { charge(); return key(n) === key(next); }) && JSON.stringify(before?.children.find(n => { charge(); return key(n) === key(next); })) !== JSON.stringify(next)) content.push(next);
    }
    return { ...original, attributes, text: before?.text === after.text ? original.text : after.text, children: content };
  }
  async function render(value: MetadataNode): Promise<string> {
    charge();
    const attributes: Record<string, string> = {};
    for (const [name, text] of Object.entries(value.attributes)) {
      charge();
      if (fields[value.name]?.includes(name)) attributes[name] = text;
      else await context.diagnostic?.({ code: "xlsx-write-loss", severity: "warning", message: `XLSX writer does not export sheet '${sheet.name}' metadata attribute '${value.name}.${name}'` });
    }
    let content = escapeXlsx(value.text);
    for (const child of value.children) {
      charge();
      if (xlsxNamespaces.XL_NS_SS!.includes(child.namespace) && children[value.name]?.includes(child.name)) content += await render(child);
      else await context.diagnostic?.({ code: "xlsx-write-loss", severity: "warning", message: `XLSX writer does not export sheet '${sheet.name}' metadata element '${value.name}.${child.name}'` });
    }
    return xml(value.name, attributes, content);
  }
  const output = new Map<string, string>();
  for (const value of current) output.set(value.name, await render(merge(raw.get(value.name), baseline.find(n => n.name === value.name), value)));
  return { handled, properties: output.get("sheetPr")!, format: output.get("sheetFormatPr")!, protection: output.get("sheetProtection")!, defaultColumnWidth,
    print: ["printOptions", "pageMargins", "pageSetup", "headerFooter"].map(name => output.get(name) ?? "").join("") };
}
