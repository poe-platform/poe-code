import type { DocumentService, SofficeCapability } from './contracts.js';
/** Versioned interchange contract; format adapters must reject unrepresentable semantics. */
export interface OfficeDocument {
  readonly modelVersion: 1;
  readonly service: DocumentService;
  readonly styles: readonly OfficeStyle[];
  readonly sections: readonly OfficeSection[];
  readonly images: readonly OfficeImage[];
  readonly footnotes: readonly { readonly id: string; readonly blocks: readonly OfficeBlock[] }[];
  readonly requiredCapabilities: readonly SofficeCapability[];
  /** Original inert parts retained by an adapter; retention is not conversion qualification. */
  readonly inertParts: readonly { readonly name: string; readonly mediaType: string; readonly bytes: Uint8Array }[];
}
export interface OfficeStyle {
  readonly id: string;
  readonly parent?: string;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
}
export interface OfficeSection {
  readonly id: string;
  readonly style?: string;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
  readonly blocks: readonly OfficeBlock[];
  readonly headers: readonly OfficeBlock[];
  readonly footers: readonly OfficeBlock[];
}
export interface OfficeImage {
  readonly id: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly altText: string;
}
export type OfficeInline =
  | { readonly kind: 'text'; readonly text: string; readonly style?: string }
  | { readonly kind: 'link'; readonly target: string; readonly children: readonly OfficeInline[]; readonly behavior: 'inert' }
  | { readonly kind: 'image'; readonly image: string; readonly widthEmu: number; readonly heightEmu: number; readonly properties: Readonly<Record<string, string | number | boolean>> }
  | { readonly kind: 'footnote'; readonly id: string }
  | { readonly kind: 'field'; readonly instruction: string; readonly cached: readonly OfficeInline[]; readonly behavior: 'inert' }
  | { readonly kind: 'break'; readonly type: 'line' | 'page' | 'column' };
export type OfficeBlock =
  | { readonly kind: 'paragraph'; readonly style?: string; readonly children: readonly OfficeInline[]; readonly properties: Readonly<Record<string, string | number | boolean>> }
  | { readonly kind: 'table'; readonly style?: string; readonly rows: readonly OfficeTableRow[]; readonly properties: Readonly<Record<string, string | number | boolean>> };
export interface OfficeTableRow {
  readonly repeatHeader: boolean;
  readonly allowSplit: boolean;
  readonly cells: readonly { readonly rowSpan: number; readonly columnSpan: number; readonly blocks: readonly OfficeBlock[]; readonly properties: Readonly<Record<string, string | number | boolean>> }[];
}
