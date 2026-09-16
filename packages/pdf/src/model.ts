/** Coordinates and dimensions are PDF points; flow uses top-down placement. */
export interface PageBox { readonly width: number; readonly height: number; readonly margin: number }
export interface SuppliedFont { readonly id: string; readonly bytes: Uint8Array }
export interface TextRun { readonly text: string; readonly font?: string; readonly size?: number; readonly link?: string }
export interface PaginationConstraints { readonly breakBefore?: boolean; readonly keepTogether?: boolean }
export interface Paragraph extends PaginationConstraints { readonly kind: "paragraph"; readonly runs: readonly TextRun[]; readonly spaceAfter?: number }
export interface ImageBlock extends PaginationConstraints { readonly kind: "image"; readonly bytes: Uint8Array; readonly media: "png" | "jpeg"; readonly width: number; readonly height: number }
/** Rows are indivisible; only rectangular, unspanned tables in this profile. */
export interface TableBlock extends PaginationConstraints { readonly kind: "table"; readonly rows: readonly (readonly Paragraph[])[]; readonly widths: readonly number[] }
export type LayoutBlock = Paragraph | ImageBlock | TableBlock;
export interface LayoutDocument { readonly page?: PageBox; readonly fonts: readonly SuppliedFont[]; readonly blocks: readonly LayoutBlock[] }
export interface PdfLimits { readonly fontBytes: number; readonly fonts: number; readonly glyphs: number; readonly pages: number; readonly objects: number; readonly images: number; readonly imageBytes: number; readonly decodedImageBytes: number; readonly layoutWork: number; readonly outputBytes: number }
export interface PdfContext {
  readonly signal?: AbortSignal | undefined;
  readonly limits?: Partial<PdfLimits>;
  /** Called before each admitted allocation/work unit, permitting shared host budgets. */
  readonly charge?: (key: keyof PdfLimits, amount: number) => void;
  readonly yield?: () => Promise<void>;
}
