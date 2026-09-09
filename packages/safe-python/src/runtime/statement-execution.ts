import type { Expression } from "../ast.js";
import type { Statement } from "../statement-ast.js";
import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";

export type LeafStatement = Extract<
  Statement,
  {
    kind:
      | "expression-statement"
      | "assignment"
      | "augmented-assignment"
      | "annotated-assignment"
      | "delete"
      | "raise"
      | "assert"
      | "import"
      | "import-from"
      | "class"
      | "function";
  }
>;

export interface StatementContext<Value> {
  evaluate(expression: Expression): Value;
  /** Evaluate directly in branching context, including short-circuit truth rules.
   * Evaluating to a value and then converting it can add observable truth calls.
   */
  test(expression: Expression): boolean;
  iterate(value: Value): Iterator<Value>;
  assign(target: Expression, value: Value): void;
  /** Definitions execute a separate scope; they cannot transfer control here. */
  execute(statement: LeafStatement): void;
  /** Host-only, non-throwing exception bookkeeping. Classify only guest errors,
   * never implementation faults. Enter installs the active exception for bare
   * raise and automatic chaining; its restore callback must not run guest code.
   * Without this capability all thrown values are treated as fatal host errors.
   */
  exceptions?: {
    isGuest(error: unknown): boolean;
    enter(error: unknown): () => void;
    /** Guest operations, with internal metering owned by the adapter. Match
     * validates exception classes/tuples and uses non-virtual inheritance.
     * Clear implements Python's None-store/delete cleanup, not restoration of
     * a previous binding. Bind/clear use the current scope's storage protocol.
     */
    handlers?: {
      match(error: unknown, type: Value): boolean;
      bind(name: string, error: unknown): void;
      clear(name: string): void;
    };
  };
}

/** An absent return value means bare return; the frame supplies guest None. */
export type StatementCompletion<Value> =
  | { readonly kind: "normal" }
  | { readonly kind: "return"; readonly value?: Value };

export class UnsupportedStatementError extends Error {
  constructor(readonly kind: Statement["kind"]) {
    super(`unsupported statement: ${kind}`);
    this.name = "UnsupportedStatementError";
  }
}

type Transfer<Value> =
  | Exclude<StatementCompletion<Value>, { kind: "normal" }>
  | { kind: "break" | "continue" }
  | { kind: "throw"; error: unknown };

type Frame<Value> =
  | { kind: "block"; body: readonly Statement[]; index: number }
  | { kind: "while"; statement: Extract<Statement, { kind: "while" }> }
  | { kind: "for"; statement: Extract<Statement, { kind: "for" }>; iterator: Iterator<Value> }
  | { kind: "finally"; body: readonly Statement[] }
  | { kind: "catch"; statement: Extract<Statement, { kind: "try" }> }
  | {
      kind: "search";
      statement: Extract<Statement, { kind: "try" }>;
      index: number;
      error: unknown;
      restore: () => void;
    }
  | { kind: "handler-cleanup"; alias: string | null; restore: () => void }
  | { kind: "resume"; transfer: Transfer<Value>; restore?: () => void };

/** Synchronous execution of statically validated suites using explicit frames.
 * Finally suites run during normal and abrupt completion; guest exception state
 * is scoped to exception-triggered cleanup and ordinary except handlers. Except*
 * groups, context managers, match
 * and suspensions are not implemented here yet; unsupported compounds fail
 * before evaluating their operands. Contexts own guest protocols and internal
 * metering; frame allocation still requires full heap accounting.
 */
