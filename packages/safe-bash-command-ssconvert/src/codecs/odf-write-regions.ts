import type { ImportedValue, Sheet, Range } from "../workbook.js";
import type { CapabilityContext } from "../contracts.js";
import { createOdfXml, odfAttributes, odfChildren, odfObject } from "./odf-write-support.js";
import type { createOdfStyles } from "./odf-write-styles.js";
import { formatA1 } from "../workbook.js";
import { quoteNativeSheet } from "../formulas/serialization.js";

/** Translate original Gnumeric regions without materializing a sheet-sized grid. */
export async function writeOdfRegion(node: ImportedValue, r: Range, id: string, sheet: Sheet,
  xml: ReturnType<typeof createOdfXml>, styles: ReturnType<typeof createOdfStyles>, context: CapabilityContext,
  formula: (source: string, sheet: Sheet, row: number, column: number) => string) {
  const e = xml.element, a = odfAttributes(node), base = styles.register({ style: { gnumeric: node }, ...(a.Format ? { format: a.Format } : {}) });
  const children = odfChildren(node), baseAddress = quoteNativeSheet(sheet.name) + "." + formatA1(r.startRow,r.startColumn);
  function expression(source: ImportedValue | undefined, name: string) {
    const n = odfChildren(source).find(n => odfObject(n)?.name === name), text = odfObject(n)?.text;
    return typeof text === "string" ? formula(text.startsWith("=") ? text : "=" + text, sheet,r.startRow,r.startColumn).slice(4) : "";
  }
  let maps = "", validationXml = "";
  for (const condition of children.filter(n => odfObject(n)?.name === "Condition")) {
    xml.charge(); const a = odfAttributes(condition), op = Number(a.Operator), overlay = odfChildren(condition).find(n => odfObject(n)?.name === "Style");
    const first = expression(condition,"Expression0"), last = expression(condition,"Expression1");
    const operators = ["", "", "=", "!=", ">", "<", ">=", "<="];
    if (!overlay || !first || !Number.isInteger(op) || op < 0 || op > 8) {
      await context.diagnostic?.({ code: "odf-write-loss", severity: "warning", message: `ODF writer does not export sheet '${sheet.name}' conditional operator '${a.Operator ?? ""}'` }); continue;
    }
    const target = styles.register({ style: { gnumeric: overlay } }).name;
    const conditionText = op === 0 || op === 1 ? `of:cell-content-is-${op === 1 ? "not-" : ""}between(${first};${last})` : op === 8 ? `of:is-true-formula(${first})` : "of:cell-content()" + operators[op] + first;
    maps += e("style:map", { "style:apply-style-name": target, "style:condition": conditionText, "style:base-cell-address": baseAddress });
  }
  const styleName = maps ? id + "c" : base.name;
  const styleXml = maps ? e("style:style", { "style:name": styleName, "style:family": "table-cell", "style:parent-style-name": base.name }, maps) : "";
  const validation = children.find(n => odfObject(n)?.name === "Validation"), input = children.find(n => odfObject(n)?.name === "InputMessage");
  let validationName: string | undefined;
  if (validation || input) {
    const a = odfAttributes(validation), type = (a.Type ?? "GNM_VALIDATION_TYPE_ANY").slice("GNM_VALIDATION_TYPE_".length), op = (a.Operator ?? "GNM_VALIDATION_OP_NONE").slice("GNM_VALIDATION_OP_".length);
    const first = expression(validation,"Expression0"), last = expression(validation,"Expression1");
    const prefixes: Readonly<Record<string,string>> = { ANY: "", AS_INT: "cell-content-is-whole-number() and ", AS_NUMBER: "cell-content-is-decimal-number() and ", AS_DATE: "cell-content-is-date() and ", AS_TIME: "cell-content-is-time() and " };
    const operators: Readonly<Record<string,string>> = { EQUAL: " = ", NOT_EQUAL: " != ", GT: " > ", LT: " < ", GTE: " >= ", LTE: " <= " };
    const length = type === "TEXT_LENGTH";
    let condition = "";
    if (type === "CUSTOM") condition = `of:is-true-formula(${first})`;
    else if (type === "IN_LIST") condition = `of:cell-content-is-in-list(${first})`;
    else if (Object.hasOwn(prefixes,type) || length) {
      const prefix = "of:" + (prefixes[type] ?? ""), subject = length ? "cell-content-text-length" : "cell-content";
      if (op === "NONE") condition = prefix + "is-true-formula(1)";
      else if (op === "BETWEEN" || op === "NOT_BETWEEN") condition = `${prefix}${subject}-is-${op === "NOT_BETWEEN" ? "not-" : ""}between(${first};${last})`;
      else if (Object.hasOwn(operators,op)) condition = prefix + subject + "()" + operators[op] + first;
    }
    if (!condition) await context.diagnostic?.({ code: "odf-write-loss", severity: "warning", message: `ODF writer does not export sheet '${sheet.name}' validation type/operator '${type}/${op}'` });
    else {
      validationName = id + "v";
      const inputAttributes = odfAttributes(input), content = (input ? e("table:help-message", { "table:display": "true", "table:title": inputAttributes.Title }, e("text:p", {}, xml.text(inputAttributes.Message ?? ""))) : "") +
        (validation && a.Style !== "GNM_VALIDATION_STYLE_NONE" ? e("table:error-message", { "table:display": "true", "table:title": a.Title, "table:message-type": a.Style?.endsWith("WARNING") ? "warning" : a.Style?.endsWith("INFO") ? "information" : "stop" }, e("text:p", {}, xml.text(a.Message ?? ""))) : "");
      validationXml = e("table:content-validation", { "table:name": validationName, "table:condition": condition, "table:base-cell-address": baseAddress,
        "table:allow-empty-cell": a.AllowBlank === "1" ? "true" : "false", "table:display-list": a.UseDropdown === "1" ? "unsorted" : "none" }, content);
    }
  }
  const link = children.find(n => odfObject(n)?.name === "HyperLink"), linkAttributes = odfAttributes(link);
  return { styleName, styleXml, validationName, validationXml, ...(linkAttributes.target ? { link: {
    "xlink:href": linkAttributes.type === "GnmHLinkCurWB" ? "#" + linkAttributes.target.split("!").join(".") : linkAttributes.target,
    "xlink:type": "simple", "office:title": linkAttributes.tip } } : {}) };
}
