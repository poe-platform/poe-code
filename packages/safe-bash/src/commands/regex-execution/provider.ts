import type { RegexExecutionOptions, Descriptor, ExprMatchDescriptor, Row } from "./protocol.js";

export interface RegexWorkerRequest {
  readonly id: number;
  readonly descriptor: Descriptor | ExprMatchDescriptor;
  readonly rows: readonly Row[];
}

export interface RegexWorker {
  postMessage(request: RegexWorkerRequest): void;
  on(event: "message", listener: (value: unknown) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "messageerror", listener: () => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  off(event: "message", listener: (value: unknown) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
  off(event: "messageerror", listener: () => void): unknown;
  off(event: "exit", listener: (code: number) => void): unknown;
  terminate(): Promise<unknown>;
  ref?(): unknown;
  unref?(): unknown;
}

export interface BoundedRegexProvider {
  createWorker(options: Readonly<Required<RegexExecutionOptions>>): RegexWorker;
}
