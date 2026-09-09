import type { Expression } from "../ast.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeMutateItem } from "./runtime-mutation.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";
import type { IntegerIndexContext } from "./index-protocol.js";

export interface RuntimeReferenceWrites {
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
 * Guest subscription mutation slots and full closure accounting remain pending.
 */
export function resolveRuntimeReference(target: Expression, context: ExpressionContext<RuntimeValue>, writes: RuntimeReferenceWrites, values: RuntimeValues, meter: ExecutionMeter): RuntimeReference {
  meter.checkpoint(1, 128);
  switch (target.kind) {
    case "name": return {
      get() { meter.checkpoint(); return context.load(target.name); },
      set(value) { meter.checkpoint(); context.store(target.name, value); },
      remove() { meter.checkpoint(); writes.deleteName(target.name); }
    };
    case "attribute": {
      const object = evaluateExpression(target.object, context, meter);
      return {
        get() { meter.checkpoint(); return context.attribute(object, target.name); },
        set(value) { meter.checkpoint(); writes.setAttribute(object, target.name, value); },
        remove() { meter.checkpoint(); writes.deleteAttribute(object, target.name); }
      };
    }
    case "subscript": {
      const { object, key } = evaluateExpression(target, context, meter, "subscript-reference");
      return {
        get() { meter.checkpoint(); return context.getItem(object, key); },
        set(value) { meter.checkpoint(1, 32); runtimeMutateItem(object, key, { kind: "set", value }, values, meter, writes.integerIndex); },
        remove() { meter.checkpoint(1, 16); runtimeMutateItem(object, key, { kind: "delete" }, values, meter, writes.integerIndex); }
      };
    }
    default: throw new Error(`invalid reference target: ${target.kind}`);
  }
}
