import type { CommandHandler } from "safe-bash-contracts";
import type { CellValue } from "@poe-code/spreadsheet-ast";
import { builtInDirectContextExecutors } from "safe-bash-contracts/runtime-control";
import { parseCommand } from "./cli.js";
import { parseSimpleSeparatedRows, formatSimpleCsv } from "@poe-code/spreadsheet-format-csv/sync-table";
import { parseSimpleXlsxTable, buildSimpleXlsx } from "@poe-code/spreadsheet-format-xlsx/sync-table";

export interface SynchronousSpreadsheetArchive {
  read(bytes: Uint8Array): ReadonlyMap<string, Uint8Array>;
  write(entries: Readonly<Record<string, Uint8Array>>): Uint8Array;
}

const syncUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const syncUtf8Encoder = new TextEncoder();

export function createSyncSsconvertEvaluator(archive: SynchronousSpreadsheetArchive) {
  return function evalSyncSsconvert(
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
      if (srcUri === "-" || dstUri === "-" || srcUri.includes("%") || dstUri.includes("%")) return undefined;
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

      let rows: (string | CellValue)[][] | undefined;
      let sheetName = srcUri === "fd://0" ? "Sheet1" : (srcUri.split("/").pop() || "Sheet1");
      if (inFmt === "csv" || inFmt === "tsv") {
        if (srcBytes.includes(0)) return undefined;
        const text = syncUtf8Decoder.decode(srcBytes);
        rows = parseSimpleSeparatedRows(text, inFmt === "tsv" ? "\t" : ",");
      } else {
        const table = parseSimpleXlsxTable(archive.read(srcBytes));
        if (!table) return undefined;
        rows = table.rows;
        sheetName = table.sheetName;
      }
      if (!rows) return undefined;

      if (outFmt === "csv") {
        const csvText = formatSimpleCsv(rows);
        if (csvText.includes("\0")) return undefined;
        if (dstUri === "fd://1") return csvText;
        if (!writeFileSync || !writeFileSync(dstUri, syncUtf8Encoder.encode(csvText))) return undefined;
        return "";
      }

      const xlsxBytes = archive.write(buildSimpleXlsx(rows, sheetName));
      if (!writeFileSync || !writeFileSync(dstUri, xlsxBytes)) return undefined;
      return "";
    } catch {
      return undefined;
    }
  };
}
