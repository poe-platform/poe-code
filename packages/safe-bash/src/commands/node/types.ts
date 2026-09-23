import type { CommandDefinition } from "../../contracts/command.js";
import type { SafeJsCommandLimits, SafeJsRuntime } from "../safejs/types.js";

export const NODE_PROFILE = "NP1-CJS-WRQ-L-SYNC-1" as const;
/** Resolved quotas: Infinity means no caller budget. sabBytes is transfer storage, not a quota. */
export const nodeLimits = Object.freeze({ sourceBytes: Infinity, contextBytes: Infinity, pathBytes: Infinity, metadataBytes: Infinity, errorBytes: Infinity, operations: Infinity, frames: Infinity, wakes: Infinity, operationBytes: Infinity, readBytes: Infinity, writeBytes: Infinity, outputBytes: Infinity, jsonBytes: Infinity, jsonEntries: Infinity, memoryBytes: Infinity, diagnosticReserve: Infinity, sabBytes: 197056, admissionMs: Infinity, steps: Infinity, callDepth: Infinity, oldGenerationMiB: Infinity, youngGenerationMiB: Infinity, codeMiB: Infinity, stackMiB: Infinity });
export type NodeLimits = typeof nodeLimits;
export type NodeLimitOptions = Partial<Omit<NodeLimits, "sabBytes">>;

export function resolveNodeLimits(options: NodeLimitOptions = {}): NodeLimits {
  for (const [name, value] of Object.entries(options)) {
    if (name === "sabBytes" || !Object.hasOwn(nodeLimits, name)) throw new TypeError(`Unknown Node limit: ${name}`);
    if (!Number.isSafeInteger(value) || value < 0 || ["admissionMs", "oldGenerationMiB", "youngGenerationMiB", "codeMiB", "stackMiB"].includes(name) && value < 1) throw new RangeError(`Invalid Node limit: ${name}`);
  }
  return Object.freeze({ ...nodeLimits, ...options });
}

export interface NodeGrants {
  readonly sourceRead?: boolean;
  readonly dataRead?: boolean;
  readonly dataWrite?: boolean;
  readonly jsonModules?: boolean;
  readonly stdinRead?: boolean;
  readonly stdoutWrite?: boolean;
  readonly stderrWrite?: boolean;
}
export type NodeSelector = "eval" | "print" | "file" | "stdin";
export interface NodeSourceRequest {
  readonly profile: typeof NODE_PROFILE;
  readonly selector: NodeSelector;
  readonly source: string;
  readonly program: string;
  readonly filename: string;
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly grants: Readonly<Required<NodeGrants>>;
  readonly limits: Readonly<NodeLimitOptions>;
}
export type NodeOperation = "authorizeModule" | "authorizeJson" | "readText" | "writeText" | "writeOutput" | "path";
export interface NodeHostRequest {
  readonly sequence: number;
  readonly op: NodeOperation;
  readonly authority: "module" | "json" | "data" | "stdin" | "stdout" | "stderr" | "path";
  readonly path: string | null;
  readonly flag: "r" | "w" | "wx" | null;
  readonly text: string | null;
  readonly moduleKey: string | null;
}
export interface NodeGuestError {
  readonly name: string;
  readonly message: string;
  readonly code: string;
  readonly errno: number | null;
  readonly path: string | null;
  readonly syscall: string | null;
  readonly dest: string | null;
}
export interface NodeHostResponse {
  readonly sequence: number;
  readonly kind: "void" | "text" | "fsError" | "unsupported" | "denied";
  readonly text: string | null;
  readonly error: NodeGuestError | null;
  readonly cacheKey: { readonly namespace: number; readonly path: string } | null;
}
export interface NodeReason { readonly present: true; readonly value: unknown; }
export interface NodeObservation {
  readonly state: "captured" | "unknown";
  readonly fault: boolean;
  readonly name: string | null;
  readonly message: string | null;
  readonly code: string | null;
}
export interface NodeCompletion {
  readonly kind: "entryReturned" | "guestFailure" | "profileFailure";
  readonly observation: NodeObservation;
}
export interface NodeRetirement {
  readonly acquisition: "none" | "exited";
  readonly exitCode: number | null;
}
export interface NodeHostServices {
  readonly signal: AbortSignal;
  readonly request: (request: NodeHostRequest) => Promise<NodeHostResponse>;
  readonly delivered: (sequence: number) => void;
  readonly reserve: (label: string, bytes: number) => () => void;
  readonly cutoff: () => void;
  readonly fail: (reason: NodeReason) => void;
  readonly stopProfile: (reason: NodeReason) => void;
  readonly job: <Value>(start: () => Value | PromiseLike<Value>) => Promise<Value>;
}
export interface NodeSession {
  readonly start: () => Promise<NodeCompletion>;
  readonly cancel: (reason: NodeReason) => void;
  readonly retire: () => Promise<NodeRetirement>;
}
export interface NodeRuntimeProvider {
  readonly profile: typeof NODE_PROFILE;
  readonly identity: string;
  readonly prepare: (request: NodeSourceRequest, services: NodeHostServices) => NodeSession;
}
export interface NodeProviderCommandOptions {
  readonly provider: NodeRuntimeProvider;
  readonly grants?: NodeGrants;
  readonly runtime?: never;
  readonly limits?: NodeLimitOptions;
}
export interface NodeSafeJsCommandOptions<Budget = unknown> {
  readonly runtime: SafeJsRuntime<Budget>;
  readonly limits?: Partial<SafeJsCommandLimits>;
  readonly provider?: never;
  readonly grants?: never;
}
export type NodeCommandOptions<Budget = unknown> = NodeProviderCommandOptions | NodeSafeJsCommandOptions<Budget>;
export type NodeCommandFactory = (options: NodeCommandOptions) => CommandDefinition;

export class NodeProfileError extends Error {
  readonly code = "ERR_VNODE_PROFILE";
  constructor(readonly resource: string) { super("Restricted node profile: " + resource); this.name = "NodeProfileError"; }
}
export class NodeUsageError extends Error {
  readonly code = "ERR_VNODE_UNSUPPORTED";
  constructor(message: string) { super(message); this.name = "NodeUsageError"; }
}
