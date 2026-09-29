import type { CommandHandler } from "../../contracts/index.js";
import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import { parseCommand } from "safe-bash-command-ssconvert";
import { createStoredZipArchive, readZipArchiveEntries } from "safe-bash-command-soffice";

export * from "safe-bash-command-ssconvert";

const syncUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const syncUtf8Encoder = new TextEncoder();

function unescapeXml(str: string): string {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseSimpleSeparatedRows(text: string, sep: string): string[][] | undefined {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || field.length === 0) {
        quoted = !quoted;
      } else {
        return undefined;
      }
    } else if (!quoted && ch === sep) {
      if (field.startsWith("=") || field.startsWith("'")) return undefined;
      row.push(field);
      field = "";
    } else if (!quoted && (ch === "\r" || ch === "\n")) {
      if (field.startsWith("=") || field.startsWith("'")) return undefined;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else {
      field += ch;
    }
  }
  if (quoted) return undefined;
  if (field.length > 0 || row.length > 0) {
    if (field.startsWith("=") || field.startsWith("'")) return undefined;
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseSimpleXlsxRows(zipBytes: Uint8Array): string[][] | undefined {
  const entries = readZipArchiveEntries(zipBytes);
  if (
    entries.has("EncryptionInfo") ||
    entries.has("EncryptedPackage") ||
    entries.has("xl/worksheets/sheet2.xml")
  ) {
    return undefined;
  }
  const sharedStrings: string[] = [];
  const sstBytes = entries.get("xl/sharedStrings.xml");
  if (sstBytes) {
    const sstXml = syncUtf8Decoder.decode(sstBytes);
    for (const si of sstXml.matchAll(/<si\b[\s\S]*?<\/si>/g)) {
      const parts = [...si[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) =>
        unescapeXml(t[1] ?? "")
      );
      sharedStrings.push(parts.join(""));
    }
  }
  const sheetBytes = entries.get("xl/worksheets/sheet1.xml");
  if (!sheetBytes) return undefined;
  const sheetXml = syncUtf8Decoder.decode(sheetBytes);
  if (/<f(?:\s|>)/u.test(sheetXml)) return undefined;

  const rows: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
    const rowCells: string[] = [];
    for (const cellMatch of rowMatch[0].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const refMatch = /\br="([A-Z]+)\d+"/i.exec(attrs);
      if (refMatch?.[1]) {
        let targetCol = 0;
        for (const ch of refMatch[1].toUpperCase()) {
          targetCol = targetCol * 26 + (ch.charCodeAt(0) - 64);
        }
        targetCol -= 1;
        while (rowCells.length < targetCol) rowCells.push("");
      }
      if (cellMatch[2] === undefined) {
        rowCells.push("");
        continue;
      }
      const typeMatch = /\bt="([^"]+)"/.exec(attrs);
      const cellType = typeMatch?.[1] ?? "n";
      if (cellType === "inlineStr") {
        const tVal = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body);
        rowCells.push(unescapeXml(tVal?.[1] ?? ""));
      } else {
        const vVal = /<v>([\s\S]*?)<\/v>/.exec(body);
        const raw = unescapeXml(vVal?.[1] ?? "");
        if (cellType === "s") {
          const idx = Number.parseInt(raw, 10);
          rowCells.push(sharedStrings[idx] ?? "");
        } else {
          rowCells.push(raw);
        }
      }
    }
    rows.push(rowCells);
  }
  return rows;
}

function buildSimpleXlsx(rows: readonly (readonly string[])[], sheetName = "Sheet1"): Uint8Array {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const colName = (idx: number): string => {
    let n = idx + 1;
    let out = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  };
  const sheetRows = rows
    .map((row, rIdx) => {
      const cells = row
        .map((val, cIdx) => {
          const ref = `${colName(cIdx)}${rIdx + 1}`;
          if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(val)) {
            return `<c r="${ref}" t="n"><v>${val}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t>${esc(val)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rIdx + 1}">${cells}</row>`;
    })
    .join("");
  return createStoredZipArchive({
    "[Content_Types].xml": syncUtf8Encoder.encode(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
    ),
    "_rels/.rels": syncUtf8Encoder.encode(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ),
    "xl/workbook.xml": syncUtf8Encoder.encode(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>`
    ),
    "xl/worksheets/sheet1.xml": syncUtf8Encoder.encode(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
    ),
  });
}

function formatSimpleCsv(rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return "";
  return (
    rows
      .map((row) =>
        row
          .map((cell) =>
            cell.includes(",") || cell.includes('"') || cell.includes("\n") || cell.includes("\r")
              ? `"${cell.replace(/"/g, '""')}"`
              : cell
          )
          .join(",")
      )
      .join("\n") + "\n"
  );
}

