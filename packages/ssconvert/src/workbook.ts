export type CellValue =
  | { readonly kind: "blank" }
  | { readonly kind: "string"; readonly value: string }
  /** Native C-string bytes that are not valid UTF-8, in canonical lowercase hex.
   * Unicode consumers must explicitly qualify their interpretation. */
  | { readonly kind: "byte-string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "error"; readonly value: string };
export interface Cell {
  readonly row: number;
  readonly column: number;
  readonly value: CellValue;
  readonly formula?: string;
  readonly format?: string;
  /** Text-entry value format, distinct from an explicit cell or column style.
   * A changed format overrides this inference. */
  readonly inferredValueFormat?: string;
  readonly displayedText?: string;
  readonly style?: Readonly<Record<string, ImportedValue>>;
  readonly richText?: readonly RichTextRun[];
  /** Absence differs from a cached blank. Values remain spreadsheet serials. */
  readonly cachedResult?: CellValue;
  /** Dirty formulas may still retain a previous cache, especially in manual mode. */
  readonly formulaDirty?: boolean;
  readonly formulaGroup?: string;
}
export type ImportedValue =
  | null
  | boolean
  | number
  | string
  | readonly ImportedValue[]
  | { readonly [key: string]: ImportedValue };
export interface RichTextRun {
  readonly start: number;
  readonly end: number;
  readonly attributes: Readonly<Record<string, ImportedValue>>;
}
export interface SheetSize {
  readonly rows: number;
  readonly columns: number;
}
export interface Range {
  readonly startRow: number;
  readonly startColumn: number;
  readonly endRow: number;
  readonly endColumn: number;
}
export interface AxisMetadata {
  readonly index: number;
  readonly sizePoints?: number;
  readonly hidden?: boolean;
  readonly outlineLevel?: number;
  readonly collapsed?: boolean;
  readonly style?: Readonly<Record<string, ImportedValue>>;
}
export interface NamedExpression {
  readonly name: string;
  readonly expression: string;
  /** Missing sheet means workbook scope; references can include detached sheets. */
  readonly sheet?: string;
  /** Relative-reference parse anchor (default A1); evaluation uses the caller cell. */
  readonly position?: { readonly sheet: string; readonly row: number; readonly column: number };
}
export interface FormulaGroup {
  readonly id: string;
  readonly kind: "shared" | "array";
  readonly range: Range;
  readonly expression: string;
}
export interface UnsupportedRecord {
  readonly source: string;
  readonly kind: string;
  readonly disposition: "retained" | "dropped";
  readonly data?: ImportedValue;
}
export interface Sheet {
  readonly id: string;
  readonly name: string;
  readonly cells: readonly Cell[];
  readonly size?: SheetSize;
  readonly visibility?: "visible" | "hidden" | "very-hidden";
  readonly rows?: readonly AxisMetadata[];
  readonly columns?: readonly AxisMetadata[];
  readonly merges?: readonly Range[];
  readonly formulaGroups?: readonly FormulaGroup[];
  readonly view?: Readonly<Record<string, ImportedValue>>;
  readonly unsupportedRecords?: readonly UnsupportedRecord[];
}
export interface Workbook {
  /** Unique terminator remembered by text import for configurable text export. */
  readonly textExportEol?: "\n" | "\r\n" | "\r";
  readonly sheets: readonly Sheet[];
  readonly detachedSheets?: readonly Sheet[];
  readonly activeSheet?: string;
  readonly view?: Readonly<Record<string, ImportedValue>>;
  readonly names?: readonly NamedExpression[];
  readonly dateSystem?: "1900" | "1904";
  readonly calculationMode?: "automatic" | "manual";
  readonly iteration?: {
    readonly enabled: boolean;
    readonly maximum: number;
    readonly tolerance: number;
  };
  readonly dependencies?: readonly {
    readonly dependent: CellRange;
    readonly precedent: CellRange;
    readonly dynamic?: boolean;
  }[];
  readonly properties?: Readonly<Record<string, ImportedValue>>;
  readonly unsupportedRecords?: readonly UnsupportedRecord[];
}
/** Array order is observable, including repeated writes to the same address. */
export interface CellUpdate extends Cell {
  readonly sheet: string;
}
export interface CellRange {
  readonly sheet: string;
  /** Second sheet endpoint for a sheet span, in reference order. */
  readonly endSheet?: string;
  /** Unqualified export references are evaluated separately on each sheet. */
  readonly sheetRelative?: boolean;
  /** Under sheetRelative, omitted axis flags mean relative; false preserves $. */
  readonly startRowRelative?: boolean;
  readonly endRowRelative?: boolean;
  readonly startColumnRelative?: boolean;
  readonly endColumnRelative?: boolean;
  readonly startRow: number;
  readonly startColumn: number;
  readonly endRow: number;
  readonly endColumn: number;
}
export type SheetSelection =
  | { readonly kind: "all" }
  | { readonly kind: "ids"; readonly ids: readonly string[] };
export {
  DEFAULT_SHEET_SIZE,
  MAX_SHEET_SIZE,
  formatA1,
  getCell,
  parseA1,
  resolveName,
  snapshotWorkbook,
  updateWorkbook,
  validSheetSize
} from "./workbook/model.js";
export { getCellsExtent } from "./workbook/dimensions.js";
