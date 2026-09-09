import type { Expression } from "../ast.js";
import type { Statement } from "../statement-ast.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface FunctionDefinitionContext<Value> {
  evaluate(expression: Expression): Value;
  /** Construct a guest function without executing its body. Capture the defining
   * globals/closure cells, code metadata and sync/async/generator behavior here.
   * Defaults are evaluated once per definition and retained by identity; their
   * normalized parameter keys can be passed directly to argument binding.
   */
  create(statement: Extract<Statement, { kind: "function" }>, defaults: ReadonlyMap<string, Value>): Value;
  /** Ordinary guest call with exactly one positional argument, no keywords.
   * Callability is checked here, not while evaluating decorator expressions.
   */
  decorate(decorator: Value, value: Value): Value;
  store(name: string, value: Value): void;
}

/** Execute a statically validated function definition in its containing scope.
 * Decorator expressions precede defaults; application reverses decorator order.
 * Only the fully decorated result is stored, including arbitrary non-functions.
 * Type expressions are absent from the executable AST and deliberately ignored.
 * Adapters own guest protocols/internal metering; complete temporary allocation
 * accounting and suspending evaluation require further runtime integration.
 */
export function executeFunctionDefinition<Value>(
  statement: Extract<Statement, { kind: "function" }>,
  context: FunctionDefinitionContext<Value>, meter: ExecutionMeter
): void {
  meter.checkpoint();
  const decorators: Value[] = [];
  for (const expression of statement.decorators) {
    meter.checkpoint();
    decorators.push(context.evaluate(expression));
  }
  const defaults = new Map<string, Value>();
  for (const parameter of statement.parameters) {
    meter.checkpoint();
    if (parameter.default !== null) defaults.set(parameter.name, context.evaluate(parameter.default));
  }
  meter.checkpoint();
  let value = context.create(statement, defaults);
  for (let index = decorators.length - 1; index >= 0; index--) {
    meter.checkpoint();
    value = context.decorate(decorators[index], value);
  }
  meter.checkpoint();
  context.store(statement.name.name, value);
}
