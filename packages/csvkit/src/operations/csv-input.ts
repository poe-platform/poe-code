import type { Runtime } from "../runtime.js";
import { readTable } from "../table/index.js";
import { csvifiedRow } from "./input-table.js";

export async function rawCsvConversion(runtime: Runtime): Promise<number> {
    const o = runtime.options;
    if (o.no_inference && !o.no_header_row && !o.skip_lines && o.sniff_limit === 0) {
      for await (const record of runtime.records(undefined, runtime.input(), 0)) await runtime.row(record.cells);
    } else {
      const table = await readTable(runtime, undefined, undefined, true);
      await runtime.row(table.headers);
      for (const row of table.rows) await runtime.row(csvifiedRow(row));
    }
    return 0;
  }
