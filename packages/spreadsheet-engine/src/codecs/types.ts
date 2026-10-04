import type { Workbook, CellRange, Cell } from "@poe-code/spreadsheet-ast";
import type { ByteSource, CapabilityContext, RangeSource } from "../contracts.js";

export type Direction = "read" | "write";
export type SaveScope = "workbook" | "sheet" | "range";
export type FormatLevel = "none" | "write_only" | "new" | "manual" | "manual_remember" | "auto";
export type ExportOptionRule =
  | { readonly kind: "string" }
  | { readonly kind: "boolean" }
  | { readonly kind: "enum"; readonly values: readonly string[]; readonly asciiCaseInsensitive?: boolean; readonly error?: string };
export interface ServiceDescriptor {
  readonly id: string;
  readonly description: string;
  readonly extensions: readonly string[];
  /** Additional compound suffixes recognized by a provider's name probe. */
  readonly filenameSuffixes?: readonly string[];
  readonly mimeTypes?: readonly string[];
  readonly formatLevel?: FormatLevel;
  readonly overwriteFiles?: boolean;
  readonly defaultSaverPriority?: number;
  readonly probePriority?: number;
  readonly encodingDependent?: boolean;
  readonly saveScope?: SaveScope;
  readonly sheetSelection?: boolean;
  /** Whether the writer consumes ssconvert's range metadata. */
  readonly honorsExportRange?: boolean;
  /** Native writers may read the view or runtime selection instead of common options. */
  readonly selectionSource?: "view" | "runtime";
  readonly interactiveOnly?: boolean;
  readonly contentProbe?: boolean;
  /** Explicit native-byte writer contract; absence requires Unicode values. */
  readonly byteStrings?: "utf8-text" | "formula-only";
  readonly exporterOptionKeys?: readonly string[];
}
/** Replayable, row-major cells backed by retained input or caller working storage.
 * Metadata contains empty cell arrays. Each iteration owns only its current cell.
 * Readers may decline this representation when global evaluation is still needed.
 */
export interface WorkbookSource {
  readonly metadata: Workbook;
  cells(sheet: string): AsyncIterable<Cell>;
}
export interface Codec extends ServiceDescriptor {
  /** Handles label metadata explicitly; other writers report its omission. */
  readonly labelRanges?: true;
  /** Provider-owned declarative handlers; unrecognized keys use common options. */
  readonly exportOptionRules?: Readonly<Record<string, ExportOptionRule>>;
  /** Explicit name probe: extensions alone never implement a probe. */
  probeName?(filename: string, context: CapabilityContext): boolean | Promise<boolean>;
  probeContent?(bytes: Uint8Array, context: CapabilityContext): boolean | Promise<boolean>;
  probeSource?(source: RangeSource, context: CapabilityContext): boolean | Promise<boolean>;
  /** Return a replayable source, or an already-decoded workbook when global
   * evaluation is needed. Undefined declines without emitting diagnostics. */
  readWorkbookSource?(source: RangeSource, context: CapabilityContext, encoding?: string): Promise<WorkbookSource | Workbook | undefined>;
  readSource?(source: RangeSource, context: CapabilityContext, encoding?: string): Promise<Workbook>;
  read?(bytes: Uint8Array, context: CapabilityContext, encoding?: string): Promise<Workbook>;
  write?(book: Workbook, options: readonly string[], context: CapabilityContext,
    selection?: { readonly sheets: readonly string[]; readonly range?: CellRange }): Promise<Uint8Array>;
  /** Incremental export; yielded bytes are borrowed until the next pull.
   * Supply write as a buffering convenience for hosts without streaming output. */
  writeStream?(book: Workbook, options: readonly string[], context: CapabilityContext,
    selection?: { readonly sheets: readonly string[]; readonly range?: CellRange }): ByteSource;
  writeWorkbookSource?(source: WorkbookSource, options: readonly string[], context: CapabilityContext,
    selection?: { readonly sheets: readonly string[]; readonly range?: CellRange }): ByteSource;
  /** Installed provider's exporter option handler; no native callback is implied. */
  exportOptions?(options: readonly string[], context: CapabilityContext, book?: Workbook): Promise<readonly string[]>;
}
export interface SourceService extends Codec {
  readonly direction: Direction;
  readonly source: string;
}
export interface FormatProvider {
  readonly id: string;
  readonly source: string;
  readonly services: readonly (Codec & { readonly direction: Direction; readonly source?: string })[];
}
