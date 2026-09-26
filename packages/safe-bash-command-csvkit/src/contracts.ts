import type { CsvWriteCell, CsvRecord, CsvCell } from "./csv.js";
import type { TypedTable } from "./table/index.js";
import type { OwnedArguments, ArgumentLimits } from "./argv.js";
import type { MatchFile } from "./match-files.js";
import type { SniffStreamProfile } from "./csv/sniffer-profile.js";
import type { DatabaseDialectDescriptor } from "./databases/descriptor.js";

export interface SniffingOptions {
  readonly stream?: SniffStreamProfile;
  /** Product resource bound, separate from reference -y semantics. */
  readonly maxSampleCharacters?: number;
  readonly suppressWarnings?: boolean;
  /** Frozen Agate deployment identity required for exact Python warning text. */
  readonly warning?: { readonly path: string; readonly line: number; readonly source?: string };
}

export type ByteSource = AsyncIterable<Uint8Array>;
export interface ByteSink { write(bytes: Uint8Array): Promise<void> }
export interface CsvkitWritableFile extends ByteSink { close(): Promise<void> }

/** All paths are virtual. The host binds access to its authorized filesystem. */
export interface CsvkitFileSystem {
  /** Native os.path.exists semantics, including directories and suppressed path OS errors. */
  exists?(path: string, options: { readonly signal: AbortSignal }): Promise<boolean>;
  /** Directory entry names, in provider order; enables dbfread's case-insensitive filename lookup. */
  listDirectory?(path: string, options: { readonly signal: AbortSignal }): Promise<readonly string[]>;
  readFile(path: string, options: { readonly signal: AbortSignal; readonly maxBytes?: number }): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array, options: { readonly signal: AbortSignal }): Promise<void>;
  /** Truncating open with awaited writes. Enables source-compatible partial side-file effects. */
  openWriteFile?(path: string, options: { readonly signal: AbortSignal }): Promise<CsvkitWritableFile>;
  readStream?(path: string, options: { readonly signal: AbortSignal }): ByteSource;
}

export interface TerminalCapabilities {
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
  readonly stderrIsTTY: boolean;
  readonly columns: number;
  readonly lines: number;
}

export interface CodecProvider {
  readonly names: readonly string[];
  decodeStream?(source: ByteSource, encoding: string, signal: AbortSignal): AsyncIterable<string>;
  decode(bytes: Uint8Array, encoding: string, signal: AbortSignal): Promise<string>;
  encode(text: string, encoding: string, signal: AbortSignal): Promise<Uint8Array>;
}

export interface CompressionProvider {
  readonly extensions: readonly string[];
  decode(source: ByteSource, signal: AbortSignal, limits?: Pick<CsvkitLimits, "maxArchiveMembers">): ByteSource;
}

export interface LocaleServices {
  readonly profile: string;
  readonly timezone: string;
  formatNumber(value: string, locale: string, format: string, grouping: boolean): string;
}

export interface CsvkitLimits extends ArgumentLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxRetainedBytes: number;
  readonly maxCodepoints: number;
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxFieldCharacters: number;
  readonly maxWork: number;
  readonly maxRegexWork: number;
  readonly maxDecimalDigits: number;
  readonly maxDecimalExponent: number;
  readonly maxArchiveMembers: number;
  readonly maxInflatedBytes: number;
  readonly maxDatabaseResultRows: number;
  readonly maxInterpreterWork: number;
  readonly maxNestingDepth: number;
}

