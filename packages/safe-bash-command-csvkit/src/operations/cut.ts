import type { Runtime } from "../runtime.js";
import { defaultHeaders, printNames, parseColumnIdentifiers } from "../columns.js";

export async function cut(runtime: Runtime): Promise<number> {
  if (runtime.options.names_only) return printNames(runtime);
  await runtime.prompt();
  let headers: readonly string[] | undefined;
  let columns: number[] = [];
  for await (const record of runtime.records()) {
    if (headers === undefined) {
      headers = runtime.options.no_header_row ? defaultHeaders(record.cells.length) : record.cells;
      columns = parseColumnIdentifiers(runtime.options.columns as string | null, headers, runtime.options.zero_based ? 0 : 1, runtime.options.not_columns as string | null, () => runtime.step());
      await runtime.row(columns.map(index => headers![index]!));
      if (!runtime.options.no_header_row) continue;
    }
    const row = columns.map(index => record.cells[index] ?? null);
    if (!runtime.options.delete_empty || row.some(value => value)) await runtime.row(row);
  }
  if (headers === undefined) await runtime.row([]);
  return 0;
}
