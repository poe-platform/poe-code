import { parseXml, type XmlElement } from "@poe-code/safe-fs/xml";
import { parseA1, formatA1, type CellValue } from "@poe-code/spreadsheet-ast";
import { decodeXlsxString, encodeXlsxString } from "@poe-code/spreadsheet-engine/codecs/xlsx-strings";
import { escapeXlsx } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";

const namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

function parse(bytes: Uint8Array): XmlElement {
  if (bytes.byteLength > 2_097_152) throw new RangeError("Synchronous XLSX XML limit exceeded");
  return parseXml(decoder.decode(bytes), { maxDepth: 32, maxNodes: 100_000, maxAttributes: 200_000, maxTextLength: 2_097_152 });
}

function attribute(node: XmlElement, name: string): string | undefined {
  return node.attributes.find(item => item.name === name)?.value;
}

function children(node: XmlElement, name: string): XmlElement[] {
  return node.children.filter(item => item.namespace === namespace && item.localName === name);
}

function stringValue(node: XmlElement): string {
  return decodeXlsxString(node.children.flatMap(item => {
    if (item.namespace !== namespace) return [];
    if (item.localName === "t") return [item.text];
    return item.localName === "r" ? children(item, "t").map(text => text.text) : [];
  }).join(""));
}

/** Dense, unformatted values only; richer workbooks use the canonical reader. */
export function parseSimpleXlsxTable(entries: ReadonlyMap<string, Uint8Array>): { rows: CellValue[][]; sheetName: string } | undefined {
  let expandedBytes = 0;
  for (const [name, bytes] of entries) {
    expandedBytes += bytes.byteLength;
    if (expandedBytes > 2_097_152 || name === "EncryptionInfo" || name === "EncryptedPackage"
      || name.startsWith("xl/worksheets/") && name.endsWith(".xml") && name !== "xl/worksheets/sheet1.xml") return undefined;
  }
  const workbookBytes = entries.get("xl/workbook.xml");
  let sheetName = "Sheet1";
  if (workbookBytes) {
    const workbook = parse(workbookBytes);
    const sheets = children(workbook, "sheets")[0];
    if (!sheets || children(sheets, "sheet").length !== 1) return undefined;
    sheetName = attribute(children(sheets, "sheet")[0]!, "name") ?? sheetName;
  }
  const sheetBytes = entries.get("xl/worksheets/sheet1.xml");
  if (!sheetBytes) return undefined;
  const sheet = parse(sheetBytes);
  if (sheet.namespace !== namespace || sheet.localName !== "worksheet") return undefined;
  const data = children(sheet, "sheetData")[0];
  if (!data) return undefined;
  const sharedBytes = entries.get("xl/sharedStrings.xml");
  const sharedItems = sharedBytes ? children(parse(sharedBytes), "si") : [];
  if (sharedItems.some(item => children(item, "r").some(run => children(run, "rPr").length))) return undefined;
  const strings = sharedItems.map(stringValue);
  const rows: CellValue[][] = [];
  for (const row of children(data, "row")) {
    if (attribute(row, "r") !== String(rows.length + 1)) return undefined;
    const values: CellValue[] = [];
    for (const cell of children(row, "c")) {
      const ref = attribute(cell, "r");
      if (ref === undefined || attribute(cell, "s") !== undefined || children(cell, "f").length) return undefined;
      const address = parseA1(ref);
      if (address.row !== rows.length || address.column !== values.length) return undefined;
      const type = attribute(cell, "t") ?? "n";
      const raw = children(cell, "v")[0]?.text ?? "";
      if (type === "inlineStr") {
        const value = children(cell, "is")[0];
        if (value && children(value, "r").some(run => children(run, "rPr").length)) return undefined;
        values.push({ kind: "string", value: value ? stringValue(value) : "" });
      } else if (type === "s") {
        const index = Number(raw);
        if (!Number.isSafeInteger(index) || index < 0 || String(index) !== raw || strings[index] === undefined) return undefined;
        values.push({ kind: "string", value: strings[index]! });
      } else if (type === "b") {
        if (raw !== "0" && raw !== "1") return undefined;
        values.push({ kind: "boolean", value: raw === "1" });
      } else if (type === "str") values.push({ kind: "string", value: decodeXlsxString(raw) });
      else if (type === "n") {
        if (raw === "") values.push({ kind: "blank" });
        else if (Number.isFinite(Number(raw))) values.push({ kind: "number", value: Number(raw) });
        else return undefined;
      }
      else return undefined;
    }
    if (rows.length && values.length !== rows[0]!.length) return undefined;
    rows.push(values);
  }
  return { rows, sheetName };
}

function simpleDecimal(value: string): boolean {
  let offset = value.startsWith("-") ? 1 : 0;
  const first = offset;
  while (offset < value.length && value.charCodeAt(offset) >= 48 && value.charCodeAt(offset) <= 57) offset++;
  if (offset === first || offset > first + 1 && value[first] === "0") return false;
  if (value[offset] === ".") {
    const start = ++offset;
    while (offset < value.length && value.charCodeAt(offset) >= 48 && value.charCodeAt(offset) <= 57) offset++;
    if (offset === start) return false;
  }
  return offset === value.length && Number.isFinite(Number(value));
}

/** Build package entries so the caller chooses the ZIP implementation. */
export function buildSimpleXlsx(rows: readonly (readonly (string | CellValue)[])[], sheetName = "Sheet1"): Record<string, Uint8Array> {
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, column) => {
    const reference = formatA1(rowIndex, column);
    const cell = typeof value === "string" ? simpleDecimal(value) ? { kind: "number" as const, value: Number(value) }
      : { kind: "string" as const, value } : value;
    if (cell.kind === "blank") return `<c r="${reference}"/>`;
    if (cell.kind === "number") return `<c r="${reference}" t="n"><v>${cell.value}</v></c>`;
    if (cell.kind === "boolean") return `<c r="${reference}" t="b"><v>${cell.value ? 1 : 0}</v></c>`;
    if (cell.kind !== "string") throw new TypeError("Unsupported synchronous XLSX cell");
    return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXlsx(encodeXlsxString(cell.value))}</t></is></c>`;
  }).join("")}</row>`).join("");
  return {
    "[Content_Types].xml": encoder.encode('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    "_rels/.rels": encoder.encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${namespace}"><sheets><sheet name="${escapeXlsx(sheetName)}" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": encoder.encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${namespace}"><sheetData>${sheetRows}</sheetData></worksheet>`),
  };
}
