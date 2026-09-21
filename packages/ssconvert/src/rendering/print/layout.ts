import { SsconvertError, type CapabilityContext } from "../../contracts.js";
import type { AxisMetadata, Range } from "../../workbook.js";
import { axisPaginator, printWork, type AxisPrintPage, type PrintBreak } from "./pagination.js";

export interface PrintLayoutRequest {
  readonly area: Range;
  readonly defaultRowPoints: number;
  readonly defaultColumnPoints: number;
  readonly rows?: readonly AxisMetadata[];
  readonly columns?: readonly AxisMetadata[];
  readonly repeatRows?: { readonly start: number; readonly end: number };
  readonly repeatColumns?: { readonly start: number; readonly end: number };
  readonly rowBreaks?: readonly PrintBreak[];
  readonly columnBreaks?: readonly PrintBreak[];
  /** Explicit paper data, including custom sizes; no ambient paper discovery. */
  readonly paper: { readonly widthPoints: number; readonly heightPoints: number };
  readonly orientation?: "portrait" | "landscape" | "reverse-portrait" | "reverse-landscape";
  /** Top/bottom denote edges below the header and above the footer. */
  readonly margins: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
  readonly scale?: { readonly kind: "percentage"; readonly x: number; readonly y: number } |
    { readonly kind: "fit"; readonly rows: number; readonly columns: number };
  readonly headings?: boolean;
  readonly displayFormulas?: boolean;
  readonly acrossThenDown?: boolean;
  readonly centerHorizontally?: boolean;
  readonly centerVertically?: boolean;
  readonly startPage?: number;
}
export interface PrintPage {
  readonly number: number;
  readonly area: Range;
  readonly rows: AxisPrintPage;
  readonly columns: AxisPrintPage;
  readonly originX: number;
  readonly originY: number;
}
export interface PrintLayout {
  readonly widthPoints: number;
  readonly heightPoints: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly pages: readonly PrintPage[];
}
/** Pure page geometry from print.c compute_sheet_pages and print_page. */
export function layoutPrintPages(request: PrintLayoutRequest, context: CapabilityContext): PrintLayout {
  const tick = printWork(context); tick();
  const landscape = request.orientation === "landscape" || request.orientation === "reverse-landscape";
  if (request.orientation !== undefined && !["portrait", "landscape", "reverse-portrait", "reverse-landscape"].includes(request.orientation))
    throw new SsconvertError("invalid-request", "Invalid ssconvert print orientation");
  const widthPoints = landscape ? request.paper.heightPoints : request.paper.widthPoints;
  const heightPoints = landscape ? request.paper.widthPoints : request.paper.heightPoints;
  const margins = request.margins;
  if (![widthPoints, heightPoints].every(value => Number.isFinite(value) && value > 0) ||
      ![margins.left, margins.right, margins.top, margins.bottom].every(value => Number.isFinite(value) && value >= 0))
    throw new SsconvertError("invalid-request", "Invalid ssconvert print paper geometry");
  const usableX = widthPoints - margins.left - margins.right;
  const usableY = heightPoints - margins.top - margins.bottom;
  if (usableX <= 0 || usableY <= 0)
    throw new SsconvertError("invalid-request", "Invalid ssconvert print margins");
  const rowHeader = request.headings ? request.defaultColumnPoints : 0;
  const columnHeader = request.headings ? request.defaultRowPoints : 0;
  const rowAxis = axisPaginator({ start: request.area.startRow, end: request.area.endRow,
    usablePoints: usableY, defaultSizePoints: request.defaultRowPoints,
    ...(request.rows ? { items: request.rows } : {}),
    ...(request.repeatRows ? { repeat: request.repeatRows } : {}),
    ...(request.rowBreaks ? { breaks: request.rowBreaks } : {}) }, tick);
  const columnAxis = axisPaginator({ start: request.area.startColumn, end: request.area.endColumn,
    usablePoints: usableX, defaultSizePoints: request.defaultColumnPoints,
    ...(request.columns ? { items: request.columns } : {}),
    ...(request.repeatColumns ? { repeat: request.repeatColumns } : {}),
    ...(request.columnBreaks ? { breaks: request.columnBreaks } : {}) }, tick);
  let scaleX = 1, scaleY = 1;
  if (request.scale?.kind === "fit") {
    scaleY = rowAxis.fit(request.scale.rows, usableY, columnHeader);
    scaleX = columnAxis.fit(request.scale.columns, usableX, rowHeader, scaleY);
    scaleY = scaleX;
  } else if (request.scale?.kind === "percentage") {
    if (![request.scale.x, request.scale.y].every(Number.isFinite))
      throw new SsconvertError("invalid-request", "Invalid ssconvert print scale");
    scaleX = request.scale.x / 100;
    scaleY = request.scale.y / 100;
  } else if (request.scale !== undefined)
    throw new SsconvertError("invalid-request", "Invalid ssconvert print scale type");
  if (scaleX <= 0) scaleX = 1;
  if (scaleY <= 0) scaleY = 1;
  const formulaScale = request.displayFormulas ? 2 : 1;
  const columns = columnAxis.paginate((usableX / scaleX - rowHeader) / formulaScale);
  const rows = rowAxis.paginate(usableY / scaleY - columnHeader);
  const count = columns.length * rows.length;
  tick(count); // Admit the Cartesian product before its allocation.
  if (request.startPage !== undefined && !Number.isSafeInteger(request.startPage))
    throw new SsconvertError("invalid-request", "Invalid ssconvert print page number");
  const startPage = request.startPage !== undefined && request.startPage >= 0 ? request.startPage : 1;
  if (!Number.isSafeInteger(startPage) || !Number.isSafeInteger(startPage + count - 1))
    throw new SsconvertError("invalid-request", "Invalid ssconvert print page number");
  const pages: PrintPage[] = [];
  for (let index = 0; index < count; index++) {
    tick();
    const rowIndex = request.acrossThenDown ? Math.floor(index / columns.length) : index % rows.length;
    const columnIndex = request.acrossThenDown ? index % columns.length : Math.floor(index / rows.length);
    const row = rows[rowIndex]!, column = columns[columnIndex]!;
    const occupiedX = (column.sizePoints + column.repeatPoints + rowHeader) * scaleX;
    const occupiedY = (row.sizePoints + row.repeatPoints + columnHeader) * scaleY;
    pages.push({ number: startPage + index,
      area: { startRow: row.start, endRow: row.end, startColumn: column.start, endColumn: column.end },
      rows: row, columns: column,
      originX: margins.left + (request.centerHorizontally ? (usableX - occupiedX) / 2 : 0),
      originY: margins.top + (request.centerVertically ? (usableY - occupiedY) / 2 : 0) });
  }
  return { widthPoints, heightPoints, scaleX, scaleY, pages };
}
