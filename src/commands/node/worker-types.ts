import type { NodeSourceRequest } from "./types.js";

export const NODE_ENGINE_ABI = "NP1-ENGINE-PUBLIC-SYNC-1" as const;
export type NodeBridge = (op: string, authority: string | null, path: string | null, flag: string | null, body: string | null, moduleKey: string | null) => string | undefined;
export interface NodeEngineInput {
  readonly request: NodeSourceRequest;
  readonly bridge: NodeBridge;
  readonly limited: (reason: unknown) => void;
}
export type NodeEngineResult = { readonly ok: true } | { readonly ok: false; readonly error: unknown };
export interface NodeEngineAdapter {
  readonly abi: typeof NODE_ENGINE_ABI;
  readonly identity: string;
  readonly execute: (input: NodeEngineInput) => Promise<NodeEngineResult>;
}
export interface NodeWorkerEvent {
  readonly kind: "workerCreated" | "engineAttempt" | "engineLimit" | "guestEntry" | "entryReturn" | "request" | "delivered" | "terminal" | "workerExit" | "retired" | "diagnosticFault";
  readonly sequence: number | null;
  readonly exitCode: number | null;
}
export interface NodeWorkerProviderOptions {
  readonly entry: string;
  readonly identity: string;
  readonly observe?: (event: NodeWorkerEvent) => void | PromiseLike<void>;
}
