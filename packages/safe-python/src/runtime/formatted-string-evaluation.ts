import type { Expression, InterpolatedPart } from "../ast.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface FormattedStringContext<Value> {
  /** Static code points or source-spelling debug text, without guest coercion. */
  text(value: Uint32Array | string): Value;
  convert(value: Value, conversion: "s" | "r" | "a"): Value;
  /** Undefined spec means FORMAT_SIMPLE, distinct from an explicit empty spec.
   * Owns __format__ dispatch, exact-string fast paths and result validation. */
  format(value: Value, spec: Value | undefined): Value;
  /** Empty produces exact empty str; singleton preserves its result identity;
   * multiple parts produce exact str. Owns string validation and allocation. */
  join(parts: readonly Value[]): Value;
}

/** Yield expression work to the evaluator, not host-recursive evaluation.
 * Python 3.14 converts each field before evaluating its nested format spec.
 * Nested specs use explicit frames; templates have a separate deferred model.
 */
export function* evaluateFormattedString<Value>(parts: readonly InterpolatedPart[], context: FormattedStringContext<Value>, meter: ExecutionMeter): Generator<Expression, Value, Value> {
  type Frame = { parts: readonly InterpolatedPart[]; index: number; output: Value[]; owner?: { value: Value } };
  meter.checkpoint(1, 192);
  const frames: Frame[] = [{ parts, index: 0, output: [] }];
  while (frames.length !== 0) {
    meter.checkpoint();
    const frame = frames[frames.length - 1];
    if (frame.index === frame.parts.length) {
      const result = context.join(frame.output); meter.checkpoint();
      frames.pop();
      if (frame.owner === undefined) return result;
      const formatted = context.format(frame.owner.value, result); meter.checkpoint();
      meter.checkpoint(0, 16);
      frames[frames.length - 1].output.push(formatted);
      continue;
    }
    const part = frame.parts[frame.index++];
    if (part.kind === "text") {
      const text = context.text(part.value); meter.checkpoint();
      meter.checkpoint(0, 16); frame.output.push(text);
      continue;
    }
    if (part.debugText !== null) {
      const text = context.text(part.debugText); meter.checkpoint();
      meter.checkpoint(0, 16); frame.output.push(text);
    }
    let value = yield part.expression;
    meter.checkpoint();
    if (part.conversion !== null) { value = context.convert(value, part.conversion); meter.checkpoint(); }
    if (part.format === null) {
      const formatted = context.format(value, undefined); meter.checkpoint();
      meter.checkpoint(0, 16); frame.output.push(formatted);
    } else {
      meter.checkpoint(0, 160);
      frames.push({ parts: part.format, index: 0, output: [], owner: { value } });
    }
  }
  throw new Error("formatted string lost its root frame");
}
