import type { Expression } from "../ast.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Guest object operations, never host eval. Implementations own guest types,
 * name resolution, descriptor/operator dispatch and metering inside each call.
 */
export interface ExpressionContext<Value> {
  literal(node: Extract<Expression, { kind: "literal" }>): Value;
  load(name: string): Value;
  store(name: string, value: Value): void;
  unary(operator: string, value: Value): Value;
  binary(operator: string, left: Value, right: Value): Value;
  compare(operator: string, left: Value, right: Value): Value;
  truth(value: Value): boolean;
  boolean(value: boolean): Value;
  attribute(object: Value, name: string): Value;
}

/** Host implementation gap, not a catchable guest exception. */
export class UnsupportedExpressionError extends Error {
  constructor(readonly kind: Expression["kind"]) {
    super(`expression execution is not implemented for ${kind}`);
    this.name = "UnsupportedExpressionError";
  }
}

/** Execute the supported expression families on an explicit continuation stack.
 * Boolean-test context propagates through logical/conditional nodes so a
 * short-circuit value's __bool__ is not invoked twice by a surrounding test.
 * Value-producing boundaries (such as walrus stores) deliberately break that
 * propagation. AST validity/static scope analysis are caller preconditions.
 * Stack/closure heap accounting and suspending expression families remain pending.
 */
export function evaluateExpression<Value>(expression: Expression, context: ExpressionContext<Value>, meter: ExecutionMeter): Value {
  type Task = { node: Expression; test: "value" | "preserve" | "branch" } | (() => void);
  const work: Task[] = [{ node: expression, test: "value" }];
  let value!: Value;
  let knownTruth: boolean | undefined;
  while (work.length) {
    meter.checkpoint();
    const task = work.pop()!;
    if (typeof task === "function") { task(); continue; }
    const { node, test } = task;
    knownTruth = undefined;
    switch (node.kind) {
      case "literal": value = context.literal(node); break;
      case "name": value = context.load(node.name); break;
      case "unary":
        if (node.operator === "not" && test === "branch") {
          work.push(() => {
            const truth = knownTruth ?? context.truth(value);
            meter.checkpoint();
            value = context.boolean(!truth);
            knownTruth = !truth;
          }, { node: node.operand, test: "branch" });
        } else {
          work.push(() => { value = context.unary(node.operator, value); knownTruth = undefined; }, { node: node.operand, test: "value" });
        }
        break;
      case "attribute":
        work.push(() => { value = context.attribute(value, node.name); knownTruth = undefined; }, { node: node.object, test: "value" });
        break;
      case "assignment-expression":
        work.push(() => { context.store(node.target.name, value); knownTruth = undefined; }, { node: node.value, test: "value" });
        break;
      case "binary":
        work.push(() => {
          const left = value;
          work.push(() => { value = context.binary(node.operator, left, value); knownTruth = undefined; }, { node: node.right, test: "value" });
        }, { node: node.left, test: "value" });
        break;
      case "boolean":
        work.push(() => {
          const truth = knownTruth ?? context.truth(value);
          if (truth === (node.operator === "and")) work.push({ node: node.right, test });
          else knownTruth = test !== "value" ? truth : undefined;
        }, { node: node.left, test: test === "branch" ? "branch" : "preserve" });
        break;
      case "conditional":
        work.push(() => {
          const truth = knownTruth ?? context.truth(value);
          // CPython's value-producing consequent crosses the conditional's
          // forward jump; the alternate falls through to the surrounding test.
          work.push({ node: truth ? node.consequent : node.alternate, test: truth && test !== "branch" ? "value" : test });
        }, { node: node.condition, test: "branch" });
        break;
      case "comparison": {
        let index = 0;
        const next = () => {
          const left = value;
          work.push(() => {
            const right = value;
            value = context.compare(node.operators[index], left, right);
            knownTruth = undefined;
            index++;
            if (index < node.operators.length) {
              // Comparison and its truth test are separate guest operations.
              work.push(() => {
                const truth = context.truth(value);
                if (truth) { value = right; work.push(next); }
                else knownTruth = test === "branch" ? false : undefined;
              });
            }
          }, { node: node.operands[index + 1], test: "value" });
        };
        work.push(next, { node: node.operands[0], test: "value" });
        break;
      }
      default: throw new UnsupportedExpressionError(node.kind);
    }
  }
  return value;
}
