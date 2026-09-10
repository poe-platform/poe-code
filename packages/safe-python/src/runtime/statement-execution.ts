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
      | "import"
      | "import-from"
      | "class"
      | "function";
  }
>;

/** Bound guest protocol callbacks, obtained before enter is called. Null means
 * exit(None, None, None); a present error is adapted to type/value/traceback.
 */
export interface PreparedContextManager<Value> {
  enter(): Value;
  exit(exception: { readonly error: unknown } | null): Value;
}

export interface PreparedAsyncContextManager<Value> {
  enter():Generator<Value,Value,Value>;
  exit(exception:{readonly error:unknown}|null):Generator<Value,Value,Value>;
}

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
  assertions?: {
    /** Compilation optimization policy; disabled assertions evaluate neither operand. */
    enabled: boolean;
    /** Raise the canonical builtin AssertionError, independent of shadowed names.
     * Null means no arguments; a wrapper means exactly one unchanged argument.
     * The adapter owns construction, context/traceback attachment and internal metering.
     */
    fail(message: { readonly value: Value } | null): never;
  };
  managers?: {
    /** Resolve exit then enter through implicit special-method lookup (CPython
     * 3.14 order, observable with descriptors), before invoking enter.
     */
    prepare(value: Value): PreparedContextManager<Value>;
    truth(value: Value): boolean;
  };
  /** Host-only exception bookkeeping. Classify only guest errors,
   * never implementation faults. Enter installs the active exception for bare
   * raise and automatic chaining; entry/restoration must not throw or run guest code.
   * Without this capability all thrown values are treated as fatal host errors.
   */
  exceptions?: {
    /** Translate recognized native operation faults without running guest code. */
    prepare?(error: unknown): unknown;
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

/** Source operations and async iteration/manager protocols can suspend.
 * Synchronous iterator and context-manager protocol calls remain ordinary calls.
 * Each callback yields guest values and receives guest send values; adapters own
 * expression/leaf semantics and checkpoints before publication/resumed effects.
 */
export interface ResumableStatementContext<Value> extends Omit<StatementContext<Value>, "evaluate" | "test" | "assign" | "execute"> {
  /** Acquire once; next owns awaited protocol calls and exhaustion only. */
  asyncIterate?(value:Value):{next():Generator<Value,IteratorResult<Value,Value>,Value>};
  asyncManagers?: {
    prepare(value:Value):PreparedAsyncContextManager<Value>;
    truth(value:Value):boolean;
  };
  evaluate(expression: Expression): Generator<Value, Value, Value>;
  test(expression: Expression): Generator<Value, boolean, Value>;
  assign(target: Expression, value: Value): Generator<Value, void, Value>;
  execute(statement: LeafStatement): Generator<Value, void, Value>;
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
  | { kind: "async-for"; statement: Extract<Statement, { kind: "for" }>; iterator: ReturnType<NonNullable<ResumableStatementContext<Value>["asyncIterate"]>> }
  | { kind: "finally"; body: readonly Statement[] }
  | { kind: "with-items"; statement: Extract<Statement, { kind: "with" }>; index: number }
  | { kind: "with-exit"; asynchronous:false; exit: PreparedContextManager<Value>["exit"]; policy:Pick<NonNullable<StatementContext<Value>["managers"]>,"truth"> }
  | { kind: "with-exit"; asynchronous:true; exit: PreparedAsyncContextManager<Value>["exit"]; policy:Pick<NonNullable<StatementContext<Value>["managers"]>,"truth"> }
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

type StatementExecution<Value> =
  | { readonly kind: "synchronous"; readonly context: StatementContext<Value> }
  | { readonly kind: "resumable"; readonly context: ResumableStatementContext<Value> };

/** Synchronous execution of statically validated suites using explicit frames.
 * Finally suites run during normal and abrupt completion; guest exception state
 * is scoped to exception-triggered cleanup and ordinary except handlers. Except*
 * groups and match are not implemented here yet;
 * unsupported compounds fail
 * before evaluating their operands. Contexts own guest protocols and internal
 * metering; frame allocation still requires full heap accounting.
 */
export function executeStatements<Value>(
  body: readonly Statement[],
  context: StatementContext<Value>,
  meter: ExecutionMeter
): StatementCompletion<Value> {
  meter.checkpoint(1, 224);
  const result = statementContinuation<Value>(body, { kind: "synchronous", context }, meter).next();
  if (!result.done) throw Error("synchronous statement execution unexpectedly suspended");
  return result.value;
}

/** Allocate an unstarted suite continuation sharing the synchronous frame
 * machine. Injected errors reach the paused operation's enclosing guest handlers;
 * pending returns, loop transfers, exits and exception cleanup survive yields.
 * The caller owns lifecycle and saved exception-frame activation on each resume.
 * Python close must inject GeneratorExit with throw, not use host return: host
 * return only releases bookkeeping and does not run guest finally/with cleanup.
 * Native protocol assembly and full frame heap accounting remain separate
 * integration work.
 */
export function createStatementContinuation<Value>(
  body: readonly Statement[], context: ResumableStatementContext<Value>, meter: ExecutionMeter
): Generator<Value, StatementCompletion<Value>, Value> {
  meter.checkpoint(1, 224);
  return statementContinuation<Value>(body, { kind: "resumable", context }, meter);
}

function* statementContinuation<Value>(
  body: readonly Statement[], execution: StatementExecution<Value>, meter: ExecutionMeter
): Generator<Value, StatementCompletion<Value>, Value> {
  meter.checkpoint(0);
  const context = execution.context;
  const frames: Frame<Value>[] = [{ kind: "block", body, index: 0 }];
  let transfer: Transfer<Value> | undefined;
  const guestFailure = (error: unknown): Transfer<Value> => {
    if (
      error instanceof ExecutionLimitError ||
      error instanceof UnsupportedStatementError
    )
      throw error;
    if (context.exceptions?.prepare) error = context.exceptions.prepare(error);
    if (!context.exceptions?.isGuest(error)) throw error;
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
      const top=frames[frames.length-1];
      if(top.kind==="with-exit") {
        frames.pop();
        const pending=transfer;
        try {
          const restore=pending?.kind==="throw"?context.exceptions!.enter(pending.error):undefined;
          try {
            meter.checkpoint();
            const error=pending?.kind==="throw"?{error:pending.error}:null;
            const result=top.asynchronous?yield* top.exit(error):top.exit(error);
            if(pending?.kind==="throw") {
              meter.checkpoint();
              transfer=top.policy.truth(result)?undefined:pending;
            }
          } finally {restore?.();}
        } catch(error){transfer=guestFailure(error);}
        continue;
      }
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
          (frame.kind === "while" || frame.kind === "for" || frame.kind === "async-for") &&
          (transfer.kind === "break" || transfer.kind === "continue")
        ) {
          if (transfer.kind === "continue") frames.push(frame);
          transfer = undefined;
        }
        continue;
      }
      try {
        const frame = top;
        if (frame.kind === "with-items") {
          if (frame.index === frame.statement.items.length) {
            frames.pop();
            frames.push({ kind: "block", body: frame.statement.body, index: 0 });
            continue;
          }
          const item = frame.statement.items[frame.index++];
          const value = execution.kind === "synchronous" ? execution.context.evaluate(item.context) : yield* execution.context.evaluate(item.context);
          meter.checkpoint();
          let exit:Extract<Frame<Value>,{kind:"with-exit"}>,entered:Value;
          if(frame.statement.async&&execution.kind==="resumable") {
            const policy=execution.context.asyncManagers!,manager=policy.prepare(value);
            exit={kind:"with-exit",asynchronous:true,exit:manager.exit,policy};
            meter.checkpoint();entered=yield* manager.enter();
          } else {
            const policy=context.managers!,manager=policy.prepare(value);
            exit={kind:"with-exit",asynchronous:false,exit:manager.exit,policy};
            meter.checkpoint();entered=manager.enter();
          }
          frames.pop();
          frames.push(exit, frame);
          if (item.target !== null) {
            meter.checkpoint();
            if (execution.kind === "synchronous") execution.context.assign(item.target, entered);
            else yield* execution.context.assign(item.target, entered);
          }
          continue;
        }
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
            const type = execution.kind === "synchronous" ? execution.context.evaluate(handler.exception) : yield* execution.context.evaluate(handler.exception);
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
          const accepted = execution.kind === "synchronous" ? execution.context.test(frame.statement.condition) : yield* execution.context.test(frame.statement.condition);
          if (accepted) {
            frames.push({ kind: "block", body: frame.statement.body, index: 0 });
          } else {
            frames.pop();
            frames.push({ kind: "block", body: frame.statement.otherwise, index: 0 });
          }
          continue;
        }
        if (frame.kind === "for"||frame.kind==="async-for") {
          const next = frame.kind==="async-for"?yield* frame.iterator.next():frame.iterator.next();
          if (next.done) {
            frames.pop();
            frames.push({ kind: "block", body: frame.statement.otherwise, index: 0 });
          } else {
            meter.checkpoint();
            if (execution.kind === "synchronous") execution.context.assign(frame.statement.target, next.value);
            else yield* execution.context.assign(frame.statement.target, next.value);
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
              const accepted = execution.kind === "synchronous" ? execution.context.test(branch.condition) : yield* execution.context.test(branch.condition);
              if (accepted) {
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
            if (statement.async&&(execution.kind==="synchronous"||execution.context.asyncIterate===undefined)) throw new UnsupportedStatementError(statement.kind);
            const iterable = execution.kind === "synchronous" ? execution.context.evaluate(statement.iterable) : yield* execution.context.evaluate(statement.iterable);
            meter.checkpoint();
            if(statement.async&&execution.kind==="resumable")frames.push({kind:"async-for",statement,iterator:execution.context.asyncIterate!(iterable)});
            else frames.push({ kind: "for", statement, iterator:context.iterate(iterable) });
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
                : { kind: "return", value: execution.kind === "synchronous" ? execution.context.evaluate(statement.value) : yield* execution.context.evaluate(statement.value) };
            break;
          case "assert": {
            if (!context.assertions) throw new UnsupportedStatementError(statement.kind);
            if (!context.assertions.enabled) break;
            const accepted = execution.kind === "synchronous" ? execution.context.test(statement.condition) : yield* execution.context.test(statement.condition);
            if (accepted) break;
            let message: { readonly value: Value } | null = null;
            if (statement.message !== null) {
              meter.checkpoint();
              message = { value: execution.kind === "synchronous" ? execution.context.evaluate(statement.message) : yield* execution.context.evaluate(statement.message) };
            }
            meter.checkpoint();
            return context.assertions.fail(message);
          }
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
            if (statement.async ? execution.kind!=="resumable"||!execution.context.asyncManagers : !context.managers) throw new UnsupportedStatementError(statement.kind);
            frames.push({ kind: "with-items", statement, index: 0 });
            break;
          case "match":
            throw new UnsupportedStatementError(statement.kind);
          default:
            if (execution.kind === "synchronous") execution.context.execute(statement);
            else yield* execution.context.execute(statement);
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
