import type { Expression } from "../ast.js";
import type { Statement } from "../statement-ast.js";
import { evaluateCallArguments, type ExpressionCall } from "./call-arguments.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface ClassDefinitionContext<Value> {
  evaluate(expression: Expression): Value;
  /** Resolve __build_class__ from the active builtins, never ordinary globals.
   * Preserve overrides; missing builders raise the guest NameError here.
   */
  lookupBuilder(): Value;
  /** Create the class-body callable/code closure without executing its suite. */
  createBody(statement: Extract<Statement, { kind: "class" }>): Value;
  /** Materialize the normalized class-name string, without guest conversion. */
  nameValue(name: string): Value;
  /** Host collector setup only; do not check builder callability yet. */
  beginCall(builder: Value): ExpressionCall<Value>;
  decorate(decorator: Value, value: Value): Value;
  store(name: string, value: Value): void;
}

/** Execute a statically validated class definition in its containing scope.
 * Decorators are evaluated before builtin-builder lookup and header operands.
 * The builder receives the body callable and name before explicit arguments;
 * shared argument evaluation preserves prefix-sensitive star/keyword ordering.
 * Only the fully decorated builder result is bound. Type syntax stays ignored.
 * The builtin builder backend owns base resolution, prepared class frames, body
 * execution and metaclass construction; overridden builders may choose otherwise.
 * Guest protocol metering and full temporary heap accounting remain adapter-owned.
 */
export function executeClassDefinition<Value>(
  statement: Extract<Statement, { kind: "class" }>, context: ClassDefinitionContext<Value>, meter: ExecutionMeter
): void {
  meter.checkpoint();
  const decorators: Value[] = [];
  for (const expression of statement.decorators) {
    meter.checkpoint();
    decorators.push(context.evaluate(expression));
  }
  meter.checkpoint();
  const builder = context.lookupBuilder();
  meter.checkpoint();
  const body = context.createBody(statement);
  meter.checkpoint();
  const name = context.nameValue(statement.name.name);
  meter.checkpoint();
  const call = context.beginCall(builder);
  meter.checkpoint();
  call.positional(body);
  meter.checkpoint();
  call.positional(name);
  const evaluation = evaluateCallArguments(statement.arguments, call, meter, true);
  let step = evaluation.next();
  while (!step.done) {
    meter.checkpoint();
    step = evaluation.next(context.evaluate(step.value));
  }
  let value = step.value;
  for (let index = decorators.length - 1; index >= 0; index--) {
    meter.checkpoint();
    value = context.decorate(decorators[index], value);
  }
  meter.checkpoint();
  context.store(statement.name.name, value);
}
