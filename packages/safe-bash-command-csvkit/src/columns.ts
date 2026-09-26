import { CsvkitDiagnostic } from "./errors.js";
import type { Runtime } from "./runtime.js";

export { defaultHeaders } from "./table/headers.js";
export { match, parseColumnIdentifiers } from "./table/selectors.js";

export async function printNames(runtime: Runtime): Promise<number> {
  if (runtime.options.no_header_row) throw new CsvkitDiagnostic("RequiredHeaderError: You cannot use --no-header-row with the -n or --names options.");
  const rows = runtime.records();
  try {
    const first = await rows.next();
    if (first.done) throw new CsvkitDiagnostic("StopIteration: ");
    const offset = runtime.options.zero_based ? 0 : 1;
    for (const [index, name] of first.value.cells.entries()) await runtime.write(`${String(index + offset).padStart(3)}: ${name}\n`);
    return 0;
  } finally { await rows.return(undefined); }
}
