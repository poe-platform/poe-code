import { createEngine } from "@poe-code/spreadsheet-engine";
import { csvFormat } from "@poe-code/spreadsheet-format-csv";
import { odsFormat } from "@poe-code/spreadsheet-format-ods";
import { xlsxFormat } from "@poe-code/spreadsheet-format-xlsx";

export function starCalcCsvOptions(filterOptions?: string): { separator: string; quote: string; quoteAll: boolean } {
  const parts = filterOptions?.split(",") ?? [];
  const separator = Number.parseInt(parts[0] ?? "44", 10);
  const quote = Number.parseInt(parts[1] ?? "34", 10);
  return {
    separator: Number.isFinite(separator) && separator > 0 ? String.fromCharCode(separator) : ",",
    quote: Number.isFinite(quote) && quote > 0 ? String.fromCharCode(quote) : '"',
    quoteAll: parts[6] === "true"
  };
}

export async function convertOds(
  bytes: Uint8Array,
  target: "csv" | "xlsx",
  filterOptions: string | undefined,
  signal: AbortSignal
): Promise<Uint8Array> {
  const engine = createEngine({ formats: [odsFormat, target === "csv" ? csvFormat : xlsxFormat] });
  const operation = { signal };
  try {
    const book = await engine.readWorkbook({ kind: "stream", filename: "input.ods", source: [bytes] }, {}, operation);
    const chunks: Uint8Array[] = [];
    const csv = starCalcCsvOptions(filterOptions);
    const quotedOption = (value: string) => "'" + value.split("\\").join("\\\\").split("'").join("\\'") + "'";
    await engine.writeWorkbook(book, { kind: "stream", sink: { async write(chunk) { chunks.push(chunk.slice()); } } }, {
      exportType: target === "csv" ? "Gnumeric_stf:stf_assistant" : "Gnumeric_Excel:xlsx2",
      ...(target === "csv" ? { exportOptions: [
        "separator=" + quotedOption(csv.separator), "quote=" + quotedOption(csv.quote),
        "quoting-mode=" + (csv.quoteAll ? "always" : "auto"), "eol=unix", "format=raw", "quoting-on-whitespace=false", "active-sheet="
      ] } : {})
    }, operation);
    const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    return output;
  } finally { await engine.dispose(); }
}
