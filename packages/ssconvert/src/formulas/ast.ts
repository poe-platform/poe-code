import type { CellValue, Workbook } from "../workbook.js";

export interface Span { readonly start: number; readonly end: number }
export interface ParsePosition { readonly sheet: string; readonly row: number; readonly column: number }
export interface Axis { readonly value: number; readonly relative: boolean }
export interface ReferenceEndpoint {
  readonly row?: Axis;
  readonly column?: Axis;
  readonly sheet?: string;
  readonly workbook?: string;
}
export type FormulaNode = Span & (
  | { readonly kind: "literal"; readonly value: CellValue }
  | { readonly kind: "omitted" }
  | { readonly kind: "reference"; readonly first: ReferenceEndpoint; readonly last?: ReferenceEndpoint }
  | { readonly kind: "name"; readonly name: string; readonly sheet?: string;
      /** Empty means the current workbook; without a sheet it selects only global names. */
      readonly workbook?: string }
  | { readonly kind: "unary"; readonly op: "+" | "-" | "%"; readonly child: FormulaNode }
  | { readonly kind: "binary"; readonly op: string; readonly left: FormulaNode; readonly right: FormulaNode }
  | { readonly kind: "parentheses"; readonly child: FormulaNode }
  | { readonly kind: "call"; readonly name: string; readonly spelling: string; readonly args: readonly FormulaNode[] }
  | { readonly kind: "array"; readonly rows: readonly (readonly FormulaNode[])[] }
);
export interface FormulaGrammar {
  readonly id: string;
  readonly address: "a1" | "r1c1";
  /** SC uses zero-based row numbers in otherwise A1 references. */
  readonly rowBase?: 0 | 1;
  readonly arguments: string;
  readonly arrayColumn: string;
  readonly arrayRow: string;
  readonly intersection: string;
  readonly union: string;
  readonly sheetSeparator: string;
  readonly bracketReferences: boolean;
  readonly stringEscape: "backslash" | "double" | "raw";
  readonly leftAssociativePower: boolean;
  readonly prefixes: readonly string[];
  readonly functionPrefixes: readonly string[];
  readonly functionAliases?: Readonly<Record<string, string>>;
  readonly functionExportAliases?: Readonly<Record<string, string>>;
  readonly odfRoundingArguments?: boolean;
  readonly excelNumericHandlers?: boolean;
  readonly functionPrefixAliases?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly booleanFunctions?: boolean;
  readonly functionArgumentInsertions?: Readonly<Record<string, { readonly arity: number; readonly index: number; readonly value: CellValue }>>;
  readonly nativeNames?: boolean;
  readonly singleQuotedStrings?: boolean;
  readonly quotedErrors?: boolean;
  readonly rangeSeparator?: string;
  readonly sheetSpans?: boolean;
  readonly qualifiedRangeEndpoints?: boolean;
  readonly absoluteSheetReferences?: boolean;
  readonly unquotedSheets?: boolean;
  readonly quoteSheetName?: (name: string) => string;
  readonly hashLogicals?: boolean;
  readonly wholeAxisReferences?: boolean;
  readonly qualifiedNames?: boolean;
}
export interface FormulaDocument {
  readonly source: string;
  readonly grammar: FormulaGrammar;
  readonly position: ParsePosition;
  readonly root: FormulaNode;
  readonly sheetNames?: Readonly<Record<string, string>>;
}
export interface FormulaParseOptions {
  readonly grammar?: FormulaGrammar;
  readonly position: ParsePosition;
  readonly workbook?: Workbook;
  readonly signal?: AbortSignal;
  readonly maximumNodes?: number;
  readonly maximumLength?: number;
  readonly onName?: (name: string, sheet?: string) => void;
}
export type FormulaParseResult =
  | { readonly ok: true; readonly document: FormulaDocument }
  | { readonly ok: false; readonly source: string; readonly diagnostic: Span & { readonly code: "syntax"; readonly message: string } };
