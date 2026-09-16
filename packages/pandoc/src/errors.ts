import type { Diagnostic, DiagnosticCode, Operation } from "./types.js";

export class AstError extends Error {
  constructor(readonly code: "E_AST" | "E_LIMIT", readonly path: string, message: string) {
    super(`${path}: ${message}`);
  }
}

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
