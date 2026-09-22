import type { FilenameDialect, FilenameExpression } from './filename-expression.js';
import type { Dependency } from './types.js';
/** Grammar is supplied by the frontend/demuxer, never guessed from an extension. */
export type DependencyGrammar = 'concat' | 'concatf' | 'hls' | 'dash' | 'filter' | 'filter-option' | 'preset' | 'option-file' | 'magick-script' | 'magick-list' | 'msl' | 'mvg' | 'svg' | 'magick-config' | 'text' | 'hls-key-info';
export type ReferenceKind = 'path' | 'url' | 'file-protocol' | 'descriptor' | 'synthetic' | 'output-pattern' | 'resource-lookup' | 'glob' | 'image-selector' | 'filename-expression' | 'delegate' | 'register';
export type ResolutionBase = { readonly kind: 'directory' | 'resource'; readonly value: Uint8Array };
export interface AccessReference {
  readonly filterReader?: Dependency['filterReader'];
  readonly optionReader?: Dependency['optionReader'];
  readonly value: Uint8Array;
  readonly path?: Uint8Array;
  readonly kind?: ReferenceKind;
  /** Authoritative reader semantics: filename bytes, not a protocol operand.
   * A kind hint alone must never turn a network URL into a local path. */
  readonly literal?: boolean;
  /** read-delete retains concatenate's input-removal hint. Like every predicted
   * access, it is neither proof of a deletion nor permission to replay one. */
  readonly access: 'read' | 'write' | 'read-write' | 'read-delete';
  readonly grammar?: DependencyGrammar;
  readonly filenameDialect?: FilenameDialect;
  readonly base?: ResolutionBase;
  readonly stage?: 'global' | 'input' | 'output' | 'runtime' | 'incremental';
  readonly index?: number;
  readonly source?: string;
  readonly optional?: boolean;
  readonly span?: { readonly start: number; readonly end: number };
  /** Explicit reader policy replaces the parent policy. Otherwise nested access
   * inherits its parent's policy, then the invocation policy. This does not
   * inherit a resolution base or authorize any prefetch/native access. */
  readonly policy?: ProtocolPolicy;
}
export interface ProtocolPolicy {
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
}
export interface ResolutionOptions {
  readonly cwd: Uint8Array;
  /** Root depth is zero; references at depth are retained, but cannot expand
   * deeper. Applies equally to grammar expansion and explicit runtime parents.
   * Bytes charge operand/base buffers, captures, advisory traversal and retained
   * source/reader/policy strings (UTF-8), separately for each occurrence.
   * Exhaustion preserves the admitted prefix and marks the graph incomplete. */
  readonly budgets: { readonly nodes: number; readonly bytes: number; readonly depth: number; readonly symlinks: number };
  /** Advisory metadata only; no opens, descriptor reads or native/delegate execution.
   * Undefined means not a known symlink. Failures stay advisory. No stat cache. */
  readonly link?: (absolutePath: Uint8Array) => Promise<Uint8Array | undefined>;
  /** Advisory native IsPathAccessible classification in this invocation's filesystem.
   * Receives absolute paths without lexical normalization. Unknown/failed probes
   * cannot validate commands or restrict runtime access. */
  readonly accessible?: (absolutePath: Uint8Array) => Promise<boolean | undefined>;
  /** Advisory GetPathAttributes/stat success, including non-regular paths.
   * Receives absolute byte paths without lexical normalization; never validation.
   * During symlink traversal, absent/unknown/failed intermediate metadata retains
   * the opened spelling and marks canonical resolution unresolved. */
  readonly exists?: (absolutePath: Uint8Array) => Promise<boolean | undefined>;
  /** Advisory native stat directory classification, also used when ImageMagick
   * filters observed filename-list members. Receives absolute byte paths without
   * lexical normalization; unknown/failed probes cannot validate commands.
   * Canonical resolution probes components traversed by a suffix,
   * including slash/dot/parent components and expanded symlink targets.
   * False, unknown or failed metadata preserves the opened spelling. Final
   * leaves are not probed by canonical traversal. Reads/output creation stay live. */
  readonly directory?: (absolutePath: Uint8Array) => Promise<boolean | undefined>;
  readonly policy?: ProtocolPolicy;
}
export interface AccessNode extends AccessReference {
  readonly id: number;
  readonly parent?: number;
  readonly original: Uint8Array;
  readonly kind: ReferenceKind;
  readonly base: ResolutionBase;
  /** Joined reader operand before advisory canonical traversal. Local '..' and
   * file-protocol spelling remain intact; network references use the selected
   * reader's URL joining rules. This is a live hint, never an access capability.
   * Content members default to this base rather than a symlink target. */
  readonly readerLocation?: Uint8Array;
  /** Advisory location after canonical traversal, when metadata is available.
   * Use readerLocation to inspect the operand supplied to the native reader. */
  readonly location?: Uint8Array;
  readonly expression?: FilenameExpression;
  readonly trace: readonly { path: Uint8Array; target?: Uint8Array }[];
  readonly live: true;
  /** All captures remain live hints. No snapshot/upload admission is implied. */
  readonly upload: false;
  readonly timing: { readonly order: number; readonly stage: NonNullable<AccessReference['stage']>; readonly certainty: 'predicted' | 'observed'; readonly sequence?: number };
}
export interface AccessGraph {
  readonly nodes: readonly AccessNode[];
  readonly edges: readonly { from: number; to: number; kind: 'before' | 'depends-on' | 'observed-before' }[];
  readonly issues: readonly { node?: number; reason: 'budget' | 'cycle' | 'syntax' | 'live' | 'policy' | 'unresolved'; detail: string }[];
  readonly status: 'live' | 'incomplete';
}
