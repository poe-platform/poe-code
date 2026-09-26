import { pythonValueText, type CsvCell, type CsvWriteCell } from "../csv.js";
import { floatText } from "./json-table.js";

/** Reader numbers are Python floats; ordinary writer numbers also include integers. */
export function inputWriteCell(cell: CsvCell): CsvWriteCell {
  return typeof cell === "number" ? {
    kind: "float", value: Number.isFinite(cell) ? floatText(cell) : pythonValueText(cell)
  } : cell;
}
