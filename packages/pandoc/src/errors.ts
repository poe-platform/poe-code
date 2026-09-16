import type { Diagnostic, DiagnosticCode, Operation } from "./types.js";

export class PandocError extends Error implements Diagnostic {
  constructor(
    readonly code: DiagnosticCode,
    readonly operation: Operation,
    message: string,
    readonly format?: string,
    readonly location?: string
  ) {
    super(message);
    this.name = "PandocError";
  }
}
