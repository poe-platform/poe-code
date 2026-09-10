import type { DictionaryEntry, Expression } from "../ast.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { evaluateCallArguments, type ExpressionCall } from "./call-arguments.js";
import { evaluateFormattedString, type FormattedStringContext } from "./formatted-string-evaluation.js";
import type { ComprehensionNode } from "./comprehension-execution.js";
export type { ExpressionCall } from "./call-arguments.js";

/** Concrete guest set operations own hashing/equality, optimized updates from
 * existing sets or mappings, guest iteration, allocation and internal metering.
 */
export interface ExpressionSet<Value> {
  add(value: Value): void;
  update(iterable: Value): void;
  finish(): Value;
}

/** Dictionary updates overwrite existing values, unlike call keyword merges.
 * Concrete storage owns key identity/equality, hash reuse and mapping protocols.
 */
export interface ExpressionDictionary<Value> {
  set(key: Value, value: Value): void;
  update(mapping: Value): void;
  finish(): Value;
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
  readonly constants?: ReadonlyMap<Expression, Value>;
  formattedString?: FormattedStringContext<Value>;
  literal(node: Extract<Expression, { kind: "literal" }>): Value;
  load(name: string): Value;
  store(name: string, value: Value): void;
  unary(operator: string, value: Value): Value;
  binary(operator: string, left: Value, right: Value, augmented?: boolean): Value;
  compare(operator: string, left: Value, right: Value): Value;
  truth(value: Value): boolean;
  boolean(value: boolean): Value;
  attribute(object: Value, name: string): Value;
  /** Prepare host bookkeeping only: do not invoke guest code or reject a
   * non-callable callee here. Callability/binding are checked at invoke time.
   */
  beginCall(callee: Value): ExpressionCall<Value>;
  beginMethodCall?(receiver: Value, name: string): ExpressionCall<Value>;
  tuple(values: readonly Value[]): Value;
  /** Allocate a fresh guest list, preserving element references. */
  list(values: readonly Value[]): Value;
  beginSet(initial: readonly Value[]): ExpressionSet<Value>;
  beginDictionary(initial: readonly (readonly [Value, Value])[]): ExpressionDictionary<Value>;
  slice(parts: SliceValues<Value>): Value;
  getItem(object: Value, key: Value): Value;
  /** Adapt the guest iteration protocol to next/done. Internal guest calls and
   * allocations remain metered by the context; the evaluator meters each next.
   * Optional consumer diagnostic for absent iteration/sequence slots only;
   * exceptions from existing guest slots must propagate unchanged. A requested
   * hint is checked on the source after acquisition, before the first next. */
  iterate(value: Value, notIterable?: (typeName: string) => never, hint?: boolean): Iterator<Value>;
  /** Create a fresh guest function using the compiled code for this exact AST
   * node and capture the defining environment. Do not execute the lambda body.
   * Defaults have normalized source keys, retaining original value identities;
   * function-frame initialization applies private-name mangling when binding.
   */
  createLambda?(node: Extract<Expression, { kind: "lambda" }>, defaults: ReadonlyMap<string, Value>): Value;
  /** Scope-aware execution owns outer-iterator acquisition, target isolation,
   * collection construction and any suspension policy. */
  comprehension?(node:ComprehensionNode):Value;
  /** Scope-aware materialization whose clauses, filters and elements may await. */
  comprehensionContinuation?(node:ComprehensionNode):Generator<Value,Value,Value>;
  /** Delegate to an already evaluated source. The capability owns guest
   * iterator acquisition, send/throw/close and completion-value semantics. */
  delegate?(source:Value):Generator<Value,Value,Value>;
  /** Validate an awaitable and suspend on its iterator. Kept separate from
   * ordinary yield-from acquisition, which accepts arbitrary iterables. */
  awaitValue?(source:Value):Generator<Value,Value,Value>;
}

/** Host implementation gap, not a catchable guest exception. */
export class UnsupportedExpressionError extends Error {
  constructor(readonly kind: Expression["kind"]) {
    super(`expression execution is not implemented for ${kind}`);
    this.name = "UnsupportedExpressionError";
  }
}

export interface SubscriptReference<Value> {
  readonly object: Value;
  readonly key: Value;
}

