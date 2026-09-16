export interface ByteSource {
  read(maxBytes: number, signal?: AbortSignal): Promise<Uint8Array | null>;
}

export interface ByteSink {
  write(bytes: Uint8Array, signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

export interface VfsCapability {
  openRead(path: string, signal?: AbortSignal): Promise<ByteSource>;
}

export interface VfsPath {
  readonly path: string;
  readonly capability: VfsCapability;
}

export type BinaryInput = Uint8Array | ByteSource | VfsPath;
export type BinaryOutput = ByteSink | VfsPath;

export interface ByteLimits {
  readonly maxBytes: number;
  readonly maxReads: number;
  readonly chunkBytes: number;
}

export interface ByteContext {
  readonly limits: ByteLimits;
  readonly signal?: AbortSignal;
}

export type ReadOptions = Partial<ByteLimits>;
export interface WriteOptions extends Partial<Pick<ByteLimits, "maxBytes" | "chunkBytes">> {
  readonly close?: boolean;
}

export type Scope =
  | "slides"
  | "notes"
  | "layouts"
  | "masters"
  | "notes-master"
  | "handout-master"
  | "presentation"
  | "shared";

export interface Location {
  readonly fingerprint: string;
  readonly scope: Scope;
  readonly owner: string;
  readonly objectId: string;
  readonly coordinateSystem: "identity";
}

export type Phase =
  | "usage"
  | "admit"
  | "parse"
  | "index"
  | "select"
  | "validate-intent"
  | "mutate"
  | "validate-result"
  | "serialize"
  | "publish";

export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly context: {
    readonly phase: Phase;
    readonly operationIndex?: number;
    readonly argument?: string;
    readonly location?: Location;
    readonly feature?: string;
    readonly candidates?: readonly Location[];
  };
}

export interface OperationRequest<Id extends string, Arguments, Options> {
  readonly operation: Id;
  readonly inputs: readonly BinaryInput[];
  readonly arguments: Arguments;
  readonly options: Options;
}

interface ResultBase<Id extends string> {
  readonly version: 1;
  readonly operation: Id;
  readonly warnings: readonly Diagnostic[];
  readonly locations: readonly Location[];
}

export type OfficeResult<Data, Id extends string = string> =
  | (ResultBase<Id> & {
      readonly ok: true;
      readonly data: Data;
      readonly errors: readonly [];
      readonly affected: number;
    })
  | (ResultBase<Id> & {
      readonly ok: false;
      readonly data: null;
      readonly errors: readonly [Diagnostic, ...Diagnostic[]];
      readonly affected: 0;
    });
