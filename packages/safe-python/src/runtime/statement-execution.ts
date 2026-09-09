import type { Expression } from "../ast.js";
import type { Statement } from "../statement-ast.js";
import type { ExecutionMeter } from "./execution-budget.js";

export type LeafStatement = Extract<Statement, { kind:
  "expression-statement" | "assignment" | "augmented-assignment" | "annotated-assignment" |
  "delete" | "raise" | "assert" | "import" | "import-from" | "class" | "function"
}>;

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
}

/** An absent return value means bare return; the frame supplies guest None. */
export type StatementCompletion<Value> = { readonly kind: "normal" } | { readonly kind: "return"; readonly value?: Value };

export class UnsupportedStatementError extends Error {
  constructor(readonly kind: Statement["kind"]) {
    super(`unsupported statement: ${kind}`);
    this.name = "UnsupportedStatementError";
  }
}

type Frame<Value> =
  | { kind: "block"; body: readonly Statement[]; index: number }
  | { kind: "while"; statement: Extract<Statement, { kind: "while" }> }
  | { kind: "for"; statement: Extract<Statement, { kind: "for" }>; iterator: Iterator<Value> };

/** Synchronous execution of statically validated suites using explicit frames.
 * Guest errors propagate unchanged. Exception handlers, context managers, match
 * and suspensions are not implemented here yet; unsupported compounds fail
 * before evaluating their operands. Contexts own guest protocols and internal
 * metering; frame allocation still requires full heap accounting.
 */
export function executeStatements<Value>(
  body: readonly Statement[], context: StatementContext<Value>, meter: ExecutionMeter
): StatementCompletion<Value> {
  meter.checkpoint();
  const frames: Frame<Value>[] = [{ kind: "block", body, index: 0 }];
  while (frames.length) {
    meter.checkpoint();
    const frame = frames[frames.length - 1];
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
    if (frame.index === frame.body.length) { frames.pop(); continue; }
    const statement = frame.body[frame.index++];
    switch (statement.kind) {
      case "if": {
        let selected = statement.otherwise;
        for (const branch of statement.branches) {
          meter.checkpoint();
          if (context.test(branch.condition)) { selected = branch.body; break; }
        }
        frames.push({ kind: "block", body: selected, index: 0 });
        break;
      }
      case "while": frames.push({ kind: "while", statement }); break;
      case "for": {
        if (statement.async) throw new UnsupportedStatementError(statement.kind);
        const iterable = context.evaluate(statement.iterable);
        meter.checkpoint();
        const iterator = context.iterate(iterable);
        frames.push({ kind: "for", statement, iterator });
        break;
      }
      case "break": case "continue": {
        while (frames.length && frames[frames.length - 1].kind === "block") {
          meter.checkpoint(); frames.pop();
        }
        if (!frames.length) throw new Error("statement suites must be statically validated");
        if (statement.kind === "break") frames.pop();
        break;
      }
      case "return": return statement.value === null ? { kind: "return" } : { kind: "return", value: context.evaluate(statement.value) };
      case "pass": case "global": case "nonlocal": case "type-alias": break;
      case "try": case "with": case "match": throw new UnsupportedStatementError(statement.kind);
      default: context.execute(statement);
    }
  }
  return { kind: "normal" };
}