export type SqlValue = CsvWriteCell | Uint8Array;
/** Driver output preserves Python scalar identity/representation, notably integral floats. */
export type DatabaseCell = SqlValue | CsvWriteCell;
export interface DatabaseResult {
  readonly columns: readonly string[] | null;
  readonly rows: AsyncIterable<readonly DatabaseCell[]>;
  close(): Promise<void>;
}
export interface DatabaseSession {
  readonly profile: string;
  /** Explicit transport compiler/bind profile; never inferred from driver presence. */
  readonly sqlDialect?: DatabaseDialectDescriptor;
  /** SQLAlchemy dialect identity, when it differs from the URL scheme. */
  readonly dialect?: string;
  /** Driver reflection, including schema visibility, for checkfirst operations. */
  hasTable?(name: string, schema: string | null, signal: AbortSignal): Promise<boolean>;
  /** Optional driver executemany; the fallback issues the same bound rows individually. */
  executeMany?(sql: string, rows: readonly (readonly SqlValue[])[], signal: AbortSignal): Promise<DatabaseResult>;
  begin(signal: AbortSignal): Promise<void>;
  query(sql: string, values: readonly SqlValue[], options: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<DatabaseResult>;
  commit(signal: AbortSignal): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}
export interface DatabaseProvider {
  readonly schemes: readonly string[];
  readonly profile: string;
  connect(url: string, options: Readonly<Record<string, unknown>>, signal: AbortSignal, invocation?: { readonly cwd: string }): Promise<DatabaseSession>;
}

export interface InterpreterSession {
  readonly profile: string;
  interact(banner: string, signal: AbortSignal): Promise<void | number>;
  close(): Promise<void>;
}
export interface InterpreterWorkBudget {
  readonly limit: number;
  /** A cooperative guest must account its work; this cannot preempt opaque host code. */
  consume(units?: number): void;
}
export interface CsvpyConvertedInput {
  readonly mode: "reader" | "dict" | "agate";
  readonly settings: Readonly<Record<string, unknown>>;
  readonly reader: () => Promise<Iterator<CsvRecord<CsvCell>>>;
  readonly table: () => Promise<TypedTable>;
  readonly write: (text: string, channel: "stdout" | "stderr") => Promise<void>;
  /** Admit synchronous guest output before retaining it for awaited engine writes. */
  readonly retainOutput: (bytes: number) => void;
}
export interface InterpreterProvider {
  readonly modes: readonly ("reader" | "dict" | "agate")[];
  /** Requires actual compatible guest objects; a JavaScript table alone is insufficient. */
  load(mode: "reader" | "dict" | "agate", source: ByteSource, settings: Readonly<Record<string, unknown>>, signal: AbortSignal, work: InterpreterWorkBudget): Promise<InterpreterSession>;
  /** JavaScript conversion path; guests receive session-owned Python objects. */
  loadConverted?(input: CsvpyConvertedInput, signal: AbortSignal, work: InterpreterWorkBudget): Promise<InterpreterSession>;
}

/** Explicit execution boundary consumed by the shared command/SDK engine. */
export interface CsvkitContext {
  readonly argv: Pick<OwnedArguments, "length" | "byteLength" | "bytes">;
  readonly cwd: string;
  readonly fs: CsvkitFileSystem;
  readonly stdin: ByteSource;
  readonly stdinIsDefault: boolean;
  readonly stdout: ByteSink;
  readonly stderr: ByteSink;
  readonly terminal: TerminalCapabilities;
  readonly env: Readonly<Record<string, string>>;
  readonly codecs: readonly CodecProvider[];
  readonly compression: readonly CompressionProvider[];
  readonly locale: LocaleServices;
  readonly clock: { now(): number };
  readonly databases: readonly DatabaseProvider[];
  /** Optional, independently qualified entry-point compiler profiles. Core CLI choices remain frozen. */
  readonly sqlDialects?: readonly DatabaseDialectDescriptor[];
  readonly interpreter?: InterpreterProvider;
  readonly sniffing?: SniffingOptions;
  /** Frozen Agate utils deployment path for column warning diagnostics. */
  readonly columnWarnings?: { readonly utilsPath?: string; readonly suppressWarnings?: boolean };
  /** Open and close a named input without reading content. Host owns cleanup and
   * cancellation during this probe; a stat-only check is not an equivalent binding. */
  readonly probeInputOpen?: (path: string, options: { readonly cwd: string; readonly signal: AbortSignal }) => Promise<void>;
  /** FileType text opening only, including explicit host handling of '-' as stdin. */
  readonly openMatchFile?: (path: string, options: { readonly cwd: string; readonly signal: AbortSignal }) => Promise<MatchFile>;
  readonly limits: CsvkitLimits;
  readonly signal: AbortSignal;
  /** Called before acquisition; cooperative cleanup must share idempotent completion.
   * Omitted destination enrolls the stdout producer. "invocation" enrolls sibling
   * file work that must remain active when the stdout consumer closes. */
  registerCleanup(cleanup: () => Promise<void>, destination?: "invocation"): void;
}
