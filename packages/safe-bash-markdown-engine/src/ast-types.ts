export type Attr = readonly [string, readonly string[], readonly (readonly [string, string])[]];
export type Target = readonly [string, string];
type Tagged<T extends string, C> = { readonly t: T; readonly c: C };
type Empty<T extends string> = { readonly t: T };
export type Inline =
  | Tagged<"Str", string>
  | Empty<"Space" | "SoftBreak" | "LineBreak">
  | Tagged<
      "Emph" | "Underline" | "Strong" | "Strikeout" | "Superscript" | "Subscript" | "SmallCaps",
      readonly Inline[]
    >
  | Tagged<"Quoted", readonly ["SingleQuote" | "DoubleQuote", readonly Inline[]]>
  | Tagged<"Cite", readonly [readonly Citation[], readonly Inline[]]>
  | Tagged<"Code", readonly [Attr, string]>
  | Tagged<"Math", readonly ["InlineMath" | "DisplayMath", string]>
  | Tagged<"RawInline", readonly [string, string]>
  | Tagged<"Link" | "Image", readonly [Attr, readonly Inline[], Target]>
  | Tagged<"Note", readonly Block[]>
  | Tagged<"Span", readonly [Attr, readonly Inline[]]>;
export interface Citation {
  readonly citationId: string;
  readonly citationPrefix: readonly Inline[];
  readonly citationSuffix: readonly Inline[];
  readonly citationMode: "AuthorInText" | "SuppressAuthor" | "NormalCitation";
  readonly citationNoteNum: number;
  readonly citationHash: number;
}
export type Alignment = "AlignLeft" | "AlignRight" | "AlignCenter" | "AlignDefault";
export type Caption = readonly [readonly Inline[] | null, readonly Block[]];
export type ColSpec = readonly [Alignment, Empty<"ColWidthDefault"> | Tagged<"ColWidth", number>];
export type Cell = readonly [Attr, Alignment, number, number, readonly Block[]];
export type Row = readonly [Attr, readonly Cell[]];
export type TableHead = readonly [Attr, readonly Row[]];
export type TableBody = readonly [Attr, number, readonly Row[], readonly Row[]];
export type Block =
  | Tagged<"Plain" | "Para", readonly Inline[]>
  | Tagged<"LineBlock", readonly (readonly Inline[])[]>
  | Tagged<"CodeBlock", readonly [Attr, string]>
  | Tagged<"RawBlock", readonly [string, string]>
  | Tagged<"BlockQuote", readonly Block[]>
  | Tagged<
      "OrderedList",
      readonly [
        readonly [
          number,
          (
            | "DefaultStyle"
            | "Example"
            | "Decimal"
            | "LowerRoman"
            | "UpperRoman"
            | "LowerAlpha"
            | "UpperAlpha"
          ),
          "DefaultDelim" | "Period" | "OneParen" | "TwoParens"
        ],
        readonly (readonly Block[])[]
      ]
    >
  | Tagged<"BulletList", readonly (readonly Block[])[]>
  | Tagged<
      "DefinitionList",
      readonly (readonly [readonly Inline[], readonly (readonly Block[])[]])[]
    >
  | Tagged<"Header", readonly [number, Attr, readonly Inline[]]>
  | Empty<"HorizontalRule">
  | Tagged<"Div", readonly [Attr, readonly Block[]]>
  | Tagged<"Figure", readonly [Attr, Caption, readonly Block[]]>
  | Tagged<
      "Table",
      readonly [Attr, Caption, readonly ColSpec[], TableHead, readonly TableBody[], TableHead]
    >;
export type MetaValue =
  | MetaMap
  | Tagged<"MetaList", readonly MetaValue[]>
  | Tagged<"MetaBool", boolean>
  | Tagged<"MetaString", string>
  | Tagged<"MetaInlines", readonly Inline[]>
  | Tagged<"MetaBlocks", readonly Block[]>;
/** Sidecars are never embedded in serialized document data. */
export interface SourcePosition {
  readonly path: string;
  readonly source: string;
  readonly line: number;
  readonly column: number;
}
export interface LossDiagnostic {
  readonly path: string;
  readonly feature: string;
  readonly message: string;
}
export function assertNever(value: never): never {
  throw new Error(`Unhandled AST constructor: ${String(value)}`);
}

export interface MetaMap {
  readonly t: "MetaMap";
  readonly c: { readonly [key: string]: MetaValue };
}
