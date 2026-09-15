import type { Expression,SourceSpan } from "../ast.js";
import { createExpressionContinuation, evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeMutateSubscription } from "./runtime-subscription.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import type { IntegerIndexContext } from "./index-protocol.js";

export interface RuntimeReferenceWrites {
  /** Restore the retained access site after receiver/key or RHS evaluation. */
  position?(site:SourceSpan):void;
  readonly subscription?: BuiltinInvocationContext;
  readonly integerIndex?: IntegerIndexContext<RuntimeValue>;
  deleteName(name: string): void;
  setAttribute(object: RuntimeValue, name: string, value: RuntimeValue): void;
  deleteAttribute(object: RuntimeValue, name: string): void;
}

export interface RuntimeReference {
  get(): RuntimeValue;
  set(value: RuntimeValue): void;
  remove(): void;
}

/** Resolve one validated target, evaluating receiver/key once but never reading
 * its current value. Later access uses current bound operations on the retained
 * receiver/key, not cached descriptors or values. No host property access occurs.
 * Supplied subscription capabilities resolve mutation slots at access time.
 * Full closure accounting remains pending.
 */
export function resolveRuntimeReference(target: Expression, context: ExpressionContext<RuntimeValue>, writes: RuntimeReferenceWrites, values: RuntimeValues, meter: ExecutionMeter): RuntimeReference {
  meter.checkpoint(1, 352);
  const result = referenceContinuation(target, context, writes, values, meter, false).next();
  if (!result.done) throw Error("synchronous reference resolution unexpectedly suspended");
  return result.value;
}

/** Unstarted target resolution; receiver/key evaluations may yield but implicit
 * get/set/delete protocols remain ordinary calls. No target read occurs here. */
export function createRuntimeReferenceContinuation(target: Expression, context: ExpressionContext<RuntimeValue>, writes: RuntimeReferenceWrites, values: RuntimeValues, meter: ExecutionMeter): Generator<RuntimeValue, RuntimeReference, RuntimeValue> {
  meter.checkpoint(1, 352);
  return referenceContinuation(target, context, writes, values, meter, true);
}

function* referenceContinuation(target: Expression, context: ExpressionContext<RuntimeValue>, writes: RuntimeReferenceWrites, values: RuntimeValues, meter: ExecutionMeter, suspended: boolean): Generator<RuntimeValue, RuntimeReference, RuntimeValue> {
  meter.checkpoint(0);
  const site=(target.kind==="attribute"?target.nameSpan:undefined)??target.contentSpan??target;
  const locate=()=>{if(writes.position!==undefined){try{writes.position(site);}finally{meter.checkpoint(0);}}};
  switch (target.kind) {
    case "name": return {
      get() { meter.checkpoint(); locate(); return context.load(target.name); },
      set(value) { meter.checkpoint(); locate(); context.store(target.name, value); },
      remove() { meter.checkpoint(); locate(); writes.deleteName(target.name); }
    };
    case "attribute": {
      const object = suspended ? yield* createExpressionContinuation(target.object, context, meter, values.none) : evaluateExpression(target.object, context, meter);
      return {
        get() { meter.checkpoint(); locate(); return context.attribute(object, target.name); },
        set(value) { meter.checkpoint(); locate(); writes.setAttribute(object, target.name, value); },
        remove() { meter.checkpoint(); locate(); writes.deleteAttribute(object, target.name); }
      };
    }
    case "subscript": {
      const { object, key } = suspended ? yield* createExpressionContinuation(target, context, meter, values.none, "subscript-reference") : evaluateExpression(target, context, meter, "subscript-reference");
      return {
        get() { meter.checkpoint(); locate(); return context.getItem(object, key); },
        set(value) { meter.checkpoint(1, 96); locate(); runtimeMutateSubscription(object, key, { kind: "set", value }, values, meter, writes.subscription, writes.integerIndex, context.iterate.bind(context)); },
        remove() { meter.checkpoint(1, 16); locate(); runtimeMutateSubscription(object, key, { kind: "delete" }, values, meter, writes.subscription, writes.integerIndex); }
      };
    }
    default: throw new Error(`invalid reference target: ${target.kind}`);
  }
}
