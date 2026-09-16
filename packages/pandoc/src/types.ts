/** A conversion AST. Format adapters must validate Pandoc constructor semantics. */
export interface Node { readonly t: string; readonly c?: unknown }
export interface Resource { readonly id: string; readonly bytes: Uint8Array }
export interface Document {
  readonly blocks: readonly Node[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly resources: readonly Resource[];
}
export interface Input { readonly bytes: Uint8Array; readonly base?: string }
export type SerializedDocument = { readonly kind: "text"; readonly text: string } | { readonly kind: "binary"; readonly bytes: Uint8Array };
export type ConversionResult = SerializedDocument & { readonly diagnostics: readonly Diagnostic[] };
export type Operation = "read" | "write" | "convert";
export type DiagnosticCode = "E_FORMAT_REQUIRED" | "E_FORMAT" | "E_EXTENSION" | "E_OPTION" | "E_CAPABILITY" | "E_AST" | "E_ENCODING" | "E_LIMIT" | "E_CANCELLED" | "E_IO" | "E_INTERNAL" | "W_METADATA_CONFLICT";
export interface Diagnostic { readonly code: DiagnosticCode; readonly operation: Operation; readonly message: string; readonly format?: string | undefined; readonly location?: string | undefined }
export interface Limits { readonly inputBytes: number; readonly resourceBytes: number; readonly outputBytes: number; readonly nodes: number; readonly depth: number; readonly work: number }
export interface ReadOptions { readonly from: string }
export interface WriteOptions { readonly to: string }
export interface ConversionOptions extends ReadOptions, WriteOptions {}
/** Explicit trusted adapters; their format conformance is not established by this seam. */
export interface AdapterContext {
  readonly signal: AbortSignal | undefined;
  readonly limits: Limits;
  readonly resources: ResourceCapability | undefined;
  checkpoint(units?: number): void;
}
export interface ResourceCapability { resolve(id: string, base: string | undefined, signal: AbortSignal | undefined): Promise<Uint8Array> }
export interface ReaderCapability { readonly format: string; read(input: Input, context: AdapterContext): Promise<Document> }
export interface WriterCapability { readonly format: string; write(document: Document, context: AdapterContext): Promise<SerializedDocument> }
/** publish must provide atomic publication; it receives owned bytes and must honor cancellation. */
export interface OutputCapability { publish(bytes: Uint8Array, signal: AbortSignal | undefined): Promise<void> }
export interface ConversionContext {
  readonly reader?: ReaderCapability;
  readonly writer?: WriterCapability;
  readonly resources?: ResourceCapability;
  readonly output?: OutputCapability;
  readonly limits?: Partial<Limits>;
  readonly signal?: AbortSignal;
}
