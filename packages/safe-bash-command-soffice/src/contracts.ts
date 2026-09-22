export class SofficeError extends Error {
  constructor(readonly code: 'invalid-argument' | 'limit' | 'cancelled' | 'closed' | 'unsupported' | 'ambiguous-filter', message: string, readonly detail?: string) {
    super(message); this.name = 'SofficeError';
  }
}
export type DocumentService = 'writer' | 'spreadsheet' | 'presentation';
export type SofficeResource = 'argumentBytes' | 'files' | 'inputBytes' | 'retainedBytes' | 'outputBytes' | 'nodes' | 'pages' | 'work';
export type SofficeLimits = Readonly<Record<SofficeResource, number>>;
export type SofficeCapability = 'conversion' | 'odf' | 'pagination' | 'shaping' | 'spreadsheetFormulas' | 'slideMasters' | 'charts' | 'pdfA' | 'pdfUA' | 'notesPages';
/** Qualification, not discovery of installed libraries or caller-supplied flags. */
export const sofficeCapabilities: Readonly<Record<SofficeCapability, boolean>> = Object.freeze({
  conversion: false, odf: false, pagination: false, shaping: false, spreadsheetFormulas: false,
  slideMasters: false, charts: false, pdfA: false, pdfUA: false, notesPages: false
});
export interface OfficeFilter {
  readonly name: string;
  readonly service: DocumentService;
  readonly extensions: readonly string[];
  readonly import: boolean;
  readonly export: boolean;
  /** Declared preferred export type, never guessed from suffix alone. */
  readonly preferred: boolean;
  readonly requires: readonly SofficeCapability[];
}
export interface ConversionParameters { readonly extension: string; readonly filter: string; readonly options: string }
export type FileEvent = 'open' | 'new' | 'conversion';
export interface SofficeInvocation {
  readonly files: readonly { readonly path: string; readonly event: FileEvent }[];
  readonly conversion?: ConversionParameters;
  readonly importFilters: readonly { readonly name: string; readonly options: string }[];
  readonly textCat: boolean;
  readonly scriptCat: boolean;
  readonly outdir?: string;
  readonly headless: boolean;
  readonly help: boolean;
  readonly version: boolean;
  readonly warnings: readonly string[];
}
/** Engine integration boundary. Paths are literal VFS paths; external relationships stay inert. */
export interface OfficeVfs {
  read(path: string, signal: AbortSignal): AsyncIterable<Uint8Array>;
  /** Invocation-owned staging only. Publish must preflight aliases/collisions before writes. */
  stage(path: string, bytes: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<void>;
  /** Cleanup must remain available after cancellation. */
  discard(): Promise<void>;
}
export interface OfficeEngineContext {
  readonly vfs: OfficeVfs;
  readonly signal: AbortSignal;
  readonly budget: import('./budget.js').SofficeBudget;
  readonly fonts: readonly { readonly bytes: Uint8Array; readonly license: string; readonly sha256: string; readonly metricsVersion: string }[];
}
/** No engine implementation is admitted by this interface alone. */
export interface OfficeConversionEngine {
  readonly filters: readonly OfficeFilter[];
  import(input: AsyncIterable<Uint8Array>, filter: OfficeFilter, options: string, context: OfficeEngineContext): Promise<import('./model.js').OfficeDocument>;
  export(document: import('./model.js').OfficeDocument, filter: OfficeFilter, options: string, context: OfficeEngineContext): AsyncIterable<Uint8Array>;
}