/** Execute the supported expression families on an explicit continuation stack.
 * Boolean-test context propagates through logical/conditional nodes so a
 * short-circuit value's __bool__ is not invoked twice by a surrounding test.
 * Value-producing boundaries (such as walrus stores) deliberately break that
 * propagation. AST validity/static scope analysis are caller preconditions.
 * Branch mode returns host boolean truth directly for statement conditions;
 * value mode (the default) returns the guest value without final coercion.
 * Subscript-reference mode captures only the outer receiver/key without getitem;
 * nested subscriptions and key expressions still execute in normal value mode.
 * Complete stack/closure heap accounting and delegated/async suspension remain pending.
 */
export function evaluateExpression<Value>(expression: Extract<Expression, { kind: "subscript" }>, context: ExpressionContext<Value>, meter: ExecutionMeter, mode: "subscript-reference"): SubscriptReference<Value>;
export function evaluateExpression<Value>(expression: Expression, context: ExpressionContext<Value>, meter: ExecutionMeter, mode: "branch"): boolean;
export function evaluateExpression<Value>(expression: Expression, context: ExpressionContext<Value>, meter: ExecutionMeter, mode?: "value"): Value;
export function evaluateExpression<Value>(expression: Expression, context: ExpressionContext<Value>, meter: ExecutionMeter, mode: "value" | "branch" | "subscript-reference" = "value"): Value | boolean | SubscriptReference<Value> {
  meter.checkpoint(1,192);
  const execution=expressionContinuation(expression,context,meter,mode);
  const result=execution.next();
  if(!result.done)throw Error("synchronous expression execution unexpectedly suspended");
  return result.value;
}

/** Unstarted expression continuation. Each yielded guest value is a Python
 * yield; the value sent back becomes that yield expression's result. Throwing
 * into the cursor propagates at the suspended expression without replaying any
 * operands. The caller owns generator lifecycle, frame/exception activation and
 * routing an escaping exception into the enclosing statement continuation.
 * Pass the execution's actual None value on each bare send; host undefined is
 * not interpreted as guest None. Delegation requires an explicit capability;
 * await requires its own validating suspension capability. */
export function createExpressionContinuation<Value>(expression:Extract<Expression,{kind:"subscript"}>,context:ExpressionContext<Value>,meter:ExecutionMeter,none:Value,mode:"subscript-reference"):Generator<Value,SubscriptReference<Value>,Value>;
export function createExpressionContinuation<Value>(expression:Expression,context:ExpressionContext<Value>,meter:ExecutionMeter,none:Value,mode:"branch"):Generator<Value,boolean,Value>;
export function createExpressionContinuation<Value>(expression:Expression,context:ExpressionContext<Value>,meter:ExecutionMeter,none:Value,mode?:"value"):Generator<Value,Value,Value>;
export function createExpressionContinuation<Value>(expression:Expression,context:ExpressionContext<Value>,meter:ExecutionMeter,none:Value,mode:"value"|"branch"|"subscript-reference"="value"):Generator<Value,Value|boolean|SubscriptReference<Value>,Value> {
  meter.checkpoint(1,224);
  return expressionContinuation(expression,context,meter,mode,{none});
}

