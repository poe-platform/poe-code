import type { CellValue } from "../../workbook.js";
import { error, numericResult, sum } from "../values.js";
import { criterion } from "./database.js";
import type { FunctionHost, FunctionImplementation, Matrix, SpecialForm, Value } from "./types.js";

function aggregate(name: string, values: Value, ranges: readonly Value[], conditions: readonly CellValue[], host: FunctionHost): Value {
  const actual = host.matrix(values), matrices = ranges.map(value => host.matrix(value));
  const height = actual.rows.length, width = actual.rows[0]?.length ?? 0;
  if (matrices.some(matrix => matrix.rows.length !== height || matrix.rows.some(row => row.length !== width))) return error("#VALUE!");
  const numbers: number[] = []; let count = 0;
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    host.tick();
    if (!matrices.every((matrix: Matrix, i) => criterion(matrix.rows[row]![column]!, conditions[i]!, host, true))) continue;
    const cell = actual.rows[row]![column]!;
    if (name.startsWith("COUNT")) { if (cell.kind === "error") return cell; count++; }
    else if (cell.kind === "error") return cell;
    else if (cell.kind === "number") numbers.push(cell.value);
  }
  if (name.startsWith("COUNT")) return numericResult(count);
  if (name.startsWith("AVERAGE")) return numbers.length ? numericResult(sum(numbers, host.tick) / numbers.length) : error("#DIV/0!");
  if (name.startsWith("MIN") || name.startsWith("MAX")) {
    if (!numbers.length) return error("#DIV/0!");
    let result = numbers[0]!; for (const value of numbers) { host.tick(); result = name.startsWith("MIN") ? Math.min(result, value) : Math.max(result, value); } return numericResult(result);
  }
  return numericResult(sum(numbers, host.tick));
}
export const conditionalMathFunctions: Readonly<Record<string, FunctionImplementation>> = Object.fromEntries(["COUNTIF", "SUMIF", "AVERAGEIF"].map(name => [name, ((args, host) =>
  aggregate(name, args[2] ?? args[0]!, [args[0]!], [host.scalar(args[1]!)], host)) satisfies FunctionImplementation]));
export const conditionalMathSpecialForms: Readonly<Record<string, SpecialForm>> = Object.fromEntries(["COUNTIFS", "SUMIFS", "AVERAGEIFS", "MINIFS", "MAXIFS"].map(name => [name, ((nodes, host) => {
  const start = name === "COUNTIFS" ? 0 : 1;
  if (nodes.length < start || (nodes.length - start) % 2) return error("#VALUE!");
  let actual = start ? host.evaluate(nodes[0]!, true) : undefined;
  if (actual?.kind === "error") return actual;
  if (actual && actual.kind !== "range") return error("#VALUE!");
  const ranges: Value[] = [], conditions: CellValue[] = [];
  for (let i = start; i < nodes.length; i += 2) {
    const range = host.evaluate(nodes[i]!, true); if (range.kind === "error") return range;
    actual ??= range; ranges.push(range);
    const condition = host.scalar(host.evaluate(nodes[i + 1]!)); if (condition.kind === "error") return condition;
    conditions.push(condition.kind === "blank" ? { kind: "number", value: 0 } : condition);
  }
  return actual ? aggregate(name, actual, ranges, conditions, host) : error("#VALUE!");
}) satisfies SpecialForm]));
