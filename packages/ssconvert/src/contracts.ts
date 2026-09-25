import type { Codec } from "./codecs.js";
import type { Workbook, CellUpdate, CellRange, SheetSelection } from "./workbook.js";
import type { FormulaCapability, GoalSeekRequest, ExternalReferencesCapability } from "./formulas.js";
import type { FormattingCapability } from "./formatting.js";
import type { RenderingCapability, ClipboardCapability, GraphRequest } from "./rendering.js";
import type { SolverCapability, AnalysisCapability, AnalysisRequest } from "./solver.js";
export type ByteSource = Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
export interface ByteSink {
  write(bytes: Uint8Array): Promise<void>;
}
export type Cleanup = () => void | Promise<void>;
export interface Operation {
  readonly signal: AbortSignal;
  /** Stdin provenance supplied by the host; independent of bytes or EOF. */
  readonly stdinIsDefault?: boolean;
  readonly registerCleanup?: (cleanup: Cleanup) => void;
  /** Awaited stderr diagnostics, including notices preceding a later failure. */
  readonly diagnostic?: (diagnostic: Diagnostic) => Promise<void>;
}
export interface FileSystem {
  /** Actual absolute VFS working directory, captured by a resource binding. */
  readonly cwd?: string;
  read(uri: string, signal: AbortSignal): Promise<ByteSource>;
  /** Host controls publication/overwrite policy; bytes are borrowed until settlement. */
  write(uri: string, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  /** Optional measured file publication protocol. Undefined retains the host's byte-write contract. */
  openOutput?(uri: string, context: CapabilityContext): Promise<FileOutput | undefined>;
}
export interface FileOutput {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
export interface Environment {
  /** Actual VFS working directory; independent of the guest-visible PWD variable. */
  readonly cwd?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly locale: string;
  readonly timezone: string;
  readonly system?: string;
  readonly osVersion?: string;
  readonly umask?: number;
}
export interface RuntimeLimits {
  /** Host refusals, independent of native format validity. Defaults preserve existing bounds. */
  readonly argumentBytes?: number;
  /** CLI terminal/listing bytes, separate from workbook conversion output. */
  readonly commandOutputBytes?: number;
  readonly compressedBytes?: number;
  readonly inflatedBytes?: number;
  /** Maximum Argon2 arena bytes for encrypted ODF import/export; defaults to 64 MiB. */
  readonly encryptionMemoryBytes?: number;
  readonly zipEntries?: number;
  readonly zipRatio?: number;
  readonly xmlDepth?: number;
  readonly splitOutputs?: number;
  readonly workbookNodes?: number;
  readonly workbookTextBytes?: number;
  /** Workbook processing work, including metadata comparisons, input chunks and admitted cryptographic work. */
  readonly workbookWork?: number;
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly cells: number;
  readonly sheets: number;
  /** Per invocation: updates, goal requests, exporter strings and enabled transforms.
   * Also bounds an analysis property array before its owned copy is allocated. */
  readonly operations: number;
}
/** Trusted host secret acquisition. Never sourced from guest argv, environment or logs. */
export interface PasswordCapability {
  read(request: Readonly<{
    maxBytes: number;
    inputFilename?: string;
    /** Absent on existing import requests; encrypt requests identify the destination. */
    purpose?: "encrypt";
    outputFilename?: string;
    signal: AbortSignal;
  } & ({
    format: "biff";
    algorithm: "xor" | "rc4" | "rc4-cryptoapi";
    revision: number;
    /** XOR requires explicitly encoded bytes (import 0–15, export 1–15).
     * A dual-stream XOR export asks once with revision 8 for both streams.
     * RC4 accepts a string or UTF-16LE bytes. */
    encoding: "bytes" | "utf16le";
  } | {
    format: "odf";
    algorithm: "aes-cbc" | "aes-gcm" | "blowfish-cfb8" | "blowfish-cfb64" | "mixed";
    revision: "1.2" | "libreoffice";
    /** ODF passwords are UTF-8 strings or explicitly encoded UTF-8 bytes. */
    encoding: "utf8";
  } | {
    format: "paradox";
    algorithm: "paradox";
    revision: 12;
    purpose: "encrypt";
    /** Explicit bytes only, 1–256 total. Native NUL termination applies;
     * an empty effective password cannot produce an encrypted table. */
    encoding: "bytes";
  })>): Promise<string | Uint8Array | undefined>;
}
/** Trusted cryptographic randomness. The host must provide fresh, unpredictable bytes. */
export interface CryptographicEntropyCapability {
  read(request: Readonly<{ length: number; signal: AbortSignal }>): Promise<Uint8Array | undefined>;
}
/** Explicit host font selection; no system-font or filesystem discovery. */
export interface FontCapability {
  resolve(request: Readonly<{
    family: string;
    bold: boolean;
    italic: boolean;
    /** Remaining invocation font-byte budget, admitted before copying/parsing. */
    maxBytes: number;
    signal: AbortSignal;
  }>): Promise<Uint8Array | undefined>;
}
export interface CapabilityContext {
  readonly entropy?: CryptographicEntropyCapability;
  readonly fonts?: FontCapability;
  readonly datasource?: import("./datasource.js").DatasourceSession;
  readonly stdinIsDefault?: boolean;
  readonly runtimeFunctions?: import("./formulas/runtime-functions.js").RuntimeFunctions;
  /** Invocation-local source identity for filename-sensitive importers. */
  readonly inputFilename?: string;
  /** Invocation-local destination identity for filename-sensitive exporters. */
  readonly outputFilename?: string;
  readonly signal: AbortSignal;
  readonly environment: Environment;
  readonly limits: RuntimeLimits;
  readonly clock?: { now(): number };
  readonly random?: { next(): number };
  readonly externalReferences?: ExternalReferencesCapability;
  readonly password?: PasswordCapability;
  readonly formatting?: FormattingCapability;
  /** Register synchronously before acquisition; cleanup must be cooperative. */
  own(cleanup: Cleanup): void;
  readonly diagnostic?: (diagnostic: Diagnostic) => Promise<void>;
}
export interface EngineConfig {
  /** Required only for explicitly requested encrypted exports; never uses random.next. */
  readonly entropy?: CryptographicEntropyCapability;
  /** Explicit supplied fonts for the PDF painter. Undefined retains the packaged default. */
  readonly fonts?: FontCapability;
  /** Explicit optional sample datasource transport, owned per operation. */
  readonly datasource?: import("./datasource.js").DatasourceCapability;
  readonly runtimeFunctions?: import("./formulas/runtime-functions.js").RuntimeFunctions;
  readonly codecs: readonly Codec[];
  readonly limits: RuntimeLimits;
  readonly environment: Environment;
  readonly filesystem?: FileSystem;
  readonly clock?: CapabilityContext["clock"];
  readonly random?: CapabilityContext["random"];
  readonly externalReferences?: ExternalReferencesCapability;
  readonly password?: PasswordCapability;
  readonly formulas?: FormulaCapability;
  readonly formatting?: FormattingCapability;
  readonly rendering?: RenderingCapability;
  readonly clipboard?: ClipboardCapability;
  readonly solver?: SolverCapability;
  readonly analysis?: AnalysisCapability;
  readonly cellText?: {
    setText(book: Workbook, range: CellRange, text: string, context: CapabilityContext): Promise<Workbook>;
  };
  readonly resize?: {
    resizeSheet(book: Workbook, sheet: string, size: { readonly rows: number; readonly columns: number },
      context: CapabilityContext): Promise<Workbook | undefined>;
  };
}
export type Input =
  | { readonly kind: "stream"; readonly source: ByteSource; readonly filename?: string }
  | { readonly kind: "resource"; readonly uri: string };
export type Destination =
  | { readonly kind: "stream"; readonly sink: ByteSink }
  | { readonly kind: "resource"; readonly uri: string };
export interface ConversionRequest {
  readonly input: Input;
  /** Omission requires an explicit exporter with an extension; inferred from input URI. */
  readonly destination?: Destination;
  readonly importType?: string;
  readonly importEncoding?: string;
  readonly exportType?: string;
  readonly exportOptions?: readonly string[];
  readonly updates?: readonly CellUpdate[];
  /** Native --set expressions; evaluated after loading, in supplied order. */
  readonly updateExpressions?: readonly string[];
  readonly selection?: SheetSelection;
  readonly exportRange?: CellRange;
  readonly exportRangeExpression?: string;
  readonly goalSeekExpressions?: readonly string[];
  readonly recalc?: boolean;
  readonly solve?: boolean;
  readonly goalSeek?: readonly GoalSeekRequest[];
  readonly analysis?: AnalysisRequest;
  readonly resize?: { readonly rows: number; readonly columns: number };
  readonly resizeExpression?: string;
  readonly toolTest?: readonly string[];
  readonly perSheet?: boolean;
  readonly verbose?: boolean;
  readonly graphs?: boolean;
  readonly clipboard?: string;
}
export interface MergeRequest extends Omit<ConversionRequest, "input"> {
  readonly inputs: readonly Input[];
}
export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "warning" | "error";
  readonly bytes?: Uint8Array;
}
export interface OperationResult {
  readonly exitCode: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly artifacts: readonly { readonly uri?: string; readonly bytes: number }[];
  readonly usage: { readonly inputBytes: number; readonly outputBytes: number };
  readonly profile: "gnumeric-1.12.61";
}
export interface Engine {
  readonly limits: RuntimeLimits;
  listServices(direction: "read" | "write"): readonly import("./codecs.js").ServiceDescriptor[];
  readWorkbook(
    input: Input,
    options: { readonly importType?: string; readonly importEncoding?: string },
    operation: Operation
  ): Promise<Workbook>;
  writeWorkbook(
    book: Workbook,
    destination: Destination,
    options: { readonly exportType: string; readonly exportOptions?: readonly string[] },
    operation: Operation
  ): Promise<OperationResult>;
  convert(request: ConversionRequest, operation: Operation): Promise<OperationResult>;
  merge(request: MergeRequest, operation: Operation): Promise<OperationResult>;
  exportGraphs(
    request: { readonly input: Input; readonly graph: GraphRequest },
    operation: Operation
  ): Promise<OperationResult>;
  exportClipboard(
    request: {
      readonly input: Input;
      readonly target: string;
      readonly range: CellRange;
      readonly destination: Destination;
    } & Pick<ConversionRequest, "updates" | "updateExpressions" | "importEncoding">,
    operation: Operation
  ): Promise<OperationResult>;
  dispose(): Promise<void>;
}
const ssconvertErrorBrand = Symbol.for("poe-code.ssconvert.SsconvertError");

export function isSsconvertError(value: unknown): value is SsconvertError {
  return value instanceof Error && Object.getOwnPropertyDescriptor(value, ssconvertErrorBrand)?.value === true;
}

export class SsconvertError extends Error {
  constructor(
    readonly code:
      | "unsupported-feature"
      | "capability-denied"
      | "resource-limit"
      | "invalid-request"
      | "io",
    message: string,
    readonly exitCode = 1
  ) {
    super(message);
    this.name = "SsconvertError";
    Object.defineProperty(this, ssconvertErrorBrand, { value: true });
  }
}
