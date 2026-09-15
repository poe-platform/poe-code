import type { SourceSpan } from "../ast.js";

/** Interpreter-owned activation metadata; never a host stack or guest object.
 * CallStack owns caller links. Position bookkeeping retains the last entered
 * source site, not a CPython instruction offset or tracing state. */
export class ExecutionFrame {
  caller: ExecutionFrame | undefined;
  executionPosition: SourceSpan | undefined;
}