export function evalSyncSsconvert(
  execute: CommandHandler,
  opArgs: readonly string[],
  inBytes?: Uint8Array,
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  if (!builtInDirectContextExecutors.has(execute) || opArgs.length === 0) return undefined;
  try {
    const parsed = parseCommand(opArgs);
    if (parsed.kind === "terminal") {
      if (parsed.exitCode === 0 && !parsed.stderr && parsed.stdout) {
        return parsed.stdout;
      }
      return undefined;
    }
    if (
      parsed.action !== "convert" ||
      parsed.flags.length > 0 ||
      Object.keys(parsed.arrays).length > 0 ||
      parsed.scalars.clipboard !== undefined ||
      parsed.scalars.resize !== undefined ||
      parsed.scalars["export-range"] !== undefined ||
      parsed.scalars["export-options"] !== undefined ||
      parsed.scalars["import-encoding"] !== undefined ||
      parsed.operands.length !== 2
    ) {
      return undefined;
    }

    const [srcUri, dstUri] = parsed.operands as [string, string];
    if (srcUri.includes("%") || dstUri.includes("%")) return undefined;
    if (srcUri.includes("://") && srcUri !== "fd://0") return undefined;
    if (dstUri.includes("://") && dstUri !== "fd://1") return undefined;

    const impType = parsed.scalars["import-type"];
    const expType = parsed.scalars["export-type"];
    const lowerSrc = srcUri.toLowerCase();
    const lowerDst = dstUri.toLowerCase();

    let inFmt: "csv" | "tsv" | "xlsx" | undefined;
    if (impType === "Gnumeric_stf:stf_csvtab" || (!impType && lowerSrc.endsWith(".csv"))) inFmt = "csv";
    else if (!impType && lowerSrc.endsWith(".tsv")) inFmt = "tsv";
    else if (impType === "Gnumeric_Excel:xlsx" || (!impType && lowerSrc.endsWith(".xlsx"))) inFmt = "xlsx";
    if (!inFmt) return undefined;

    let outFmt: "csv" | "xlsx" | undefined;
    if (expType === "Gnumeric_stf:stf_csv" || (!expType && lowerDst.endsWith(".csv"))) outFmt = "csv";
    else if (expType === "Gnumeric_Excel:xlsx" || expType === "Gnumeric_Excel:xlsx2" || (!expType && lowerDst.endsWith(".xlsx"))) outFmt = "xlsx";
    if (!outFmt) return undefined;
    if (dstUri === "fd://1" && (!expType || outFmt !== "csv")) return undefined;

    const srcBytes = srcUri === "fd://0" ? inBytes : readFileSync?.(srcUri);
    if (!srcBytes || srcBytes.byteLength === 0 || srcBytes.byteLength > 131072) return undefined;

    let rows: string[][] | undefined;
    if (inFmt === "csv" || inFmt === "tsv") {
      const text = syncUtf8Decoder.decode(srcBytes);
      rows = parseSimpleSeparatedRows(text, inFmt === "tsv" ? "\t" : ",");
    } else {
      rows = parseSimpleXlsxRows(srcBytes);
    }
    if (!rows) return undefined;

    if (outFmt === "csv") {
      const csvText = formatSimpleCsv(rows);
      if (dstUri === "fd://1") return csvText;
      if (!writeFileSync || !writeFileSync(dstUri, syncUtf8Encoder.encode(csvText))) return undefined;
      return "";
    }

    const sheetName = srcUri === "fd://0" ? "Sheet1" : (srcUri.split("/").pop() || "Sheet1");
    const xlsxBytes = buildSimpleXlsx(rows, sheetName);
    if (!writeFileSync || !writeFileSync(dstUri, xlsxBytes)) return undefined;
    return "";
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.evalSyncSsconvert = evalSyncSsconvert;
