export type Tool = "ffmpeg" | "ffprobe";
export interface Option {
  readonly index: number;
  readonly name: string;
  readonly specifier?: Uint8Array;
  readonly value?: Uint8Array;
  readonly fromFile: boolean;
  readonly scopes: readonly string[];
  /** Native callbacks or later matching options discard this loaded value.
   * Indirection still reads the value file before discarding its contents. */
  readonly discardValue?: true;
}
export interface Group {
  readonly kind: "input" | "output" | "decoder" | "trailing";
  readonly target?: Uint8Array;
  readonly index: number;
  readonly options: readonly Option[];
}
export type ResourceRole = "input" | "output" | "option-file" | "preset" | "filter-script" | "filter-resource" | "sidecar" | "attachment";
export interface Dependency {
  readonly filterReader?: { readonly filter: string; readonly name: string; readonly discardValue?: true };
  readonly optionReader?: { readonly tool: Tool; readonly name: string; readonly specifier?: Uint8Array; readonly discardValue?: true };
  readonly index: number;
  readonly value: Uint8Array;
  readonly role: ResourceRole;
  readonly kind: "path" | "file-protocol" | "url" | "descriptor" | "pattern" | "resource-lookup";
  readonly access: "read" | "write" | "read-write";
  readonly stage: "global" | "input" | "output" | "runtime";
  readonly base: "cwd" | { readonly resource: Uint8Array };
  /** The selected reader opens a literal filename rather than an AVIO URL. */
  readonly literal?: boolean;
}
export interface Deferred {
  readonly index: number;
  readonly reason: "unknown-option" | "missing-value" | "filter-syntax" | "stream-metadata" | "option-file-content" | "filter-runtime" | "generated-name" | "preset-search" | "native-access";
}
export interface Discovery {
  readonly tool: Tool;
  readonly grammarRevision: string;
  readonly argv: readonly Uint8Array[];
  readonly globals: readonly Option[];
  readonly groups: readonly Group[];
  readonly dependencies: readonly Dependency[];
  readonly deferred: readonly Deferred[];
}