function* expressionContinuation<Value>(expression:Expression,context:ExpressionContext<Value>,meter:ExecutionMeter,mode:"value"|"branch"|"subscript-reference",suspension?:{readonly none:Value}):Generator<Value,Value|boolean|SubscriptReference<Value>,Value> {
  if (mode === "subscript-reference" && expression.kind !== "subscript") throw new Error("subscript reference mode requires a subscript expression");
  type Task = { node: Expression; test: "value" | "preserve" | "branch" } | {kind:"yield"|"yield-from"|"await"} | (() => void);
  const work: Task[] = [{ node: expression, test: mode === "branch" ? "branch" : "value" }];
  let reference: SubscriptReference<Value> | undefined;
  let value!: Value;
  let knownTruth: boolean | undefined;
  while (work.length) {
    meter.checkpoint();
    const task = work.pop()!;
    if (typeof task === "function") { task(); continue; }
    if("kind" in task) {
      meter.checkpoint(0);
      value=task.kind==="await"?yield* context.awaitValue!(value):task.kind==="yield-from"?yield* context.delegate!(value):yield value;
      meter.checkpoint();
      knownTruth=undefined;
      continue;
    }
    const { node, test } = task;
    knownTruth = undefined;
    if (context.constants?.has(node)) { value = context.constants.get(node)!; continue; }
    switch (node.kind) {
      case "await":
        if(suspension===undefined||context.awaitValue===undefined)throw new UnsupportedExpressionError(node.kind);
        meter.checkpoint(0,64);
        work.push({kind:"await"},{node:node.value,test:"value"});
        break;
      case "yield-from":
        if(suspension===undefined||context.delegate===undefined)throw new UnsupportedExpressionError(node.kind);
        meter.checkpoint(0,64);
        work.push({kind:"yield-from"},{node:node.value,test:"value"});
        break;
      case "yield":
        if(suspension===undefined)throw new UnsupportedExpressionError(node.kind);
        meter.checkpoint(0,node.value===null?32:64);
        work.push({kind:"yield"});
        if(node.value===null)value=suspension.none;
        else work.push({node:node.value,test:"value"});
        break;
      case "comprehension": case "dictionary-comprehension":
        if(suspension!==undefined&&context.comprehensionContinuation!==undefined){value=yield* context.comprehensionContinuation(node);break;}
        if(context.comprehension===undefined)throw new UnsupportedExpressionError(node.kind);
        value=context.comprehension(node);break;
      case "interpolated-string": {
        if (node.flavor !== "formatted" || context.formattedString === undefined) throw new UnsupportedExpressionError(node.kind);
        meter.checkpoint(0, 192);
        const parts = evaluateFormattedString(node.parts, context.formattedString, meter);
        const advance = () => {
          const next = parts.next(value);
          if (next.done) { value = next.value; knownTruth = undefined; }
          else work.push(advance, { node: next.value, test: "value" });
        };
        work.push(advance);
        break;
      }
      case "literal": value = context.literal(node); break;
      case "name": value = context.load(node.name); break;
      case "lambda": {
        const create = context.createLambda;
        if (create === undefined) throw new UnsupportedExpressionError(node.kind);
        const defaults = new Map<string, Value>();
        let index = 0;
        const next = () => {
          while (index < node.parameters.length) {
            meter.checkpoint();
            const parameter = node.parameters[index++];
            if (parameter.default === null) continue;
            work.push(() => { defaults.set(parameter.name, value); work.push(next); }, { node: parameter.default, test: "value" });
            return;
          }
          value = create.call(context, node, defaults);
          knownTruth = undefined;
        };
        work.push(next);
        break;
      }
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
      case "dictionary": {
        let dictionary: ExpressionDictionary<Value> | undefined, index = 0;
        const nextChunk = () => {
          const entry = node.entries[index];
          if (entry === undefined) {
            if (dictionary === undefined) { meter.checkpoint(0, 32); dictionary = context.beginDictionary([]); work.push(nextChunk); }
            else { value = dictionary.finish(); knownTruth = undefined; }
            return;
          }
          if (entry.kind === "mapping") {
            if (dictionary === undefined) { meter.checkpoint(0, 32); dictionary = context.beginDictionary([]); work.push(nextChunk); return; }
            index++;
            work.push(() => { dictionary!.update(value); work.push(nextChunk); }, { node: entry.value, test: "value" });
            return;
          }
          let end = index;
          // CPython emits explicit runs in chunks of at most 17 pairs. Runs
          // above 15 pairs insert incrementally; smaller runs defer hashing.
          while (end < node.entries.length && end - index < 17 && node.entries[end].kind === "entry") {
            meter.checkpoint(); end++;
          }
          let cursor = index;
          meter.checkpoint(0, 32);
          const pending: (readonly [Value, Value])[] = [];
          let group: ExpressionDictionary<Value> | undefined;
          if (end - index > 15) { meter.checkpoint(1, 32); group = context.beginDictionary([]); }
          index = end;
          const finishGroup = () => {
            if (dictionary === undefined) { dictionary = group!; work.push(nextChunk); }
            else {
              const mapping = group!.finish();
              work.push(() => { dictionary!.update(mapping); work.push(nextChunk); });
            }
          };
          const nextPair = () => {
            if (cursor === end) {
              if (group === undefined) group = context.beginDictionary(pending);
              work.push(finishGroup);
              return;
            }
            const pair = node.entries[cursor++] as Extract<DictionaryEntry, { kind: "entry" }>;
            work.push(() => {
              const key = value;
              work.push(() => {
                if (group === undefined) { meter.checkpoint(0, 56); pending.push([key, value]); }
                else group.set(key, value);
                work.push(nextPair);
              }, { node: pair.value, test: "value" });
            }, { node: pair.key, test: "value" });
          };
          work.push(nextPair);
        };
        work.push(nextChunk);
        break;
      }
      case "set": {
        // CPython's stack-use guideline changes observable hash-call timing:
        // small initial runs are evaluated before BUILD_SET, large ones use adds.
        let initialCount = 0;
        if (node.items.length <= 30) {
          while (initialCount < node.items.length && node.items[initialCount].kind !== "unpack") {
            meter.checkpoint(); initialCount++;
          }
        }
        meter.checkpoint(0, 32);
        const initial: Value[] = [];
        let set: ExpressionSet<Value> | undefined, index = 0;
        const nextItem = () => {
          if (set === undefined && index === initialCount) {
            set = context.beginSet(initial);
            work.push(nextItem);
            return;
          }
          const item = node.items[index++];
          if (item === undefined) { value = set!.finish(); knownTruth = undefined; return; }
          work.push(() => {
            if (item.kind === "unpack") set!.update(value);
            else if (set === undefined) { meter.checkpoint(0, 8); initial.push(value); }
            else set.add(value);
            work.push(nextItem);
          }, { node: item.kind === "unpack" ? item.value : item, test: "value" });
        };
        work.push(nextItem);
        break;
      }
      case "tuple":
      case "list":
      case "subscript": {
        let object!: Value;
        const assemble = () => {
          meter.checkpoint(0, 32);
          const keys: Value[] = [];
          let index = 0;
          const nextItem = () => {
            const item = node.items[index++];
            if (item === undefined) {
              if (node.kind === "subscript") {
                work.push(() => {
                  if (mode === "subscript-reference" && node === expression) {
                    meter.checkpoint(1, 32);
                    reference = { object, key: value };
                  } else value = context.getItem(object, value);
                  knownTruth = undefined;
                });
                if (node.tuple) work.push(() => { value = context.tuple(keys); });
                else value = keys[0];
              } else {
                value = node.kind === "list" ? context.list(keys) : context.tuple(keys);
                knownTruth = undefined;
              }
              return;
            }
            if (item.kind === "slice") {
              meter.checkpoint(0, 120);
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
                const slice = context.slice(parts);
                meter.checkpoint(0, 8); keys.push(slice);
                work.push(nextItem);
              };
              work.push(nextPart);
            } else if (item.kind === "unpack") {
              work.push(() => {
                const iterator = context.iterate(value, name => {
                  throw new PythonRuntimeError("TypeError", `Value after * must be an iterable, not ${name}`);
                }, true);
                const nextValue = () => {
                  const entry = iterator.next();
                  if (entry.done) work.push(nextItem);
                  else { meter.checkpoint(0, 8); keys.push(entry.value); work.push(nextValue); }
                };
                work.push(nextValue);
              }, { node: item.value, test: "value" });
            } else {
              work.push(() => { meter.checkpoint(0, 8); keys.push(value); work.push(nextItem); }, { node: item, test: "value" });
            }
          };
          work.push(nextItem);
        };
        if (node.kind === "subscript") {
          work.push(() => { object = value; assemble(); }, { node: node.object, test: "value" });
        } else work.push(assemble);
        break;
      }
      case "call": {
        const attribute = context.beginMethodCall !== undefined && node.callee.kind === "attribute" && node.arguments.every(argument => {
          meter.checkpoint(); return argument.kind !== "starred" && argument.kind !== "mapping";
        }) ? node.callee : undefined;
        work.push(() => {
          const call = attribute === undefined ? context.beginCall(value) : context.beginMethodCall!(value, attribute.name);
          const arguments_ = evaluateCallArguments(node.arguments, call, meter);
          const advance = () => {
            const next = arguments_.next(value);
            if (next.done) { value = next.value; knownTruth = undefined; }
            else work.push(advance, { node: next.value, test: "value" });
          };
          work.push(advance);
        }, { node: attribute?.object ?? node.callee, test: "value" });
        break;
      }
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
      default: {
        const unexpected:never=node;
        throw new Error(`invalid expression node: ${unexpected}`);
      }
    }
  }
  // A terminal node/continuation may call guest code without scheduling another
  // task. Observe its cancellation before publishing the expression result.
  meter.checkpoint(0);
  if (mode === "subscript-reference") {
    if (reference === undefined) throw new Error("subscript reference was not resolved");
    return reference;
  }
  if (mode === "branch") {
    meter.checkpoint();
    const truth = knownTruth ?? context.truth(value);
    meter.checkpoint(0);
    return truth;
  }
  return value;
}
