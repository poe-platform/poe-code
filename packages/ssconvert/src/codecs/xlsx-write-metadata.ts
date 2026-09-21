import type { CapabilityContext } from "../contracts.js";
import { parseA1, formatA1, type Sheet, type Workbook } from "../workbook.js";
import { SsconvertError } from "../contracts.js";
import type { createXlsxStyles } from "./xlsx-write-styles.js";
import { escapeXlsx, metadataNode, type ElementWriter, type MetadataNode } from "./xlsx-write-support.js";
import { gnumericNumber } from "./gnumeric-number.js";

function child(node: MetadataNode | undefined, name: string): MetadataNode | undefined { return node?.children.find(n => n.name === name); }
function header(node: MetadataNode | undefined, fallback: string): string {
  if (!node) return fallback;
  const codes: Readonly<Record<string, string>> = { PAGE: "P", PAGES: "N", DATE: "D", TIME: "T", TAB: "A", FILE: "F", PATH: "Z" };
  const text = ["Left", "Middle", "Right"].map((name, index) => {
    const source = node.attributes[name]; if (!source) return "";
    let output = "";
    for (let at = 0; at < source.length; at++) {
      if (source[at] === "&" && source[at + 1] === "[") {
        const end = source.indexOf("]", at + 2); const code = codes[source.slice(at + 2, end)];
        if (end >= 0 && code) { output += "&" + code; at = end; continue; }
      }
      output += source[at] === "&" ? "&&" : source[at];
    }
    return "&" + ["L", "C", "R"][index] + output;
  }).join("");
  return text;
}
export async function writeXlsxSheetMetadata(sheet: Sheet, number: number, xml: ElementWriter, context: CapabilityContext, namespace: string,
  formula: (source: string, sheet: Sheet, row: number, column: number, context: CapabilityContext) => string,
  styles: ReturnType<typeof createXlsxStyles>, charge: (amount?: number) => void) {
  const records = (sheet.unsupportedRecords ?? []).map(record => ({ record, node: metadataNode(record.data, charge) }));
  const pi = records.find(r => r.record.kind === "PrintInformation")?.node;
  const scale = child(pi, "Scale"), margins = child(pi, "Margins");
  const fitToPage = scale?.attributes.type === "fit";
  const marginAttrs: Record<string, number> = { left: 1, right: 1, top: 120 / 72, bottom: 120 / 72, header: 1, footer: 1 };
  for (const node of margins?.children ?? []) if (node.name in marginAttrs) marginAttrs[node.name] = Number(node.attributes.Points) / 72;
  const comments: Readonly<Record<string, string>> = { GNM_PRINT_COMMENTS_IN_PLACE: "asDisplayed", GNM_PRINT_COMMENTS_AT_END: "atEnd", GNM_PRINT_COMMENTS_NONE: "none" };
  const errors: Readonly<Record<string, string>> = { GNM_PRINT_ERRORS_AS_BLANK: "blank", GNM_PRINT_ERRORS_AS_DASHES: "dash", GNM_PRINT_ERRORS_AS_NA: "NA", GNM_PRINT_ERRORS_AS_DISPLAYED: "displayed" };
  let print = xml("printOptions") + xml("pageMargins", marginAttrs) + xml("pageSetup", {
    blackAndWhite: Number(child(pi, "monochrome")?.attributes.value ?? 0), cellComments: comments[child(pi, "comments")?.attributes.placement ?? ""] ?? "asDisplayed",
    draft: Number(child(pi, "draft")?.attributes.value ?? 0), errors: errors[child(pi, "errors")?.attributes.PrintErrorsAs ?? ""] ?? "displayed",
    fitToHeight: fitToPage ? Number(scale?.attributes.rows ?? 0) : 0, fitToWidth: fitToPage ? Number(scale?.attributes.cols ?? 0) : 0,
    orientation: child(pi, "orientation")?.text ?? "portrait", pageOrder: child(pi, "order")?.text === "r_then_d" ? "overThenDown" : "downThenOver",
    paperSize: child(pi, "paper")?.text === "na_letter" ? 1 : 9, scale: Number(scale?.attributes.percentage ?? 100), useFirstPageNumber: 0 }) +
    xml("headerFooter", {}, xml("oddHeader", {}, escapeXlsx(header(child(pi, "Header"), "&C&A"))) + xml("oddFooter", {}, escapeXlsx(header(child(pi, "Footer"), "&CPage &P"))));
  for (const [gnm, name, max] of [["vPageBreaks", "rowBreaks", 16383], ["hPageBreaks", "colBreaks", 1048575]] as const) {
    const breaks = child(pi, gnm); if (breaks) print += xml(name, { count: breaks.children.length }, breaks.children.map(b => xml("brk", {
      id: Number(b.attributes.pos), max, man: b.attributes.type === "manual" ? 1 : undefined, pt: b.attributes.type === "data-slice" ? 1 : undefined })).join(""));
  }
  let filters = "", rules = "";
  const parts: { name: string; content: string; type: string; relation: string }[] = [];
  const handled = new Set(["PrintInformation", "SheetLayout", "Styles"]);
  const render = (node: MetadataNode): string => {
    charge();
    if (node.namespace !== namespace || Object.keys(node.attributes).some(name => name === "xmlns" || name.includes(":") && name !== "xml:space"))
      throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: XLSX metadata namespace or relationship");
    return xml(node.name, node.attributes, escapeXlsx(node.text) + node.children.map(render).join(""));
  };
  const rawFilter = records.find(r => r.record.kind === "autoFilter")?.node;
  if (rawFilter) filters = render(rawFilter);
  else {
    let selected = false;
    const operators = new Map([["eq", "equal"], ["ne", "notEqual"], ["gt", "greaterThan"], ["gte", "greaterThanOrEqual"], ["lt", "lessThan"], ["lte", "lessThanOrEqual"]]);
    const boolean = (value: string | undefined, fallback: boolean) => value === undefined ? fallback : value !== "0" && value.toLowerCase() !== "false";
    for (const { node, record } of records) if (record.kind === "Filters") {
      handled.add("Filters");
      for (const filter of node?.children ?? []) {
        charge();
        if (selected) {
          await context.diagnostic?.({ code: "xlsx-write-loss", severity: "warning", message: `XLSX writer does not export sheet '${sheet.name}' additional filter '${filter.attributes.Area ?? ""}'` });
          continue;
        }
        selected = true;
        const area = filter.attributes.Area ?? "", endpoints = area.split(":");
        if (endpoints.length > 2) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: XLSX filter area");
        const first = parseA1(endpoints[0]!), last = parseA1(endpoints[1] ?? endpoints[0]!);
        const width = Math.abs(last.column - first.column) + 1;
        const fields = new Map<number, MetadataNode>();
        for (const field of filter.children) { charge(); fields.set(Number(field.attributes.Index ?? 0), field); }
        let columns = "";
        for (const [index, field] of [...fields].sort((a, b) => { charge(); return a[0] - b[0]; })) {
          charge(); const a = field.attributes, type = a.Type?.toLowerCase(); let content = "", warned = false;
          if (Number.isSafeInteger(index) && index >= 0 && index < width) {
            if (type === "bucket") {
              const items = boolean(a.items, true), relative = boolean(a.rel_range, true), count = Number(a.count ?? 10);
              if (Number.isFinite(count) && (items || relative)) content = xml("top10", {
                val: gnumericNumber(Math.max(0, Math.min(items ? 1000000000 : 100, items ? Math.floor(count) : count))),
                top: boolean(a.top, true) ? undefined : 0, percent: items ? undefined : 1 });
            } else if (type === "blanks") content = xml("filters", { blank: 1 });
            // The native XML reader recognizes noblanks; its own writer spells nonblanks.
            else if (type === "noblanks") content = xml("customFilters", {}, xml("customFilter", { operator: "notEqual", val: " " }));
            else if (type === "expr") {
              const expressions: string[] = [];
              for (const suffix of ["0", "1"]) {
                charge(); const operator = operators.get(a["Op" + suffix]?.toLowerCase() ?? ""), code = a["Value" + suffix];
                // Native Gnumeric XML intentionally stores type in ValueN and text in ValueTypeN.
                const source = a["ValueType" + suffix]; let value: string | undefined;
                if (operator && source !== undefined) {
                  if (code === "60") value = source;
                  else if ((code === "30" || code === "40") && source.trim() && Number.isFinite(Number(source))) value = gnumericNumber(Number(source));
                  else if (code === "20" && ["TRUE", "FALSE"].includes(source.toUpperCase())) value = source.toUpperCase();
                  else if (code === "50" && ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"].includes(source)) value = source;
                }
                if (value !== undefined) expressions.push(xml("customFilter", { operator, val: value }));
                else if (suffix === "0" || a.Op1 !== undefined || a.Value1 !== undefined || a.ValueType1 !== undefined) {
                  await context.diagnostic?.({ code: "xlsx-write-loss", severity: "warning", message: `XLSX writer does not export sheet '${sheet.name}' filter field '${index}' expression '${suffix}'` });
                  warned = true;
                  if (suffix === "0") break;
                }
              }
              // The native OOXML writer emits and=true for every dual condition, ignoring IsAnd.
              if (expressions.length && operators.has(a.Op0?.toLowerCase() ?? "")) content = xml("customFilters", { and: expressions.length > 1 ? "true" : undefined }, expressions.join(""));
            }
          }
          if (content) columns += xml("filterColumn", { colId: index }, content);
          else if (!warned) await context.diagnostic?.({ code: "xlsx-write-loss", severity: "warning", message: `XLSX writer does not export sheet '${sheet.name}' filter field '${a.Index ?? "0"}' type '${a.Type ?? ""}'` });
        }
        filters = xml("autoFilter", { ref: filter.attributes.Area }, columns);
      }
    }
  }
  const objects = records.find(r => r.record.kind === "Objects")?.node;
  if (objects) {
    const comments = objects.children.filter(n => n.name === "CellComment" || n.name === "GnmCellComment");
    const authors = [...new Set(comments.flatMap(n => n.attributes.Author === undefined ? [] : [n.attributes.Author]))];
    if (comments.length) parts.push({ name: `comments${number}.xml`, relation: "comments", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml",
      content: xml("comments", { xmlns: namespace }, xml("authors", {}, authors.map(a => xml("author", {}, escapeXlsx(a))).join("")) + xml("commentList", {}, comments.map(comment =>
        xml("comment", { ref: comment.attributes.ObjectBound?.split(":")[0] ?? "A1", authorId: comment.attributes.Author === undefined ? undefined : authors.indexOf(comment.attributes.Author) },
          xml("text", {}, xml("t", {}, escapeXlsx(comment.attributes.Text ?? ""))))).join(""))) });
    if (comments.length) parts.push({ name: `drawings/vmlDrawing${number}.vml`, relation: "vmlDrawing", type: "application/vnd.openxmlformats-officedocument.vmlDrawing",
      content: xml("xml", { "xmlns:v": "urn:schemas-microsoft-com:vml", "xmlns:o": "urn:schemas-microsoft-com:office:office", "xmlns:x": "urn:schemas-microsoft-com:office:excel" },
        xml("v:shapetype", { id: "#_x0000_t201" }) + comments.map((comment, index) => {
          const position = parseA1(comment.attributes.ObjectBound?.split(":")[0] ?? "A1");
          return xml("v:shape", { type: "#_x0000_t202", fillcolor: "#ffffc0", style: `position:absolute;margin-left:${((position.column + 1) * 48).toFixed(2)}pt;margin-top:${(position.row * 12.75).toFixed(2)}pt;width:0.00pt;height:0.00pt;z-index:${index + 1};visibility:hidden;` },
            xml("x:ClientData", { ObjectType: "Note" }, xml("x:Anchor", {}, `${position.column + 1}, 15, ${position.row}, 10, ${position.column + 3}, 15, ${position.row + 4}, 4`) + xml("x:MoveWithCells") + xml("x:SizeWithCells") + xml("x:AutoFill", {}, "False") +
              xml("x:Row", {}, String(position.row)) + xml("x:Column", {}, String(position.column))));
        }).join("")) });
    if (objects.children.every(n => ["CellComment", "GnmCellComment"].includes(n.name))) handled.add("Objects");
  }
  const regions = records.find(r => r.record.kind === "Styles")?.node?.children ?? [];
  let validations = ""; let validationCount = 0;
  for (const region of regions) {
    charge(); const a = region.attributes, style = child(region, "Style");
    const row = Number(a.startRow), column = Number(a.startCol);
    const ref = formatA1(row, column) + (a.startRow === a.endRow && a.startCol === a.endCol ? "" : ":" + formatA1(Number(a.endRow), Number(a.endCol)));
    const validation = child(style, "Validation"), input = child(style, "InputMessage");
    if (validation || input) {
      const v = validation?.attributes ?? {};
      const typeNames: Readonly<Record<string, string>> = { AS_INT: "whole", AS_NUMBER: "decimal", IN_LIST: "list", AS_DATE: "date", AS_TIME: "time", TEXT_LENGTH: "textLength", CUSTOM: "custom" };
      const opNames: Readonly<Record<string, string>> = { NOT_BETWEEN: "notBetween", EQUAL: "equal", NOT_EQUAL: "notEqual", LT: "lessThan", GT: "greaterThan", LTE: "lessThanOrEqual", GTE: "greaterThanOrEqual" };
      const typeKey = (v.Type ?? "").slice("GNM_VALIDATION_TYPE_".length), opKey = (v.Operator ?? "").slice("GNM_VALIDATION_OP_".length);
      if (validation && (!Object.hasOwn(typeNames, typeKey) && typeKey !== "ANY" || !Object.hasOwn(opNames, opKey) && !["", "BETWEEN", "NONE"].includes(opKey)))
        await context.diagnostic?.({ code: "xlsx-write-loss", severity: "warning", message: `XLSX writer does not export sheet '${sheet.name}' validation type/operator '${typeKey}/${opKey}'` });
      let content = "";
      for (const [source, target] of [["Expression0", "formula1"], ["Expression1", "formula2"]] as const) {
        const expr = child(validation, source); if (expr) content += xml(target, {}, escapeXlsx(formula(expr.text, sheet, row, column, context)));
      }
      validations += xml("dataValidation", { type: Object.hasOwn(typeNames, typeKey) ? typeNames[typeKey] : undefined,
        operator: Object.hasOwn(opNames, opKey) ? opNames[opKey] : undefined, errorStyle: v.Style?.endsWith("WARNING") ? "warning" : v.Style?.endsWith("INFO") ? "information" : undefined,
        allowBlank: v.AllowBlank === "1" ? 1 : undefined, showDropDown: validation ? v.UseDropdown === "1" ? 0 : 1 : undefined,
        errorTitle: v.Title, error: v.Message, showInputMessage: 1, showErrorMessage: 1, promptTitle: input?.attributes.Title, prompt: input?.attributes.Message, sqref: ref }, content);
      validationCount++;
    }
    const conditions = style?.children.filter(n => n.name === "Condition") ?? [];
    let cf = "";
    for (const condition of conditions) {
      const op = Number(condition.attributes.Operator), overlay = child(condition, "Style");
      if (op < 0 || op > 8 || !overlay) {
        await context.diagnostic?.({ code: "xlsx-write-loss", severity: "warning", message: `XLSX writer does not export sheet '${sheet.name}' conditional operator '${op}'` }); continue;
      }
      const operators = ["between", "notBetween", "equal", "notEqual", "greaterThan", "lessThan", "greaterThanOrEqual", "lessThanOrEqual"];
      const missing = Object.keys(overlay.attributes).filter(key => !["Back", "Shade", "Fore"].includes(key));
      for (const node of overlay.children) {
        if (node.name !== "Font") missing.push(node.name);
        else for (const key of Object.keys(node.attributes)) if (!["Bold", "Italic", "Unit"].includes(key)) missing.push("Font." + key);
      }
      if (missing.length) await context.diagnostic?.({ code: "xlsx-write-loss", severity: "warning",
        message: `XLSX writer does not export sheet '${sheet.name}' differential style fields '${missing.join(", ")}'` });
      let content = "";
      for (const source of op < 2 ? ["Expression0", "Expression1"] : ["Expression0"]) {
        const expr = child(condition, source); if (expr) content += xml("formula", {}, escapeXlsx(formula(expr.text, sheet, row, column, context)));
      }
      cf += xml("cfRule", { type: op === 8 ? "expression" : "cellIs", dxfId: styles.differential(overlay), priority: 1, stopIfTrue: 1, operator: operators[op] }, content);
    }
    if (cf) rules += xml("conditionalFormatting", { sqref: ref }, cf);
  }
  if (validationCount) rules += xml("dataValidations", { count: validationCount }, validations);
  for (const { record, node } of records) {
    context.signal.throwIfAborted();
    if (handled.has(record.kind) || record.kind === "autoFilter") continue;
    if (record.source === "Gnumeric_XmlIO:sax" && (record.kind === "Rows" && sheet.rows !== undefined || record.kind === "Cols" && sheet.columns !== undefined)) continue;
    if (node?.namespace === namespace && record.kind === "dataValidations") { rules += render(node); continue; }
    // Retained relationship IDs cannot be copied into a new package without their targets.
    await context.diagnostic?.({ code: "xlsx-write-loss", severity: "warning", message: `XLSX writer does not export sheet '${sheet.name}' record '${record.kind}'` });
  }
  // Gnumeric styles may carry imperative metadata; warn instead of losing it silently.
  for (const cell of regions.length ? [] : sheet.cells) {
    const style = metadataNode(cell.style?.gnumeric, charge);
    for (const node of style?.children ?? []) if (["Validation", "Condition", "Conditions", "InputMessage"].includes(node.name)) {
      await context.diagnostic?.({ code: "xlsx-write-loss", severity: "warning", message: `XLSX writer does not export sheet '${sheet.name}' style '${node.name}'` });
    }
  }
  return { filters, rules, print, fitToPage, parts };
}
export function writeXlsxProperties(book: Workbook, xml: ElementWriter) {
  const vt = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes";
  const coreFields: Readonly<Record<string, string>> = { "dc:title": "dc:title", "dc:subject": "dc:subject", "dc:description": "dc:description", "meta:initial-creator": "dc:creator",
    "dc:language": "dc:language", "dc:creator": "cp:lastModifiedBy", "meta:print-date": "cp:lastPrinted", "meta:creation-date": "dcterms:created", "dc:date": "dcterms:modified", "meta:editing-cycles": "cp:revision",
    "gsf:category": "cp:category", "cp:contentStatus": "cp:contentStatus", "cp:contentType": "cp:contentType", "dc:keywords": "cp:keywords", "cp:version": "cp:version", "dc:identifier": "dc:identifier" };
  const extendedFields: Readonly<Record<string, readonly [string, "text" | "int" | "bool" | "duration"]>> = {
    "meta:template": ["Template", "text"], "gsf:manager": ["Manager", "text"], "dc:publisher": ["Company", "text"],
    "gsf:page-count": ["Pages", "int"], "gsf:word-count": ["Words", "int"], "gsf:character-count": ["Characters", "int"],
    "gsf:presentation-format": ["PresentationFormat", "text"], "gsf:line-count": ["Lines", "int"], "gsf:paragraph-count": ["Paragraphs", "int"],
    "gsf:slide-count": ["Slides", "int"], "gsf:note-count": ["Notes", "int"], "meta:editing-duration": ["TotalTime", "duration"],
    "gsf:hidden-slide-count": ["HiddenSlides", "int"], "xlsx:MMClips": ["MMClips", "text"], "gsf:scale": ["ScaleCrop", "bool"],
    "gsf:links-dirty": ["LinksUpToDate", "bool"], "gsf:byte-count": ["CharactersWithSpaces", "int"], "xlsx:SharedDoc": ["SharedDoc", "bool"],
    "xlsx:HyperlinkBase": ["HyperlinkBase", "text"], "xlsx:HyperlinksChanged": ["HyperlinksChanged", "bool"], "gsf:security": ["DocSecurity", "int"] };
  const encoder = new TextEncoder();
  const sorted = Object.entries(book.properties ?? {}).map(([key, value]) => ({ key, value, bytes: encoder.encode(key) })).sort((a, b) => {
    for (let index = 0; index < Math.min(a.bytes.length, b.bytes.length); index++) {
      const diff = a.bytes[index]! - b.bytes[index]!; if (diff) return diff;
    }
    return a.bytes.length - b.bytes.length;
  });
  let coreContent = "", extendedContent = "", customContent = "", pid = 29;
  const exportedKeys = new Set<string>();
  for (const { key, value } of sorted) {
    const core = Object.hasOwn(coreFields, key) ? coreFields[key] : undefined;
    const extended = Object.hasOwn(extendedFields, key) ? extendedFields[key] : undefined;
    if (core) {
      const text = Array.isArray(value) && key === "dc:keywords" ? value.join(" ") : typeof value === "string" || typeof value === "number" ? String(value) : undefined;
      if (text !== undefined) { exportedKeys.add(key); coreContent += xml(core, core.startsWith("dcterms:") ? { "xsi:type": "dcterms:W3CDTF" } : {}, escapeXlsx(text)); }
    } else if (extended) {
      let text: string;
      if (extended[1] === "bool") text = typeof value === "string" ? ["true", "yes"].includes(value.toLowerCase()) ? "1" : "0" : value ? "1" : "0";
      else if (extended[1] === "int") text = typeof value === "number" && Number.isInteger(value) ? String(value) : "0";
      else if (extended[1] === "duration" && typeof value === "string") {
        const m = value.indexOf("M"), end = value.indexOf("S", m + 1);
        const minutes = value.startsWith("PT") && m >= 0 ? Number(value.slice(2, m)) : NaN;
        const seconds = end >= 0 ? Number(value.slice(m + 1, end)) : NaN;
        text = Number.isFinite(minutes) && Number.isFinite(seconds) ? String(minutes + (seconds > 29 ? 1 : 0)) : "0";
      } else text = typeof value === "number" || typeof value === "string" ? String(value) : "";
      extendedContent += xml(extended[0], {}, escapeXlsx(text));
      exportedKeys.add(key);
    } else if (key !== "meta:generator" && ["string", "number", "boolean"].includes(typeof value)) {
      const type = typeof value === "boolean" ? "vt:bool" : typeof value === "number" ? "vt:decimal" : "vt:lpwstr";
      customContent += xml("property", { fmtid: "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}", pid: key === "Editor" ? 2 : pid++, name: key }, xml(type, {}, escapeXlsx(String(value))));
      exportedKeys.add(key);
    }
  }
  const app = xml("Properties", { xmlns: "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties", "xmlns:vt": vt },
    xml("Application", {}, "gnumeric") + xml("AppVersion", {}, "1.1261") + extendedContent);
  const core = xml("cp:coreProperties", { "xmlns:cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties", "xmlns:dc": "http://purl.org/dc/elements/1.1/",
    "xmlns:dcmitype": "http://purl.org/dc/dcmitype/", "xmlns:dcterms": "http://purl.org/dc/terms/", "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance" }, coreContent);
  const custom = xml("Properties", { xmlns: "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties", "xmlns:vt": vt }, customContent);
  return { app, core, custom, exportedKeys };
}
