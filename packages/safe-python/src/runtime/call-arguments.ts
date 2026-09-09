import type { CallArgument, Expression } from "../ast.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Per-call guest collector. Expansion/merging owns iteration, key validation,
 * duplicate detection, allocation and internal metering. Preparing a collector
 * must not invoke guest code or reject a non-callable before operand evaluation.
 */
export interface ExpressionCall<Value> {
  positional(value: Value): void;
  starred(value: Value, loneStar?: boolean): void;
  keywords(entries: readonly (readonly [string, Value])[]): void;
  mapping(value: Value): void;
  invoke(): Value;
}

/** Host continuation protocol: evaluate each yielded expression in value context
 * and send its result back. This is not a guest generator. Static AST validation
 * and the callee/collector setup precede this stage. Class headers have implicit
 * positional body/name operands, so their lone starred base expands immediately.
 * Ordinary lone-star calls defer expansion until after keyword merging. Explicit
 * keyword runs evaluate fully before merging. Temporary heap accounting is pending.
 */
export function* evaluateCallArguments<Value>(
  arguments_: readonly CallArgument[], call: ExpressionCall<Value>, meter: ExecutionMeter,
  hasPositionalPrefix = false
): Generator<Expression, Value, Value> {
  meter.checkpoint();
  const positional: CallArgument[] = [], keywords: CallArgument[] = [];
  for (const argument of arguments_) {
    meter.checkpoint();
    (argument.kind === "positional" || argument.kind === "starred" ? positional : keywords).push(argument);
  }
  const soleStar = !hasPositionalPrefix && positional.length === 1 && positional[0].kind === "starred";
  let deferredStar: { value: Value } | undefined;
  for (const argument of positional) {
    meter.checkpoint();
    const value = yield argument.value;
    meter.checkpoint();
    if (argument.kind === "positional") call.positional(value);
    else if (soleStar) deferredStar = { value };
    else call.starred(value);
  }
  let group: (readonly [string, Value])[] = [];
  for (const argument of keywords) {
    meter.checkpoint();
    if (argument.kind === "mapping" && group.length) {
      call.keywords(group);
      group = [];
      meter.checkpoint();
    }
    const value = yield argument.value;
    meter.checkpoint();
    if (argument.kind === "keyword") group.push([argument.name, value]);
    else call.mapping(value);
  }
  if (group.length) { meter.checkpoint(); call.keywords(group); }
  if (deferredStar !== undefined) { meter.checkpoint(); call.starred(deferredStar.value, true); }
  meter.checkpoint();
  return call.invoke();
}
