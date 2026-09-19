import type { Runtime } from "../runtime.js";
import { readTextTable, type TextTable } from "../text-table.js";
import { match } from "../columns.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "../errors.js";

function combine(runtime: Runtime, left: TextTable, right: TextTable, leftKey: number | undefined, rightKey: number | undefined, full: boolean, inner: boolean): TextTable {
  const included = right.headers.map((_, index) => index).filter(index => full || index !== rightKey);
  const headers = [...left.headers, ...included.map(index => left.headers.includes(right.headers[index]!) ? right.headers[index]! + "2" : right.headers[index]!)];
  if (new Set(headers).size !== headers.length) throw new CsvkitBlocked("Agate joined duplicate column warning provenance");
  if (headers.length > runtime.context.limits.maxColumns) throw new CsvkitBlocked("column budget exceeded");
  const rightHash = new Map<string | number | null, (readonly (string | null)[])[]>();
  for (const [index, row] of right.rows.entries()) {
    runtime.step(); runtime.retain(64);
    const key = rightKey === undefined ? index : row[rightKey]!;
    const matches = rightHash.get(key);
    if (matches) matches.push(row); else rightHash.set(key, [row]);
  }
  const rows: (string | null)[][] = [];
  const seen = new Set<string | number | null>();
  const append = (a: readonly (string | null)[], b?: readonly (string | null)[]): void => {
    runtime.step();
    if (rows.length >= runtime.context.limits.maxRows) throw new CsvkitBlocked("join result row budget exceeded");
    runtime.retain(64 + headers.length * 16);
    rows.push([...a, ...included.map(index => { runtime.step(); return b?.[index] ?? null; })]);
  };
  for (const [index, row] of left.rows.entries()) {
    runtime.step(); runtime.retain(32);
    const key = leftKey === undefined ? index : row[leftKey]!;
    seen.add(key);
    const matches = rightHash.get(key);
    if (matches) for (const match of matches) append(row, match);
    else if (!inner) append(row);
  }
  if (full) for (const [index, row] of right.rows.entries()) {
    runtime.step();
    if (!seen.has(rightKey === undefined ? index : row[rightKey]!)) append(left.headers.map(() => null), row);
  }
  return { headers, rows };
}

export async function join(runtime: Runtime): Promise<number> {
  const o = runtime.options;
  const paths = o.input_paths as readonly string[];
  if (runtime.context.terminal.stdinIsTTY && paths.length === 1 && paths[0] === "-") runtime.error("You must provide an input file or piped data.");
  let names = o.columns ? String(o.columns).split(",").map(name => name.trim()) : [];
  if (names.length === 1) names = paths.map(() => names[0]!);
  if (names.length && names.length !== paths.length) runtime.error("The number of join column names must match the number of files, or be a single column name that exists in all files.");
  if ((o.left_join || o.right_join || o.outer_join) && !o.columns) runtime.error("You must provide join column names when performing an outer join.");
  if (o.left_join && o.right_join) runtime.error("It is not valid to specify both a left and a right join.");
  const tables: TextTable[] = [];
  for (const path of paths) tables.push(await readTextTable(runtime, path));
  if (!tables.length) throw new CsvkitDiagnostic("IndexError: list index out of range");
  const keys = names.map((name, index) => match(tables[index]!.headers, name, 1, true));
  if (o.right_join) { tables.reverse(); keys.reverse(); }
  let table = tables[0]!;
  for (let index = 1; index < tables.length; index++) table = combine(runtime, table, tables[index]!, keys[0], keys[index], !names.length || Boolean(o.outer_join && !o.left_join && !o.right_join), Boolean(names.length && !o.outer_join && !o.left_join && !o.right_join));
  await runtime.row(table.headers);
  for (const row of table.rows) await runtime.row(row);
  return 0;
}
