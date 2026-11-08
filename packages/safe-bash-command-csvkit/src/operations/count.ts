import type { Runtime } from "../runtime.js";
import { CsvkitBlocked } from "../errors.js";
import { printNames } from "../columns.js";

export async function statistics(runtime: Runtime): Promise<number> {
  const o = runtime.options;
  if (o.names_only) return printNames(runtime);
  if (runtime.context.terminal.stdinIsTTY && !o.input_path) runtime.error("You must provide an input file or piped data.");
  const operations = runtime.descriptor.actions.filter(action => action.dest.endsWith("_only") && !["names_only", "count_only"].includes(action.dest) && o[action.dest]);
  if (operations.length > 1) runtime.error("Only one operation argument may be specified (--mean, --median, etc).");
  for (const [option, label] of [["csv_output", "csv"], ["json_output", "json"], ["count_only", "count"]] as const) {
    if (operations.length && o[option]) runtime.error(`You may not specify --${label} and an operation (--mean, --median, etc) at the same time.`);
  }
  if (!runtime.options.count_only) throw new CsvkitBlocked("Agate metrics and statistics serializers");
  let count = runtime.options.no_header_row ? 0 : -1;
  for await (const ignoredRecord of runtime.records()) count++;
  await runtime.write(`${count}\n`);
  return 0;
}
