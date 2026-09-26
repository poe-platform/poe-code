import type { CapabilityContext, Diagnostic } from "../../contracts.js";
import type { Cell, CellValue, Sheet, Workbook } from "../../workbook.js";
import type { FormulaNode, ParsePosition } from "../ast.js";

export interface Reference {
  readonly kind: "range";
  readonly sheets: readonly Sheet[];
  readonly firstRow: number;
  readonly lastRow: number;
  readonly firstColumn: number;
  readonly lastColumn: number;
}
export interface Matrix { readonly kind: "matrix"; readonly rows: readonly (readonly CellValue[])[] }
export interface SetValue { readonly kind: "set"; readonly values: readonly Value[] }
export type Value = CellValue | Reference | Matrix | SetValue;
export interface FunctionHost {
  readonly book: Workbook;
  readonly context: CapabilityContext;
  readonly position: ParsePosition;
  readonly array: boolean;
  evaluate(node: FormulaNode, wantReference?: boolean, permitNonScalar?: boolean): Value;
  scalar(value: Value): CellValue;
  matrix(value: Value): Matrix;
  cell(sheet: Sheet, row: number, column: number): Cell | undefined;
  fetchCell(sheet: Sheet, row: number, column: number): Cell;
  read(sheet: Sheet, row: number, column: number): CellValue;
  indirect(text: string, a1: boolean): Value;
  tick(): void;
  diagnostic?(diagnostic: Diagnostic): void;
}
export type FunctionImplementation = (args: readonly (Value | undefined)[], host: FunctionHost) => Value;
export type SpecialForm = (args: readonly FormulaNode[], host: FunctionHost) => Value;
