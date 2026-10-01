/** Coordinates and dimensions are PDF points; flow uses top-down placement. */
export interface PageBox { readonly width: number; readonly height: number; readonly margin: number }
export interface SuppliedFont { readonly id: string; readonly bytes: Uint8Array }
export type StandardFontName = "Helvetica" | "Helvetica-Bold" | "Helvetica-Oblique" | "Helvetica-BoldOblique" | "Courier" | "Courier-Bold" | "Courier-Oblique" | "Courier-BoldOblique" | "Times-Roman" | "Times-Bold" | "Times-Italic" | "Times-BoldItalic" | "Symbol" | "ZapfDingbats";
export interface StandardFont {readonly id: string; readonly standard: StandardFontName}
export interface TextRun {
  readonly text: string; readonly font?: string; readonly size?: number; readonly link?: string;
  /** Synthetic weight/oblique apply to supplied fonts, including Unicode fallback; standard fonts use their named face. */
  readonly bold?: boolean; readonly italic?: boolean; readonly strikeout?: boolean; readonly underline?: boolean;
}
export interface PaginationConstraints { readonly breakBefore?: boolean; readonly keepTogether?: boolean }
export interface Paragraph extends PaginationConstraints {
  /** Optional flat outline entry targeting the first placed line. */
  readonly outline?: string;
  readonly kind: "paragraph"; readonly runs: readonly TextRun[]; readonly spaceAfter?: number;
  readonly keepWithNext?: boolean;
  readonly indent?: number; readonly widows?: number; readonly orphans?: number;
  readonly align?: "left" | "center" | "right";
  readonly longWord?: "wrap" | "error";
}
export interface ImageBlock extends PaginationConstraints { readonly kind: "image"; readonly bytes: Uint8Array; readonly media: "png" | "jpeg"; readonly width: number; readonly height: number; readonly fit?: "contain" | "natural" }
export interface RuleBlock extends PaginationConstraints { readonly kind: "rule"; readonly indent?: number }
/** Rectangular unspanned tables; leading header rows repeat on continuation pages. */
export interface TableBlock extends PaginationConstraints { readonly kind: "table"; readonly rows: readonly (readonly Paragraph[])[]; readonly widths: readonly number[]; readonly headerRows?: number; readonly rowSplit?: "error" | "lines" }
export type LayoutBlock = Paragraph | ImageBlock | TableBlock | RuleBlock;
export interface PdfMetadata {readonly title?: string; readonly author?: string; readonly subject?: string; readonly keywords?: readonly string[]}
export interface LayoutDocument { readonly metadata?: PdfMetadata; readonly page?: PageBox; readonly lineHeight?: number; readonly fonts: readonly (SuppliedFont | StandardFont)[]; readonly blocks: readonly LayoutBlock[] }
export interface PdfLimits { readonly fontBytes: number; readonly fonts: number; readonly glyphs: number; readonly pages: number; readonly objects: number; readonly images: number; readonly imageBytes: number; readonly imagePixels: number; readonly decodedImageBytes: number; readonly layoutWork: number; readonly outputBytes: number }
export interface PdfContext {
  /** Top-down boxes of emitted content, for consumers inspecting layout. Page is one-based. */
  readonly onPlacement?: (box: Placement) => void;
  readonly signal?: AbortSignal | undefined;
  readonly limits?: Partial<PdfLimits>;
  /** Called before each admitted allocation/work unit, permitting shared host budgets. */
  readonly charge?: (key: keyof PdfLimits, amount: number) => void;
  readonly yield?: () => Promise<void>;
}
export interface Placement { readonly kind: "text" | "image" | "cell" | "rule"; readonly page: number; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly text?: string }