export function executeStatements<Value>(
  body: readonly Statement[],
  context: StatementContext<Value>,
  meter: ExecutionMeter
): StatementCompletion<Value> {
  meter.checkpoint();
  const frames: Frame<Value>[] = [{ kind: "block", body, index: 0 }];
  let transfer: Transfer<Value> | undefined;
  const guestFailure = (error: unknown): Transfer<Value> => {
    if (
      error instanceof ExecutionLimitError ||
      error instanceof UnsupportedStatementError ||
      !context.exceptions?.isGuest(error)
    )
      throw error;
    return { kind: "throw", error };
  };
  const clearHandler = (frame: Extract<Frame<Value>, { kind: "handler-cleanup" }>, exceptional: boolean): void => {
    // Normal/return/loop exits pop exception state before alias stores. Error
    // unwinding retains the handler's active exception through those stores.
    if (!exceptional) frame.restore();
    try {
      if (frame.alias !== null) context.exceptions!.handlers!.clear(frame.alias);
    } finally {
      if (exceptional) frame.restore();
    }
  };
  try {
    while (frames.length || transfer) {
      if (!frames.length && transfer) {
        if (transfer.kind === "return") return transfer;
        if (transfer.kind === "throw") throw transfer.error;
        throw new Error("statement suites must be statically validated");
      }
      meter.checkpoint();
      if (transfer) {
        const frame = frames.pop()!;
        if (frame.kind === "finally") {
          const restore = transfer.kind === "throw" ? context.exceptions!.enter(transfer.error) : undefined;
          frames.push({ kind: "resume", transfer, restore }, { kind: "block", body: frame.body, index: 0 });
          transfer = undefined;
        } else if (frame.kind === "catch" && transfer.kind === "throw") {
          frames.push({
            kind: "search",
            statement: frame.statement,
            index: 0,
            error: transfer.error,
            restore: context.exceptions!.enter(transfer.error)
          });
          transfer = undefined;
        } else if (frame.kind === "handler-cleanup") {
          try {
            clearHandler(frame, transfer.kind === "throw");
          } catch (error) {
            transfer = guestFailure(error);
          }
        } else if (frame.kind === "resume" || frame.kind === "search") frame.restore?.();
        else if (
          (frame.kind === "while" || frame.kind === "for") &&
          (transfer.kind === "break" || transfer.kind === "continue")
        ) {
          if (transfer.kind === "continue") frames.push(frame);
          transfer = undefined;
        }
        continue;
      }
      try {
        const frame = frames[frames.length - 1];
        if (frame.kind === "catch") {
          frames.pop();
          frames.push({ kind: "block", body: frame.statement.otherwise, index: 0 });
          continue;
        }
        if (frame.kind === "search") {
          if (frame.index === frame.statement.handlers.length) {
            frames.pop();
            frame.restore();
            transfer = { kind: "throw", error: frame.error };
            continue;
          }
          const handler = frame.statement.handlers[frame.index++];
          if (handler.exception !== null) {
            const type = context.evaluate(handler.exception);
            meter.checkpoint();
            if (!context.exceptions!.handlers!.match(frame.error, type)) continue;
          }
          if (handler.alias !== null) {
            meter.checkpoint();
            context.exceptions!.handlers!.bind(handler.alias.name, frame.error);
          }
          frames.pop();
          frames.push(
            { kind: "handler-cleanup", alias: handler.alias?.name ?? null, restore: frame.restore },
            { kind: "block", body: handler.body, index: 0 }
          );
          continue;
        }
        if (frame.kind === "handler-cleanup") {
          frames.pop();
          clearHandler(frame, false);
          continue;
        }
        if (frame.kind === "finally") {
          frames.pop();
          frames.push({ kind: "block", body: frame.body, index: 0 });
          continue;
        }
        if (frame.kind === "resume") {
          frames.pop();
          frame.restore?.();
          transfer = frame.transfer;
          continue;
        }
        if (frame.kind === "while") {
          if (context.test(frame.statement.condition)) {
            frames.push({ kind: "block", body: frame.statement.body, index: 0 });
          } else {
            frames.pop();
            frames.push({ kind: "block", body: frame.statement.otherwise, index: 0 });
          }
          continue;
        }
        if (frame.kind === "for") {
          const next = frame.iterator.next();
          if (next.done) {
            frames.pop();
            frames.push({ kind: "block", body: frame.statement.otherwise, index: 0 });
          } else {
            meter.checkpoint();
            context.assign(frame.statement.target, next.value);
            frames.push({ kind: "block", body: frame.statement.body, index: 0 });
          }
          continue;
        }
        if (frame.index === frame.body.length) {
          frames.pop();
          continue;
        }
        const statement = frame.body[frame.index++];
        switch (statement.kind) {
          case "if": {
            let selected = statement.otherwise;
            for (const branch of statement.branches) {
              meter.checkpoint();
              if (context.test(branch.condition)) {
                selected = branch.body;
                break;
              }
            }
            frames.push({ kind: "block", body: selected, index: 0 });
            break;
          }
          case "while":
            frames.push({ kind: "while", statement });
            break;
          case "for": {
            if (statement.async) throw new UnsupportedStatementError(statement.kind);
            const iterable = context.evaluate(statement.iterable);
            meter.checkpoint();
            const iterator = context.iterate(iterable);
            frames.push({ kind: "for", statement, iterator });
            break;
          }
          case "break":
          case "continue":
            transfer = { kind: statement.kind };
            break;
          case "return":
            transfer =
              statement.value === null
                ? { kind: "return" }
                : { kind: "return", value: context.evaluate(statement.value) };
            break;
          case "pass":
          case "global":
          case "nonlocal":
          case "type-alias":
            break;
          case "try":
            if (statement.group || (statement.handlers.length && !context.exceptions?.handlers))
              throw new UnsupportedStatementError(statement.kind);
            frames.push({ kind: "finally", body: statement.finalizer });
            if (statement.handlers.length) frames.push({ kind: "catch", statement });
            frames.push({ kind: "block", body: statement.body, index: 0 });
            break;
          case "with":
          case "match":
            throw new UnsupportedStatementError(statement.kind);
          default:
            context.execute(statement);
        }
      } catch (error) {
        transfer = guestFailure(error);
      }
    }
    return { kind: "normal" };
  } finally {
    // Restore host exception state on fatal termination without guest finalizers.
    for (let index = frames.length - 1; index >= 0; index--) {
      const frame = frames[index];
      if (frame.kind === "resume" || frame.kind === "search" || frame.kind === "handler-cleanup") frame.restore?.();
    }
  }
}
