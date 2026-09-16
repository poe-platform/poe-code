import type { FormatSelection } from "./formats.js";
import type { Block, Inline, MetaValue } from "./ast-types.js";
export type Node = Block | Inline;
export interface Resource {
  readonly id: string;
  readonly bytes: Uint8Array;
}
export interface Document {
  readonly blocks: readonly Block[];
  readonly metadata: Readonly<Record<string, MetaValue>>;
  readonly resources: readonly Resource[];
  readonly language?: string;
  readonly direction?: "ltr" | "rtl" | "auto";
}
export interface Input {
  readonly bytes: Uint8Array;
  /** Present for UTF-8 formats after per-input BOM/newline normalization. */
  readonly text?: string;
  readonly base?: string;
}
export interface StreamingInput {
  readonly chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
  readonly base?: string;
}
export type InputSource = Input | StreamingInput;
export type SerializedDocument =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "binary"; readonly bytes: Uint8Array };
export type ConversionResult = SerializedDocument & { readonly diagnostics: readonly Diagnostic[] };
export type Operation = "read" | "write" | "convert";
export type DiagnosticCode =
  | "E_FORMAT_REQUIRED"
  | "E_FORMAT"
  | "E_EXTENSION"
  | "E_OPTION"
  | "E_CAPABILITY"
  | "E_AST"
  | "E_ENCODING"
  | "E_PARSE"
  | "E_LIMIT"
  | "E_CANCELLED"
  | "E_IO"
  | "E_INTERNAL"
  | "W_TABLE_LOSS"
  | "W_RAW_CONTENT"
  | "W_METADATA_CONFLICT";
export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly operation: Operation;
  readonly message: string;
  readonly format?: string | undefined;
  readonly location?: string | undefined;
}
export interface Limits {
  readonly inputBytes: number;
  readonly resourceBytes: number;
  readonly outputBytes: number;
  readonly nodes: number;
  readonly depth: number;
  readonly work: number;
  readonly retainedBytes: number;
  readonly text: number;
  readonly attributes: number;
  readonly tableCells: number;
  /** Delimited reader ceilings: decoded UTF-16 units per field, records including header, columns. */
  readonly tableFieldText: number;
  readonly tableRows: number;
  readonly tableColumns: number;
  readonly resources: number;
  readonly diagnostics: number;
  readonly references: number;
  readonly entities: number;
  readonly entityBytes: number;
  readonly compressedBytes: number;
  readonly expandedBytes: number;
  readonly parts: number;
  readonly xmlDepth: number;
  readonly xmlNodes: number;
  readonly binaryBytes: number;
  readonly macros: number;
  readonly includes: number;
  readonly directives: number;
  readonly fonts: number;
  readonly glyphs: number;
  readonly pages: number;
  readonly objects: number;
  readonly images: number;
  readonly layoutWork: number;
}
export interface ReadOptions {
  readonly from: string;
}
export interface WriteOptions {
  readonly wrap?: "none";
  readonly to: string;
  readonly standalone?: boolean;
  readonly metadata?: Readonly<Record<string, MetaValue>>;
  readonly rawContent?: "reject" | "escape" | "retain";
  /** Strict by default; explicitly permit diagnosed table text projections. */
  readonly lossy?: boolean;
}
export interface ConversionOptions extends ReadOptions, WriteOptions {}
/** Explicit trusted adapters; their format conformance is not established by this seam. */
export interface AdapterContext {
  readonly operation?: Operation;
  readonly lossy?: boolean;
  readonly standalone?: boolean;
  readonly rawContent?: "reject" | "escape" | "retain" | undefined;
  readonly signal: AbortSignal | undefined;
  readonly limits: Limits;
  readonly resources: ResourceCapability | undefined;
  checkpoint(units?: number): void;
  /** Reserve aggregate capacity before allocating or extending parser/writer data. */
  charge(key: keyof Limits, units: number): void;
  /** Check a gauge (e.g. nesting depth) without accumulating it. */
  bound(key: keyof Limits, actual: number): void;
  cooperate(units?: number): Promise<void>;
  decodeUtf8(chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<string>;
  /** Reserve entity expansion before constructing its Unicode scalar. */
  decodeEntity(code: number): string;
  decodeCodepage(bytes: Uint8Array, codepage?: 1252 | 28591): Promise<string>;
  retainBinaryBlock(bytes: Uint8Array): Uint8Array;
  report(diagnostic: Diagnostic): void;
  /** Strictly advancing cursor for pagination and other iterative layouts. */
  progress(id: string, cursor: number): void;
}
export interface ResourceCapability {
  resolve(
    id: string,
    base: string | undefined,
    signal: AbortSignal | undefined
  ): Promise<Uint8Array>;
}
export interface ReaderCapability {
  readonly format: string;
  read(input: Input, context: AdapterContext, selection?: FormatSelection): Promise<Document>;
}
export interface WriterCapability {
  readonly format: string;
  readonly math?: "source";
  write(
    document: Document,
    context: AdapterContext,
    selection?: FormatSelection
  ): Promise<SerializedDocument>;
}
/** publish must provide atomic publication; it receives owned bytes and must honor cancellation. */
export interface OutputCapability {
  publish(bytes: Uint8Array, signal: AbortSignal | undefined): Promise<void>;
}
/** Streaming hosts may expose partial output on failure; close must report commit failure. */
export interface StreamingOutputCapability {
  write(bytes: Uint8Array, signal: AbortSignal | undefined): Promise<void>;
  close(signal: AbortSignal | undefined): Promise<void>;
  abort(reason: unknown): Promise<void>;
}
export interface ConversionContext {
  readonly reader?: ReaderCapability;
  readonly writer?: WriterCapability;
  readonly resources?: ResourceCapability;
  readonly output?: OutputCapability | StreamingOutputCapability;
  readonly limits?: Partial<Limits>;
  readonly signal?: AbortSignal;
  /** Trusted event-loop scheduler, chiefly for deterministic host/test integration. */
  readonly yield?: () => Promise<void>;
}
