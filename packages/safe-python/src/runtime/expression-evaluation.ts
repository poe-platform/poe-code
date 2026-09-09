import type { CallArgument, Expression } from "../ast.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Per-call guest argument collector. Expansion/merging owns iteration, guest
 * key validation, duplicate detection, allocation and internal metering. Explicit
 * keyword groups are evaluated fully before being handed to the collector.
 */
export interface ExpressionCall<Value> {
  positional(value: Value): void;
  starred(value: Value): void;
  keywords(entries: readonly (readonly [string, Value])[]): void;
  mapping(value: Value): void;
  invoke(): Value;
}

/** Absent properties denote omitted bounds; a present guest value is never
 * interpreted as absence. Slice construction does not perform __index__ calls.
 */
export interface SliceValues<Value> {
  readonly lower?: Value;
  readonly upper?: Value;
  readonly step?: Value;
}

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
  /** Prepare host bookkeeping only: do not invoke guest code or reject a
   * non-callable callee here. Callability/binding are checked at invoke time.
   */
  beginCall(callee: Value): ExpressionCall<Value>;
  tuple(values: readonly Value[]): Value;
  slice(parts: SliceValues<Value>): Value;
  getItem(object: Value, key: Value): Value;
  /** Adapt the guest iteration protocol to next/done. Internal guest calls and
   * allocations remain metered by the context; the evaluator meters each next.
   */
  iterate(value: Value): Iterator<Value>;
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
      case "subscript":
        work.push(() => {
          const object = value, keys: Value[] = [];
          let index = 0;
          const nextItem = () => {
            const item = node.items[index++];
            if (item === undefined) {
              work.push(() => { value = context.getItem(object, value); knownTruth = undefined; });
              if (node.tuple) work.push(() => { value = context.tuple(keys); });
              else value = keys[0];
              return;
            }
            if (item.kind === "slice") {
              const parts: { lower?: Value; upper?: Value; step?: Value } = {};
              const fields = ["lower", "upper", "step"] as const;
              let part = 0;
              const nextPart = () => {
                while (part < fields.length) {
                  meter.checkpoint();
                  const field = fields[part++], bound = item[field];
                  if (bound === null) continue;
                  work.push(() => { parts[field] = value; work.push(nextPart); }, { node: bound, test: "value" });
                  return;
                }
                meter.checkpoint();
                keys.push(context.slice(parts));
                work.push(nextItem);
              };
              work.push(nextPart);
            } else if (item.kind === "unpack") {
              work.push(() => {
                const iterator = context.iterate(value);
                const nextValue = () => {
                  const entry = iterator.next();
                  if (entry.done) work.push(nextItem);
                  else { keys.push(entry.value); work.push(nextValue); }
                };
                work.push(nextValue);
              }, { node: item.value, test: "value" });
            } else {
              work.push(() => { keys.push(value); work.push(nextItem); }, { node: item, test: "value" });
            }
          };
          work.push(nextItem);
        }, { node: node.object, test: "value" });
        break;
      case "call":
        work.push(() => {
          const call = context.beginCall(value);
          const positional: CallArgument[] = [], keywords: CallArgument[] = [];
          for (const argument of node.arguments) {
            meter.checkpoint();
            (argument.kind === "positional" || argument.kind === "starred" ? positional : keywords).push(argument);
          }
          const soleStar = positional.length === 1 && positional[0].kind === "starred";
          let deferredStar: { value: Value } | undefined;
          let position = 0, keyword = 0;
          let group: (readonly [string, Value])[] = [];
          const nextKeyword = () => {
            const argument = keywords[keyword];
            if (group.length && (argument === undefined || argument.kind === "mapping")) {
              const entries = group; group = [];
              work.push(nextKeyword);
              call.keywords(entries);
              return;
            }
            if (argument === undefined) {
              work.push(() => { value = call.invoke(); knownTruth = undefined; });
              if (deferredStar !== undefined) {
                const star = deferredStar.value;
                work.push(() => { call.starred(star); });
              }
              return;
            }
            keyword++;
            work.push(() => {
              if (argument.kind === "keyword") group.push([argument.name, value]);
              else call.mapping(value);
              work.push(nextKeyword);
            }, { node: argument.value, test: "value" });
          };
          const nextPositional = () => {
            const argument = positional[position++];
            if (argument === undefined) { work.push(nextKeyword); return; }
            work.push(() => {
              if (argument.kind === "positional") call.positional(value);
              else if (soleStar) deferredStar = { value };
              else call.starred(value);
              work.push(nextPositional);
            }, { node: argument.value, test: "value" });
          };
          work.push(nextPositional);
        }, { node: node.callee, test: "value" });
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
