import { attachErrorSpan, replaceErrorStack } from "../error/shape.js";
import { formatParseError, type ParseDiagnostic } from "./format-error.js";

// Only parser-created diagnostics cross the native-error conversion boundary.
// Arbitrary host error properties and stacks are not source authority.
export const syntaxDiagnostics = new WeakMap<Error, ParseDiagnostic>();

export function createSyntaxDiagnostic(source: string, filename: string, failure: unknown): SyntaxError {
  const error = new SyntaxError(failure instanceof Error ? failure.message : String(failure));
  replaceErrorStack(error);
  const formatted = formatParseError(source, filename, error);
  const diagnostic: ParseDiagnostic = {
    kind: formatted.kind, filename, message: error.message,
    line: formatted.line, column: formatted.column,
    excerpt: formatted.excerpt, caret: formatted.caret
  };
  syntaxDiagnostics.set(error, diagnostic);
  Object.assign(error, diagnostic);
  attachErrorSpan(error, formatted.span);
  return error;
}
